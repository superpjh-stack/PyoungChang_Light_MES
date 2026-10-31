from collections import defaultdict

import psycopg

from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.integrations.excel import COLUMNS
from kkotsuni.schemas.input import scalar_record
from kkotsuni.services import masters, matching
from kkotsuni.services.common import day, number


def get(db, no):
    row = repo.require(db, "order_hdr", "order_no", no, "주문")
    row["lines"] = db.q("SELECT * FROM order_dtl WHERE order_no=%s ORDER BY line_no", (no,))
    return row


def listing(db, filters):
    conditions, params = [], []
    for key, column, op in [
        ("customer_code", "o.customer_code", "="),
        ("status", "o.status", "="),
        ("order_date_from", "o.order_date", ">="),
        ("order_date_to", "o.order_date", "<="),
        ("ship_due_date_from", "o.ship_due_date", ">="),
        ("ship_due_date_to", "o.ship_due_date", "<="),
    ]:
        if filters.get(key):
            conditions.append(f"{column} {op} %s")
            params.append(day(filters[key]) if "date" in key else filters[key])
    if filters.get("product_code"):
        conditions.append("EXISTS (SELECT 1 FROM order_dtl d WHERE d.order_no=o.order_no AND d.product_code=%s)")
        params.append(filters["product_code"])
    return db.q(
        "SELECT o.* FROM order_hdr o"
        + (" WHERE " + " AND ".join(conditions) if conditions else "")
        + " ORDER BY o.order_no DESC",
        params,
    )


def customer(db, values):
    if values.get("customer_code"):
        return repo.get(db, "customer", "customer_code", values["customer_code"])
    return db.one("SELECT * FROM customer WHERE name=%s ORDER BY customer_code LIMIT 1", (values.get("customer_name"),))


def row_errors(db, values):
    errors = []
    labels = dict(COLUMNS)
    try:
        scalar_record(values)
        for key, label in COLUMNS:
            value = values.get(key)
            if value is not None and key not in ("quantity", "unit_price") and not isinstance(value, str):
                raise BusinessError(f"{label}은(는) 문자열이어야 합니다")
    except BusinessError as exc:
        return [{"column": "입력값", "reason": str(exc)}]

    def fail(key, text):
        errors.append({"column": labels.get(key, key), "reason": text})

    for key in ("order_date", "ship_due_date", "raw_product_name", "quantity"):
        if values.get(key) in (None, ""):
            fail(key, f"{labels[key]}은(는) 필수 입력 항목입니다")
    if not values.get("customer_code") and not values.get("customer_name"):
        fail("customer_code", "거래처코드 또는 거래처명 중 하나는 반드시 입력해야 합니다")
    elif not customer(db, values):
        fail("customer_code", "등록되지 않은 거래처입니다")
    dates = {}
    for key in ("order_date", "ship_due_date"):
        if values.get(key):
            try:
                dates[key] = day(values[key], labels[key])
            except BusinessError as exc:
                fail(key, str(exc))
    if len(dates) == 2 and dates["ship_due_date"] < dates["order_date"]:
        fail("ship_due_date", "출고예정일은 주문일자보다 빠를 수 없습니다")
    for key in ("quantity", "unit_price"):
        if values.get(key) not in (None, ""):
            try:
                num = number(values[key], labels[key], positive=key == "quantity")
                if key == "quantity" and num != int(num):
                    raise BusinessError("수량은 1 이상의 정수여야 합니다")
            except BusinessError as exc:
                fail(key, str(exc))
    return errors


def preview(db, rows):
    result = []
    for row in rows:
        errors = row_errors(db, row["values"])
        result.append({**row, "valid": not errors, "errors": errors})
    valid = sum(r["valid"] for r in result)
    return {"rows": result, "totalRows": len(result), "validCount": valid, "errorCount": len(result) - valid}


def change_status(db, no, status, actor=None):
    old = repo.require(db, "order_hdr", "order_no", no, "주문", lock=True)
    if old["status"] == status:
        return
    repo.update(db, "order_hdr", "order_no", no, {"status": status}, ("status",), timestamp=True)
    repo.insert(
        db, "order_status_log", {"order_no": no, "from_status": old["status"], "to_status": status, "changed_by": actor}
    )


def commit(db, rows):
    # A batch can span date counters and aliases; one lock avoids opposite-order deadlocks.
    db.lock("orders:upload")
    if not isinstance(rows, list) or not rows:
        raise BusinessError("등록할 rows 배열이 필요합니다")
    groups = defaultdict(list)
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("values"), dict):
            raise BusinessError("각 행에 values 객체가 필요합니다")
        v = row["values"]
        key = tuple(
            str(v.get(k) or "")
            for k in ("customer_code", "customer_name", "order_date", "ship_due_date", "customer_order_no")
        )
        groups[key].append(row)
    result = {"orders": [], "errors": []}
    for key, grouped in groups.items():
        try:
            with db.tx():
                errors = [e for r in grouped for e in row_errors(db, r["values"])]
                if errors:
                    raise BusinessError("; ".join(e["reason"] for e in errors))
                first = grouped[0]["values"]
                c = customer(db, first)
                site = None
                if first.get("delivery_site_name"):
                    site = db.one(
                        "SELECT * FROM delivery_site WHERE customer_code=%s AND site_name=%s ORDER BY delivery_site_id LIMIT 1",
                        (c["customer_code"], first["delivery_site_name"]),
                    )
                    if not site:
                        site = masters.site(
                            db,
                            c["customer_code"],
                            {
                                "site_name": first["delivery_site_name"],
                                "address": first.get("delivery_address"),
                                "receiver_name": first.get("receiver_name"),
                                "receiver_phone": first.get("receiver_phone"),
                            },
                        )
                no = repo.next_number(db, "order", first["order_date"])
                hdr = {
                    k: first.get(k)
                    for k in (
                        "order_date",
                        "ship_due_date",
                        "delivery_address",
                        "receiver_name",
                        "receiver_phone",
                        "ship_method",
                        "customer_order_no",
                        "note",
                    )
                }
                repo.insert(
                    db,
                    "order_hdr",
                    {
                        **hdr,
                        "order_no": no,
                        "customer_code": c["customer_code"],
                        "delivery_site_id": site["delivery_site_id"] if site else None,
                    },
                )
                for idx, row in enumerate(grouped, 1):
                    v = row["values"]
                    matched = matching.match(db, c["customer_code"], v["raw_product_name"], record=True)
                    qty = number(v["quantity"], "수량", positive=True)
                    price = number(v["unit_price"], "단가") if v.get("unit_price") not in (None, "") else None
                    repo.insert(
                        db,
                        "order_dtl",
                        {
                            "order_no": no,
                            "line_no": idx,
                            "raw_product_name": v["raw_product_name"],
                            "product_code": matched["product_code"],
                            "spec": v.get("spec"),
                            "quantity": qty,
                            "unit": v.get("unit"),
                            "unit_price": price,
                            "amount": qty * price if price is not None else None,
                        },
                    )
                repo.insert(db, "order_status_log", {"order_no": no, "from_status": None, "to_status": "RECEIVED"})
            result["orders"].append(no)
        except (BusinessError, psycopg.IntegrityError, psycopg.DataError) as exc:
            result["errors"].append(
                {
                    "groupKey": "|".join(key),
                    "rows": [r.get("rowNumber") for r in grouped],
                    "message": str(exc)
                    if isinstance(exc, BusinessError)
                    else "데이터 제약 위반으로 해당 주문을 등록하지 않았습니다",
                }
            )
    return result


def update(db, no, data):
    row = repo.require(db, "order_hdr", "order_no", no, "주문", lock=True)
    if row["status"] != "RECEIVED":
        raise BusinessError("RECEIVED 상태의 주문만 수정할 수 있습니다", 409)
    repo.update(
        db,
        "order_hdr",
        "order_no",
        no,
        data,
        ("delivery_address", "receiver_name", "receiver_phone", "ship_method", "note"),
        timestamp=True,
    )
    return get(db, no)


def validate(db, no):
    row = get(db, no)
    errors, warnings = [], []
    for line in row["lines"]:
        entry = {"line_no": line["line_no"], "column": "제품명(거래처 표기)"}
        if not line["product_code"]:
            errors.append({**entry, "reason": f"표준 제품으로 매핑되지 않았습니다: {line['raw_product_name']}"})
        else:
            duplicate = db.q(
                """SELECT DISTINCT o.order_no FROM order_hdr o JOIN order_dtl d ON d.order_no=o.order_no
              WHERE o.customer_code=%s AND d.product_code=%s AND o.order_date=%s AND o.order_no<>%s""",
                (row["customer_code"], line["product_code"], row["order_date"], no),
            )
            if duplicate:
                warnings.append(
                    {
                        **entry,
                        "reason": "동일 거래처·제품·주문일자의 주문이 이미 존재합니다: "
                        + ", ".join(d["order_no"] for d in duplicate),
                    }
                )
    if not row["lines"]:
        errors.append({"column": "상세", "reason": "주문 상세가 없습니다"})
    return {"order_no": no, "valid": not errors, "errors": errors, "warnings": warnings}


def confirm(db, no, actor=None):
    row = repo.require(db, "order_hdr", "order_no", no, "주문", lock=True)
    if row["status"] != "RECEIVED":
        raise BusinessError("RECEIVED 상태의 주문만 확정할 수 있습니다", 409)
    validation = validate(db, no)
    if not validation["valid"]:
        raise BusinessError("검증 실패로 확정할 수 없습니다", 422, validation)
    change_status(db, no, "CONFIRMED", actor)
    return {**get(db, no), "warnings": validation["warnings"]}
