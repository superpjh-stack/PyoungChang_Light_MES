"""HTML request security and post/redirect/get helpers."""

import secrets
from urllib.parse import urlsplit

from fastapi import HTTPException
from starlette.responses import RedirectResponse


def local_url(value, default="/"):
    value = str(value or "")
    parsed = urlsplit(value)
    return (
        value
        if value.startswith("/")
        and not value.startswith("//")
        and not parsed.netloc
        and not parsed.scheme
        and "\\" not in value
        and not any(ord(c) < 32 for c in value)
        else default
    )


def csrf_token(request):
    if "csrf" not in request.session:
        request.session["csrf"] = secrets.token_urlsafe(32)
    return request.session["csrf"]


def check_csrf(request, value):
    expected = request.session.get("csrf")
    if not expected or not secrets.compare_digest(expected, str(value or "")):
        raise HTTPException(403, "보안 토큰이 만료되었습니다. 페이지를 새로고침해 주세요.")


def saved(request, target, message="저장했습니다."):
    request.session["flash"] = message
    return RedirectResponse(local_url(target), status_code=303)
