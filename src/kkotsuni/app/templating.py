from decimal import Decimal
from pathlib import Path
from urllib.parse import quote

from fastapi.templating import Jinja2Templates

from .http import csrf_token
from .nav import APP_NAME, NAV

templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
LABELS = dict(
    item.split("=", 1)
    for item in [
        "customer_code=거래처코드",
        "name=이름",
        "biz_reg_no=사업자번호",
        "erp_customer_code=ERP 거래처코드",
        "contact_name=담당자",
        "contact_phone=담당자 연락처",
        "approval_required=승인 필요",
        "product_code=제품코드",
        "spec=규격",
        "unit=단위",
        "tax_type=과세구분",
        "erp_item_code=ERP 품목코드",
        "pack_unit=포장단위",
        "pack_size=포장수량",
        "default_price=기본단가",
        "site_name=납품처명",
        "address=주소",
        "receiver_name=수령인",
        "receiver_phone=수령인 연락처",
        "unit_price=단가",
        "effective_from=적용일",
        "raw_name=원본 제품명",
        "raw_product_name=원본 제품명",
        "user_id=사용자 ID",
        "role=역할",
        "order_no=주문번호",
        "order_date=주문일",
        "ship_due_date=출고예정일",
        "ship_date=출고일",
        "ship_order_no=출고지시번호",
        "invoice_no=명세서번호",
        "invoice_date=거래일",
        "status=상태",
        "erp_status=ERP 상태",
        "quantity=수량",
        "order_qty=주문수량",
        "instructed_qty=지시수량",
        "actual_qty=실출고수량",
        "pack_lot=포장 LOT",
        "diff_reason_code=차이 사유",
        "note=비고",
        "lines=품목",
        "delivery_sites=납품처",
        "prices=단가",
        "created_at=등록일",
        "updated_at=수정일",
        "amount=금액",
        "total_amount=합계",
        "supply_amount=공급가액",
        "tax_amount=세액",
        "ship_method=출고방법",
        "delivery_site_id=납품처 ID",
        "split_by_delivery_site=납품처별 분리",
        "success=ERP 반영 성공",
        "erp_invoice_no=ERP 명세서번호",
        "error_message=실패 사유",
        "value=승인 임계금액",
        "date=기준일",
        "from=시작일",
        "to=종료일",
        "entity_type=대상 유형",
        "entity_id=대상 번호",
        "action=작업",
        "detail=상세",
        "errors=오류",
        "warnings=경고",
        "valid=정상",
        "rows=행",
        "orders=주문",
        "shipOrders=출고지시",
        "invoices=거래명세서",
    ]
)
LABELS.update(
    {
        "today": "오늘",
        "week": "최근 7일",
        "shipment": "출고 현황",
        "invoice": "명세서 현황",
        "erp": "ERP 파일 처리",
        "orderCount": "주문 건수",
        "orderQty": "주문 수량",
        "pendingShipmentCount": "미출고 건수",
        "overdueShipmentCount": "출고 지연 건수",
        "overdueShipments": "출고 지연 내역",
        "pendingInvoiceCount": "미발행 건수",
        "issuedTodayCount": "오늘 발행 건수",
        "pendingCount": "대기 건수",
        "sendingCount": "전송중 건수",
        "successCount": "완료 건수",
        "failedCount": "실패 건수",
        "mappingPendingCount": "매핑 대기 건수",
        "validationFailedCount": "검증 필요 건수",
        "delivery_address": "납품주소",
        "order_date_from": "주문 시작일",
        "order_date_to": "주문 종료일",
        "ship_due_date_from": "출고예정 시작일",
        "ship_due_date_to": "출고예정 종료일",
        "missingErpMapping": "ERP 코드 누락 필터",
        "limit": "최대 조회 건수",
        "erp_send_status": "ERP 전송 상태",
        "customer_name": "거래처명",
        "product_name": "제품명",
        "product_spec": "제품규격",
        "product_unit": "제품단위",
        "line_count": "라인 수",
        "order_nos": "주문번호 목록",
        "ship_orders": "출고지시",
        "excludedOrders": "생성 제외 주문",
        "groups": "생성 대상",
        "reason": "사유",
        "message": "내용",
        "mismatches": "불일치 내역",
        "shipOrders": "생성 출고지시",
        "totalInstructedQty": "총 지시수량",
        "sourceOrderCount": "원 주문 건수",
        "approved": "승인 여부",
        "required": "승인 필요",
        "history": "이력",
        "threshold": "승인 임계금액",
        "createdCount": "신규 건수",
        "updatedCount": "갱신 건수",
        "sources": "원 주문 배분",
        "allocated_qty": "배분수량",
        "packed_qty": "포장환산 수량",
        "match_type": "매핑방식",
        "use_count": "사용횟수",
        "last_used_at": "최근 사용일",
        "registered_by": "등록자",
        "changed_by": "변경자",
        "changed_at": "변경일",
        "old_status": "이전 상태",
        "new_status": "변경 상태",
        "from_status": "이전 상태",
        "to_status": "변경 상태",
        "field": "변경 항목",
        "old_value": "이전 값",
        "new_value": "변경 값",
        "line_no": "행 번호",
        "order_line_no": "주문 행 번호",
        "id": "ID",
        "ship_order_dtl_id": "출고지시 행 ID",
        "invoice_dtl_id": "명세서 행 ID",
        "total_actual_qty": "총 실출고수량",
        "diff_qty": "차이수량",
        "filename": "파일명",
        "transmission": "ERP 파일",
        "customer_biz_reg_no": "사업자번호",
        "delivery_site": "납품처",
        "customer_order_no": "거래처 주문번호",
        "updatedLines": "갱신 행 수",
    }
)
templates.env.globals.update(
    label=lambda key: LABELS.get(str(key), str(key)),
    link_for=lambda key, value: (
        (
            "/"
            + {
                "order_no": "orders",
                "ship_order_no": "ship-orders",
                "invoice_no": "invoices",
                "customer_code": "customers",
                "product_code": "products",
            }[key]
            + "/"
            + quote(str(value), safe="")
        )
        if key in {"order_no", "ship_order_no", "invoice_no", "customer_code", "product_code"} and value
        else None
    ),
)


def render(request, template="page.html", context=None, status_code=200):
    context = dict(context or {})
    context.update(
        request=request,
        nav=NAV,
        app_name=APP_NAME,
        csrf=csrf_token(request),
        flash=request.session.pop("flash", None),
        dev_auth=getattr(request.app.state.settings, "dev_auth", False),
    )
    return templates.TemplateResponse(request=request, name=template, context=context, status_code=status_code)


def format_value(value):
    if isinstance(value, Decimal):
        text = format(value, "f")
        return text.rstrip("0").rstrip(".") if "." in text else text
    return value


templates.env.finalize = format_value
