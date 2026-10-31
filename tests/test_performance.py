"""R1-N-01/02 on actual PostgreSQL, synthetic data, one local measurement per test."""

from time import perf_counter

from test_workflow import ok, preview, row, setup


def test_upload_1000_rows_within_five_minutes(client):
    setup(client)
    rows = [row(customer_order_no=f"PERF-{i}", quantity=1) for i in range(1000)]
    start = perf_counter()
    parsed = preview(client, rows)
    result = ok(client.post("/api/orders/upload/commit", json={"rows": parsed["rows"]}), 201)
    elapsed = perf_counter() - start
    assert result["errors"] == [] and len(result["orders"]) == 1000
    assert len(ok(client.get("/api/orders"))) == 1000
    print(f"R1-N-01: 1000 rows preview+commit {elapsed:.3f}s (limit 300s)")
    assert elapsed < 300


def test_generate_400_orders_within_thirty_seconds(client):
    for index in range(20):
        ok(client.post("/api/customers", json={"customer_code": f"C{index:03}", "name": f"합성 거래처 {index}"}), 201)
    for index in range(10):
        ok(client.post("/api/products", json={"product_code": f"P{index:03}", "name": f"합성 품목 {index}"}), 201)
    aliases = [
        {"customer_code": f"C{c:03}", "product_code": f"P{p:03}", "raw_name": f"품목 {p}"}
        for c in range(20)
        for p in range(10)
    ]
    ok(client.post("/api/product-aliases/bulk", json=aliases), 201)
    parsed = preview(
        client,
        [
            row(
                customer_code=f"C{i % 20:03}",
                raw_product_name=f"품목 {i % 10}",
                quantity=1,
                unit_price=10000,
                customer_order_no=f"PERF-{i}",
            )
            for i in range(400)
        ],
    )
    committed = ok(client.post("/api/orders/upload/commit", json={"rows": parsed["rows"]}), 201)
    assert len(committed["orders"]) == 400
    for no in committed["orders"]:
        ok(client.post(f"/api/orders/{no}/confirm"))
    start = perf_counter()
    generated = ok(client.post("/api/ship-orders/generate", json={"ship_date": "2026-11-05"}), 201)
    ship_elapsed = perf_counter() - start
    assert generated["sourceOrderCount"] == 400
    for no in generated["shipOrders"]:
        for line in ok(client.get(f"/api/ship-orders/{no}"))["lines"]:
            ok(
                client.post(
                    f"/api/ship-orders/lines/{line['ship_order_dtl_id']}/results",
                    json={"actual_qty": line["instructed_qty"]},
                ),
                201,
            )
    start = perf_counter()
    result = ok(client.post("/api/invoices/generate", json={"invoice_date": "2026-11-05"}), 201)
    invoice_elapsed = perf_counter() - start
    assert result["excludedOrders"] == []
    assert len(ok(client.get("/api/orders", params={"status": "INVOICED"}))) == 400
    print(f"R1-N-02: 400 orders shipping {ship_elapsed:.3f}s, invoices {invoice_elapsed:.3f}s (each limit 30s)")
    assert ship_elapsed < 30 and invoice_elapsed < 30
