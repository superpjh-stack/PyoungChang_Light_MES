from datetime import date

import psycopg

from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.schemas.input import scalar_record
from kkotsuni.services.common import day, number, required

FIELDS = {
    "customer": ("name", "biz_reg_no", "contact_name", "contact_phone", "erp_customer_code", "approval_required"),
    "product": ("name", "spec", "unit", "tax_type", "erp_item_code", "pack_unit", "pack_size", "default_price"),
    "app_user": ("name", "role"),
}
KEYS = {"customer": "customer_code", "product": "product_code", "app_user": "user_id"}


def boolean(value):
    if value in (True, 1, "1", "true", "on"):
        return 1
    if value in (False, 0, "0", "false", "", None):
        return 0
    raise BusinessError("참/거짓 값이 올바르지 않습니다")


def save(db, table, data, code=None):
    scalar_record(data)
    key = KEYS[table]
    create = code is None
    required(data, *((key, "name") if create else ()))
    code = data[key] if create else code
    existing = repo.get(db, table, key, code)
    if create and existing:
        raise BusinessError(f"이미 존재하는 코드입니다: {code}", 409)
    if not create and not existing:
        raise BusinessError("대상을 찾을 수 없습니다", 404)
    values = {k: v for k, v in data.items() if k in FIELDS[table]}
    if "name" in values and not str(values["name"] or "").strip():
        raise BusinessError("name은 필수입니다")
    if table == "customer" and "approval_required" in values:
        values["approval_required"] = boolean(values["approval_required"])
    if table == "product":
        for k in ("pack_size", "default_price"):
            if k in values and values[k] not in (None, ""):
                values[k] = number(values[k], k, positive=k == "pack_size")
            elif k in values:
                values[k] = None
        if create:
            values.setdefault("unit", "EA")
            values.setdefault("tax_type", "TAXABLE")
        if values.get("tax_type", "TAXABLE") not in ("TAXABLE", "EXEMPT"):
            raise BusinessError("tax_type은 TAXABLE 또는 EXEMPT여야 합니다")
    if table == "app_user":
        values.setdefault("role", "VIEWER")
        if values["role"] not in ("ADMIN", "OPERATOR", "VIEWER"):
            raise BusinessError("role은 ADMIN, OPERATOR, VIEWER 중 하나여야 합니다")
    if create:
        return repo.insert(db, table, {key: code, **values})
    return repo.update(db, table, key, code, values, FIELDS[table], timestamp=table != "app_user")


def customer(db, code):
    row = repo.require(db, "customer", "customer_code", code, "거래처")
    row["delivery_sites"] = repo.listing(
        db, "delivery_site", {"customer_code": code}, ("customer_code",), "delivery_site_id"
    )
    row["prices"] = db.q(
        "SELECT * FROM customer_price WHERE customer_code=%s ORDER BY product_code,effective_from DESC", (code,)
    )
    return row


def site(db, code, data):
    repo.require(db, "customer", "customer_code", code, "거래처")
    fields = {k: data.get(k) for k in ("site_name", "address", "receiver_name", "receiver_phone")}
    return repo.insert(
        db, "delivery_site", {"customer_code": code, **fields, "is_default": boolean(data.get("is_default"))}
    )


def price(db, code, data, upsert=False):
    scalar_record(data)
    repo.require(db, "customer", "customer_code", code, "거래처")
    product = repo.get(db, "product", "product_code", data.get("product_code"))
    if not product:
        raise BusinessError("존재하지 않는 제품코드입니다")
    values = {
        "customer_code": code,
        "product_code": product["product_code"],
        "unit_price": number(data.get("unit_price"), "unit_price", positive=True),
        "effective_from": day(data.get("effective_from") or date.today().isoformat()),
    }
    existing = db.one(
        "SELECT id FROM customer_price WHERE customer_code=%s AND product_code=%s AND effective_from=%s",
        (code, values["product_code"], values["effective_from"]),
    )
    if existing and not upsert:
        raise BusinessError("이미 등록된 적용일의 단가입니다", 409)
    if existing:
        repo.update(db, "customer_price", "id", existing["id"], values, ("unit_price",))
    else:
        existing = repo.insert(db, "customer_price", values)
    return existing


def sync(db, kind, rows):
    if not isinstance(rows, list) or not rows:
        raise BusinessError("rows 배열이 필요합니다")
    counts = {"createdCount": 0, "updatedCount": 0, "errors": []}
    for row in rows:
        try:
            with db.tx():  # Savepoint: a rejected row must not poison the batch transaction.
                if kind == "customer-prices":
                    required(row, "customer_code", "product_code", "unit_price")
                    old = db.one(
                        "SELECT id FROM customer_price WHERE customer_code=%s AND product_code=%s AND effective_from=%s",
                        (
                            row["customer_code"],
                            row["product_code"],
                            day(row.get("effective_from") or date.today().isoformat()),
                        ),
                    )
                    price(db, row["customer_code"], row, upsert=True)
                else:
                    table = {"customers": "customer", "products": "product"}[kind]
                    required(row, KEYS[table], "name")
                    old = repo.get(db, table, KEYS[table], row[KEYS[table]])
                    save(db, table, row, row[KEYS[table]] if old else None)
                counts["updatedCount" if old else "createdCount"] += 1
        except (BusinessError, psycopg.IntegrityError, psycopg.DataError) as exc:
            counts["errors"].append(
                {"row": row, "message": str(exc) if isinstance(exc, BusinessError) else "입력 데이터 제약 위반"}
            )
    return counts
