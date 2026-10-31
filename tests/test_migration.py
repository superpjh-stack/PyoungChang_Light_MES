"""Only synthetic SQLite fixtures and isolated PostgreSQL test schemas."""
import hashlib
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from psycopg.errors import CheckViolation

from tools.migrate_sqlite import MARKER, SOURCE_SCHEMA, MigrationError, migrate_sqlite


@pytest.fixture
def source(tmp_path):
    path = tmp_path / 'source.sqlite'
    with sqlite3.connect(path) as db:
        db.executescript(SOURCE_SCHEMA.read_text())
    return path


def populate(path):
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO customer(customer_code,name) VALUES ('C','Synthetic')")
        db.execute("INSERT INTO product(product_code,name,default_price) VALUES ('P','Synthetic',12.125)")
        db.execute("INSERT INTO order_hdr(order_no,order_date,customer_code,ship_due_date) VALUES ('20261031-0042','2026-10-31','C','2026-11-01')")
        db.execute("INSERT INTO order_dtl(order_no,line_no,raw_product_name,product_code,quantity,unit_price,amount) VALUES ('20261031-0042',1,'Synthetic','P',2,12.125,24.25)")
        db.execute("INSERT INTO audit_log(id,entity_type,entity_id,action) VALUES (88,'ORDER','20261031-0042','CREATE')")


def schema_name(db):
    return db.one('SELECT current_schema() AS name')['name']


def test_dry_run_empty_read_only(source):
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    source.chmod(0o444)
    result = migrate_sqlite(source)
    assert result['mode'] == 'dry-run'
    assert result['validated']
    assert all(n == 0 for n in result['counts'].values())
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before


def test_dry_run_does_not_connect(source):
    populate(source)
    assert migrate_sqlite(source, 'not-a-real-url')['counts']['order_dtl'] == 1


@pytest.mark.parametrize('statement', [
    "UPDATE order_hdr SET order_date='bad'",
    "UPDATE order_dtl SET quantity='bad'",
    "UPDATE order_dtl SET quantity=1.0000001",
    "UPDATE order_dtl SET product_code='missing'",
    "UPDATE order_hdr SET status='bad'",
    "UPDATE customer SET created_at='2026-10-31T01:00:00+09:00'",
    "UPDATE order_dtl SET line_no=2147483648",
])
def test_invalid_values_preflight(source, statement):
    populate(source)
    with sqlite3.connect(source) as conn:
        conn.execute('PRAGMA ignore_check_constraints=ON')
        conn.execute(statement)
    with pytest.raises(MigrationError):
        migrate_sqlite(source)


def test_roundtrip_repeat_and_sequences(source, db, db_url):
    populate(source)
    before = source.read_bytes()
    result = migrate_sqlite(source, db_url, apply=True, schema=schema_name(db))
    assert result['verified']
    assert source.read_bytes() == before
    assert str(db.one('SELECT amount FROM order_dtl')['amount']) == '24.250000'
    assert db.one("SELECT value FROM document_counter WHERE prefix='20261031'")['value'] == 42
    assert db.one("INSERT INTO audit_log(entity_type,entity_id,action) VALUES ('TEST','T','CREATE') RETURNING id")['id'] == 89
    with pytest.raises(MigrationError, match='target_not_empty'):
        migrate_sqlite(source, db_url, apply=True, schema=schema_name(db))


def test_empty_import_repeat_refused(source, db, db_url):
    migrate_sqlite(source, db_url, apply=True, schema=schema_name(db))
    assert db.one('SELECT value FROM document_counter WHERE prefix=%s', (MARKER,))['value'] == 0
    with pytest.raises(MigrationError, match='target_not_empty'):
        migrate_sqlite(source, db_url, apply=True, schema=schema_name(db))


def test_target_failure_rolls_back(source, db, db_url):
    populate(source)
    db.x("ALTER TABLE order_dtl ADD CONSTRAINT test_reject CHECK (quantity > 100)")
    with pytest.raises(CheckViolation):
        migrate_sqlite(source, db_url, apply=True, schema=schema_name(db))
    assert db.one('SELECT count(*) AS n FROM customer')['n'] == 0
    assert db.one('SELECT count(*) AS n FROM audit_log')['n'] == 0
    assert db.one('SELECT count(*) AS n FROM document_counter')['n'] == 0


def test_concurrent_import_only_one_succeeds(source, db, db_url):
    populate(source)
    schema = schema_name(db)

    def run():
        try:
            migrate_sqlite(source, db_url, apply=True, schema=schema)
            return 'ok'
        except MigrationError:
            return 'refused'

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: run(), range(2))) == ['ok', 'refused']
    assert db.one('SELECT count(*) AS n FROM order_hdr')['n'] == 1
