import re

from fastapi.testclient import TestClient

from kkotsuni.app.auth import verify_password
from kkotsuni.app.main import create_app
from kkotsuni.app.settings import Settings
from tools.create_user import provision

PASSWORD = 'test-only-password!'


def production_client(db, db_url):
    schema = db.one('SELECT current_schema() AS name')['name']
    return TestClient(create_app(Settings(database_url=db_url, db_schema=schema,
                                         dev_auth=False, secret_key='test-only-session-key')))


def csrf(response):
    return re.search(r'name="_csrf" value="([^"]+)"', response.text).group(1)


def login(client, password=PASSWORD, target='/'):
    token = csrf(client.get('/login'))
    return client.post('/login', data={'_csrf': token, 'username': 'admin', 'password': password,
                                      'next': target}, follow_redirects=False)


def test_login_gate_csrf_logout_and_replay(db, db_url):
    provision(db, 'admin', '관리자', 'ADMIN', PASSWORD)
    encoded = db.one('SELECT password_hash FROM auth_credential')['password_hash']
    assert PASSWORD not in encoded and verify_password(PASSWORD, encoded)
    with production_client(db, db_url) as c:
        assert c.get('/orders', follow_redirects=False).status_code == 303
        assert c.get('/api/orders', headers={'X-User-Id': 'admin'}).status_code == 401
        assert c.get('/api/health').status_code == 200
        assert c.post('/login', data={'username': 'admin', 'password': PASSWORD}).status_code == 403
        assert login(c, 'wrong-password').status_code == 401
        assert login(c, target='//evil.example').headers['location'] == '/'
        page = c.get('/settings')
        assert page.status_code == 200 and '로그아웃' in page.text and '관리자' in page.text
        assert c.get('/api/orders').status_code == 200
        assert c.post('/api/customers', json={}).status_code == 403
        token = csrf(page)
        # Admin identity reaches the existing protected operation.
        response = c.put('/api/settings/approval-amount-threshold', json={'value': 500000},
                         headers={'X-CSRF-Token': token})
        assert response.status_code == 200
        assert c.post('/logout', data={}).status_code == 403
        old_cookie = c.cookies.get('session')
        assert c.post('/logout', data={'_csrf': token}, follow_redirects=False).status_code == 303
        c.cookies.set('session', old_cookie)
        assert c.get('/api/orders').status_code == 401


def test_login_lockout_and_expiry(db, db_url):
    provision(db, 'admin', '관리자', 'ADMIN', PASSWORD)
    with production_client(db, db_url) as c:
        for _ in range(5):
            assert login(c, 'incorrect').status_code == 401
        assert login(c).status_code == 429
        db.x('DELETE FROM auth_login_limit')
        assert login(c).status_code == 303
        db.x("UPDATE auth_session SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second'")
        assert c.get('/api/orders').status_code == 401


def test_account_disabled_and_viewer_cannot_promote(db, db_url):
    provision(db, 'admin', '조회자', 'VIEWER', PASSWORD)
    with production_client(db, db_url) as c:
        assert login(c).status_code == 303
        assert c.get('/api/users').status_code == 403
        page = c.get('/')
        assert c.post('/actions', data={'_csrf': csrf(page), '_path': '/users/admin',
                                      '_method': 'PUT', 'role': 'ADMIN'}).status_code == 403
        db.x('UPDATE auth_credential SET enabled=FALSE')
        assert c.get('/api/orders').status_code == 401
