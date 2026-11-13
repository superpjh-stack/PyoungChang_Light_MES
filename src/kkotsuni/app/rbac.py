"""Existing R1 access contract; identity-header emulation is explicit development mode only."""

from kkotsuni.app.errors import BusinessError
from kkotsuni.db.repositories import get

RANK = {"VIEWER": 0, "OPERATOR": 1, "ADMIN": 2}


def get_user(request, db):
    if not request.app.state.settings.dev_auth:
        return getattr(request.state, "auth_user", None)
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


# Master data (customers incl. delivery sites/prices, products) and accounts are ADMIN-maintained (MIG-20).
ADMIN_WRITES = ("/users", "/customers", "/products")


def require_write(user, screen, obj=None):
    """R1-N-06: VIEWER is read-only; user and master-data administration is ADMIN only.

    An anonymous caller only exists in explicit development mode (production requires a session),
    where the legacy anonymous R1 writes stay available for header-compatible tests.
    """
    if user is None:
        return
    require_action(user, "ADMIN" if screen.startswith(ADMIN_WRITES) else "OPERATOR")
