"""Existing R1 access contract; identity-header emulation is explicit development mode only."""

from kkotsuni.app.errors import BusinessError
from kkotsuni.db.repositories import get

RANK = {"VIEWER": 0, "OPERATOR": 1, "ADMIN": 2}


def get_user(request, db):
    if not request.app.state.settings.dev_auth:
        return None
    ident = request.headers.get("X-User-Id") or request.session.get("user_id")
    return get(db, "app_user", "user_id", ident) if ident else None


def require_action(user, role):
    if not user:
        raise BusinessError("인증이 필요합니다 (등록된 사용자여야 합니다)", 401)
    if RANK.get(user.get("role"), -1) < RANK[role]:
        raise BusinessError(f"권한이 부족합니다 ({role} 이상 필요)", 403)


def require_screen(user, screen):
    # R1 currently permits anonymous reads. This is distinct from authentication.
    return None


def require_write(user, screen, obj=None):
    # Existing R1 writes are public except action-gated issuance, ERP and admin settings.
    # Do not invent the unavailable manufacturing D-26/D-28 permission matrix.
    return None
