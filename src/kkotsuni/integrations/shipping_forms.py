"""Company shipping-request layout, rebuilt without copying historical entries."""

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.pagebreak import Break


def request_workbook(document, author):
    book = Workbook()
    sheet = book.active
    sheet.title = "출고요청서"
    lines = document["lines"]
    border = Border(*([Side(style="thin", color="9AA89D")] * 4))

    def put(row, col, value):
        cell = sheet.cell(row, col, value)
        if isinstance(value, str):
            cell.data_type = "s"
        return cell

    for offset in range(0, max(len(lines), 1), 21):
        base = (offset // 21) * 34
        if base:
            sheet.row_breaks.append(Break(id=base))
        sheet.merge_cells(start_row=base + 2, start_column=2, end_row=base + 3, end_column=10)
        put(base + 2, 2, "출고 요청서 (택배취합)").font = Font(name="맑은 고딕", bold=True, size=20)
        for row, label, value, right, rvalue in [
            (4, "출고일자", str(document["ship_date"]), "출고자", ""),
            (6, "작성일자", "", "작성자", author),
            (8, "거래처명", document["customer_name"], "구분", document.get("ship_method") or ""),
        ]:
            for first, last in [(2, 3), (4, 7), (8, 8), (9, 10)]:
                sheet.merge_cells(start_row=base + row, start_column=first, end_row=base + row + 1, end_column=last)
            for col, val in [(2, label), (4, value), (8, right), (9, rvalue)]:
                put(base + row, col, val)
        sheet.merge_cells(start_row=base + 11, start_column=3, end_row=base + 11, end_column=4)
        sheet.merge_cells(start_row=base + 11, start_column=5, end_row=base + 11, end_column=6)
        for col, val in [
            (2, "NO."),
            (3, "품명 (원산지표기)"),
            (5, "규격"),
            (7, "수량(ea)"),
            (8, "합계 kg"),
            (9, "비고"),
            (10, "제조일자"),
        ]:
            put(base + 11, col, val).fill = PatternFill("solid", fgColor="E5EEE7")
        for index in range(21):
            row = base + 12 + index
            sheet.merge_cells(start_row=row, start_column=3, end_row=row, end_column=4)
            sheet.merge_cells(start_row=row, start_column=5, end_row=row, end_column=6)
            put(row, 2, offset + index + 1)
            if offset + index < len(lines):
                line = lines[offset + index]
                for col, val in [
                    (3, line["product_name"]),
                    (5, line.get("product_spec") or ""),
                    (7, line["instructed_qty"]),
                    (9, line.get("note") or ""),
                ]:
                    put(row, col, val)
        sheet.merge_cells(start_row=base + 33, start_column=2, end_row=base + 33, end_column=10)
        put(base + 33, 2, "평창올푸드㈜ by 평창꽃순이 · 제조일자·원산지·중량은 확인 후 기재")
        for row in sheet.iter_rows(min_row=base + 4, max_row=base + 32, min_col=2, max_col=10):
            for cell in row:
                cell.border = border
                cell.alignment = Alignment(vertical="center", wrap_text=True)
        for r in range(base + 1, base + 35):
            sheet.row_dimensions[r].height = 24
    for col, width in {"A": 2, "B": 7, "C": 18, "D": 14, "E": 10, "F": 5, "G": 11, "H": 12, "I": 22, "J": 15}.items():
        sheet.column_dimensions[col].width = width
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.print_area = f"B1:J{sheet.max_row}"
    out = BytesIO()
    book.save(out)
    return out.getvalue()
