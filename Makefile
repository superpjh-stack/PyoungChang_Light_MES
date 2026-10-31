.PHONY: setup run db-migrate test lint check-trace check-routes gate legacy-test
setup:
	uv sync --frozen --python 3.12
run:
	uv run uvicorn kkotsuni.app.main:app --host 127.0.0.1 --port 8000
# Additive migrations only. This target never resets data or seeds business records.
db-migrate:
	uv run python tools/db_migrate.py
test:
	uv run pytest
lint:
	uv run ruff check src tools tests
check-trace check-routes:
	uv run python tools/check_contracts.py
gate: lint check-trace test
legacy-test:
	npm test
