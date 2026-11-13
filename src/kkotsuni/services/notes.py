"""Work notes: an append-only log people read later (R1-N-07 keeps the automatic audit trail separately)."""

from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.services.common import required


def listing(db):
    # Shown in Korean business time regardless of the database server's time zone.
    return db.q(
        """SELECT id,title,body,created_by,created_at AT TIME ZONE 'Asia/Seoul' AS created_at
           FROM work_note ORDER BY id DESC"""
    )


def create(db, data, user=None):
    required(data, "title", "body")
    title, body = str(data["title"]).strip(), str(data["body"]).replace("\r\n", "\n").strip()
    if not title or not body:
        raise BusinessError("title, body은(는) 필수입니다")
    if len(title) > 200 or len(body) > 20000:
        raise BusinessError("제목은 200자, 내용은 20,000자 이하로 입력하세요")
    return repo.insert(
        db, "work_note", {"title": title, "body": body, "created_by": (user or {}).get("user_id")}
    )
