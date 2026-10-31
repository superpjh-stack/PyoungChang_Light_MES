from fastapi import Request

from kkotsuni.db.connection import connect


def get_db(request: Request):
    settings = request.app.state.settings
    with connect(settings.database_url, settings.db_schema) as db:
        yield db
