from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

from kkotsuni.app.dependencies import get_db
from kkotsuni.app.errors import BusinessError
from kkotsuni.app.http import check_csrf
from kkotsuni.app.rbac import get_user, require_action
from kkotsuni.app.templating import render
from kkotsuni.db import repositories as repo
from kkotsuni.integrations import excel
from kkotsuni.services import shipping, source_data

router = APIRouter()
DB = Annotated[object, Depends(get_db)]


def account(request, db, role="ADMIN"):
    user = get_user(request, db)
    require_action(user, role)
    return user


@router.get("/source-data")
def index(request: Request, db: DB):
    user = account(request, db)
    return render(
        request,
        "source_data.html",
        {"title": "원본 자료 가져오기", "current_user": user, "files": source_data.summary(db)},
    )


@router.post("/source-data/upload")
@router.post("/api/source-data/upload")
async def upload(request: Request, db: DB):
    await run_in_threadpool(account, request, db)
    form = await request.form(max_files=1, max_fields=3, max_part_size=21 * 1024 * 1024)
    if not request.url.path.startswith("/api/"):
        check_csrf(request, form.get("_csrf"))
    file = form.get("file")
    if file is None or not hasattr(file, "read"):
        raise BusinessError("파일이 필요합니다")
    try:
        content = await file.read(20 * 1024 * 1024 + 1)
        result = await run_in_threadpool(source_data.ingest, db, content, file.filename or "")
    finally:
        await file.close()
    if request.url.path.startswith("/api/"):
        return JSONResponse(jsonable_encoder(result))
    return RedirectResponse(f"/source-data/{result['id']}", status_code=303)


@router.get("/api/source-data")
def summary(request: Request, db: DB):
    account(request, db)
    return source_data.summary(db)


@router.get("/source-data/{ident}/original")
def original(ident: int, request: Request, db: DB):
    account(request, db)
    row = repo.require(db, "source_file", "id", ident)
    return Response(
        bytes(row["content"]),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(row['filename'])}",
            "Cache-Control": "no-store",
        },
    )


@router.get("/source-data/{ident}")
def detail(ident: int, request: Request, db: DB, page: int = 1, status: str = ""):
    user = account(request, db)
    file = db.one("SELECT id,filename,kind FROM source_file WHERE id=%s", (ident,))
    if not file:
        raise BusinessError("자료를 찾을 수 없습니다", 404)
    page = max(page, 1)
    records = db.q(
        """SELECT * FROM source_record WHERE file_id=%s AND (%s='' OR status=%s)
      ORDER BY id LIMIT 100 OFFSET %s""",
        (ident, status, status, (page - 1) * 100),
    )
    return render(
        request,
        "source_data.html",
        {
            "title": file["filename"],
            "current_user": user,
            "file": file,
            "records": records,
            "page": page,
            "status": status,
        },
    )


@router.get("/source-data/rows/{ident}/edit")
def edit(ident: int, request: Request, db: DB):
    user = account(request, db)
    row = repo.require(db, "source_record", "id", ident)
    return render(request, "source_data.html", {"title": "원본 행 확인", "current_user": user, "record": row})


@router.post("/source-data/rows/{ident}/edit")
async def save(ident: int, request: Request, db: DB):
    await run_in_threadpool(account, request, db)
    form = await request.form()
    check_csrf(request, form.get("_csrf"))
    from psycopg.types.json import Jsonb

    def update():
        with db.tx():
            db.lock("source:import")
            row = repo.require(db, "source_record", "id", ident, lock=True)
            if row["status"] != "검토 필요" or row["kind"] == "품목":
                raise BusinessError("검토 중인 업무자료만 보완할 수 있습니다", 409)
            v = dict(row["payload"])
            for name in (
                "customer_name",
                "order_date",
                "ship_due_date",
                "quantity",
                "quantity_kind",
                "raw_product_name",
            ):
                if name in form:
                    v[name] = str(form[name]).strip()
            db.x("UPDATE source_record SET payload=%s WHERE id=%s", (Jsonb(v), ident))
            row["payload"] = v
            source_data.apply_record(db, row)
            db.x(
                "INSERT INTO audit_log(entity_type,entity_id,action,user_id) VALUES ('SOURCE_RECORD',%s,'REVIEW',%s)",
                (str(ident), get_user(request, db)["user_id"]),
            )
            return row["file_id"]

    file_id = await run_in_threadpool(update)
    return RedirectResponse(f"/source-data/{file_id}", status_code=303)


@router.get("/source-data/{ident}/postal.xlsx")
def postal(ident: int, request: Request, db: DB):
    account(request, db)
    rows = db.q(
        "SELECT payload FROM source_record WHERE file_id=%s AND kind IN ('수주','송장') AND status<>'중복' ORDER BY id",
        (ident,),
    )
    keys = [
        "customer_name",
        "tracking_no",
        "ship_due_date",
        "receiver_name",
        "receiver_phone",
        "phone2",
        "delivery_address",
        "raw_product_name",
        "quantity",
        "spec",
        "note",
        "box_code",
        "postal_code",
        "freight",
    ]
    headers = [
        "업체",
        "운송장번호",
        "날짜",
        "이름",
        "핸드폰",
        "연락처2",
        "주 소2",
        "품명",
        "수량",
        "규격",
        "배송메세지",
        "박스코드",
        "우편번호",
        "운임비",
        "비고",
    ]
    values = [
        [r["payload"].get(k, "") for k in keys]
        + [f"수량 기준: {r['payload'].get('quantity_kind', '제품')} / 원본 확인용"]
        for r in rows
    ]
    return Response(
        excel.workbook(headers, values, "우체국"),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="postal-{ident}.xlsx"'},
    )


@router.get("/ship-orders/{no}/request-form")
def request_form(no: str, request: Request, db: DB):
    user = account(request, db, "VIEWER")
    return render(
        request,
        "shipping_request.html",
        {"title": "출고 요청서", "current_user": user, "print_mode": True, "document": shipping.get(db, no)},
    )


@router.get("/ship-orders/{no}/request-form.xlsx")
def request_excel(no: str, request: Request, db: DB):
    from kkotsuni.integrations.shipping_forms import request_workbook

    user = account(request, db, "VIEWER")
    return Response(
        request_workbook(shipping.get(db, no), user["name"]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(no + '-출고요청서.xlsx')}"},
    )
