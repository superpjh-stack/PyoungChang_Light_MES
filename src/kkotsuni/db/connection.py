"""Bound parameters, short-lived connections, explicit atomic transactions."""

from contextlib import contextmanager

import psycopg
from psycopg import sql
from psycopg.rows import dict_row


class Connection:
    def __init__(self, raw):
        self.raw = raw

    def q(self, statement, params=()):
        return self.raw.execute(statement, params).fetchall()

    def one(self, statement, params=()):
        return self.raw.execute(statement, params).fetchone()

    def x(self, statement, params=()):
        return self.raw.execute(statement, params).rowcount

    def tx(self):
        return self.raw.transaction()

    def lock(self, name):
        # Transaction-scoped lock, released on success and failure.
        self.raw.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (name,))


@contextmanager
def connect(url, schema="public"):
    with psycopg.connect(url, autocommit=True, row_factory=dict_row, connect_timeout=5) as raw:
        raw.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        yield Connection(raw)
