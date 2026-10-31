"""Password authentication, revocable sessions and a production request gate."""
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import quote

import psycopg
from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, RedirectResponse

from kkotsuni.app.dependencies import get_db
from kkotsuni.app.http import check_csrf, csrf_token, local_url
from kkotsuni.app.nav import APP_NAME
from kkotsuni.db.connection import connect

router = APIRouter()
ITERATIONS = 600_000


def hash_password(password):
    salt = secrets.token_hex(16)
    value = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), ITERATIONS).hex()
    return f'pbkdf2_sha256${ITERATIONS}${salt}${value}'


def verify_password(password, encoded):
    try:
        algorithm, rounds, salt, expected = encoded.split('$')
        if algorithm != 'pbkdf2_sha256' or int(rounds) != ITERATIONS:
            return False
        actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(rounds)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def session_user(settings, token):
    if not token or not isinstance(token, str):
        return None
    with connect(settings.database_url, settings.db_schema) as db:
        return db.one('''SELECT u.* FROM auth_session s JOIN auth_credential c USING(user_id)
            JOIN app_user u USING(user_id) WHERE s.token_hash=%s AND c.enabled
            AND s.expires_at>CURRENT_TIMESTAMP''', (token_hash(token),))


class AuthenticationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        settings = request.app.state.settings
        path = request.url.path
        if path == '/dev/account' and not settings.dev_auth:
            return JSONResponse({'error': '요청 경로를 확인하세요'}, status_code=404)
        if settings.dev_auth or path in ('/login', '/api/health') or path.startswith('/static/'):
            return await call_next(request)
        try:
            user = await run_in_threadpool(session_user, settings, request.session.get('auth_token'))
        except psycopg.OperationalError:
            return JSONResponse({'error': '데이터베이스에 연결할 수 없습니다'}, status_code=503)
        if not user:
            if path.startswith('/api/'):
                return JSONResponse({'error': '로그인이 필요합니다'}, status_code=401)
            return RedirectResponse('/login?next=' + quote(path, safe=''), status_code=303)
        request.state.auth_user = user
        if (path == '/users' or path == '/api/users' or path.startswith('/api/users/')) and user['role'] != 'ADMIN':
            return JSONResponse({'error': '관리자 권한이 필요합니다'}, status_code=403)
        if path.startswith('/api/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            expected = request.session.get('csrf', '')
            if not expected or not hmac.compare_digest(expected, request.headers.get('X-CSRF-Token', '')):
                return JSONResponse({'error': '보안 토큰을 확인하세요'}, status_code=403)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response


def authenticate(db, username, password, address):
    now = datetime.now(UTC)
    keys = sorted(['user:' + token_hash(username), 'ip:' + token_hash(address)])
    with db.tx():
        for key in keys:
            db.lock('login:' + key)
            db.x('INSERT INTO auth_login_limit(key) VALUES (%s) ON CONFLICT DO NOTHING', (key,))
        limits = [db.one('SELECT * FROM auth_login_limit WHERE key=%s', (key,)) for key in keys]
        if any(row['locked_until'] and row['locked_until'] > now for row in limits):
            return None, 429
        row = db.one('SELECT * FROM auth_credential WHERE user_id=%s', (username,))
        # Perform equal-cost work even when the account is absent.
        encoded = row['password_hash'] if row else f'pbkdf2_sha256${ITERATIONS}$missing$' + '0' * 64
        valid = verify_password(password, encoded)
        if not row or not row['enabled'] or not valid:
            for key, limit in zip(keys, limits):
                failures = limit['failures'] + 1 if now - limit['window_start'] < timedelta(minutes=15) else 1
                db.x('UPDATE auth_login_limit SET failures=%s,window_start=%s,locked_until=%s WHERE key=%s',
                     (failures, limit['window_start'] if failures > 1 else now,
                      now + timedelta(minutes=15) if failures >= 5 else None, key))
            return None, 401
        for key in keys:
            db.x('DELETE FROM auth_login_limit WHERE key=%s', (key,))
        db.x('DELETE FROM auth_session WHERE expires_at<CURRENT_TIMESTAMP')
        token = secrets.token_urlsafe(32)
        db.x('INSERT INTO auth_session(token_hash,user_id,expires_at) VALUES (%s,%s,%s)',
             (token_hash(token), username, now + timedelta(hours=8)))
        return token, 200


def login_page(request, error=None, status=200, target='/'):
    from kkotsuni.app.templating import templates
    response = templates.TemplateResponse(request=request, name='login.html', context={
        'app_name': APP_NAME, 'csrf': csrf_token(request), 'error': error, 'target': local_url(target),
    }, status_code=status)
    response.headers['Cache-Control'] = 'no-store'
    return response


@router.get('/login')
def login_form(request: Request):
    return login_page(request, target=request.query_params.get('next'))


@router.post('/login')
async def login(request: Request, db: Annotated[object, Depends(get_db)]):
    if len(await request.body()) > 16384:
        return login_page(request, '입력값이 너무 깁니다', 400)
    data = await request.form()
    check_csrf(request, data.get('_csrf'))
    username = str(data.get('username', '')).strip()
    password = str(data.get('password', ''))
    target = local_url(data.get('next'))
    if not username or len(username)>100 or not password or len(password)>256:
        return login_page(request, '아이디와 비밀번호를 확인하세요', 401, target)
    token, status = await run_in_threadpool(authenticate, db, username, password,
                                          request.client.host if request.client else 'unknown')
    if not token:
        message = '시도가 너무 많습니다. 15분 후 다시 로그인하세요.' if status == 429 else '아이디와 비밀번호를 확인하세요'
        return login_page(request, message, status, target)
    old_token = request.session.get('auth_token')
    if old_token:
        await run_in_threadpool(db.x, 'DELETE FROM auth_session WHERE token_hash=%s', (token_hash(old_token),))
    request.session.clear()
    request.session['auth_token'] = token
    csrf_token(request)
    return RedirectResponse(target, status_code=303, headers={'Cache-Control': 'no-store'})


@router.post('/logout')
async def logout(request: Request, db: Annotated[object, Depends(get_db)]):
    data = await request.form()
    check_csrf(request, data.get('_csrf'))
    token = request.session.get('auth_token')
    if token:
        await run_in_threadpool(db.x, 'DELETE FROM auth_session WHERE token_hash=%s', (token_hash(token),))
    request.session.clear()
    return RedirectResponse('/login', status_code=303, headers={'Cache-Control': 'no-store'})
