"""Read vendor layouts without guessing missing dates, prices or product quantities."""

import csv
import hashlib
import io
import re
import unicodedata
import xml.etree.ElementTree as ET
from datetime import date, datetime
from zipfile import ZipFile

import openpyxl
import xlrd

from kkotsuni.app.errors import BusinessError


def text(value):
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return unicodedata.normalize("NFC", str(value)).strip()


def key(value):
    return re.sub(r"\s+", "", text(value)).lower()


def date_value(value):
    value = text(value)
    for pattern in ("%Y-%m-%d", "%Y.%m.%d", "%y.%m.%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(value[:10] if pattern.startswith("%Y") else value[:8], pattern).date().isoformat()
        except ValueError:
            pass
    return ""


ALIASES = {
    "customer_name": ["업체명", "업체", "거래처명"],
    "customer_order_no": [
        "주문번호(사방넷)",
        "품목별 주문번호",
        "상품주문번호",
        "주문번호",
        "고객주문번호",
        "주문번호(곳간 일괄등록용)",
    ],
    "order_date": ["주문일시", "주문일", "발주일"],
    "ship_due_date": ["출고예정일", "출고일", "송장입력일", "송장 입력일", "날짜", "등록일자"],
    "receiver_name": ["수취인명", "수령인명", "수령인", "수령자", "받는사람", "받는분", "이름"],
    "receiver_phone": [
        "수취인 이동통신",
        "수취인연락처",
        "수령인연락처",
        "수령인 휴대전화",
        "수령인휴대폰",
        "수령자핸드폰",
        "배송지연락처",
        "연락처1",
        "핸드폰",
        "연락처(핸폰)",
        "연락처(핸드폰)",
    ],
    "phone2": ["수취인 전화번호", "수령인 전화번호", "수령인연락처", "연락처2", "연락처(2)", "수령자전화"],
    "delivery_address": [
        "수취인주소",
        "수취인 주소",
        "수령인 주소(전체)",
        "수령인주소",
        "전체주소(도로명)",
        "배송지주소",
        "배송지",
        "주소",
        "주 소2",
        "주 소",
    ],
    "address2": ["수취인상세주소"],
    "postal_code": ["우편번호", "수취인 우편번호"],
    "raw_product_name": ["제품명(거래처 표기)", "품목", "상품명", "상품명(병팔이상점)", "품명", "선택사항"],
    "quantity": ["주문수량", "수량", "판매개수", "박스 수량"],
    "unit_price": ["단가", "상품가격"],
    "spec": ["규격"],
    "unit": ["단위"],
    "tracking_no": ["운송장번호", "송장번호", "송장번호(회신용)", "배송번호", "등기번호"],
    "delivery_status": ["배송진행 상태내역", "배송상태"],
    "note": ["배송메세지", "배송메시지", "배송시 요청사항", "배송위치/(출입정보)/(배송요청사항)", "메모", "사용자메모"],
    "box_code": ["박스코드", "박스 타입"],
    "freight": ["운임비", "총 운임"],
}


def sheets(content, filename):
    suffix = filename.rsplit(".", 1)[-1].lower()
    if suffix == "csv":
        for encoding in ("utf-8-sig", "cp949"):
            try:
                rows = list(csv.reader(io.StringIO(content.decode(encoding))))
                if len(rows) > 10000:
                    raise BusinessError("파일당 10,000행까지 처리합니다")
                yield "CSV", rows
                return
            except UnicodeDecodeError:
                continue
        raise BusinessError("CSV 인코딩을 확인하세요")
    if suffix == "xls":
        book = xlrd.open_workbook(file_contents=content)
        for sheet in book.sheets():
            if sheet.nrows > 10000:
                raise BusinessError("시트당 10,000행까지 처리합니다")
            yield sheet.name, [sheet.row_values(i) for i in range(sheet.nrows)]
        return
    if suffix != "xlsx":
        raise BusinessError("XLSX, XLS, CSV 파일만 지원합니다")
    with ZipFile(io.BytesIO(content)) as archive:
        if sum(i.file_size for i in archive.infolist()) > 100 * 1024 * 1024:
            raise BusinessError("압축 해제 크기가 너무 큽니다", 413)
        for name in archive.namelist():
            if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name):
                with archive.open(name) as stream:
                    for _, element in ET.iterparse(stream, events=("end",)):
                        if element.tag.endswith("}c"):
                            populated = any(
                                child.tag.endswith(("}v", "}is")) and "".join(child.itertext()).strip()
                                for child in element
                            )
                            coordinate = element.get("r", "A1")
                            if populated and int(re.search(r"\d+", coordinate).group()) > 10000:
                                raise BusinessError("시트당 10,000행까지 처리합니다. 파일을 나눠주세요")
                            element.clear()
    book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        for sheet in book:
            # Vendor files have formatting extending to row 1,016,897. Bound memory
            # and explicitly detect real values beyond the supported import range.
            rows = []
            for row in sheet.iter_rows(
                max_row=min(sheet.max_row or 0, 10001), max_col=min(sheet.max_column or 0, 80), values_only=True
            ):
                rows.append(list(row))
            if len(rows) > 10000 and any(v is not None for v in rows[-1]):
                raise BusinessError("시트당 10,000행까지 처리합니다")
            yield sheet.title, rows[:10000]
    finally:
        book.close()


def parse(content, filename):
    filename = text(filename).split("/")[-1].split("\\")[-1]
    if not content or len(content) > 20 * 1024 * 1024:
        raise BusinessError("20MB 이하 파일이 필요합니다", 413)
    kind = "품목" if "품목코드" in filename else "양식" if "출고요청서" in filename else "업무자료"
    result = {"filename": filename, "digest": hashlib.sha256(content).hexdigest(), "kind": kind, "records": []}
    if kind == "양식":
        return result
    for sheet, rows in sheets(content, filename):
        if kind == "품목":
            for index, row in enumerate(rows, 1):
                if len(row) > 3 and text(row[0]) in ("제품", "원재료", "부산품") and text(row[1]):
                    result["records"].append(
                        {
                            "sheet": sheet,
                            "row_number": index,
                            "kind": "품목",
                            "values": {
                                "category": text(row[0]),
                                "product_code": text(row[1]),
                                "name": text(row[2]),
                                "spec": text(row[3]),
                            },
                        }
                    )
            continue
        headers, offset = None, 0
        for i, row in enumerate(rows[:25]):
            names = [key(v) for v in row]
            if any(key(v) in names for v in ALIASES["quantity"]) and any(
                key(v) in names for v in ALIASES["raw_product_name"]
            ):
                headers, offset = names, i + 1
                break
        if headers is None and "사방넷 송장번호" in filename:
            headers = [
                key(v)
                for v in [
                    "출고예정일",
                    "No.",
                    "송장번호",
                    "구분",
                    "결제방법",
                    "주문일시",
                    "받는분",
                    "연락처1",
                    "연락처2",
                    "주소",
                    "품목",
                    "수량",
                    "배송메세지",
                    "상품명(판매명)",
                    "판매옵션",
                    "결제금액",
                    "주문번호(사방넷)",
                ]
            ]
        if headers is None:
            continue
        columns = {
            field: next((headers.index(key(a)) for a in aliases if key(a) in headers), None)
            for field, aliases in ALIASES.items()
        }
        vendor = next(
            (
                v
                for v in [
                    "강원곳간",
                    "꽃순이",
                    "미식도감",
                    "대관령",
                    "병팔이상점",
                    "사방넷",
                    "식봄",
                    "용평식음",
                    "제이",
                    "제철밥상",
                    "컨비니",
                    "한화리조트",
                ]
                if v in filename
            ),
            "",
        )
        file_date = ""
        if rows and ("미식도감" in filename or "한화리조트" in filename):
            for v in rows[0]:
                if isinstance(v, (int, float)) and 40000 < v < 60000:
                    file_date = openpyxl.utils.datetime.from_excel(v).date().isoformat()
                    break
        for index, row in enumerate(rows[offset:], offset + 1):
            values = {k: text(row[j]) if j is not None and j < len(row) else "" for k, j in columns.items()}
            if not values["raw_product_name"] or key(values["raw_product_name"]) in ("품목", "상품명", "품명", "합계"):
                continue
            values["customer_name"] = values["customer_name"] or vendor
            if vendor == "강원곳간":
                values["customer_name"] = vendor  # the 업체명 column names the supplier
            if key(values["tracking_no"]) in ("입력하세요", "없음", "-", "0"):
                values["tracking_no"] = ""
            values["delivery_address"] = " ".join(filter(None, [values["delivery_address"], values.pop("address2")]))
            values["order_date"] = date_value(values["order_date"])
            values["ship_due_date"] = date_value(values["ship_due_date"]) or file_date
            if "사방넷 송장번호" in filename:
                values["ship_due_date"] = (
                    datetime.strptime(sheet[:8], "%Y%m%d").date().isoformat() if re.match(r"^20\d{6}", sheet) else ""
                )
            values["quantity_kind"] = "박스" if "박스수량" in headers or "1012출고" in filename else "제품"
            values["ship_method"] = "택배"
            values["unit"] = values["unit"] or "EA"
            values["raw"] = {str(i + 1): text(v) for i, v in enumerate(row) if v is not None}
            record_kind = "송장" if values["tracking_no"] or "1012출고" in filename else "수주"
            result["records"].append({"sheet": sheet, "row_number": index, "kind": record_kind, "values": values})
    if not result["records"] and kind != "양식":
        raise BusinessError("지원하는 데이터 행을 찾지 못했습니다. 업체별 원본 헤더를 확인하세요")
    return result
