"""Apply additive schema migrations explicitly; never reset a database."""

from pathlib import Path

from kkotsuni.app.settings import Settings
from kkotsuni.db.connection import connect


def migrate(db):
    with db.tx():
        db.lock("kkotsuni:schema")
        db.x(
            "CREATE TABLE IF NOT EXISTS schema_migration (version TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
        )
        for path in sorted((Path(__file__).resolve().parents[1] / "src/kkotsuni/db/migrations").glob("*.sql")):
            if not db.one("SELECT version FROM schema_migration WHERE version=%s", (path.name,)):
                db.raw.execute(path.read_text())
                db.x("INSERT INTO schema_migration(version) VALUES (%s)", (path.name,))


if __name__ == "__main__":
    settings = Settings()
    with connect(settings.database_url) as db:
        migrate(db)
    print("Schema migrations applied (no reset or seed).")
