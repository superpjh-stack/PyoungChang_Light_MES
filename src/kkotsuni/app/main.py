import logging
from pathlib import Path

import psycopg
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.middleware.sessions import SessionMiddleware

from kkotsuni.app.errors import BusinessError
from kkotsuni.app.routers.api import router as api_router
from kkotsuni.app.settings import Settings


def create_app(settings=None):
    app = FastAPI(title="평창꽃순이 MES", version="0.2.0")
    app.state.settings = settings or Settings()
    app.add_middleware(
        SessionMiddleware,
        secret_key=app.state.settings.secret_key,
        https_only=app.state.settings.secure_cookie,
        same_site="lax",
    )
    app.include_router(api_router)
    static = Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=static), name="static")
    from kkotsuni.app.routers.pages import router as pages_router

    app.include_router(pages_router)

    def error_response(request, message, status, details=None):
        if request.url.path.startswith("/api/"):
            payload = {"error": message}
            if details is not None:
                payload["details"] = details
            return JSONResponse(jsonable_encoder(payload), status_code=status)
        from kkotsuni.app.templating import render

        return render(request, "error.html", {"error": message}, status_code=status)

    @app.exception_handler(BusinessError)
    async def business(request: Request, exc: BusinessError):
        return error_response(request, str(exc), exc.status, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation(request: Request, exc: RequestValidationError):
        return error_response(request, "입력값의 형식이 올바르지 않습니다", 422)

    @app.exception_handler(psycopg.OperationalError)
    async def unavailable(request: Request, exc):
        return error_response(request, "데이터베이스에 연결할 수 없습니다", 503)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc):
        return error_response(request, "요청 경로 또는 메서드를 확인하세요", exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc):
        logging.getLogger(__name__).error("Unhandled MES error: %s", type(exc).__name__)
        return error_response(request, "요청 처리 중 오류가 발생했습니다", 500)

    return app


app = create_app()
