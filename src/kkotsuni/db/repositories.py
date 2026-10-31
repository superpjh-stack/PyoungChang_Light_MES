"""Small repository primitives. SQL identifiers are composed, never interpolated from requests."""

from psycopg import sql

from kkotsuni.app.errors import BusinessError


def get(db, table, key, value, lock=False):
    query = sql.SQL("SELECT * FROM {} WHERE {} = %s").format(sql.Identifier(table), sql.Identifier(key))
    if lock:
        query += sql.SQL(" FOR UPDATE")
    return db.one(query, (value,))


def require(db, table, key, value, label="대상", lock=False):
    row = get(db, table, key, value, lock)
    if row is None:
        raise BusinessError(f"{label}을(를) 찾을 수 없습니다", 404)
    return row


def insert(db, table, values):
    query = sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING *").format(
        sql.Identifier(table),
        sql.SQL(",").join(map(sql.Identifier, values)),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return db.one(query, tuple(values.values()))


def update(db, table, key, value, patch, allowed, timestamp=False):
    fields = {k: v for k, v in patch.items() if k in allowed}
    if not fields:
        return get(db, table, key, value)
    assignments = [sql.SQL("{} = %s").format(sql.Identifier(k)) for k in fields]
    if timestamp:
        assignments.append(sql.SQL("updated_at = CURRENT_TIMESTAMP"))
    return db.one(
        sql.SQL("UPDATE {} SET {} WHERE {} = %s RETURNING *").format(
            sql.Identifier(table), sql.SQL(",").join(assignments), sql.Identifier(key)
        ),
        (*fields.values(), value),
    )


def listing(db, table, filters=None, allowed=(), order=None):
    fields = {k: v for k, v in (filters or {}).items() if k in allowed and v not in (None, "")}
    query = sql.SQL("SELECT * FROM {}").format(sql.Identifier(table))
    if fields:
        query += sql.SQL(" WHERE ") + sql.SQL(" AND ").join(
            sql.SQL("{} = %s").format(sql.Identifier(k)) for k in fields
        )
    if order:
        query += sql.SQL(" ORDER BY {}").format(sql.Identifier(order))
    return db.q(query, tuple(fields.values()))


def next_number(db, kind, date):
    prefix = {"order": "", "ship": "SO-", "invoice": "INV-"}[kind] + str(date).replace("-", "")
    row = db.one(
        """INSERT INTO document_counter (prefix, value) VALUES (%s, 1)
      ON CONFLICT (prefix) DO UPDATE SET value = document_counter.value + 1 RETURNING value""",
        (prefix,),
    )
    return f"{prefix}-{row['value']:04d}"
