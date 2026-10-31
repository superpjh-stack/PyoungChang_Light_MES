"""Shared application operations for JSON and server-rendered HTML clients."""

import json
import re
from dataclasses import dataclass

import psycopg

from kkotsuni.app.errors import BusinessError
from kkotsuni.app.rbac import require_action, require_screen, require_write
from kkotsuni.db import repositories as repo
from kkotsuni.integrations import excel
from kkotsuni.schemas.input import scalar_record
from kkotsuni.services import erp, invoices, masters, matching, orders, reporting, shipping
from kkotsuni.services.common import audit, day, required


@dataclass
class Download:
    content: bytes
    filename: str
    media_type: str


@dataclass
class Operation:
    method: str
    path: str
    handler: object
    status: int = 200
    role: str | None = None

    def matches(self, path):
        pattern = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", self.path)
        return re.fullmatch(pattern, path)


OPERATIONS = []


def operation(method, path, status=200, role=None):
    def decorate(fn):
        OPERATIONS.append(Operation(method, path, fn, status, role))
        return fn

    return decorate


def find_operation(method, path):
    path = path.rstrip("/") or "/"
    # Static paths first, independent of declaration order.
    for op in sorted(OPERATIONS, key=lambda o: o.path.count("{")):
        match = op.matches(path)
        if op.method == method.upper() and match:
            return op, match.groupdict()
    raise BusinessError("요청 경로를 찾을 수 없습니다", 404)


def invoke(db, method, path, data=None, query=None, user=None):
    op, params = find_operation(method, path)
    if op.role:
        require_action(user, op.role)
    if method.upper() == "GET":
        require_screen(user, op.path)
    else:
        require_write(user, op.path, params)
    body = {} if data is None else data
    if not isinstance(body, (dict, list)):
        raise BusinessError("요청 본문은 객체 또는 배열이어야 합니다", 422)
    if isinstance(body, list) and op.path not in ("/product-aliases/bulk", "/erp-sync/{kind}"):
        raise BusinessError("요청 본문은 객체여야 합니다", 422)
    if op.path not in ("/orders/upload/preview", "/orders/upload/commit", "/product-aliases/bulk", "/erp-sync/{kind}"):
        scalar_record(body)
    try:
        with db.tx():
            return op.handler(db, body, query or {}, user, **params)
    except psycopg.errors.UniqueViolation:
        raise BusinessError("이미 등록된 데이터입니다", 409)
    except psycopg.IntegrityError:
        raise BusinessError("참조 대상 또는 입력값이 데이터 제약을 만족하지 않습니다", 400)
    except psycopg.DataError:
        raise BusinessError("입력값의 형식 또는 범위가 올바르지 않습니다", 400)


def actor(user, data):
    return (user or {}).get("user_id") or (data.get("registered_by") if isinstance(data, dict) else None)


def xlsx(content, filename):
    return Download(content, filename, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@operation("GET", "/health")
def health(db, data, query, user):
    db.one("SELECT 1")
    return {"status": "ok"}


# Master's object boundaries are explicitly whitelisted here, never supplied as SQL names by a client.
def master_routes(path, table, key):
    @operation("GET", path)
    def lists(db, data, query, user):
        if table == "customer" and query.get("missingErpMapping") == "true":
            return db.q(
                "SELECT * FROM customer WHERE erp_customer_code IS NULL OR erp_customer_code='' ORDER BY customer_code"
            )
        return repo.listing(db, table, order=key)

    @operation("POST", path, 201)
    def create(db, data, query, user):
        return masters.save(db, table, data)

    if table == "app_user":
        return

    @operation("GET", path + "/{code}")
    def detail(db, data, query, user, code):
        return masters.customer(db, code) if table == "customer" else repo.require(db, table, key, code, "제품")

    @operation("PUT", path + "/{code}")
    def change(db, data, query, user, code):
        masters.save(db, table, data, code)
        return masters.customer(db, code) if table == "customer" else repo.require(db, table, key, code)


master_routes("/customers", "customer", "customer_code")
master_routes("/products", "product", "product_code")
master_routes("/users", "app_user", "user_id")


@operation("GET", "/customers/{code}/delivery-sites")
def sites(db, data, query, user, code):
    return repo.listing(db, "delivery_site", {"customer_code": code}, ("customer_code",), "delivery_site_id")


@operation("POST", "/customers/{code}/delivery-sites", 201)
def site(db, data, query, user, code):
    return masters.site(db, code, data)


@operation("GET", "/customers/{code}/prices")
def prices(db, data, query, user, code):
    return db.q(
        "SELECT * FROM customer_price WHERE customer_code=%s ORDER BY product_code,effective_from DESC", (code,)
    )


@operation("POST", "/customers/{code}/prices", 201)
def price(db, data, query, user, code):
    masters.price(db, code, data)
    return prices(db, data, query, user, code)


@operation("GET", "/product-aliases")
def aliases(db, data, query, user):
    return repo.listing(db, "product_alias", query, ("customer_code", "product_code"), "raw_name")


@operation("POST", "/product-aliases", 201)
def alias(db, data, query, user):
    result = matching.alias(db, data)
    audit(db, "PRODUCT_ALIAS", result["id"], "ALIAS_CREATE", user)
    return result


@operation("POST", "/product-aliases/bulk", 201)
def bulk(db, data, query, user):
    rows = data if isinstance(data, list) else data.get("aliases")
    if not isinstance(rows, list):
        raise BusinessError("배열 형태의 aliases가 필요합니다")
    result = {"created": [], "errors": []}
    for row in rows:
        try:
            with db.tx():
                result["created"].append(matching.alias(db, row))
        except (BusinessError, psycopg.IntegrityError) as exc:
            result["errors"].append(
                {"row": row, "message": str(exc) if isinstance(exc, BusinessError) else "입력 데이터 제약 위반"}
            )
    return result


@operation("GET", "/product-aliases/match")
def match(db, data, query, user):
    required(query, "customer_code", "raw_name")
    return matching.match(db, query["customer_code"], query["raw_name"])


@operation("POST", "/product-aliases/{ident}/use")
def use_alias(db, data, query, user, ident):
    return matching.use(db, ident)


@operation("GET", "/mapping-queue")
def pending(db, data, query, user):
    return matching.pending(db)


@operation("POST", "/mapping-queue/resolve")
def resolve(db, data, query, user):
    result = matching.resolve(db, data)
    audit(db, "PRODUCT_ALIAS", result["alias"]["id"], "MAPPING_RESOLVE", user)
    return result


@operation("GET", "/orders/upload-template")
def upload_template(db, data, query, user):
    return xlsx(excel.template(), "order_upload_template.xlsx")


@operation("POST", "/orders/upload/preview")
def upload_preview(db, data, query, user):
    return orders.preview(db, excel.parse(data.get("file")))


@operation("POST", "/orders/upload/commit", 201)
def upload_commit(db, data, query, user):
    return orders.commit(db, data.get("rows"))


@operation("GET", "/orders")
def order_list(db, data, query, user):
    return orders.listing(db, query)


@operation("GET", "/orders/export")
def order_export(db, data, query, user):
    headers = [
        "주문번호",
        "주문일자",
        "거래처코드",
        "상태",
        "출고예정일",
        "라인번호",
        "원본제품명",
        "표준제품코드",
        "규격",
        "수량",
        "단위",
        "단가",
        "금액",
    ]
    values = []
    for order in orders.listing(db, query):
        for line in orders.get(db, order["order_no"])["lines"]:
            values.append(
                [order[k] for k in ("order_no", "order_date", "customer_code", "status", "ship_due_date")]
                + [
                    line[k]
                    for k in (
                        "line_no",
                        "raw_product_name",
                        "product_code",
                        "spec",
                        "quantity",
                        "unit",
                        "unit_price",
                        "amount",
                    )
                ]
            )
    return xlsx(excel.workbook(headers, values, "주문내역"), "orders_export.xlsx")


@operation("GET", "/orders/pending-shipment")
def pending_ship(db, data, query, user):
    return db.q("SELECT * FROM order_hdr WHERE status IN ('CONFIRMED','SHIP_ORDERED') ORDER BY ship_due_date,order_no")


@operation("GET", "/orders/pending-invoice")
def pending_invoice(db, data, query, user):
    return db.q("SELECT * FROM order_hdr WHERE status='SHIPPED' ORDER BY ship_due_date,order_no")


@operation("GET", "/orders/{no}")
def order_get(db, data, query, user, no):
    return orders.get(db, no)


@operation("PUT", "/orders/{no}")
def order_update(db, data, query, user, no):
    result = orders.update(db, no, data)
    audit(db, "ORDER", no, "ORDER_UPDATE", user, json.dumps(data, ensure_ascii=False))
    return result


@operation("GET", "/orders/{no}/status-history")
def order_history(db, data, query, user, no):
    return db.q("SELECT * FROM order_status_log WHERE order_no=%s ORDER BY id", (no,))


@operation("GET", "/orders/{no}/validate")
def order_validate(db, data, query, user, no):
    return orders.validate(db, no)


@operation("POST", "/orders/{no}/confirm")
def order_confirm(db, data, query, user, no):
    return orders.confirm(db, no, actor(user, data))


@operation("GET", "/orders/{no}/trace")
def order_trace(db, data, query, user, no):
    return reporting.trace_order(db, no)


@operation("POST", "/ship-orders/generate", 201)
def ship_generate(db, data, query, user):
    return shipping.generate(db, data, actor(user, data))


@operation("GET", "/ship-orders")
def ship_list(db, data, query, user):
    if query.get("ship_date"):
        query = {**query, "ship_date": day(query["ship_date"])}
    return list(
        reversed(repo.listing(db, "ship_order", query, ("customer_code", "ship_date", "status"), "ship_order_no"))
    )


@operation("GET", "/ship-orders/{no}")
def ship_get(db, data, query, user, no):
    return shipping.get(db, no)


@operation("GET", "/ship-orders/{no}/export")
def ship_export(db, data, query, user, no):
    row = shipping.get(db, no)
    keys = ["product_code", "product_name", "product_spec", "instructed_qty", "packed_qty", "pack_unit", "note"]
    values = [
        [l[k] for k in keys] + [", ".join(sorted({src["order_no"] for src in l["sources"]}))] for l in row["lines"]
    ]
    return xlsx(
        excel.document_workbook(
            [f"출고지시서 {no}"],
            [
                f"출고일: {row['ship_date']}",
                f"거래처: {row['customer_name']} ({row['customer_code']})",
                f"배송방법: {row['ship_method'] or '-'}",
            ],
            ["제품코드", "제품명", "규격", "지시수량", "포장수량", "포장단위", "비고", "원주문번호"],
            values,
            "출고지시서",
        ),
        f"{no}.xlsx",
    )


@operation("PUT", "/ship-orders/lines/{ident}")
def ship_edit(db, data, query, user, ident):
    return shipping.edit_line(db, ident, data, actor(user, data) or data.get("changed_by"))


@operation("GET", "/ship-orders/lines/{ident}/revisions")
def ship_revisions(db, data, query, user, ident):
    return db.q("SELECT * FROM ship_order_dtl_revision WHERE ship_order_dtl_id=%s ORDER BY id", (ident,))


@operation("POST", "/ship-orders/lines/{ident}/results", 201)
def ship_result(db, data, query, user, ident):
    return shipping.register(db, ident, data, actor(user, data))


@operation("GET", "/ship-orders/{no}/results")
def ship_summary(db, data, query, user, no):
    return shipping.summary(db, no)


@operation("GET", "/invoices/preview")
def invoice_preview(db, data, query, user):
    return invoices.preview(db, query)


@operation("POST", "/invoices/generate", 201)
def invoice_generate(db, data, query, user):
    return invoices.generate(db, data, actor(user, data))


@operation("GET", "/invoices")
def invoice_list(db, data, query, user):
    if query.get("invoice_date"):
        query = {**query, "invoice_date": day(query["invoice_date"])}
    return list(
        reversed(
            repo.listing(
                db, "invoice_hdr", query, ("customer_code", "invoice_date", "status", "erp_send_status"), "invoice_no"
            )
        )
    )


@operation("GET", "/invoices/{no}")
def invoice_get(db, data, query, user, no):
    return invoices.get(db, no)


@operation("GET", "/invoices/{no}/trace")
def invoice_trace(db, data, query, user, no):
    return reporting.trace_invoice(db, no)


@operation("GET", "/invoices/{no}/validate")
def invoice_validate(db, data, query, user, no):
    return invoices.validate(db, no)


@operation("GET", "/invoices/{no}/approval")
def invoice_approval(db, data, query, user, no):
    return invoices.approval(db, no)


@operation("POST", "/invoices/{no}/issue", role="OPERATOR")
def invoice_issue(db, data, query, user, no):
    result = invoices.issue(db, no)
    audit(db, "INVOICE", no, "INVOICE_ISSUE", user)
    return result


@operation("POST", "/invoices/{no}/approve", role="OPERATOR")
def invoice_approve(db, data, query, user, no):
    result = invoices.approve(db, no, user["user_id"])
    audit(db, "INVOICE", no, "INVOICE_APPROVE", user)
    return result


@operation("POST", "/invoices/{no}/erp/send", role="OPERATOR")
def erp_send(db, data, query, user, no):
    result = erp.send(db, no)
    audit(db, "INVOICE", no, "ERP_SEND", user, result["transmission"]["filename"])
    return result


@operation("POST", "/invoices/{no}/erp/retry", role="OPERATOR")
def erp_retry(db, data, query, user, no):
    result = erp.send(db, no, retry=True)
    audit(db, "INVOICE", no, "ERP_RETRY", user, result["transmission"]["filename"])
    return result


@operation("POST", "/invoices/{no}/erp/confirm", role="OPERATOR")
def erp_confirm(db, data, query, user, no):
    result = erp.confirm(db, no, data)
    audit(db, "INVOICE", no, "ERP_CONFIRM", user, result["erp_send_status"])
    return result


@operation("POST", "/invoices/erp/send-batch", role="OPERATOR")
def erp_batch(db, data, query, user):
    result = erp.batch(db, data.get("invoice_date"))
    audit(db, "INVOICE", data["invoice_date"], "ERP_SEND_BATCH", user, f"{len(result)}건")
    return result


@operation("GET", "/invoices/{no}/erp/import-file")
def erp_file(db, data, query, user, no):
    return Download(erp.csv_file(db, no), f"{no}_erp_import.csv", "text/csv; charset=utf-8")


@operation("GET", "/invoices/{no}/export")
def invoice_export(db, data, query, user, no):
    row = invoices.get(db, no)
    keys = [
        "product_code",
        "product_name",
        "spec",
        "quantity",
        "unit",
        "unit_price",
        "supply_amount",
        "tax_amount",
        "tax_type",
        "order_no",
        "ship_order_no",
    ]
    values = [[l[k] for k in keys] for l in row["lines"]]
    values.append(["합계", None, None, None, None, None, row["supply_amount"], row["tax_amount"], None, None, None])
    values.append(["총액", row["total_amount"]])
    return xlsx(
        excel.document_workbook(
            [f"거래명세서 {no}"],
            [
                f"거래일자: {row['invoice_date']}",
                f"공급받는자: {row['customer_name']} ({row['customer_code']})",
                f"상태: {row['status']}",
            ],
            [
                "제품코드",
                "제품명",
                "규격",
                "수량",
                "단위",
                "단가",
                "공급가액",
                "세액",
                "과세구분",
                "주문번호",
                "출고지시번호",
            ],
            values,
            "거래명세서",
        ),
        f"{no}.xlsx",
    )


@operation("GET", "/settings/approval-amount-threshold")
def threshold(db, data, query, user):
    return {"value": invoices.threshold(db)}


@operation("PUT", "/settings/approval-amount-threshold", role="ADMIN")
def set_threshold(db, data, query, user):
    return {"value": invoices.set_threshold(db, data.get("value"))}


@operation("POST", "/erp-sync/{kind}", 201, "ADMIN")
def sync(db, data, query, user, kind):
    if kind not in ("customers", "products", "customer-prices"):
        raise BusinessError("동기화 대상을 찾을 수 없습니다", 404)
    rows = data if isinstance(data, list) else data.get("rows")
    result = masters.sync(db, kind, rows)
    action = "ERP_SYNC_" + kind.upper().replace("-", "_")
    audit(
        db,
        "ERP_MASTER_SYNC",
        action,
        action,
        user,
        f"생성 {result['createdCount']}건, 갱신 {result['updatedCount']}건, 오류 {len(result['errors'])}건",
    )
    return result


@operation("GET", "/dashboard/summary")
def dashboard(db, data, query, user):
    return reporting.dashboard(db, query.get("date"))


@operation("GET", "/audit-log")
def logs(db, data, query, user):
    try:
        limit = min(1000, max(1, int(query.get("limit", 100))))
    except (TypeError, ValueError):
        raise BusinessError("limit은 정수여야 합니다")
    conditions, params = [], []
    for key in ("entity_type", "entity_id"):
        if query.get(key):
            conditions.append(f"{key}=%s")
            params.append(query[key])
    return db.q(
        "SELECT * FROM audit_log"
        + (" WHERE " + " AND ".join(conditions) if conditions else "")
        + " ORDER BY id DESC LIMIT %s",
        (*params, limit),
    )
