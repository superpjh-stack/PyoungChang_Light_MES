"""Replace sample documents with a curated chain built from the uploaded source files (MIG-24).

Dry-run by default: every step runs inside one transaction that is rolled back, so the printed counts are
exactly what --apply would do. Take a database backup before --apply; deletions cannot be undone.

    python tools/curate_real_data.py            # report only
    python tools/curate_real_data.py --apply    # delete samples, re-apply review rows, link shipments
"""

import sys
from collections import Counter

from kkotsuni.app.errors import BusinessError
from kkotsuni.app.settings import Settings
from kkotsuni.db.connection import connect
from kkotsuni.services import matching, notes, orders, shipping, source_data

REAL_ORDER = "EXISTS (SELECT 1 FROM source_record r WHERE r.order_no={})"
TRACKED = "EXISTS (SELECT 1 FROM source_record r WHERE r.order_no=o.order_no AND COALESCE(r.payload->>'tracking_no','')<>'')"


class Rollback(Exception):
    pass


def count(db, table):
    return db.one(f"SELECT count(*) AS n FROM {table}")["n"]  # callers pass fixed table names only


def delete_samples(db):
    """Sample = documents with no uploaded-source provenance, and the masters only they used."""
    done = {}
    done["거래명세서"] = db.x(
        f"""DELETE FROM invoice_hdr h WHERE NOT EXISTS (SELECT 1 FROM invoice_dtl d WHERE d.invoice_no=h.invoice_no
            AND {REAL_ORDER.format('d.order_no')})"""
    )
    done["출고지시"] = db.x(
        f"""DELETE FROM ship_order s WHERE NOT EXISTS (SELECT 1 FROM ship_order_dtl d JOIN ship_order_src x
            USING(ship_order_dtl_id) WHERE d.ship_order_no=s.ship_order_no AND {REAL_ORDER.format('x.order_no')})"""
    )
    done["수주"] = db.x(f"DELETE FROM order_hdr o WHERE NOT {REAL_ORDER.format('o.order_no')}")
    sample_customer = """customer_code NOT LIKE 'SRC-%%' AND NOT EXISTS (SELECT 1 FROM order_hdr o
        WHERE o.customer_code=c.customer_code)"""
    sample_product = """NOT EXISTS (SELECT 1 FROM source_record r WHERE r.product_code=p.product_code)
        AND NOT EXISTS (SELECT 1 FROM order_dtl d WHERE d.product_code=p.product_code)"""
    done["제품 별칭"] = db.x(
        f"""DELETE FROM product_alias a WHERE EXISTS (SELECT 1 FROM customer c WHERE c.customer_code=a.customer_code
            AND {sample_customer}) OR EXISTS (SELECT 1 FROM product p WHERE p.product_code=a.product_code AND {sample_product})"""
    )
    done["거래처 단가"] = db.x(
        f"""DELETE FROM customer_price a WHERE EXISTS (SELECT 1 FROM customer c WHERE c.customer_code=a.customer_code
            AND {sample_customer}) OR EXISTS (SELECT 1 FROM product p WHERE p.product_code=a.product_code AND {sample_product})"""
    )
    done["납품처"] = db.x(
        f"DELETE FROM delivery_site a WHERE EXISTS (SELECT 1 FROM customer c WHERE c.customer_code=a.customer_code AND {sample_customer})"
    )
    done["거래처"] = db.x(f"DELETE FROM customer c WHERE {sample_customer}")
    done["제품"] = db.x(f"DELETE FROM product p WHERE {sample_product}")
    return done


def reapply_review(db):
    before = Counter()
    rows = db.q("SELECT * FROM source_record WHERE status='검토 필요' AND kind<>'품목' ORDER BY id")
    for row in rows:
        source_data.apply_record(db, row)
    after = db.q(
        """SELECT status,count(*) AS n FROM source_record WHERE id = ANY(%s) GROUP BY status""",
        ([r["id"] for r in rows],),
    )
    before.update({r["status"]: r["n"] for r in after})
    return len(rows), dict(before)


def map_unique_names(db):
    """Pending names that equal exactly one product name (ignoring spacing/brackets) are confirmed."""
    mapped = []
    products = db.q("SELECT product_code,name,spec FROM product")
    for item in matching.pending(db):
        raw = matching.normalize(item["raw_product_name"])
        hits = [
            p
            for p in products
            if raw in {matching.normalize(p["name"]), matching.normalize(p["name"] + (p["spec"] or ""))}
        ]
        if len(hits) != 1:
            continue
        code = hits[0]["product_code"]
        alias = db.one(
            "SELECT product_code FROM product_alias WHERE customer_code=%s AND raw_name=%s",
            (item["customer_code"], item["raw_product_name"]),
        )
        if alias and alias["product_code"] != code:
            continue
        if alias:
            # The alias was created while re-applying review rows; older pending lines still need the link.
            lines = db.x(
                """UPDATE order_dtl d SET product_code=%s,amount=quantity*unit_price FROM order_hdr o
                   WHERE o.order_no=d.order_no AND d.product_code IS NULL AND d.raw_product_name=%s
                   AND o.customer_code=%s""",
                (code, item["raw_product_name"], item["customer_code"]),
            )
        else:
            lines = matching.resolve(
                db,
                {"customer_code": item["customer_code"], "raw_name": item["raw_product_name"], "product_code": code},
            )["updatedLines"]
        mapped.append((item["raw_product_name"], code, lines))
    return mapped


def link_shipments(db, actor):
    """Orders whose upload carries a tracking number were shipped: confirm, instruct and register results."""
    candidates = db.q(f"SELECT order_no FROM order_hdr o WHERE status='RECEIVED' AND {TRACKED} ORDER BY order_no")
    confirmed, blocked = 0, 0
    for row in candidates:
        try:
            with db.tx():
                orders.confirm(db, row["order_no"], actor)
            confirmed += 1
        except BusinessError:
            blocked += 1  # unmapped product: stays RECEIVED until mapping is decided
    ship_orders = []
    groups = db.q(
        f"""SELECT DISTINCT ship_due_date,customer_code FROM order_hdr o WHERE status='CONFIRMED' AND {TRACKED}
            ORDER BY ship_due_date,customer_code"""
    )
    for group in groups:
        result = shipping.generate(
            db, {"ship_date": group["ship_due_date"], "customer_code": group["customer_code"]}, actor
        )
        ship_orders += result["shipOrders"]
    lines = db.q(
        "SELECT ship_order_dtl_id,instructed_qty FROM ship_order_dtl WHERE ship_order_no = ANY(%s) ORDER BY 1",
        (ship_orders,),
    )
    for line in lines:
        shipping.register(db, line["ship_order_dtl_id"], {"actual_qty": line["instructed_qty"]}, actor)
    shipped = db.one(f"SELECT count(*) AS n FROM order_hdr o WHERE status='SHIPPED' AND {TRACKED}")["n"]
    return {"confirmed": confirmed, "blocked": blocked, "ship_orders": ship_orders, "lines": len(lines), "shipped": shipped}


def run(db, apply):
    admin = db.one("SELECT * FROM app_user WHERE role='ADMIN' ORDER BY (user_id='admin') DESC, created_at LIMIT 1")
    actor = admin["user_id"] if admin else None
    report = []
    try:
        with db.tx():
            db.lock("source:import")
            deleted = delete_samples(db)
            report.append("[샘플 삭제] " + ", ".join(f"{k} {v}건" for k, v in deleted.items()))
            total, outcome = reapply_review(db)
            report.append(f"[검토 행 재처리] {total}행 → " + ", ".join(f"{k} {v}" for k, v in sorted(outcome.items())))
            mapped = map_unique_names(db)
            report.append(
                f"[제품 자동 매핑] 표기명 {len(mapped)}개, 주문 품목 {sum(m[2] for m in mapped)}줄"
                + "".join(f"\n- {raw} → {code} ({n}줄)" for raw, code, n in mapped)
            )
            link = link_shipments(db, actor)
            report.append(
                f"[출고 연계] 수주 확정 {link['confirmed']}건(매핑 미완료로 보류 {link['blocked']}건), "
                f"출고지시 {len(link['ship_orders'])}건·품목 {link['lines']}줄 생성과 실적 등록, 출고완료 수주 {link['shipped']}건"
                + ("\n- " + ", ".join(link["ship_orders"]) if link["ship_orders"] else "")
            )
            states = db.q("SELECT status,count(*) AS n FROM order_hdr GROUP BY status ORDER BY status")
            review = db.q(
                """SELECT split_part(issue,';',1) AS reason,count(*) AS n FROM source_record
                   WHERE status='검토 필요' GROUP BY 1 ORDER BY n DESC"""
            )
            report.append(
                "[결과] 수주 " + ", ".join(f"{s['status']} {s['n']}" for s in states)
                + f" · 출고지시 {count(db, 'ship_order')} · 거래명세서 {count(db, 'invoice_hdr')}"
                + f" · 거래처 {count(db, 'customer')} · 제품 {count(db, 'product')}"
                + f" · 매핑 대기 {count(db, 'order_dtl WHERE product_code IS NULL')}줄"
            )
            report.append("[남은 검토 필요] " + (", ".join(f"{r['reason']} {r['n']}행" for r in review) or "없음"))
            body = (
                "샘플 수주·출고·거래명세서와 샘플 마스터를 삭제하고, 업로드한 원본 자료 기준으로 정제·연계함 (MIG-24).\n"
                "규칙: 주문일·출고예정일 중 하나만 없으면 다른 날짜로 보완(비고에 표시). 우체국 송장 이력·1012출고는 수주로 "
                "만들지 않고 송장번호가 일치하는 수주의 배송 근거로만 연결. 송장번호가 있는 수주는 그 출고일로 출고지시·실적을 "
                "만들어 출고완료 처리. 거래명세서는 단가·과세구분이 확인되지 않아 만들지 않음.\n\n" + "\n".join(report)
            )
            if apply:
                notes.create(db, {"title": "샘플 삭제 및 실제 업로드 데이터 정제·연계", "body": body}, admin)
            else:
                raise Rollback
    except Rollback:
        pass
    print("\n".join(report))
    print("\nAPPLIED" if apply else "\nDRY-RUN: nothing was changed. Re-run with --apply after taking a backup.")


if __name__ == "__main__":
    settings = Settings()
    with connect(settings.database_url, settings.db_schema) as db:
        run(db, "--apply" in sys.argv)
