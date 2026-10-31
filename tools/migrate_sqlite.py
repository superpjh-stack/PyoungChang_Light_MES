"""Read-only SQLite preflight and atomic import into an already migrated PostgreSQL DB."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
from collections import Counter
from contextlib import closing
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from psycopg import Error as PostgreSQLError
from psycopg import sql

from kkotsuni.db.connection import connect

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SCHEMA = Path(__file__).resolve().parent / "sqlite_source_schema.sql"
TARGET_SCHEMA = ROOT / "src/kkotsuni/db/migrations/001_initial.sql"
MARKER = "__sqlite_import__"


class MigrationError(ValueError):
    """Safe diagnostics contain table/row/column identifiers, never row contents."""


def _model():
    db = sqlite3.connect(":memory:")
    db.executescript(SOURCE_SCHEMA.read_text())
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")]
    columns = {t: list(db.execute(f'PRAGMA table_info("{t}")')) for t in tables}
    return db, tables, columns


def _convert(value, column, target_type):
    if value is None:
        return None
    if target_type == "DATE":
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError
        return date.fromisoformat(value)
    if target_type == "TIMESTAMP":
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?", value):
            raise ValueError
        return datetime.fromisoformat(value)
    if column[2] == "NUMERIC":
        number = Decimal(str(value))
        if not number.is_finite() or abs(number) >= Decimal(10) ** 18 or number != number.quantize(Decimal("0.000001")):
            raise ValueError
        return number
    if column[2] == "INTEGER":
        number = Decimal(str(value))
        bits = 64 if target_type == "BIGINT" else 32
        if not number.is_finite() or number != number.to_integral_value() or not -(2 ** (bits-1)) <= number < 2 ** (bits-1):
            raise ValueError
        return int(number)
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError
    return value


def _canonical(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return format(value.normalize(), 'f') if value else '0'
    return value


def _fingerprint(rows, names):
    serialized = sorted(json.dumps([_canonical(r[n]) for n in names], ensure_ascii=False, separators=(',', ':')) for r in rows)
    return hashlib.sha256('\n'.join(serialized).encode()).hexdigest()


def _summary(rows, names):
    return {
        'count': len(rows),
        'hash': _fingerprint(rows, names),
        'amounts': {n: sum((r[n] or Decimal(0) for r in rows), Decimal(0)) for n in names if n == 'amount' or n.endswith('_amount')},
        'statuses': {n: Counter(r[n] for r in rows) for n in names if n == 'status' or n.endswith('_status')},
    }


def read_source(path):
    """Validate a stable read-only snapshot without connecting to PostgreSQL."""
    scratch, tables, columns = _model()
    target = TARGET_SCHEMA.read_text()
    data = {}
    try:
        with closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)) as source:
            source.row_factory = sqlite3.Row
            source.execute('PRAGMA query_only=ON')
            source.execute('BEGIN')
            for table in tables:
                names = [c[1] for c in columns[table]]
                actual = [r[1] for r in source.execute(f'PRAGMA table_info("{table}")')]
                if actual != names:
                    raise MigrationError(f'{table}: schema_mismatch')
                body = target.split(f'CREATE TABLE IF NOT EXISTS {table} (', 1)[1].split('\n);', 1)[0]
                types = {n: re.search(r'\b' + re.escape(n) + r'\s+(\w+)', body).group(1) for n in names}
                data[table] = []
                for ordinal, row in enumerate(source.execute(f'SELECT * FROM "{table}"'), 1):
                    converted = {}
                    for col in columns[table]:
                        try:
                            converted[col[1]] = _convert(row[col[1]], col, types[col[1]])
                            if converted[col[1]] is None and (col[3] or col[5]):
                                raise ValueError
                        except (ValueError, TypeError, InvalidOperation, OverflowError):
                            raise MigrationError(f'{table}: row {ordinal}: {col[1]}: invalid_value') from None
                    try:
                        scratch.execute(f'INSERT INTO "{table}" VALUES ({",".join("?" for _ in names)})', tuple(_canonical(converted[n]) for n in names))
                    except sqlite3.IntegrityError:
                        raise MigrationError(f'{table}: row {ordinal}: constraint_violation') from None
                    data[table].append(converted)
            if scratch.execute('PRAGMA foreign_key_check').fetchone():
                raise MigrationError('source: foreign_key_violation')
    except sqlite3.DatabaseError:
        raise MigrationError('source: unreadable_database') from None
    finally:
        scratch.close()
    return tables, columns, data


def migrate_sqlite(path, database_url=None, *, apply=False, schema='public'):
    tables, columns, data = read_source(path)
    report = {'mode': 'apply' if apply else 'dry-run', 'counts': {t: len(data[t]) for t in tables}, 'validated': True}
    if not apply:
        return report
    if not database_url:
        raise MigrationError('target: database_url_required')
    with connect(database_url, schema=schema) as db, db.tx():
        db.lock(f'sqlite-import:{schema}')
        db.x(sql.SQL('LOCK TABLE {} IN ACCESS EXCLUSIVE MODE').format(sql.SQL(', ').join(sql.Identifier(t) for t in tables + ['document_counter'])))
        for table in tables + ['document_counter']:
            if db.one(sql.SQL('SELECT 1 FROM {} LIMIT 1').format(sql.Identifier(table))):
                raise MigrationError(f'{table}: target_not_empty')
        for table in tables:
            names = [c[1] for c in columns[table]]
            statement = sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, names)), sql.SQL(',').join(sql.Placeholder() for _ in names))
            with db.raw.cursor() as cursor:
                cursor.executemany(statement, [tuple(row[n] for n in names) for row in data[table]])
            copied = db.q(sql.SQL('SELECT * FROM {}').format(sql.Identifier(table)))
            if _summary(data[table], names) != _summary(copied, names):
                raise MigrationError(f'{table}: verification_failed')
        for table, column in [('order_hdr', 'order_no'), ('ship_order', 'ship_order_no'), ('invoice_hdr', 'invoice_no')]:
            counters = {}
            for row in data[table]:
                match = re.fullmatch(r'((?:SO-|INV-)?\d{8})-(\d+)', row[column])
                if match:
                    counters[match[1]] = max(counters.get(match[1], 0), int(match[2]))
            for prefix, value in counters.items():
                db.x('INSERT INTO document_counter(prefix,value) VALUES (%s,%s)', (prefix,value))
        db.x('INSERT INTO document_counter(prefix,value) VALUES (%s,0)', (MARKER,))
        # ALTER SEQUENCE RESTART is transactional, unlike setval().
        for table in tables:
            for col in columns[table]:
                sequence = db.one('SELECT pg_get_serial_sequence(%s,%s) AS name', (table,col[1]))['name']
                if sequence:
                    next_id = max([r[col[1]] for r in data[table]] + [0]) + 1
                    db.x(sql.SQL('ALTER SEQUENCE {} RESTART WITH {}').format(sql.Identifier(*sequence.split('.')), sql.Literal(next_id)))
    report['verified'] = True
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--schema', default='public')
    args = parser.parse_args()
    try:
        report = migrate_sqlite(args.source, os.getenv('KKOTSUNI_DATABASE_URL'), apply=args.apply, schema=args.schema)
    except MigrationError as error:
        parser.exit(1, str(error) + '\n')
    except (PostgreSQLError, OSError):
        parser.exit(1, 'migration_failed: transaction rolled back; check target configuration\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
