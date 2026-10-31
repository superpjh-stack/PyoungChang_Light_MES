from collections import defaultdict
from decimal import Decimal

from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.services import orders
from kkotsuni.services.common import day, number


def get(db, no):
    row = repo.require(db, "ship_order", "ship_order_no", no, "출고지시서")
    row["customer_name"] = repo.require(db, "customer", "customer_code", row["customer_code"])["name"]
    if row["delivery_site_id"]:
        site = repo.get(db, "delivery_site", "delivery_site_id", row["delivery_site_id"])
        row["delivery_site"] = (
            {k: site[k] for k in ("site_name", "address", "receiver_name", "receiver_phone")} if site else None
        )
    row["lines"] = db.q(
        """SELECT d.*,p.name AS product_name,p.spec AS product_spec,p.unit AS product_unit
       FROM ship_order_dtl d JOIN product p ON p.product_code=d.product_code WHERE d.ship_order_no=%s ORDER BY d.ship_order_dtl_id""",
        (no,),
    )
    for line in row["lines"]:
        line["sources"] = db.q(
            "SELECT * FROM ship_order_src WHERE ship_order_dtl_id=%s ORDER BY id", (line["ship_order_dtl_id"],)
        )
    return row


def generate(db, data, actor=None):
    ship_date = day(data.get("ship_date"), "ship_date(출고예정일)")
    db.lock("shipping:generate")
    conditions, params = (
        [
            "o.status='CONFIRMED'",
            "o.ship_due_date=%s",
            "NOT EXISTS (SELECT 1 FROM ship_order_src s WHERE s.order_no=d.order_no AND s.order_line_no=d.line_no)",
        ],
        [ship_date],
    )
    for key, col in (
        ("customer_code", "o.customer_code"),
        ("delivery_site_id", "o.delivery_site_id"),
        ("ship_method", "o.ship_method"),
        ("product_code", "d.product_code"),
    ):
        if data.get(key):
            conditions.append(f"{col}=%s")
            params.append(data[key])
    lines = db.q(
        """SELECT o.order_no,d.line_no,o.customer_code,o.delivery_site_id,o.ship_method,d.product_code,d.quantity,d.unit
       FROM order_dtl d JOIN order_hdr o ON o.order_no=d.order_no WHERE """
        + " AND ".join(conditions)
        + " ORDER BY o.order_no,d.line_no FOR UPDATE OF o,d",
        params,
    )
    groups = defaultdict(list)
    for line in lines:
        groups[(line["customer_code"], line["delivery_site_id"])].append(line)
    numbers, touched, total = [], set(), Decimal(0)
    for (code, site), rows in groups.items():
        no = repo.next_number(db, "ship", ship_date)
        repo.insert(
            db,
            "ship_order",
            {
                "ship_order_no": no,
                "ship_date": ship_date,
                "customer_code": code,
                "delivery_site_id": site,
                "ship_method": rows[0]["ship_method"],
            },
        )
        products = defaultdict(list)
        for row in rows:
            products[row["product_code"]].append(row)
        for product_code, sources in products.items():
            product = repo.require(db, "product", "product_code", product_code, "제품")
            qty = sum(s["quantity"] for s in sources)
            packed = qty / product["pack_size"] if product["pack_size"] and product["pack_size"] > 0 else qty
            dtl = repo.insert(
                db,
                "ship_order_dtl",
                {
                    "ship_order_no": no,
                    "product_code": product_code,
                    "instructed_qty": qty,
                    "packed_qty": packed,
                    "pack_unit": product["pack_unit"] if product["pack_size"] else None,
                },
            )
            total += qty
            for src in sources:
                repo.insert(
                    db,
                    "ship_order_src",
                    {
                        "ship_order_dtl_id": dtl["ship_order_dtl_id"],
                        "order_no": src["order_no"],
                        "order_line_no": src["line_no"],
                        "allocated_qty": src["quantity"],
                    },
                )
                touched.add(src["order_no"])
        numbers.append(no)
    for no in sorted(touched):
        # A product filter may select only part of an order: keep remaining lines eligible.
        pending = db.one(
            """SELECT 1 FROM order_dtl d WHERE order_no=%s AND NOT EXISTS
          (SELECT 1 FROM ship_order_src s WHERE s.order_no=d.order_no AND s.order_line_no=d.line_no) LIMIT 1""",
            (no,),
        )
        if not pending:
            orders.change_status(db, no, "SHIP_ORDERED", actor)
    return {"shipOrders": numbers, "totalInstructedQty": total, "sourceOrderCount": len(touched)}


def assert_not_issued(db, ident):
    issued = db.one(
        """SELECT 1 FROM ship_order_src s JOIN invoice_dtl d
        ON d.order_no=s.order_no JOIN invoice_hdr h ON h.invoice_no=d.invoice_no
        WHERE s.ship_order_dtl_id=%s AND h.status='ISSUED' LIMIT 1""",
        (ident,),
    )
    if issued:
        raise BusinessError("이미 발행된 명세서와 연결된 출고 수량은 변경할 수 없습니다", 409)


def edit_line(db, ident, data, actor=None):
    db.lock("shipping:results")
    if "instructed_qty" in data:
        assert_not_issued(db, ident)
    row = repo.require(db, "ship_order_dtl", "ship_order_dtl_id", ident, "출고지시 라인", lock=True)
    values = {k: data[k] for k in ("instructed_qty", "note") if k in data}
    if "instructed_qty" in values:
        values["instructed_qty"] = number(values["instructed_qty"], "instructed_qty", positive=True)
    for key, value in values.items():
        if row[key] != value:
            repo.insert(
                db,
                "ship_order_dtl_revision",
                {
                    "ship_order_dtl_id": ident,
                    "field": key,
                    "old_value": str(row[key]) if row[key] is not None else None,
                    "new_value": str(value) if value is not None else None,
                    "changed_by": actor,
                },
            )
    if "instructed_qty" in values:
        p = repo.require(db, "product", "product_code", row["product_code"])
        values["packed_qty"] = values["instructed_qty"] / p["pack_size"] if p["pack_size"] else values["instructed_qty"]
    return repo.update(
        db, "ship_order_dtl", "ship_order_dtl_id", ident, values, ("instructed_qty", "note", "packed_qty")
    )


def results(db, ident):
    return db.q("SELECT * FROM ship_result WHERE ship_order_dtl_id=%s ORDER BY id", (ident,))


def register(db, ident, data, actor=None):
    # Shared lock order for generation, actual quantities and invoice validation.
    db.lock("shipping:results")
    row = repo.require(db, "ship_order_dtl", "ship_order_dtl_id", ident, "출고지시 라인", lock=True)
    assert_not_issued(db, ident)
    qty = number(data.get("actual_qty"), "actual_qty")
    if qty != row["instructed_qty"] and not data.get("diff_reason_code"):
        raise BusinessError("지시수량과 실출고수량이 다르면 차이 사유(diff_reason_code)가 필요합니다")
    repo.insert(
        db,
        "ship_result",
        {
            "ship_order_dtl_id": ident,
            "actual_qty": qty,
            "pack_lot": data.get("pack_lot"),
            "diff_reason_code": data.get("diff_reason_code"),
            "registered_by": actor or data.get("registered_by"),
        },
    )
    for src in db.q(
        "SELECT DISTINCT order_no FROM ship_order_src WHERE ship_order_dtl_id=%s ORDER BY order_no", (ident,)
    ):
        no = src["order_no"]
        order = repo.require(db, "order_hdr", "order_no", no, lock=True)
        absent = db.one(
            """SELECT 1 FROM order_dtl d WHERE d.order_no=%s AND NOT EXISTS
           (SELECT 1 FROM ship_order_src s JOIN ship_result r ON r.ship_order_dtl_id=s.ship_order_dtl_id
            WHERE s.order_no=d.order_no AND s.order_line_no=d.line_no) LIMIT 1""",
            (no,),
        )
        if not absent and order["status"] == "SHIP_ORDERED":
            orders.change_status(db, no, "SHIPPED", actor)
    absent = db.one(
        """SELECT 1 FROM ship_order_dtl d WHERE d.ship_order_no=%s AND NOT EXISTS
         (SELECT 1 FROM ship_result r WHERE r.ship_order_dtl_id=d.ship_order_dtl_id) LIMIT 1""",
        (row["ship_order_no"],),
    )
    if not absent:
        repo.update(
            db,
            "ship_order",
            "ship_order_no",
            row["ship_order_no"],
            {"status": "RESULT_REGISTERED"},
            ("status",),
            timestamp=True,
        )
    return results(db, ident)


def summary(db, no):
    lines = db.q("SELECT * FROM ship_order_dtl WHERE ship_order_no=%s ORDER BY ship_order_dtl_id", (no,))
    for line in lines:
        rows = results(db, line["ship_order_dtl_id"])
        total = sum(r["actual_qty"] for r in rows) if rows else None
        line.update(
            results=rows, totalActualQty=total, diffQty=total - line["instructed_qty"] if total is not None else None
        )
    return lines
