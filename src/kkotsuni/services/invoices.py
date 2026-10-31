from collections import defaultdict
from decimal import Decimal

from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.services import orders
from kkotsuni.services.common import day, js_round, number


def get(db, no):
    hdr = repo.require(db, "invoice_hdr", "invoice_no", no, "거래명세서")
    c = repo.require(db, "customer", "customer_code", hdr["customer_code"])
    hdr.update(customer_name=c["name"], customer_biz_reg_no=c["biz_reg_no"])
    hdr["lines"] = db.q(
        """SELECT d.*,p.name AS product_name FROM invoice_dtl d JOIN product p ON p.product_code=d.product_code
          WHERE d.invoice_no=%s ORDER BY d.id""",
        (no,),
    )
    return hdr


def actual_qty(db, no, line):
    row = db.one(
        """SELECT COALESCE(SUM(r.qty*s.allocated_qty/NULLIF(d.instructed_qty,0)),0) AS qty
       FROM ship_order_src s JOIN ship_order_dtl d ON d.ship_order_dtl_id=s.ship_order_dtl_id
       JOIN (SELECT ship_order_dtl_id,SUM(actual_qty) AS qty FROM ship_result GROUP BY ship_order_dtl_id) r
         ON r.ship_order_dtl_id=s.ship_order_dtl_id WHERE s.order_no=%s AND s.order_line_no=%s""",
        (no, line),
    )
    return js_round(row["qty"])


def preview(db, data):
    date = day(data.get("invoice_date"), "invoice_date(거래일자)")
    params = [date]
    query = "SELECT * FROM order_hdr WHERE status='SHIPPED' AND ship_due_date=%s"
    if data.get("customer_code"):
        query += " AND customer_code=%s"
        params.append(data["customer_code"])
    rows = db.q(query + " ORDER BY order_no", params)
    groups, excluded = {}, []
    split = data.get("split_by_delivery_site") in (True, "true", "on", "1", 1)
    for order in rows:
        lines, failure = [], None
        for line in orders.get(db, order["order_no"])["lines"]:
            qty = actual_qty(db, order["order_no"], line["line_no"])
            if qty <= 0:
                failure = "출고 실적이 없어 청구 수량을 확정할 수 없습니다"
                break
            p = repo.require(db, "product", "product_code", line["product_code"])
            if p['tax_review_required']:
                failure = '원본 품목의 과세구분을 제품 마스터에서 확인해야 합니다'
                break
            price, source = line["unit_price"], "ORDER"
            if price is None:
                current = db.one(
                    """SELECT unit_price FROM customer_price WHERE customer_code=%s AND product_code=%s
                  AND effective_from<=%s ORDER BY effective_from DESC LIMIT 1""",
                    (order["customer_code"], line["product_code"], order["order_date"]),
                )
                price, source = (
                    (current["unit_price"], "CUSTOMER_PRICE") if current else (p["default_price"], "DEFAULT")
                )
            if price is None:
                failure = (
                    f"단가를 확정할 수 없습니다 (주문단가/거래처단가표/기본단가 모두 없음): {line['raw_product_name']}"
                )
                break
            supply = js_round(Decimal(qty) * price)
            tax = 0 if p["tax_type"] == "EXEMPT" else js_round(Decimal(supply) * Decimal("0.1"))
            shipment = db.one(
                """SELECT d.ship_order_no FROM ship_order_src s JOIN ship_order_dtl d ON d.ship_order_dtl_id=s.ship_order_dtl_id
                WHERE s.order_no=%s AND s.order_line_no=%s ORDER BY s.id LIMIT 1""",
                (order["order_no"], line["line_no"]),
            )
            lines.append(
                {
                    "product_code": p["product_code"],
                    "spec": line["spec"] or p["spec"],
                    "quantity": qty,
                    "unit": line["unit"],
                    "unit_price": price,
                    "price_source": source,
                    "supply_amount": supply,
                    "tax_amount": tax,
                    "tax_type": p["tax_type"],
                    "ship_order_no": shipment["ship_order_no"] if shipment else None,
                    "order_no": order["order_no"],
                }
            )
        if failure or not lines:
            excluded.append({"order_no": order["order_no"], "reason": failure or "주문 상세가 없습니다"})
            continue
        key = (order["customer_code"], order["delivery_site_id"] if split else None)
        group = groups.setdefault(
            key,
            {
                "customer_code": order["customer_code"],
                "delivery_site_id": order["delivery_site_id"],
                "lines": [],
                "orderNos": [],
            },
        )
        group["lines"].extend(lines)
        group["orderNos"].append(order["order_no"])
    return {"groups": list(groups.values()), "excludedOrders": excluded}


def generate(db, data, actor=None):
    db.lock("shipping:results")
    db.lock("invoice:generate")
    computed = preview(db, data)
    numbers = []
    for group in computed["groups"]:
        no = repo.next_number(db, "invoice", day(data["invoice_date"]))
        supply = sum(l["supply_amount"] for l in group["lines"])
        tax = sum(l["tax_amount"] for l in group["lines"])
        repo.insert(
            db,
            "invoice_hdr",
            {
                "invoice_no": no,
                "invoice_date": day(data["invoice_date"]),
                "customer_code": group["customer_code"],
                "supply_amount": supply,
                "tax_amount": tax,
                "total_amount": supply + tax,
            },
        )
        for line in group["lines"]:
            repo.insert(db, "invoice_dtl", {"invoice_no": no, **{k: v for k, v in line.items() if k != "price_source"}})
        for order_no in group["orderNos"]:
            orders.change_status(db, order_no, "INVOICED", actor)
        numbers.append(no)
    return {"invoices": numbers, "excludedOrders": computed["excludedOrders"]}


def validate(db, no):
    invoice = get(db, no)
    mismatches = []
    # Multiple lines may contain the same product: compare grouped quantities once.
    invoiced = defaultdict(Decimal)
    for line in invoice["lines"]:
        pending_tax = db.one('SELECT tax_review_required FROM product WHERE product_code=%s',(line['product_code'],))
        if pending_tax and pending_tax['tax_review_required']:
            mismatches.append({'product_code':line['product_code'],'reason':'원본 품목의 과세구분 확인 후 제품 마스터에서 저장하세요'})
        invoiced[(line["order_no"], line["product_code"])] += line["quantity"]
    for (order_no, product), qty in invoiced.items():
        rows = db.q("SELECT line_no FROM order_dtl WHERE order_no=%s AND product_code=%s", (order_no, product))
        actual = sum(actual_qty(db, order_no, l["line_no"]) for l in rows)
        if actual != qty:
            mismatches.append(
                {
                    "order_no": order_no,
                    "product_code": product,
                    "invoiced_qty": qty,
                    "current_shipped_qty": actual,
                    "reason": "명세서 생성 이후 출고 실적이 변경되어 청구 수량과 일치하지 않습니다",
                }
            )
    supply = sum(l["supply_amount"] for l in invoice["lines"])
    tax = sum(l["tax_amount"] for l in invoice["lines"])
    if supply != invoice["supply_amount"] or tax != invoice["tax_amount"] or supply + tax != invoice["total_amount"]:
        mismatches.append(
            {
                "reason": "명세서 헤더 합계가 라인 합계와 일치하지 않습니다",
                "recomputed": {"supply_amount": supply, "tax_amount": tax},
            }
        )
    return {"valid": not mismatches, "mismatches": mismatches}


def issue(db, no):
    db.lock("shipping:results")
    row = repo.require(db, "invoice_hdr", "invoice_no", no, "거래명세서", lock=True)
    validation = validate(db, no)
    if not validation["valid"]:
        raise BusinessError("주문·출고 실적과 청구 수량이 일치하지 않아 발행할 수 없습니다", 422, validation)
    if row["status"] != "DRAFT":
        raise BusinessError("DRAFT 상태의 명세서만 발행할 수 있습니다", 409)
    repo.update(db, "invoice_hdr", "invoice_no", no, {"status": "ISSUED"}, ("status",), timestamp=True)
    return get(db, no)


def threshold(db):
    row = repo.get(db, "system_setting", "key", "APPROVAL_AMOUNT_THRESHOLD")
    return Decimal(row["value"]) if row and row["value"] not in (None, "") else None


def set_threshold(db, value):
    amount = number(value, "value") if value not in (None, "") else None
    db.x(
        """INSERT INTO system_setting(key,value) VALUES ('APPROVAL_AMOUNT_THRESHOLD',%s)
       ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value""",
        (str(amount) if amount is not None else None,),
    )
    return amount


def approval(db, no):
    row = get(db, no)
    c = repo.require(db, "customer", "customer_code", row["customer_code"])
    limit = threshold(db)
    history = db.q("SELECT * FROM invoice_approval_log WHERE invoice_no=%s ORDER BY id", (no,))
    return {
        "invoice_no": no,
        "required": bool(c["approval_required"]) or (limit is not None and row["total_amount"] >= limit),
        "approved": bool(history),
        "history": history,
    }


def approve(db, no, actor):
    repo.require(db, "invoice_hdr", "invoice_no", no, "거래명세서", lock=True)
    state = approval(db, no)
    if not state["required"]:
        raise BusinessError("이 명세서는 승인이 필요하지 않습니다")
    if state["approved"]:
        raise BusinessError("이미 승인된 명세서입니다", 409)
    repo.insert(db, "invoice_approval_log", {"invoice_no": no, "user_id": actor})
    return approval(db, no)
