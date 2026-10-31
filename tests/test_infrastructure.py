import psycopg
import pytest
from fastapi.testclient import TestClient

from kkotsuni.app.main import create_app
from kkotsuni.app.settings import Settings
from kkotsuni.db.repositories import insert


def test_transaction_rollback_and_database_constraints(db):
    with pytest.raises(psycopg.IntegrityError), db.tx():
        insert(db, "customer", {"customer_code": "C", "name": "합성 거래처"})
        insert(
            db,
            "order_hdr",
            {"order_no": "BAD", "order_date": "2026-11-05", "ship_due_date": "2026-11-01", "customer_code": "C"},
        )
    assert db.one("SELECT COUNT(*) AS c FROM customer")["c"] == 0


def test_database_unavailable_returns_503_without_connection_details():
    app = create_app(Settings(database_url="postgresql://unavailable@127.0.0.1:1/absent"))
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 503
        assert response.json() == {"error": "데이터베이스에 연결할 수 없습니다"}
        response = client.get("/")
        assert response.status_code == 503
        assert "unavailable@" not in response.text


def test_unknown_routes_and_methods(client):
    response = client.get("/api/unknown")
    assert response.status_code == 404 and "error" in response.json()
    assert client.delete("/api/products").status_code == 405


def test_malformed_body_and_upload_header(client):
    assert client.post("/api/products", json=[]).status_code == 422
    assert client.post("/api/products", json="wrong").status_code == 422
    assert client.post("/api/orders/upload/preview", files={"file": ("wrong.xlsx", b"invalid")}).status_code == 400


def test_development_identity_is_disabled_by_default(client, db_url, db):
    from test_workflow import invoice, setup

    setup(client)
    _, _, no, _ = invoice(client)
    schema = db.one("SELECT current_schema() AS s")["s"]
    app = create_app(Settings(database_url=db_url, db_schema=schema, dev_auth=False))
    with TestClient(app) as production:
        assert production.post(f"/api/invoices/{no}/issue", headers={"X-User-Id": "admin1"}).status_code == 401


@pytest.mark.parametrize(
    "payload", [{"customer_code": 123, "name": "고객"}, {"customer_code": "C", "name": {"bad": 1}}]
)
def test_scalar_text_identifiers_are_validated(client, payload):
    assert client.post("/api/customers", json=payload).status_code == 422


def test_nonstandard_json_numbers_rejected(client):
    response = client.post(
        "/api/products",
        content='{"product_code":"P","name":"Kimchi","default_price":NaN}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_openapi_exposes_dynamic_path_and_file_input(client):
    spec = client.get("/openapi.json").json()
    params = spec["paths"]["/api/orders/{no}"]["get"]["parameters"]
    assert any(p["name"] == "no" and p["in"] == "path" for p in params)
    body = spec["paths"]["/api/orders/upload/preview"]["post"]["requestBody"]
    assert "multipart/form-data" in body["content"]
