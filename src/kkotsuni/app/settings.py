import os
import secrets
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("KKOTSUNI_DATABASE_URL", "postgresql:///kkotsuni_db"))
    dev_auth: bool = field(default_factory=lambda: os.getenv("KKOTSUNI_DEV_AUTH", "false").lower() == "true")
    secret_key: str = field(default_factory=lambda: os.getenv("KKOTSUNI_SECRET_KEY") or secrets.token_urlsafe(48))
    secure_cookie: bool = field(default_factory=lambda: os.getenv("KKOTSUNI_SECURE_COOKIE", "false").lower() == "true")
    db_schema: str = field(default_factory=lambda: os.getenv("KKOTSUNI_DB_SCHEMA", "public"))
