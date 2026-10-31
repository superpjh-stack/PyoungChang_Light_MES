"""Shared JSON field validation before any database adaptation."""

from datetime import date
from decimal import Decimal

from kkotsuni.app.errors import BusinessError

NUMERIC = {
    "quantity",
    "unit_price",
    "pack_size",
    "default_price",
    "actual_qty",
    "instructed_qty",
    "delivery_site_id",
    "value",
    "limit",
}
BOOLEAN = {"approval_required", "is_default", "split_by_delivery_site", "success"}


def scalar_record(data):
    if not isinstance(data, dict):
        raise BusinessError("각 항목은 객체여야 합니다", 422)
    for key, value in data.items():
        if value is None:
            continue
        if key in NUMERIC:
            valid = isinstance(value, (str, int, float, Decimal)) and not isinstance(value, bool)
        elif key in BOOLEAN:
            valid = isinstance(value, (str, int, bool))
        else:
            valid = isinstance(value, (str, date))
        if not valid:
            raise BusinessError(f"{key} 입력 형식이 올바르지 않습니다", 422)
    return data
