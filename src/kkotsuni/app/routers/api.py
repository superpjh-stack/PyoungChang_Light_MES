import json
import re
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from starlette.concurrency import run_in_threadpool

from kkotsuni.app.dependencies import get_db
from kkotsuni.app.errors import BusinessError
from kkotsuni.app.rbac import get_user
from kkotsuni.services.operations import OPERATIONS, Download, invoke

router = APIRouter(prefix="/api")


def reject_constant(value):
    raise ValueError("Non-finite JSON number")


def endpoint(operation):
    async def handle(request: Request, db: Annotated[object, Depends(get_db)]):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > 21 * 1024 * 1024:
                    raise BusinessError("요청 크기는 20MB 이하로 제한됩니다", 413)
            except ValueError:
                raise BusinessError("요청 크기 형식이 올바르지 않습니다", 400)
        data = {}
        if operation.method != "GET":
            if operation.path == "/orders/upload/preview":
                form = await request.form(max_part_size=21 * 1024 * 1024)
                uploaded = form.get("file")
                if uploaded is None or not hasattr(uploaded, "read"):
                    raise BusinessError("업로드할 파일(file)이 필요합니다")
                try:
                    data = {"file": await uploaded.read(20 * 1024 * 1024 + 1), "filename": uploaded.filename}
                finally:
                    await uploaded.close()
            else:
                raw = await request.body()
                if len(raw) > 20 * 1024 * 1024:
                    raise BusinessError("요청 크기는 20MB 이하로 제한됩니다", 413)
                if raw:
                    try:
                        data = json.loads(raw, parse_constant=reject_constant)
                    except (ValueError, UnicodeDecodeError):
                        raise BusinessError("올바른 JSON 본문이 필요합니다", 422)
        user = await run_in_threadpool(get_user, request, db)
        result = await run_in_threadpool(
            invoke, db, operation.method, request.url.path[4:], data, dict(request.query_params), user
        )
        if isinstance(result, Download):
            return Response(
                result.content,
                media_type=result.media_type,
                headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(result.filename)}"},
            )
        return JSONResponse(jsonable_encoder(result), status_code=operation.status)

    return handle


def openapi_contract(op):
    extra = {
        "parameters": [
            {"name": name, "in": "path", "required": True, "schema": {"type": "string"}}
            for name in re.findall(r"\{(\w+)\}", op.path)
        ]
    }
    if op.role:
        extra["parameters"].append(
            {
                "name": "X-User-Id",
                "in": "header",
                "required": False,
                "description": "Development identity only; requires KKOTSUNI_DEV_AUTH=true.",
                "schema": {"type": "string"},
            }
        )
    if op.method != "GET":
        if op.path == "/orders/upload/preview":
            content = {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "required": ["file"],
                        "properties": {"file": {"type": "string", "format": "binary"}},
                    }
                }
            }
        else:
            content = {"application/json": {"schema": {"type": "object", "additionalProperties": True}}}
        extra["requestBody"] = {"required": False, "content": content}
    return extra


for op in sorted(OPERATIONS, key=lambda o: o.path.count("{")):
    router.add_api_route(
        op.path,
        endpoint(op),
        methods=[op.method],
        status_code=op.status,
        name=op.method + " " + op.path,
        response_model=None,
        openapi_extra=openapi_contract(op),
    )
