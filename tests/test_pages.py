"""HTML helper checks independent of the database integration suite."""

from types import SimpleNamespace

from starlette.requests import Request

from kkotsuni.app.http import local_url
from kkotsuni.app.templating import render


def test_return_urls_reject_external_redirects():
    for value in ("https://outside.test", "//outside.test", "/\\outside.test", "/x\ny"):
        assert local_url(value) == "/"
    assert local_url("/orders?status=RECEIVED") == "/orders?status=RECEIVED"


def test_server_html_escapes_data_and_preserves_form_input():
    app = SimpleNamespace(state=SimpleNamespace(settings=SimpleNamespace(dev_auth=False)))
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/customers",
            "query_string": b"",
            "headers": [],
            "scheme": "http",
            "server": ("test", 80),
            "app": app,
            "session": {},
        }
    )
    response = render(
        request,
        context={
            "title": "거래처",
            "current_path": "/customers",
            "sections": [{"title": "목록", "data": [{"customer_code": "C1", "name": "<script>bad()</script>"}]}],
            "forms": [],
            "links": [],
            "filters": [],
        },
    )
    html = response.body.decode()
    assert "&lt;script&gt;" in html
    assert "<script>bad()" not in html
    assert "/customers/C1" in html
    assert "주문 업로드" in html


def test_templates_render_nested_rows_and_empty_state():
    from kkotsuni.app.templating import templates

    template = templates.env.from_string("{% from 'macros.html' import display %}{{ display(data) }}")
    html = template.render(data={"lines": [], "quantity": 0, "note": None})
    assert "내역이 없습니다." in html
    assert "0" in html


def html_token(client, path="/users"):
    import re

    page = client.get(path)
    assert page.status_code == 200, page.text
    match = re.search(r'name="_csrf" value="([^"]+)"', page.text)
    assert match, page.text
    return match.group(1)


def html_action(client, token, path, target="/", method="POST", **fields):
    return client.post(
        "/actions",
        data={"_csrf": token, "_path": path, "_return": target, "_method": method, **fields},
        follow_redirects=False,
    )


def test_html_csrf_input_retention_prg_and_account_permissions(client):
    token = html_token(client)
    assert client.post("/actions", data={"_path": "/users"}).status_code == 403
    bad = html_action(client, token, "/users", "/users", user_id="kept-id", name="", role="ADMIN")
    assert bad.status_code == 400
    assert 'value="kept-id"' in bad.text
    assert "필수" in bad.text
    good = html_action(client, token, "/users", "/users", user_id="admin", name="관리자", role="ADMIN")
    assert good.status_code == 303
    assert good.headers["location"] == "/users"
    assert "저장했습니다" in client.get("/users").text
    unauthorized = html_action(
        client, token, "/settings/approval-amount-threshold", "/settings", method="PUT", value="1234"
    )
    assert unauthorized.status_code == 401
    assert 'value="1234"' in unauthorized.text
    selected = client.post(
        "/dev/account", data={"_csrf": token, "_return": "//outside.test", "user_id": "admin"}, follow_redirects=False
    )
    assert selected.status_code == 303 and selected.headers["location"] == "/"
    approved = html_action(
        client, token, "/settings/approval-amount-threshold", "/settings", method="PUT", value="1234"
    )
    assert approved.status_code == 303
    assert client.get("/api/settings/approval-amount-threshold").json()["value"] == 1234
    html_action(client, token, "/users", "/users", user_id="viewer", name="조회자", role="VIEWER")
    client.post("/dev/account", data={"_csrf": token, "_return": "/users", "user_id": "viewer"})
    forbidden = html_action(
        client, token, "/settings/approval-amount-threshold", "/settings", method="PUT", value="555"
    )
    assert forbidden.status_code == 403


def test_html_complete_order_shipping_invoice_workflow(client):
    import html
    import json
    import re

    from test_workflow import row, setup, workbook

    setup(client, approval=True)
    token = html_token(client)
    client.post("/dev/account", data={"_csrf": token, "user_id": "op1", "_return": "/orders/upload"})
    preview = client.post(
        "/actions",
        data={"_csrf": token, "_path": "/orders/upload/preview", "_return": "/orders/upload"},
        files={"file": ("orders.xlsx", workbook([row()]))},
    )
    assert preview.status_code == 200, preview.text
    hidden = re.search(r'name="_rows" value="([^"]+)"', preview.text)
    assert hidden
    rows = json.loads(html.unescape(hidden.group(1)))
    committed = html_action(
        client, token, "/orders/upload/commit", "/orders/upload", _rows=json.dumps(rows), selected="0"
    )
    assert committed.status_code == 303, committed.text
    number = client.get("/api/orders").json()[0]["order_no"]
    assert html_action(client, token, f"/orders/{number}/confirm", f"/orders/{number}").status_code == 303
    assert (
        html_action(client, token, "/ship-orders/generate", "/ship-orders", ship_date="2026-11-05").status_code == 303
    )
    shipment = client.get("/api/ship-orders").json()[0]["ship_order_no"]
    line = client.get(f"/api/ship-orders/{shipment}").json()["lines"][0]["ship_order_dtl_id"]
    assert (
        html_action(
            client,
            token,
            f"/ship-orders/lines/{line}/results",
            f"/ship-orders/{shipment}",
            actual_qty="10",
            pack_lot="LOT-HTML",
        ).status_code
        == 303
    )
    assert (
        html_action(
            client, token, "/invoices/generate", "/invoices", invoice_date="2026-11-05", split_by_delivery_site="false"
        ).status_code
        == 303
    )
    invoice = client.get("/api/invoices").json()[0]["invoice_no"]
    for operation in ("approve", "issue", "erp/send"):
        result = html_action(client, token, f"/invoices/{invoice}/{operation}", f"/invoices/{invoice}")
        assert result.status_code == 303, result.text
    result = html_action(
        client,
        token,
        f"/invoices/{invoice}/erp/confirm",
        f"/invoices/{invoice}",
        success="true",
        erp_invoice_no="ERP-HTML",
    )
    assert result.status_code == 303, result.text
    for path in [
        "/",
        "/customers",
        "/customers/C1",
        "/products",
        "/products/P1",
        "/users",
        "/settings",
        "/orders",
        f"/orders/{number}",
        "/mapping",
        "/ship-orders",
        f"/ship-orders/{shipment}",
        f"/ship-orders/{shipment}/print",
        "/invoices",
        "/invoices/preview?invoice_date=2026-11-05",
        f"/invoices/{invoice}",
        f"/invoices/{invoice}/print",
        "/audit-log",
    ]:
        response = client.get(path)
        assert response.status_code == 200, (path, response.text)
    printed = client.get(f"/invoices/{invoice}/print").text
    assert "거 래 명 세 서" in printed and "배추김치" in printed
    for path in [
        "/orders/upload-template",
        "/orders/export",
        f"/ship-orders/{shipment}/export",
        f"/invoices/{invoice}/export",
        f"/invoices/{invoice}/erp/import-file",
    ]:
        download = client.get("/downloads" + path)
        assert download.status_code == 200
        assert "attachment" in download.headers["content-disposition"]


def test_development_account_switch_hidden_and_disabled_when_off(client):
    from dataclasses import replace

    client.app.state.settings = replace(client.app.state.settings, dev_auth=False)
    token = html_token(client)
    assert "개발 전용 계정 전환" not in client.get("/users").text
    result = client.post("/dev/account", data={"_csrf": token, "user_id": "admin"})
    assert result.status_code == 404


def test_mapping_prefilled_name_order_edit_and_csv_sync(client):
    from test_workflow import row, setup, upload

    setup(client)
    number = upload(client, [row(raw_product_name="처음 보는 김치")])[0]
    token = html_token(client)
    mapping = client.get("/mapping")
    assert 'value="처음 보는 김치"' in mapping.text
    result = html_action(
        client,
        token,
        "/mapping-queue/resolve",
        "/mapping",
        customer_code="C1",
        raw_name="처음 보는 김치",
        product_code="P1",
    )
    assert result.status_code == 303
    assert client.get("/api/mapping-queue").json() == []
    edited = html_action(
        client,
        token,
        f"/orders/{number}",
        f"/orders/{number}",
        method="PUT",
        delivery_address="평창 배송주소",
        receiver_name="홍길동",
        receiver_phone="010-0000-0000",
        ship_method="택배",
        note="문 앞에 배송",
    )
    assert edited.status_code == 303
    detail = client.get(f"/api/orders/{number}").json()
    assert detail["delivery_address"] == "평창 배송주소"
    assert detail["note"] == "문 앞에 배송"
    assert '<select name="missingErpMapping">' in client.get("/customers").text
    client.post("/dev/account", data={"_csrf": token, "user_id": "admin1", "_return": "/settings"})
    sync = client.post(
        "/actions",
        data={"_csrf": token, "_path": "/erp-sync/customers", "_return": "/settings"},
        files={"file": ("masters.csv", "customer_code,name,erp_customer_code\nC1,수정상호,ERP-C1\n".encode())},
        follow_redirects=False,
    )
    assert sync.status_code == 303, sync.text
    assert client.get("/api/customers/C1").json()["erp_customer_code"] == "ERP-C1"
