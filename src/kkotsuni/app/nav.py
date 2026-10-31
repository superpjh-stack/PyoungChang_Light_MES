"""Shared navigation for the server-rendered application."""

APP_NAME = "평창꽃순이김치 New MES"

NAV = [
    ("수주관리", [("/orders", "주문 관리"), ("/orders/upload", "주문 업로드"), ("/source-data", "원본 자료 가져오기"), ("/mapping", "매핑 대기")]),
    ("출고관리", [("/ship-orders", "출고 관리")]),
    ("거래관리", [("/invoices", "거래명세서"), ("/customers", "거래처"), ("/products", "제품")]),
    ("시스템관리", [("/users", "사용자"), ("/settings", "설정"), ("/audit-log", "감사 로그")]),
]
