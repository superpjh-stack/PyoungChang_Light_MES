import csv
from decimal import Decimal
from io import StringIO

from kkotsuni.app.errors import BusinessError
from kkotsuni.db import repositories as repo
from kkotsuni.services import invoices
from kkotsuni.services.common import day

HEADERS = [
    "명세서번호",
    "거래일자",
    "거래처코드",
    "ERP거래처코드",
    "품목코드",
    "ERP품목코드",
    "규격",
    "수량",
    "단위",
    "단가",
    "공급가액",
    "세액",
    "과세구분",
]


def csv_file(db, no):
    invoice = invoices.get(db, no)
    customer = repo.require(db, "customer", "customer_code", invoice["customer_code"])
    buf = StringIO(newline="")
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(HEADERS)

    def cell(value):
        if isinstance(value, Decimal):
            return format(value, "f").rstrip("0").rstrip(".") if "." in format(value, "f") else str(value)
        return value

    for line in invoice["lines"]:
        product = repo.require(db, "product", "product_code", line["product_code"])
        writer.writerow(
            [
                cell(value)
                for value in [
                    no,
                    invoice["invoice_date"],
                    invoice["customer_code"],
                    customer["erp_customer_code"] or "",
                    line["product_code"],
                    product["erp_item_code"] or "",
                    line["spec"] or "",
                    line["quantity"],
                    line["unit"] or "",
                    line["unit_price"],
                    line["supply_amount"],
                    line["tax_amount"],
                    line["tax_type"],
                ]
            ]
        )
    return buf.getvalue().encode("utf-8")


def send(db, no, retry=False):
    row = repo.require(db, "invoice_hdr", "invoice_no", no, "거래명세서", lock=True)
    if retry and row["erp_send_status"] != "FAILED":
        raise BusinessError("전송 실패 상태의 명세서만 재전송할 수 있습니다", 409)
    if row["status"] != "ISSUED":
        raise BusinessError("발행(ISSUED)된 명세서만 ERP로 전송할 수 있습니다", 409)
    if row["erp_send_status"] == "SUCCESS":
        raise BusinessError("이미 ERP 전송이 성공한 명세서입니다", 409)
    state = invoices.approval(db, no)
    if state["required"] and not state["approved"]:
        raise BusinessError("승인이 필요한 명세서입니다. 먼저 승인 후 ERP로 전송하세요", 409)
    csv_file(db, no)
    repo.update(
        db,
        "invoice_hdr",
        "invoice_no",
        no,
        {"erp_send_status": "SENDING", "erp_error_message": None},
        ("erp_send_status", "erp_error_message"),
        timestamp=True,
    )
    return {**invoices.get(db, no), "transmission": {"filename": f"{no}_erp_import.csv"}}


def confirm(db, no, data):
    row = repo.require(db, "invoice_hdr", "invoice_no", no, "거래명세서", lock=True)
    if row["erp_send_status"] != "SENDING":
        raise BusinessError("전송중 상태의 명세서만 결과를 확정할 수 있습니다", 409)
    success = data.get("success")
    if success not in (True, False, "true", "false", "1", "0", 1, 0):
        raise BusinessError("success는 참/거짓이어야 합니다")
    success = success in (True, "true", "1", 1)
    if not success and not data.get("error_message"):
        raise BusinessError("실패 처리 시 error_message가 필요합니다")
    values = {
        "erp_send_status": "SUCCESS" if success else "FAILED",
        "erp_error_message": None if success else data["error_message"],
    }
    if success:
        values["erp_invoice_no"] = data.get("erp_invoice_no")
    repo.update(db, "invoice_hdr", "invoice_no", no, values, tuple(values), timestamp=True)
    return invoices.get(db, no)


def batch(db, date):
    rows = db.q(
        "SELECT invoice_no FROM invoice_hdr WHERE invoice_date=%s AND status='ISSUED' AND erp_send_status IN ('PENDING','FAILED') ORDER BY invoice_no",
        (day(date, "invoice_date"),),
    )
    result = []
    for row in rows:
        no = row["invoice_no"]
        try:
            with db.tx():
                sent = send(db, no)
                result.append(
                    {"invoice_no": no, "filename": sent["transmission"]["filename"], "status": sent["erp_send_status"]}
                )
        except BusinessError as exc:
            result.append({"invoice_no": no, "error": str(exc)})
    return result
