"""Render the 거래명세서 template to HTML and PDF. Amounts come from the stored invoice, never recomputed."""

import os
import sys
from decimal import Decimal
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from kkotsuni.app.errors import BusinessError

TEMPLATES = Path(__file__).resolve().parents[1] / "app" / "templates"
MIN_ROWS = 12
DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]
SMALL_UNITS = ["", "십", "백", "천"]
LARGE_UNITS = ["", "만", "억", "조", "경"]


def money(value):
    """Thousands separators; keeps a fractional part only when one is stored."""
    if value is None or value == "":
        return ""
    number = Decimal(str(value))
    text = f"{number:,f}"
    return text.rstrip("0").rstrip(".") if "." in text else text


def korean_amount(value):
    """1848000 -> '일백팔십사만팔천' (formal reading used on trading statements)."""
    number = int(Decimal(str(value or 0)).to_integral_value())
    if number == 0:
        return "영"
    sign, number, parts, group = ("마이너스 " if number < 0 else ""), abs(number), [], 0
    while number:
        number, chunk = divmod(number, 10000)
        if chunk:
            text = "".join(
                DIGITS[int(d)] + SMALL_UNITS[3 - i] for i, d in enumerate(f"{chunk:04d}") if d != "0"
            )
            parts.append(text + LARGE_UNITS[group])
        group += 1
    return sign + "".join(reversed(parts))


env = Environment(loader=FileSystemLoader(str(TEMPLATES)), autoescape=select_autoescape(["html"]))
env.filters["money"] = money


def html(invoice, supplier):
    return env.get_template("invoice_pdf.html").render(
        d=invoice,
        supplier=supplier,
        amount_text=korean_amount(invoice["total_amount"]),
        blank_rows=max(0, MIN_ROWS - len(invoice["lines"])),
        has_exempt=any(line.get("tax_type") == "EXEMPT" for line in invoice["lines"]),
    )


def _weasyprint():
    if sys.platform == "darwin":
        # Development Macs: Homebrew's Pango is outside the default loader path. Linux images need nothing.
        paths = [p for p in ("/opt/homebrew/lib", "/usr/local/lib") if os.path.isdir(p)]
        current = os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", "")
        os.environ["DYLD_FALLBACK_LIBRARY_PATH"] = ":".join(dict.fromkeys(filter(None, [*current.split(":"), *paths])))
    from weasyprint import HTML

    return HTML


def to_pdf(markup):
    try:
        # Imported on use: the native Pango libraries are a deployment dependency of this feature only.
        HTML = _weasyprint()
    except (ImportError, OSError) as exc:
        raise BusinessError("PDF 변환 구성요소(Pango)가 설치되지 않아 PDF를 만들 수 없습니다", 503) from exc
    return HTML(string=markup, base_url=str(TEMPLATES)).write_pdf()


def pdf(invoice, supplier):
    return to_pdf(html(invoice, supplier))
