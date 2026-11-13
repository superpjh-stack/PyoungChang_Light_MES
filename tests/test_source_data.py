from io import BytesIO

from openpyxl import Workbook, load_workbook

from kkotsuni.integrations.source_files import parse
from kkotsuni.services.source_data import ingest, summary


def source(rows, sheet="원본"):
    w = Workbook()
    s = w.active
    s.title = sheet
    for row in rows:
        s.append(row)
    out = BytesIO()
    w.save(out)
    return out.getvalue()


HEAD = ["업체명", "주문일", "출고일", "주문번호", "받는분", "주소", "품명", "수량", "송장번호"]
ROW = ["거래처", "2026-10-10", "2026-10-12", "external-001", "수령인", "배송주소", "배추김치", 2, "12345"]


def test_source_dedupe_and_no_automatic_shipment(db):
    a = source([HEAD, ROW])
    b = source([HEAD, ROW], sheet="회신")
    first = ingest(db, a, "거래처 발주서.xlsx")
    assert ingest(db, a, "다른 파일명.xlsx")["duplicate_file"]
    ingest(db, b, "거래처 송장번호.xlsx")
    assert db.one("SELECT count(*) AS n FROM order_hdr")["n"] == 1
    assert db.one("SELECT count(*) AS n FROM ship_order")["n"] == 0
    assert db.one("SELECT count(*) AS n FROM source_record WHERE status='중복'")["n"] == 1
    assert db.one("SELECT order_no FROM source_record WHERE file_id=%s", (first["id"],))["order_no"]
    # A second recipient under the same external order is a separate order.
    different = ROW.copy()
    different[4] = "다른 수령인"
    ingest(db, source([HEAD, different]), "거래처 추가.xlsx")
    assert db.one("SELECT count(*) AS n FROM order_hdr")["n"] == 2


def test_missing_dates_and_parcel_quantity_stay_in_review(db):
    row = ROW.copy()
    row[1] = ""
    headers = HEAD.copy()
    headers[7] = "박스 수량"
    ingest(db, source([headers, row]), "배송자료.xlsx")
    result = summary(db)[0]
    assert result["review"] == 1 and result["imported"] == 0
    assert db.one("SELECT count(*) AS n FROM order_hdr")["n"] == 0
    assert "박스" in db.one("SELECT issue FROM source_record")["issue"]


def test_later_order_enriches_earlier_parcel_without_duplicate(db):
    row = ROW.copy()
    row[1] = ""
    headers = HEAD.copy()
    headers[7] = "박스 수량"
    ingest(db, source([headers, row]), "배송자료.xlsx")
    ingest(db, source([HEAD, ROW]), "발주자료.xlsx")
    assert db.one("SELECT count(*) AS n FROM order_hdr")["n"] == 1
    assert db.one("SELECT count(DISTINCT order_no) AS n FROM source_record")["n"] == 1
    assert db.one("SELECT count(*) AS n FROM source_record WHERE status='기존 연결'")["n"] == 1


def test_shipping_form_layout_and_formula_safety():
    from kkotsuni.integrations.shipping_forms import request_workbook

    data = {
        "ship_date": "2026-11-01",
        "customer_name": "거래처",
        "ship_method": "택배",
        "lines": [{"product_name": "=malicious()", "product_spec": "5kg", "instructed_qty": 2, "note": ""}] * 22,
    }
    w = load_workbook(BytesIO(request_workbook(data, "관리자")))
    assert w.active["C12"].data_type == "s"
    assert w.active["G12"].value == 2
    assert len(w.active.row_breaks.brk) == 1
    assert w.active["B46"].value == 22


def test_catalog_conflicts_preserved_and_tax_pending(db):
    b = source([["구분", "코드", "품목명", "규격"], ["제품", "P001", "김치", "5kg"], ["원재료", "R001", "무", "kg"]])
    ingest(db, b, "품목코드.xlsx")
    assert db.one("SELECT tax_review_required FROM product WHERE product_code='P001'")["tax_review_required"]
    ingest(
        db, source([["구분", "코드", "품목명", "규격"], ["제품", "P001", "다른 김치", "10kg"]]), "품목코드 변경.xlsx"
    )
    assert db.one("SELECT name FROM product WHERE product_code='P001'")["name"] == "김치"
    assert db.one("SELECT count(*) AS n FROM product")["n"] == 1


def test_csv_and_placeholder_tracking():
    b = "상품명(병팔이상점),수량,운송장번호\n김치,1,입력하세요\n".encode("cp949")
    row = parse(b, "병팔이상점 발주서.csv")["records"][0]
    assert row["values"]["tracking_no"] == "" and row["kind"] == "수주"


def test_admin_only_import_and_exports(client, db):
    db.x("INSERT INTO app_user(user_id,name,role) VALUES ('a','관리자','ADMIN'),('v','조회','VIEWER')")
    assert client.get("/source-data").status_code == 401
    assert client.get("/source-data", headers={"X-User-Id": "v"}).status_code == 403
    with client:
        b = source([HEAD, ROW])
        r = client.post("/api/source-data/upload", headers={"X-User-Id": "a"}, files={"file": ("주문.xlsx", b)})
        assert r.status_code == 200, r.text
        ident = r.json()["id"]
        assert client.get(f"/source-data/{ident}", headers={"X-User-Id": "a"}).status_code == 200
        assert client.get(f"/source-data/{ident}/original", headers={"X-User-Id": "v"}).status_code == 403
        assert client.get(f"/source-data/{ident}/original", headers={"X-User-Id": "a"}).content == b
        result = client.get(f"/source-data/{ident}/postal.xlsx", headers={"X-User-Id": "a"})
        w = load_workbook(BytesIO(result.content))
        assert w.active["B2"].value == "12345"
        assert w.active["M1"].value == "우편번호"


def test_one_missing_date_is_filled_and_parcel_logs_are_evidence_only(db):
    # MIG-24: order date missing -> ship date; marked on the order note.
    row = ROW.copy()
    row[1] = ""
    ingest(db, source([HEAD, row]), "거래처 발주서.xlsx")
    order = db.one("SELECT order_date,ship_due_date,note FROM order_hdr")
    assert str(order["order_date"]) == str(order["ship_due_date"]) == "2026-10-12"
    assert "[날짜 보완: 주문일=출고예정일]" in order["note"]
    # Ship date missing -> order date.
    other = ROW.copy()
    other[2], other[3], other[4], other[8] = "", "external-002", "둘째", ""
    ingest(db, source([HEAD, other]), "거래처 발주서2.xlsx")
    assert db.one("SELECT count(*) AS n FROM order_hdr WHERE ship_due_date='2026-10-10'")["n"] == 1
    # Both dates missing stays in review.
    none = ROW.copy()
    none[1], none[2], none[3], none[4], none[8] = "", "", "external-003", "셋째", ""
    ingest(db, source([HEAD, none]), "거래처 발주서3.xlsx")
    assert db.one("SELECT count(*) AS n FROM source_record WHERE status='검토 필요'")["n"] == 1
    # A parcel log never creates an order: matching tracking links, unknown tracking is excluded.
    log = [HEAD, ["", "", "2026-10-12", "", "수령인", "", "김치", 1, "12345"], ["", "", "2026-10-12", "", "남", "", "김치", 1, "99999"]]
    ingest(db, source(log), "1012출고.xlsx")
    assert db.one("SELECT count(*) AS n FROM order_hdr")["n"] == 2
    rows = db.q("SELECT status,order_no FROM source_record r JOIN source_file f ON f.id=r.file_id WHERE f.filename='1012출고.xlsx' ORDER BY r.id")
    assert [r["status"] for r in rows] == ["기존 연결", "범위 제외"] and rows[0]["order_no"]
