"""Login account administration (R1-N-06). Password values are never returned, logged or audited."""

from kkotsuni.app.auth import hash_password, token_hash, verify_password
from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.services import masters

ACCOUNT = """SELECT u.user_id,u.name,u.role,
       (c.user_id IS NOT NULL) AS password_set, c.enabled, u.created_at
  FROM app_user u LEFT JOIN auth_credential c ON c.user_id=u.user_id"""


def listing(db):
    return db.q(ACCOUNT + " ORDER BY u.user_id")


def detail(db, user_id):
    row = db.one(ACCOUNT + " WHERE u.user_id=%s", (user_id,))
    if not row:
        raise BusinessError("사용자를 찾을 수 없습니다", 404)
    return row


def check_password(password, label="비밀번호"):
    if not isinstance(password, str) or not 8 <= len(password) <= 256:
        raise BusinessError(f"{label}는 8자 이상 256자 이하로 입력하세요")


def revoke(db, user_id, keep_token=None):
    """End the user's sessions; keep the caller's own session when it changes its own password."""
    db.x(
        "DELETE FROM auth_session WHERE user_id=%s AND token_hash<>%s",
        (user_id, token_hash(keep_token) if keep_token else ""),
    )


def set_password(db, user_id, password, keep_token=None):
    check_password(password)
    repo.require(db, "app_user", "user_id", user_id, "사용자")
    db.lock("account:" + user_id)
    db.x(
        """INSERT INTO auth_credential(user_id,password_hash) VALUES (%s,%s)
           ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash""",
        (user_id, hash_password(password)),
    )
    revoke(db, user_id, keep_token)


def create(db, data):
    values = dict(data)
    password = values.pop("password", None)
    created = masters.save(db, "app_user", values)
    if password not in (None, ""):
        set_password(db, created["user_id"], password)
    return detail(db, created["user_id"])


def change(db, user_id, data, actor):
    current = repo.require(db, "app_user", "user_id", user_id, "사용자")
    values = {k: data[k] for k in ("name", "role") if k in data and data[k] not in (None, "")}
    if actor and actor.get("user_id") == user_id and values.get("role", current["role"]) != current["role"]:
        raise BusinessError("본인의 역할은 바꿀 수 없습니다", 409)
    if values:
        masters.save(db, "app_user", {**current, **values}, user_id)
    return detail(db, user_id)


def set_enabled(db, user_id, enabled, actor):
    if not isinstance(enabled, bool):
        enabled = masters.boolean(enabled)
    if actor and actor.get("user_id") == user_id and not enabled:
        raise BusinessError("본인 계정은 사용 중지할 수 없습니다", 409)
    if not db.one("SELECT 1 FROM auth_credential WHERE user_id=%s", (user_id,)):
        raise BusinessError("비밀번호가 등록되지 않은 사용자입니다. 먼저 비밀번호를 설정하세요", 409)
    db.x("UPDATE auth_credential SET enabled=%s WHERE user_id=%s", (enabled, user_id))
    if not enabled:
        revoke(db, user_id)
    return detail(db, user_id)


def change_own(db, user_id, current, new, confirm, keep_token):
    row = db.one("SELECT password_hash FROM auth_credential WHERE user_id=%s AND enabled", (user_id,))
    if not row or not verify_password(str(current or ""), row["password_hash"]):
        raise BusinessError("현재 비밀번호가 올바르지 않습니다", 400)
    check_password(new, "새 비밀번호")
    if new != confirm:
        raise BusinessError("새 비밀번호와 확인이 일치하지 않습니다", 400)
    if new == current:
        raise BusinessError("현재 비밀번호와 다른 비밀번호를 입력하세요", 400)
    set_password(db, user_id, new, keep_token)
