import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from psycopg import sql

from kkotsuni.app.settings import Settings
from kkotsuni.db.connection import connect
from tools.db_migrate import migrate


@pytest.fixture(scope="session")
def db_url():
    url = os.getenv("KKOTSUNI_TEST_DATABASE_URL")
    if not url:
        pytest.fail("Set KKOTSUNI_TEST_DATABASE_URL to a dedicated PostgreSQL test database (no SQLite fallback).")
    return url


@pytest.fixture
def db(db_url):
    schema = "test_" + uuid4().hex
    with connect(db_url) as admin:
        admin.raw.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    try:
        with connect(db_url, schema) as conn:
            migrate(conn)
            yield conn
    finally:
        with connect(db_url) as admin:
            admin.raw.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


@pytest.fixture
def client(db, db_url):
    from kkotsuni.app.main import create_app

    schema = db.one("SELECT current_schema() AS schema")["schema"]
    settings = Settings(database_url=db_url, db_schema=schema, dev_auth=True, secret_key="test-session-only")
    with TestClient(create_app(settings)) as test_client:
        yield test_client
