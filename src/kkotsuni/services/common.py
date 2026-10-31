from datetime import date
from decimal import ROUND_FLOOR, Decimal, InvalidOperation

from kkotsuni.app.errors import BusinessError
from kkotsuni.db.repositories import insert


def number(value, label, minimum=0, positive=False):
    try:
        if value is None or isinstance(value, bool) or str(value).strip() == "":
            raise ValueError
        result = Decimal(str(value))
        if not result.is_finite() or result < minimum or (positive and result <= minimum):
            raise ValueError
        if result.adjusted() >= 18 or max(0, -result.as_tuple().exponent) > 6:
            raise ValueError
        return result
    except (InvalidOperation, ValueError, TypeError):
        raise BusinessError(f"{label}은(는) {'0보다 큰' if positive else '0 이상의'} 유한한 숫자여야 합니다")


def day(value, label="일자"):
    try:
        parsed = date.fromisoformat(str(value))
        if str(parsed) != str(value):
            raise ValueError
        return parsed
    except (ValueError, TypeError):
        raise BusinessError(f"{label} 형식이 올바르지 않습니다 (YYYY-MM-DD)")


def required(data, *keys):
    if not isinstance(data, dict) or any(data.get(k) in (None, "") for k in keys):
        raise BusinessError(f"{', '.join(keys)}은(는) 필수입니다")


def js_round(value):
    # JavaScript Math.round: ties toward positive infinity, including negatives.
    return int((Decimal(str(value)) + Decimal("0.5")).to_integral_value(rounding=ROUND_FLOOR))


def audit(db, entity, ident, action, user=None, detail=None):
    insert(
        db,
        "audit_log",
        {
            "entity_type": entity,
            "entity_id": str(ident),
            "action": action,
            "user_id": (user or {}).get("user_id"),
            "detail": detail,
        },
    )
