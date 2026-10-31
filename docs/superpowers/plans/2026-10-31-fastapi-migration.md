# FastAPI MES Migration Implementation Plan

> Execute inline in this session. The user approved the migration design and requested implementation. Preserve all pre-existing changes; no deployment or source database mutation.

**Goal:** Run the existing order-to-invoice MES on Python 3.12, FastAPI, Jinja2 and PostgreSQL 17.
**Architecture:** Shared transactional services serve JSON APIs and HTML forms. PostgreSQL repositories replace SQLite; templates replace React runtime. Migration reads SQLite without modifying it.
**Spec:** docs/refactoring/2026-10-31-fastapi-migration-design.md

## Constraints
- Package kkotsuni, uv, port 8000, KKOTSUNI_ configuration.
- Preserve R1 requirement IDs, business states, trace references, print views and existing edits.
- No fabricated manufacturing/AI screens, operational deployment or production DB reset.

## Tasks
- [x] Foundation: pyproject.toml, src/kkotsuni/app/settings.py, db/connection.py, db/migrations/001_initial.sql. Expose Connection.q(sql, params), one(sql, params), x(sql, params), tx(). Test actual PostgreSQL rollback and schema constraints.
- [x] Masters and orders: services/masters.py, matching.py, orders.py, integrations/excel.py. Preserve customer/product/alias API, upload validation, status history and order confirmation. Test valid/invalid upload, mapping, duplicate warnings and read-only queries.
- [x] Shipping and billing: services/shipping.py, invoices.py, erp.py, reporting.py. Preserve allocations, actual quantity, Decimal rounding, approval, ERP file/state machine and traceability. Test end-to-end flow, denial, concurrency, rollback and historical snapshots.
- [x] HTTP: app/routers/api.py, rbac.py, errors.py. Capture API contract in contracts/api-contract.json. Test every original method/path and response status plus malformed requests and unavailable DB.
- [x] HTML: app/nav.py, templating.py, http.py, routers/pages.py, templates and static assets. Implement all existing list/detail/forms/print routes with common layout and 303 success. Verify desktop/tablet/mobile and print via browser.
- [x] Data migration: tools/migrate_sqlite.py. Read-only dry-run, empty target guard, transactional copy, identity alignment, counts/checksums and reference verification. Test repeat refusal and failed copy rollback with synthetic SQLite data.
- [x] Delivery: Dockerfile, docker-compose.yml, Makefile, README, contracts and verification record. Keep legacy Docker configuration separately. Run Python suite, route/schema checks, build/run container and inspect browser flows. Record unrun checks accurately.

## Verification commands
```sh
uv sync --python 3.12
uv run pytest
uv run python tools/check_contracts.py
uv run python tools/migrate_sqlite.py /path/to/source.sqlite3
uv run uvicorn kkotsuni.app.main:app --host 127.0.0.1 --port 8000
```

Tests use an isolated PostgreSQL database or a unique test schema, never the existing SQLite file. Before applying a migration, compare dry-run counts, primary keys, FK references, amounts and status aggregates. Document intentional compatibility differences (input validation and read-only matching).

## Completion
All implementation tasks completed. See docs/refactoring/verification.md for actual checks, intentional compatibility changes and operational exclusions.
