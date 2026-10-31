from datetime import date, timedelta

from kkotsuni.services import invoices, matching, orders
from kkotsuni.services.common import day


def trace_order(db, no):
    row = orders.get(db, no)
    return {
        "order_no": no,
        "status": row["status"],
        "ship_orders": db.q(
            """SELECT DISTINCT h.ship_order_no,h.ship_date,h.status FROM ship_order h
             JOIN ship_order_dtl d ON d.ship_order_no=h.ship_order_no JOIN ship_order_src s ON s.ship_order_dtl_id=d.ship_order_dtl_id
             WHERE s.order_no=%s ORDER BY h.ship_order_no""",
            (no,),
        ),
        "invoices": db.q(
            """SELECT DISTINCT h.invoice_no,h.invoice_date,h.status,h.erp_send_status FROM invoice_hdr h
             JOIN invoice_dtl d ON d.invoice_no=h.invoice_no WHERE d.order_no=%s ORDER BY h.invoice_no""",
            (no,),
        ),
    }


def trace_invoice(db, no):
    invoice = invoices.get(db, no)
    nos = sorted({l["order_no"] for l in invoice["lines"] if l["order_no"]})
    return {
        "invoice_no": no,
        "orders": [
            db.one("SELECT order_no,status FROM order_hdr WHERE order_no=%s", (n,)) or {"order_no": n, "status": None}
            for n in nos
        ],
        "ship_orders": sorted({l["ship_order_no"] for l in invoice["lines"] if l["ship_order_no"]}),
    }


def dashboard(db, today=None):
    today = day(today) if today else date.today()
    week = today - timedelta(days=6)

    def stats(start):
        row = db.one(
            """SELECT COUNT(DISTINCT h.order_no) AS count,COALESCE(SUM(d.quantity),0) AS qty
          FROM order_hdr h JOIN order_dtl d ON d.order_no=h.order_no WHERE h.order_date BETWEEN %s AND %s""",
            (start, today),
        )
        return {"orderCount": row["count"], "orderQty": row["qty"]}

    def count(query, params=()):
        return db.one(query, params)["c"]

    overdue = db.q(
        "SELECT order_no,customer_code,ship_due_date,status FROM order_hdr WHERE status IN ('CONFIRMED','SHIP_ORDERED') AND ship_due_date<%s ORDER BY ship_due_date",
        (today,),
    )
    erp = {
        r["erp_send_status"]: r["c"]
        for r in db.q("SELECT erp_send_status,COUNT(*) AS c FROM invoice_hdr GROUP BY erp_send_status")
    }
    return {
        "date": today,
        "today": {"date": today, **stats(today)},
        "week": {"from": week, "to": today, **stats(week)},
        "shipment": {
            "pendingShipmentCount": count(
                "SELECT COUNT(*) AS c FROM order_hdr WHERE status IN ('CONFIRMED','SHIP_ORDERED')"
            ),
            "overdueShipmentCount": len(overdue),
            "overdueShipments": overdue,
        },
        "invoice": {
            "pendingInvoiceCount": count("SELECT COUNT(*) AS c FROM order_hdr WHERE status='SHIPPED'"),
            "issuedTodayCount": count(
                "SELECT COUNT(*) AS c FROM invoice_hdr WHERE status='ISSUED' AND invoice_date=%s", (today,)
            ),
        },
        "erp": {
            k: erp.get(s, 0)
            for k, s in (
                ("pendingCount", "PENDING"),
                ("sendingCount", "SENDING"),
                ("successCount", "SUCCESS"),
                ("failedCount", "FAILED"),
            )
        },
        "mappingPendingCount": len(matching.pending(db)),
        "validationFailedCount": count(
            "SELECT COUNT(*) AS c FROM order_hdr o WHERE status='RECEIVED' AND EXISTS (SELECT 1 FROM order_dtl d WHERE d.order_no=o.order_no AND product_code IS NULL)"
        ),
    }
