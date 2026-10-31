FROM python:3.12-slim AS runtime
WORKDIR /app
RUN pip install --no-cache-dir uv==0.12.1
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable
COPY tools ./tools
RUN useradd --create-home --uid 10001 mes
USER mes
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "kkotsuni.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
