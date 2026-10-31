"""Run browser checks against synthetic data in a unique, disposable PostgreSQL schema."""

import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path
from uuid import uuid4

import httpx
from playwright.sync_api import sync_playwright
from psycopg import sql

from kkotsuni.db.connection import connect
from tools.db_migrate import migrate


def main():
    url = os.environ["KKOTSUNI_TEST_DATABASE_URL"]
    schema = "browser_" + uuid4().hex
    output = Path("artifacts/browser")
    output.mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    with connect(url) as db:
        db.raw.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    process = None
    try:
        with connect(url, schema) as db:
            migrate(db)
        env = {**os.environ, "KKOTSUNI_DATABASE_URL": url, "KKOTSUNI_DB_SCHEMA": schema, "KKOTSUNI_DEV_AUTH": "true"}
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "kkotsuni.app.main:app", "--host", "127.0.0.1", "--port", str(port)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        with httpx.Client(base_url=base, timeout=20) as client:
            for _ in range(100):
                try:
                    if client.get("/api/health").status_code == 200:
                        break
                except httpx.ConnectError:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("Browser test server did not start")

            def post(path, data=None):
                response = client.post("/api" + path, json=data)
                response.raise_for_status()
                return response.json()

            post("/users", {"user_id": "browser-admin", "name": "검증 관리자", "role": "ADMIN"})
            post("/customers", {"customer_code": "DEMO", "name": "브라우저 검증 거래처", "biz_reg_no": "000-00-00000"})
            post(
                "/products",
                {
                    "product_code": "DEMO",
                    "name": "고랭지 포기김치 · 긴 품목명 인쇄 검증",
                    "spec": "10kg",
                    "unit": "BOX",
                    "default_price": 38000,
                },
            )
            post("/product-aliases", {"customer_code": "DEMO", "raw_name": "김치", "product_code": "DEMO"})
            rows = [
                {
                    "rowNumber": i + 2,
                    "values": {
                        "order_date": "2026-11-03",
                        "ship_due_date": "2026-11-05",
                        "customer_code": "DEMO",
                        "raw_product_name": "김치",
                        "quantity": 2,
                        "unit": "BOX",
                        "customer_order_no": "BROWSER",
                        "unit_price": 38000,
                    },
                }
                for i in range(55)
            ]
            order = post("/orders/upload/commit", {"rows": rows})["orders"][0]
            post("/orders/" + order + "/confirm")
            shipment = post("/ship-orders/generate", {"ship_date": "2026-11-05"})["shipOrders"][0]
            line = client.get("/api/ship-orders/" + shipment).json()["lines"][0]
            post(
                "/ship-orders/lines/" + str(line["ship_order_dtl_id"]) + "/results",
                {"actual_qty": 110, "pack_lot": "DEMO-PACK"},
            )
            invoice = post("/invoices/generate", {"invoice_date": "2026-11-05"})["invoices"][0]
        errors = []
        checked = []
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page()
            page.on("pageerror", lambda exc: errors.append(str(exc)))
            for width in (1440, 1024, 390):
                page.set_viewport_size({"width": width, "height": 1000})
                for path in (
                    "/",
                    "/orders",
                    "/orders/upload",
                    "/mapping-queue",
                    "/ship-orders/" + shipment,
                    "/invoices/" + invoice,
                    "/customers",
                    "/products",
                    "/users",
                    "/settings",
                    "/audit-log",
                ):
                    response = page.goto(base + path)
                    assert response.status == 200, (path, response.status)
                    assert page.locator("h1").inner_text().strip()
                    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2"), (
                        f"Page overflow {width} {path}"
                    )
                    checked.append({"width": width, "path": path})
                page.goto(base + "/invoices/" + invoice)
                page.screenshot(path=str(output / f"invoice-{width}.png"), full_page=True)
                page.goto(base + "/")
                page.screenshot(path=str(output / f"dashboard-{width}.png"), full_page=True)
            page.set_viewport_size({"width": 1440, "height": 1000})
            page.goto(base + "/customers")
            page.locator('input[name="customer_code"]').fill("BROWSER-NEW")
            page.locator('input[name="name"]').fill("화면에서 등록한 거래처")
            page.locator('form[action="/actions"] button[type="submit"]').click()
            assert "화면에서 등록한 거래처" in page.locator("main").inner_text()
            page.goto(base + "/users")
            page.locator("details.dev summary").click()
            page.locator('select[name="user_id"]').select_option("browser-admin")
            page.locator('form[action="/dev/account"] button').click()
            page.goto(base + "/invoices/" + invoice)
            form = page.locator('form[action="/actions"]').filter(
                has=page.locator('input[name="_path"][value$="/issue"]')
            )
            form.locator('button[type="submit"]').click()
            assert "ISSUED" in page.locator("main").inner_text()
            page.goto(base + "/invoices/" + invoice + "/print")
            page.emulate_media(media="print")
            page.screenshot(path=str(output / "invoice-print.png"), full_page=True)
            pdf = page.pdf(
                path=str(output / "invoice-multipage.pdf"),
                format="A4",
                print_background=True,
                prefer_css_page_size=True,
            )
            pages = len(re.findall(rb"/Type\s*/Page\b", pdf))
            assert pages >= 2, "55 lines should span multiple A4 pages"
            page.goto(base + "/ship-orders/" + shipment + "/print")
            page.screenshot(path=str(output / "shipment-print.png"), full_page=True)
            assert shipment in page.locator(".print-document").inner_text()
            assert not errors, errors
            browser.close()
        report = {
            "pages_checked": len(checked),
            "widths": [1440, 1024, 390],
            "invoice_pdf_pages": pages,
            "console_errors": errors,
            "form_create_and_issue": "passed",
            "checks": checked,
        }
        (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({k: v for k, v in report.items() if k != "checks"}, ensure_ascii=False))
    finally:
        if process:
            process.terminate()
            process.wait(timeout=10)
        with connect(url) as db:
            db.raw.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


if __name__ == "__main__":
    main()
