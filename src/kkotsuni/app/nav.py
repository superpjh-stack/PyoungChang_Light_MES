"""Shared navigation for the server-rendered application.

Each item is (href, name, minimum role). Items an account cannot use are hidden (R1-N-06);
the server still checks every write and admin screen independently of the menu.
"""

APP_NAME = "평창꽃순이김치 New MES"
RANK = {"VIEWER": 0, "OPERATOR": 1, "ADMIN": 2}

NAV = [
    ("수주관리", [
        ("/orders", "주문 관리", None),
        ("/orders/upload", "주문 업로드", "OPERATOR"),
        ("/source-data", "원본 자료 가져오기", "ADMIN"),
        ("/mapping", "매핑 대기", None),
    ]),
    ("출고관리", [
        ("/orders/pending-shipment", "출고 대기", None),
        ("/ship-orders", "출고 관리", None),
    ]),
    ("거래관리", [
        ("/orders/pending-invoice", "명세서 미발행", None),
        ("/invoices", "거래명세서", None),
        ("/customers", "거래처", None),
        ("/products", "제품", None),
    ]),
    ("시스템관리", [
        ("/users", "사용자", "ADMIN"),
        ("/settings", "설정", "ADMIN"),
        ("/audit-log", "감사 로그", "ADMIN"),
    ]),
]


def menu(user, path, dev_auth=False):
    """Visible groups for the account and the single nav href that matches the current path."""
    rank = RANK.get((user or {}).get("role"), -1)
    show_all = user is None and dev_auth  # development mode without a selected account (legacy view)
    groups = []
    for title, items in NAV:
        visible = [(h, n) for h, n, role in items if show_all or role is None or rank >= RANK[role]]
        if visible:
            groups.append((title, visible))
    hrefs = [h for _, items in groups for h, _ in items]
    matches = [h for h in hrefs if path == h or path.startswith(h + "/")]
    active = max(matches, key=len) if matches else None
    return groups, active
