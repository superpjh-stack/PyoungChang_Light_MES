from datetime import date, datetime
from io import BytesIO
from zipfile import BadZipFile, ZipFile

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill

from kkotsuni.app.errors import BusinessError

COLUMNS = [
    ("order_date", "주문일자"),
    ("customer_code", "거래처코드"),
    ("customer_name", "거래처명"),
    ("delivery_site_name", "납품처명"),
    ("delivery_address", "배송지 주소"),
    ("receiver_name", "수령인"),
    ("receiver_phone", "연락처"),
    ("raw_product_name", "제품명(거래처 표기)"),
    ("spec", "규격"),
    ("quantity", "수량"),
    ("unit", "단위"),
    ("unit_price", "단가"),
    ("ship_due_date", "출고예정일"),
    ("ship_method", "배송방법"),
    ("customer_order_no", "거래처 주문번호"),
    ("note", "비고"),
]


def workbook(headers, rows, title="주문내역서"):
    wb = Workbook()
    ws = wb.active
    ws.title = title
    ws.append(headers)
    for row in rows:
        ws.append(list(row))
        # Treat user-controlled values as strings, not Excel formulas.
        for cell in ws[ws.max_row]:
            if isinstance(cell.value, str):
                cell.data_type = "s"
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="245447")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = 20
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = "1:1"
    output = BytesIO()
    wb.save(output)
    return output.getvalue()


def template():
    sample = [
        "2026-11-03",
        "C0012",
        "○○홈쇼핑",
        "○○물류센터",
        "강원 평창군",
        "홍길동",
        "010-0000-0000",
        "고랭지띄고10kg",
        "10kg",
        25,
        "BOX",
        38000,
        "2026-11-05",
        "택배",
        "HS-2026110300123",
        "",
    ]
    return workbook([h for _, h in COLUMNS], [sample])


def parse(content):
    if not content or len(content) > 20 * 1024 * 1024:
        raise BusinessError("20MB 이하의 Excel 파일이 필요합니다", 413 if content else 400)
    try:
        with ZipFile(BytesIO(content)) as archive:
            if sum(i.file_size for i in archive.infolist()) > 100 * 1024 * 1024:
                raise BusinessError("압축 해제 크기가 너무 큰 Excel 파일입니다", 413)
        wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
        try:
            ws = wb.worksheets[0]
            iterator = ws.iter_rows(values_only=True)
            headers = next(iterator, ())
            if list(headers[: len(COLUMNS)]) != [h for _, h in COLUMNS]:
                raise BusinessError("필수 컬럼 또는 순서가 올바르지 않습니다. 표준 업로드 템플릿을 사용하세요")
            rows = []
            for idx, cells in enumerate(iterator, 2):
                if idx > 10002:
                    raise BusinessError("한 번에 10,000행까지 업로드할 수 있습니다", 413)
                values = {}
                for i, (key, _) in enumerate(COLUMNS):
                    value = cells[i] if i < len(cells) else None
                    if isinstance(value, (datetime, date)):
                        value = value.strftime("%Y-%m-%d")
                    if isinstance(value, str):
                        value = value.strip() or None
                    values[key] = value
                if any(v is not None for v in values.values()):
                    rows.append({"rowNumber": idx, "values": values})
            return rows
        finally:
            wb.close()
    except BusinessError:
        raise
    except (BadZipFile, KeyError, ValueError, IndexError, OSError):
        raise BusinessError("올바른 XLSX 파일이 아닙니다")


def document_workbook(title_row, metadata_row, headers, rows, title):
    content = workbook(headers, rows, title)
    wb = load_workbook(BytesIO(content))
    ws = wb.active
    ws.insert_rows(1, 3)
    for index, row in enumerate((title_row, metadata_row), 1):
        for col, value in enumerate(row, 1):
            cell = ws.cell(index, col, value)
            if isinstance(value, str):
                cell.data_type = "s"
    ws.freeze_panes = "A5"
    ws.print_title_rows = "1:4"
    ws.auto_filter.ref = f"A4:{ws.cell(ws.max_row, ws.max_column).coordinate}"
    output = BytesIO()
    wb.save(output)
    return output.getvalue()
