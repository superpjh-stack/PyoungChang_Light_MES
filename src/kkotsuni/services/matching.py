import re

from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.schemas.input import scalar_record
from kkotsuni.services.common import required


def normalize(text):
    return re.sub(r"[\s\-_./()\[\]]", "", str(text).upper())


def distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        row = [i]
        for j, cb in enumerate(b, 1):
            row.append(min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = row
    return prev[-1]


def size(text):
    match = re.search(r"(\d+(?:\.\d+)?)\s*(kg|g|ml|l|box|ea)", text or "", re.IGNORECASE)
    return "".join(match.groups()).upper() if match else None


def alias(db, data):
    scalar_record(data)
    required(data, "customer_code", "raw_name", "product_code")
    for table, key in (("customer", "customer_code"), ("product", "product_code")):
        if not repo.get(db, table, key, data[key]):
            raise BusinessError(f"존재하지 않는 {key}입니다")
    if db.one(
        "SELECT id FROM product_alias WHERE customer_code=%s AND raw_name=%s", (data["customer_code"], data["raw_name"])
    ):
        raise BusinessError("이미 등록된 별칭입니다", 409)
    kind = data.get("match_type") or "MANUAL"
    if kind not in ("EXACT", "NORMALIZED", "SUGGESTED_APPROVED", "MANUAL"):
        raise BusinessError("match_type이 올바르지 않습니다")
    return repo.insert(
        db,
        "product_alias",
        {
            "customer_code": data["customer_code"],
            "raw_name": data["raw_name"],
            "product_code": data["product_code"],
            "normalized_key": normalize(data["raw_name"]),
            "match_type": kind,
            "registered_by": data.get("registered_by"),
        },
    )


def use(db, ident):
    row = db.one(
        "UPDATE product_alias SET use_count=use_count+1,last_used_at=CURRENT_TIMESTAMP WHERE id=%s RETURNING *",
        (ident,),
    )
    if row is None:
        raise BusinessError("별칭을 찾을 수 없습니다", 404)
    return row


def match(db, customer_code, raw_name, record=False):
    exact = db.one("SELECT * FROM product_alias WHERE customer_code=%s AND raw_name=%s", (customer_code, raw_name))
    normalized = exact or db.one(
        "SELECT * FROM product_alias WHERE customer_code=%s AND normalized_key=%s ORDER BY use_count DESC,id LIMIT 1",
        (customer_code, normalize(raw_name)),
    )
    if normalized:
        kind = "EXACT" if exact else "NORMALIZED"
        if record:
            if not exact:
                normalized = alias(
                    db,
                    {
                        "customer_code": customer_code,
                        "raw_name": raw_name,
                        "product_code": normalized["product_code"],
                        "match_type": kind,
                    },
                )
            normalized = use(db, normalized["id"])
        return {"matchType": kind, "product_code": normalized["product_code"], "alias": normalized, "candidates": []}
    candidates = []
    for product in repo.listing(db, "product", order="product_code"):
        a, b = normalize(raw_name), normalize(product["name"] + (product["spec"] or ""))
        score = 1 - distance(a, b) / max(len(a), len(b), 1)
        if size(raw_name) and size(raw_name) == size(product["spec"] or product["name"]):
            score = min(1, score + 0.15)
        candidates.append({"product_code": product["product_code"], "name": product["name"], "score": round(score, 4)})
    return {
        "matchType": "SUGGESTED" if candidates else "NONE",
        "product_code": None,
        "candidates": sorted(candidates, key=lambda c: -c["score"])[:3],
    }


def pending(db):
    return db.q("""SELECT o.customer_code,d.raw_product_name,COUNT(*) AS line_count,
       array_agg(DISTINCT d.order_no ORDER BY d.order_no) AS order_nos FROM order_dtl d
       JOIN order_hdr o ON o.order_no=d.order_no WHERE d.product_code IS NULL
       GROUP BY o.customer_code,d.raw_product_name ORDER BY line_count DESC,o.customer_code""")


def resolve(db, data):
    created = alias(db, {**data, "match_type": "SUGGESTED_APPROVED"})
    count = db.x(
        """UPDATE order_dtl d SET product_code=%s,amount=quantity*unit_price
        FROM order_hdr o WHERE o.order_no=d.order_no AND d.product_code IS NULL
        AND d.raw_product_name=%s AND o.customer_code=%s""",
        (data["product_code"], data["raw_name"], data["customer_code"]),
    )
    if count:
        created = db.one(
            "UPDATE product_alias SET use_count=use_count+%s,last_used_at=CURRENT_TIMESTAMP WHERE id=%s RETURNING *",
            (count, created["id"]),
        )
    return {"alias": created, "updatedLines": count}
