"""Server-rendered workflow routes; mutations delegate to the same API services."""

import csv
import io
import json
import secrets
import time
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.responses import Response

from kkotsuni.app.dependencies import get_db
from kkotsuni.app.http import check_csrf, local_url, saved
from kkotsuni.app.rbac import get_user
from kkotsuni.app.templating import render
from kkotsuni.services.operations import invoke

router = APIRouter()
NUMBERS = {
    "pack_size",
    "default_price",
    "unit_price",
    "quantity",
    "instructed_qty",
    "actual_qty",
    "delivery_site_id",
    "value",
}
BOOLS = {"approval_required", "split_by_delivery_site", "success"}
OPTIONS = {
    "role": ["VIEWER", "OPERATOR", "ADMIN"],
    "tax_type": ["TAXABLE", "EXEMPT"],
    "approval_required": ["false", "true"],
    "split_by_delivery_site": ["false", "true"],
    "success": ["true", "false"],
}


def form(title, path, fields="", values=None, method="POST", hidden=None):
    values = values or {}
    return {
        "title": title,
        "path": path,
        "method": method,
        "hidden": hidden or {},
        "fields": [
            {
                "name": k.rstrip("*"),
                "required": k.endswith("*"),
                "value": values.get(k.rstrip("*"), ""),
                "type": "date"
                if "date" in k or k.rstrip("*") == "effective_from"
                else "number"
                if k.rstrip("*") in NUMBERS
                else "text",
                "options": OPTIONS.get(k.rstrip("*")),
            }
            for k in fields.split()
        ],
    }


def page_context(request, db, path, query=None):
    user = get_user(request, db)
    query = query if query is not None else dict(request.query_params)
    ctx = {
        "title": "업무 대시보드",
        "sections": [],
        "forms": [],
        "links": [],
        "filters": [],
        "current_user": user,
        "current_path": path,
    }

    def read(api, q=None):
        return invoke(db, "GET", api, query=q or {}, user=user)

    def section(title, data):
        ctx["sections"].append({"title": title, "data": data})

    def add(title, api, fields="", values=None, method="POST", hidden=None):
        ctx["forms"].append(form(title, api, fields, values, method, hidden))

    def link(title, href):
        ctx["links"].append((title, href))

    parts = path.strip("/").split("/")
    kind = parts[0]
    code = parts[1] if len(parts) > 1 else None
    if path in ("/", "/dashboard"):
        ctx["dashboard"] = read("/dashboard/overview", query)
    elif kind in ("customers", "products", "users"):
        ctx["title"] = {"customers": "거래처 마스터", "products": "제품 마스터", "users": "사용자 관리"}[kind]
        data = read("/" + kind + ("/" + code if code else ""), query)
        section("기본 정보" if code else "목록", data)
        fields = {
            "customers": "customer_code* name* biz_reg_no erp_customer_code contact_name contact_phone approval_required",
            "products": "product_code* name* spec unit tax_type erp_item_code pack_unit pack_size default_price",
            "users": "user_id* name* role",
        }[kind]
        if code:
            fields = " ".join(fields.split()[1:])
        add(
            "변경 저장" if code else "새로 등록",
            "/" + kind + ("/" + code if code else ""),
            fields,
            data if code else {"unit": "EA"},
            "PUT" if code else "POST",
        )
        if kind == "customers" and not code:
            ctx["filters"] = ["missingErpMapping"]
        if code and kind == "customers":
            add("납품처 추가", path + "/delivery-sites", "site_name* address receiver_name receiver_phone")
            add("단가 추가", path + "/prices", "product_code* unit_price* effective_from")
        if code and kind == "products":
            section("거래처별 별칭", read("/product-aliases", {"product_code": code}))
            add("별칭 추가", "/product-aliases", "customer_code* raw_name*", hidden={"product_code": code})
    elif path == "/orders/upload":
        ctx.update(title="주문 내역서 업로드", upload=True)
        link("표준 템플릿 다운로드", "/downloads/orders/upload-template")
    elif path in ("/orders/pending-shipment", "/orders/pending-invoice"):
        ctx["title"] = "출고 대기 수주" if path.endswith("pending-shipment") else "명세서 미발행 수주"
        section("처리 대기 목록", read(path))
    elif path in ("/mapping", "/mapping-queue"):
        ctx["title"] = "제품 매핑 대기"
        rows = read("/mapping-queue")
        section("미매핑 제품", rows)
        section("표준 제품 목록", read("/products"))
        for row in rows:
            add(
                "매핑 확정 · " + str(row.get("raw_product_name", "")),
                "/mapping-queue/resolve",
                "customer_code* raw_name* product_code*",
                {**row, "raw_name": row.get("raw_product_name", "")},
            )
    elif kind in ("orders", "ship-orders", "invoices"):
        ctx["title"] = {"orders": "주문 관리", "ship-orders": "출고 관리", "invoices": "거래명세서"}[kind]
        if not code:
            ctx["filters"] = (
                [
                    "customer_code",
                    "status",
                    "order_date_from",
                    "order_date_to",
                    "ship_due_date_from",
                    "ship_due_date_to",
                    "product_code",
                ]
                if kind == "orders"
                else ["customer_code", "ship_date" if kind == "ship-orders" else "invoice_date", "status"]
            )
            section("조회 내역", read("/" + kind, query))
            if kind == "orders":
                link("주문 업로드", "/orders/upload")
                link("조회 결과 Excel", "/downloads/orders/export?" + str(request.query_params))
            elif kind == "ship-orders":
                add(
                    "확정 주문으로 출고지시 생성",
                    "/ship-orders/generate",
                    "ship_date* customer_code delivery_site_id ship_method product_code",
                    query,
                )
            else:
                add(
                    "실출고 기준 명세서 생성",
                    "/invoices/generate",
                    "invoice_date* customer_code split_by_delivery_site",
                    query,
                )
                link("생성 미리보기", "/invoices/preview?" + str(request.query_params))
                add("일 마감 ERP 파일 일괄 생성", "/invoices/erp/send-batch", "invoice_date*", query)
        elif kind == "invoices" and code == "preview":
            ctx["title"] = "명세서 생성 미리보기"
            ctx["filters"] = ["invoice_date", "customer_code", "split_by_delivery_site"]
            if query.get("invoice_date"):
                section("예상 명세서 · 제외 사유", read("/invoices/preview", query))
            add(
                "미리보기 조건으로 생성",
                "/invoices/generate",
                "invoice_date* customer_code split_by_delivery_site",
                query,
            )
        else:
            base = "/" + kind + "/" + code
            data = read(base)
            ctx["title"] += " · " + code
            section("문서 상세", data)
            if kind == "orders":
                section("확정 전 검증", read(base + "/validate"))
                section("상태 변경 이력", read(base + "/status-history"))
                section("문서 추적", read(base + "/trace"))
                add("주문 수정", base, "delivery_address receiver_name receiver_phone ship_method note", data, "PUT")
                add("주문 확정", base + "/confirm")
            else:
                link("Excel 다운로드", "/downloads" + base + "/export")
                link("인쇄", base + "/print")
                ctx["print_mode"] = len(parts) > 2 and parts[2] == "print"
                if ctx["print_mode"]:
                    ctx.update(document=data, document_kind=kind)
                    return ctx
                if kind == "ship-orders":
                    link("원본 양식 출고요청서", base + "/request-form")
                    link("출고요청서 Excel", base + "/request-form.xlsx")
                    section("출고 실적과 수량 차이", read(base + "/results"))
                    for line in data.get("lines", []):
                        line_id = line.get("id", line.get("ship_order_dtl_id"))
                        p = "/ship-orders/lines/" + str(line_id)
                        add(
                            "지시 수정 · " + str(line.get("product_code", line_id)),
                            p,
                            "instructed_qty note",
                            line,
                            "PUT",
                        )
                        add(
                            "실적 등록 · " + str(line.get("product_code", line_id)),
                            p + "/results",
                            "actual_qty* pack_lot diff_reason_code",
                        )
                        section("수정 이력 · " + str(line_id), read(p + "/revisions"))
                else:
                    section("정합성 검증", read(base + "/validate"))
                    section("승인 현황", read(base + "/approval"))
                    section("원 주문 역추적", read(base + "/trace"))
                    for name, suffix in [
                        ("승인", "/approve"),
                        ("발행 확정", "/issue"),
                        ("ERP Import 파일 생성", "/erp/send"),
                        ("ERP 재시도", "/erp/retry"),
                    ]:
                        add(name, base + suffix)
                    add("ERP 수동 결과 확인", base + "/erp/confirm", "success erp_invoice_no error_message")
                    link("ERP Import CSV", "/downloads" + base + "/erp/import-file")
                    ctx["notice"] = (
                        "ERP 연계는 파일 Import 방식입니다. ERP 반영 결과를 확인한 후 수동으로 회신을 기록하세요."
                    )
    elif path == "/settings":
        ctx["title"] = "시스템 설정"
        add(
            "승인 임계금액 저장",
            "/settings/approval-amount-threshold",
            "value",
            read("/settings/approval-amount-threshold"),
            "PUT",
        )
        ctx["erp_import"] = True
    elif path == "/audit-log":
        ctx["title"] = "감사 로그"
        ctx["filters"] = ["entity_type", "entity_id", "limit"]
        section("변경 이력", read("/audit-log", query))
    else:
        raise HTTPException(404, "화면을 찾을 수 없습니다.")
    if getattr(request.app.state.settings, "dev_auth", False):
        ctx["users"] = read("/users")
    return ctx


@router.get("/downloads/{api_path:path}")
def download(request: Request, api_path: str, db: Annotated[object, Depends(get_db)]):
    result = invoke(db, "GET", "/" + api_path, query=dict(request.query_params), user=get_user(request, db))
    if not hasattr(result, "content"):
        raise HTTPException(404, "다운로드 파일이 없습니다.")
    from urllib.parse import quote

    return Response(
        result.content,
        media_type=result.media_type,
        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(result.filename)},
    )


@router.post("/dev/account")
async def account(request: Request, db: Annotated[object, Depends(get_db)]):
    data = await request.form()
    check_csrf(request, data.get("_csrf"))
    if not getattr(request.app.state.settings, "dev_auth", False):
        raise HTTPException(404)
    users = invoke(db, "GET", "/users", user=get_user(request, db))
    if data.get("user_id") not in {u["user_id"] for u in users}:
        raise HTTPException(400, "사용자를 찾을 수 없습니다.")
    request.session["user_id"] = data["user_id"]
    return saved(request, data.get("_return"), "개발용 계정을 변경했습니다.")


@router.post("/actions")
async def action(request: Request, db: Annotated[object, Depends(get_db)]):
    data = await request.form()
    check_csrf(request, data.get("_csrf"))
    target = local_url(data.get("_return"))
    api = local_url(data.get("_path"), "")
    if not request.app.state.settings.dev_auth and (api == "/users" or api.startswith("/users/")):
        from kkotsuni.app.rbac import require_action
        require_action(get_user(request, db), "ADMIN")
    method = data.get("_method", "POST")
    if not api or method not in ("POST", "PUT"):
        raise HTTPException(400, "잘못된 작업입니다.")
    payload = {k: v for k, v in data.items() if not k.startswith("_") and k not in ("file", "selected")}
    rows = []
    try:
        for key in list(payload):
            if key in BOOLS:
                payload[key] = str(payload[key]).lower() in ("true", "1", "on")
            elif key in NUMBERS:
                payload[key] = payload[key] if payload[key] != "" else None
            elif payload[key] == "":
                payload[key] = None
        if api == "/orders/upload/preview":
            file = data.get("file")
            if not file or not getattr(file, "filename", ""):
                raise ValueError("Excel 파일을 선택해 주세요.")
            content = await file.read(20 * 1024 * 1024 + 1)
            if len(content) > 20 * 1024 * 1024:
                raise ValueError("파일은 20MB 이하로 선택해 주세요.")
            payload = {"file": content, "filename": file.filename}
        if api == "/orders/upload/commit":
            rows = json.loads(data.get("_rows", "[]"))
            indexes = {int(i) for i in data.getlist("selected")}
            payload = {"rows": [row for i, row in enumerate(rows) if i in indexes]}
        if api.startswith("/erp-sync/"):
            file = data.get("file")
            if not file or not getattr(file, "filename", ""):
                raise ValueError("CSV 파일을 선택해 주세요.")
            content = await file.read(20 * 1024 * 1024 + 1)
            if len(content) > 20 * 1024 * 1024:
                raise ValueError("CSV 파일은 20MB 이하로 선택해 주세요.")
            payload = {"rows": list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))}
        result = invoke(db, method, api, data=payload, user=get_user(request, db))
        if api == "/orders/upload/preview":
            ctx = page_context(request, db, "/orders/upload")
            ctx["preview"] = result
            return render(request, "dashboard.html" if ctx.get("dashboard") else ("print.html" if ctx.get("print_mode") else "page.html"), context=ctx)
        # Preserve detailed partial-success results through PRG without cookie-size limits.
        if isinstance(result, dict) and (
            result.get("errors") or api.endswith("/generate") or api == "/orders/upload/commit"
        ):
            partial = bool(result.get("errors") or result.get("excludedOrders"))
            cache = getattr(request.app.state, "html_results", {})
            now = time.monotonic()
            cache = {k: v for k, v in cache.items() if now - v[0] < 600}
            if len(cache) >= 100:
                cache.pop(next(iter(cache)))
            token = secrets.token_urlsafe(24)
            cache[token] = (now, result)
            request.app.state.html_results = cache
            request.session["html_result"] = token
            return saved(
                request,
                target,
                "일부 항목이 처리되지 않았습니다. 처리 결과를 확인해 주세요."
                if partial
                else "처리했습니다. 생성 결과를 확인해 주세요.",
            )
        return saved(request, target)
    except Exception as exc:
        if (
            not isinstance(exc, (ValueError, TypeError))
            and not hasattr(exc, "status")
            and not hasattr(exc, "status_code")
        ):
            raise
        ctx = page_context(request, db, urlsplit(target).path)
        ctx.update(error=str(exc), details=getattr(exc, "details", None), submitted=dict(data), failed_path=api)
        if api == "/orders/upload/commit":
            ctx["preview"] = {"rows": rows if isinstance(rows, list) else []}
        return render(request, context=ctx, status_code=getattr(exc, "status", getattr(exc, "status_code", 400)))


@router.get("/{page_path:path}")
def page(request: Request, page_path: str, db: Annotated[object, Depends(get_db)]):
    ctx = page_context(request, db, "/" + page_path)
    token = request.session.pop("html_result", None)
    result = getattr(request.app.state, "html_results", {}).pop(token, None)
    if result and time.monotonic() - result[0] < 600:
        ctx["sections"].insert(0, {"title": "처리 결과", "data": result[1]})
    return render(request, "dashboard.html" if ctx.get("dashboard") else ("print.html" if ctx.get("print_mode") else "page.html"), context=ctx)
