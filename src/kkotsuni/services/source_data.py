"""Auditable, idempotent source import. Originals stay private in PostgreSQL."""

import hashlib
import json
from decimal import Decimal, InvalidOperation

from psycopg.types.json import Jsonb

from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.integrations.excel import COLUMNS
from kkotsuni.integrations.source_files import key, parse
from kkotsuni.services import matching, orders


def fingerprint(parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()


def identities(v):
    result = []
    # Include recipient and item: one external order/tracking number may cover
    # multiple recipients or products; never collapse those into a single line.
    tail = [key(v.get(k)) for k in ("receiver_name", "delivery_address", "raw_product_name", "quantity")]
    for field in ("customer_order_no", "tracking_no"):
        if v.get(field):
            scope = key(v.get("customer_name")) if field == "customer_order_no" else ""
            result.append(fingerprint([field, scope, v[field], *tail]))
    return result


def apply_record(db, record):
    v, ident = record["payload"], record["id"]
    if record["order_no"] or record["product_code"] or record["status"] == "중복":
        return
    if record["kind"] == "품목":
        if v["category"] != "제품":
            db.x(
                "UPDATE source_record SET status='범위 제외',issue='원재료·부산품은 이번 수주·출고 적용 범위에서 제외' WHERE id=%s",
                (ident,),
            )
            return
        old = repo.get(db, "product", "product_code", v["product_code"])
        if old and (key(old["name"]) != key(v["name"]) or key(old["spec"]) != key(v["spec"])):
            db.x(
                "UPDATE source_record SET issue='기존 품목코드의 이름·규격이 다릅니다. 기존 정보를 보존했습니다' WHERE id=%s",
                (ident,),
            )
            return
        if not old:
            repo.insert(
                db,
                "product",
                {
                    "product_code": v["product_code"],
                    "name": v["name"],
                    "spec": v["spec"],
                    "erp_item_code": v["product_code"],
                    "unit": "EA",
                    "tax_review_required": True,
                },
            )
        db.x(
            "UPDATE source_record SET status=%s,product_code=%s,issue=%s WHERE id=%s",
            (
                "기존 연결" if old else "등록",
                v["product_code"],
                "" if old else "원본에 과세구분·판매단가가 없습니다. 거래명세서 발행 전 확인하세요",
                ident,
            ),
        )
        return
    tokens = identities(v)
    related = set()
    for token in tokens:
        other = db.one(
            "SELECT r.* FROM source_identity i JOIN source_record r ON r.id=i.record_id WHERE i.identity=%s", (token,)
        )
        if other and other["id"] != ident:
            if (
                not other["order_no"]
                and v.get("order_date")
                and v.get("ship_due_date")
                and v.get("quantity_kind") == "제품"
            ):
                related.add(other["id"])
                continue
            db.x(
                "UPDATE source_record SET status='중복',issue=%s,order_no=%s WHERE id=%s",
                (f"원본 행 #{other['id']}와 동일 식별정보", other["order_no"], ident),
            )
            return

    def link_evidence(no):
        for previous in related:
            db.x(
                "UPDATE source_record SET status='기존 연결',order_no=%s,issue='후속 발주자료와 연결' WHERE id=%s",
                (no, previous),
            )
        for token in tokens:
            db.x(
                "INSERT INTO source_identity VALUES (%s,%s) ON CONFLICT (identity) DO UPDATE SET record_id=EXCLUDED.record_id",
                (token, ident),
            )

    for token in tokens:
        db.x("INSERT INTO source_identity VALUES (%s,%s) ON CONFLICT DO NOTHING", (token, ident))
    issues = []
    if not v.get("customer_name"):
        issues.append("거래처 확인 필요")
    if not v.get("order_date"):
        issues.append("주문일 확인 필요")
    if not v.get("ship_due_date"):
        issues.append("출고예정일 확인 필요")
    if v.get("quantity_kind") == "박스":
        issues.append("박스 수량: 제품별 수량 확인 필요")
    if "\n" in v.get("raw_product_name", "") or "+" in v.get("raw_product_name", ""):
        issues.append("복수 품목·세트 구성 확인 필요")
    try:
        qty = Decimal(v.get("quantity") or "0")
        if not qty.is_finite() or qty <= 0 or qty != int(qty):
            raise ValueError
    except (InvalidOperation, ValueError, OverflowError):
        issues.append("제품 수량 확인 필요")
    if issues:
        db.x("UPDATE source_record SET issue=%s WHERE id=%s", ("; ".join(issues), ident))
        return
    customer = db.q("SELECT * FROM customer WHERE name=%s", (v["customer_name"],))
    if len(customer) > 1:
        db.x("UPDATE source_record SET issue='동일 이름의 거래처가 여러 개입니다' WHERE id=%s", (ident,))
        return
    code = customer[0]["customer_code"] if customer else "SRC-" + fingerprint([v["customer_name"]])[:12]
    if not customer:
        repo.insert(db, "customer", {"customer_code": code, "name": v["customer_name"], "approval_required": 1})
    # Existing historical orders may predate source provenance. Only exact
    # recipient/item/quantity matches may be linked; ambiguity stays in review.
    if v.get("customer_order_no"):
        existing = db.q(
            """SELECT DISTINCT o.order_no FROM order_hdr o JOIN order_dtl d USING(order_no)
          WHERE o.customer_code=%s AND o.customer_order_no=%s AND o.receiver_name=%s
          AND o.delivery_address=%s AND d.raw_product_name=%s AND d.quantity=%s""",
            (code, v["customer_order_no"], v["receiver_name"], v["delivery_address"], v["raw_product_name"], qty),
        )
        if len(existing) > 1:
            db.x("UPDATE source_record SET issue='기존 주문이 여러 건 일치합니다' WHERE id=%s", (ident,))
            return
        if existing:
            no = existing[0]["order_no"]
            db.x("UPDATE source_record SET status='기존 연결',issue='',order_no=%s WHERE id=%s", (no, ident))
            link_evidence(no)
            return
    values = {k: v.get(k) or None for k, _ in COLUMNS}
    values.update(customer_code=code, quantity=str(qty), note=(v.get("note", "") + f" [원본행 #{ident}]").strip())
    validation = orders.row_errors(db, values)
    if validation:
        db.x("UPDATE source_record SET issue=%s WHERE id=%s", ("; ".join(e["reason"] for e in validation), ident))
        return
    raw = matching.normalize(v["raw_product_name"])
    candidates = [
        p
        for p in db.q("SELECT product_code,name,spec FROM product")
        if raw in {matching.normalize(p["name"]), matching.normalize(p["name"] + (p["spec"] or ""))}
    ]
    if len(candidates) == 1 and not db.one(
        "SELECT 1 FROM product_alias WHERE customer_code=%s AND raw_name=%s", (code, v["raw_product_name"])
    ):
        matching.alias(
            db,
            {
                "customer_code": code,
                "raw_name": v["raw_product_name"],
                "product_code": candidates[0]["product_code"],
                "match_type": "EXACT",
            },
        )
    result = orders.commit(db, [{"rowNumber": record["row_number"], "values": values}])
    if result["errors"]:
        raise BusinessError(result["errors"][0]["message"])
    no = result["orders"][0]
    # Imported shipments are evidence, not instructions to generate new
    # deliveries or to assert product-level fulfillment from parcel counts.
    if v.get("tracking_no"):
        db.x(
            "UPDATE order_hdr SET note=COALESCE(note,'') || %s WHERE order_no=%s",
            (f" 송장: {v['tracking_no']} (과거 배송자료, 재출고 전 확인)", no),
        )
    db.x("UPDATE source_record SET status='등록',issue='',order_no=%s WHERE id=%s", (no, ident))
    link_evidence(no)


def ingest(db, content, filename):
    try:
        parsed = parse(content, filename)
    except BusinessError:
        raise
    except Exception as exc:
        raise BusinessError("파일 형식 또는 셀 값을 확인하세요") from exc
    with db.tx():
        db.lock("source:import")
        old = db.one("SELECT id FROM source_file WHERE digest=%s", (parsed["digest"],))
        if old:
            return {"id": old["id"], "duplicate_file": True}
        file = db.one(
            "INSERT INTO source_file(digest,filename,kind,content) VALUES (%s,%s,%s,%s) RETURNING id",
            (parsed["digest"], parsed["filename"], parsed["kind"], content),
        )
        for item in parsed["records"]:
            record = db.one(
                """INSERT INTO source_record(file_id,sheet,row_number,kind,payload)
              VALUES (%s,%s,%s,%s,%s) RETURNING *""",
                (file["id"], item["sheet"], item["row_number"], item["kind"], Jsonb(item["values"])),
            )
            apply_record(db, record)
        # Link duplicate evidence that arrived before the matching order file.
        db.x("""UPDATE source_record r SET order_no=s.order_no FROM source_record s
          WHERE r.status='중복' AND r.order_no IS NULL AND s.order_no IS NOT NULL
          AND r.issue='원본 행 #' || s.id || '와 동일 식별정보' """)
        db.x(
            "INSERT INTO audit_log(entity_type,entity_id,action,detail) VALUES ('SOURCE_FILE',%s,'IMPORT',%s)",
            (str(file["id"]), f"{parsed['filename']}: {len(parsed['records'])}행"),
        )
    return {"id": file["id"], "duplicate_file": False, "rows": len(parsed["records"])}


def summary(db):
    return db.q("""SELECT f.id,f.filename,f.kind,f.created_at,count(r.id) AS rows,
       count(r.id) FILTER (WHERE r.status IN ('등록','기존 연결')) AS imported,
       count(r.id) FILTER (WHERE r.status='검토 필요') AS review,
       count(r.id) FILTER (WHERE r.status='중복') AS duplicates,
       count(r.id) FILTER (WHERE r.status='범위 제외') AS excluded
       FROM source_file f LEFT JOIN source_record r ON r.file_id=f.id
       GROUP BY f.id ORDER BY f.id DESC""")
