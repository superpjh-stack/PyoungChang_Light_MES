-- 평창꽃순이 경량 MES 스키마 (T1)
-- 근거: 요구사항정의서 7장(R1-D-01~04), 기획서 6.2 주요 엔티티 관계
-- 주문 내역서를 단일 원천으로 하고, 출고지시서·거래명세서는 주문에서 파생/역참조한다.
-- 실제 컬럼명·형식은 샘플 문서 확보 전까지 가정이며, 변경 시 이 파일만 고치면 된다 (PROGRESS.md "확인 필요" 참고).

PRAGMA foreign_keys = ON;

-- 사용자 계정 (R1-N-06 RBAC). 별도 로그인 체계는 없고, 요청 헤더(X-User-Id)로 신원을 식별하는
-- 경량 방식으로 구현했다 — 실제 운영 전환 시 정식 인증(SSO 등)으로 교체 필요 (PROGRESS.md 확인 필요 참고).
CREATE TABLE IF NOT EXISTS app_user (
  user_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'VIEWER')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 감사 로그 (R1-N-07). 주문 수정/매핑 변경/ERP 전송 등 주요 변경 행위에 사용자·일시를 기록한다.
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,   -- 예: ORDER, PRODUCT_ALIAS, INVOICE
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,   -- 예: ORDER_UPDATE, ALIAS_CREATE, ERP_SEND
  user_id      TEXT,            -- 식별된 사용자 없으면 NULL (헤더 미제공 등)
  detail       TEXT,            -- 사람이 읽을 수 있는 변경 요약 (JSON 문자열도 허용)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);

-- 거래처 (기획서 6.2 CUSTOMER)
CREATE TABLE IF NOT EXISTS customer (
  customer_code   TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  biz_reg_no      TEXT,
  contact_name    TEXT,
  contact_phone   TEXT,
  erp_customer_code TEXT,              -- R1-F-04 ERP 거래처 코드 매핑 (누락 식별 대상)
  approval_required INTEGER NOT NULL DEFAULT 0 CHECK (approval_required IN (0, 1)), -- R1-F-12 거래처별 승인 필요 여부
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 시스템 설정 (R1-F-12: 금액 기준 승인 임계값 등 소수의 전역 설정값 저장)
CREATE TABLE IF NOT EXISTS system_setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 납품처 (거래처 1:N)
CREATE TABLE IF NOT EXISTS delivery_site (
  delivery_site_id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code    TEXT NOT NULL REFERENCES customer(customer_code),
  site_name        TEXT,
  address          TEXT,
  receiver_name    TEXT,
  receiver_phone   TEXT,
  is_default       INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_delivery_site_customer ON delivery_site(customer_code);

-- 표준 제품 마스터 (기획서 6.2 PRODUCT)
CREATE TABLE IF NOT EXISTS product (
  product_code    TEXT PRIMARY KEY,     -- 표준 제품코드 (예: KC-HW-10)
  name            TEXT NOT NULL,        -- 표준명 (예: 고랭지 황태김치 10kg)
  spec            TEXT,                 -- 규격 (예: 10kg)
  unit            TEXT NOT NULL DEFAULT 'EA',
  tax_type        TEXT NOT NULL DEFAULT 'TAXABLE' CHECK (tax_type IN ('TAXABLE', 'EXEMPT')),
  erp_item_code   TEXT,
  pack_unit       TEXT,                 -- 포장 단위 (예: BOX) — R1-F-06 포장단위 환산용, 미설정 시 환산하지 않음
  pack_size       NUMERIC,              -- 1 pack_unit = pack_size * unit (예: 1BOX = 10(kg))
  default_price   NUMERIC,              -- 기본 단가 (R1-F-08: 주문단가 → 거래처단가표 → 기본단가 순으로 적용)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 거래처별 기준 단가표 (R1-F-04 세부, 거래명세서 단가 적용용)
CREATE TABLE IF NOT EXISTS customer_price (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code   TEXT NOT NULL REFERENCES customer(customer_code),
  product_code    TEXT NOT NULL REFERENCES product(product_code),
  unit_price      NUMERIC NOT NULL,
  effective_from  TEXT NOT NULL DEFAULT (date('now')),
  UNIQUE (customer_code, product_code, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_customer_price_lookup ON customer_price(customer_code, product_code);

-- 제품별칭 매핑 테이블 (R1-D-04, R1-F-03)
CREATE TABLE IF NOT EXISTS product_alias (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code   TEXT NOT NULL REFERENCES customer(customer_code),
  raw_name        TEXT NOT NULL,        -- 거래처 원본 표기명 (예: 고랭지띄고10kg)
  normalized_key  TEXT NOT NULL,        -- 정규화 키 (공백/특수문자 제거, 대소문자 통일)
  product_code    TEXT NOT NULL REFERENCES product(product_code),
  match_type      TEXT NOT NULL DEFAULT 'MANUAL'
                    CHECK (match_type IN ('EXACT', 'NORMALIZED', 'SUGGESTED_APPROVED', 'MANUAL')),
  registered_by   TEXT,
  registered_at   TEXT NOT NULL DEFAULT (datetime('now')),
  use_count       INTEGER NOT NULL DEFAULT 0,
  last_used_at    TEXT,
  UNIQUE (customer_code, raw_name)
);
CREATE INDEX IF NOT EXISTS idx_product_alias_normalized ON product_alias(customer_code, normalized_key);

-- 주문 헤더 (R1-D-01, 단일 원천)
CREATE TABLE IF NOT EXISTS order_hdr (
  order_no          TEXT PRIMARY KEY,     -- 채번: 일자+일련번호 (예: 20261103-0001)
  order_date        TEXT NOT NULL,
  customer_code     TEXT NOT NULL REFERENCES customer(customer_code),
  delivery_site_id  INTEGER REFERENCES delivery_site(delivery_site_id),
  delivery_address  TEXT,
  receiver_name     TEXT,
  receiver_phone    TEXT,
  ship_due_date     TEXT NOT NULL,        -- 출고예정일 (출고지시서 생성 기준)
  ship_method       TEXT,                 -- 택배/직배송/화물
  customer_order_no TEXT,                 -- 거래처 주문번호 (참조용)
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'RECEIVED'
                      CHECK (status IN ('RECEIVED', 'CONFIRMED', 'SHIP_ORDERED', 'SHIPPED', 'INVOICED', 'CANCELLED')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (ship_due_date >= order_date)
);
CREATE INDEX IF NOT EXISTS idx_order_hdr_customer ON order_hdr(customer_code);
CREATE INDEX IF NOT EXISTS idx_order_hdr_ship_due ON order_hdr(ship_due_date);
CREATE INDEX IF NOT EXISTS idx_order_hdr_status ON order_hdr(status);

-- 주문 상세 (제품 라인)
CREATE TABLE IF NOT EXISTS order_dtl (
  order_no        TEXT NOT NULL REFERENCES order_hdr(order_no) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,
  raw_product_name TEXT NOT NULL,        -- 원본 표기명 (거래처가 입력한 그대로 보관)
  product_code    TEXT REFERENCES product(product_code), -- 매핑 완료 전까지 NULL (매핑 대기)
  spec            TEXT,
  quantity        NUMERIC NOT NULL CHECK (quantity > 0),
  unit            TEXT,
  unit_price      NUMERIC,               -- 미입력 시 거래처 단가표 적용 (customer_price 참조)
  amount          NUMERIC,               -- quantity * unit_price (확정 시 계산)
  PRIMARY KEY (order_no, line_no)
);
CREATE INDEX IF NOT EXISTS idx_order_dtl_product ON order_dtl(product_code);

-- 주문 상태 변경 이력 (R1-F-02 완료 기준: "상태 변경 이력이 화면에서 확인됨")
CREATE TABLE IF NOT EXISTS order_status_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no      TEXT NOT NULL REFERENCES order_hdr(order_no) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  changed_by    TEXT,
  changed_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_status_log_order ON order_status_log(order_no);

-- 출고지시 헤더 (R1-D-02)
CREATE TABLE IF NOT EXISTS ship_order (
  ship_order_no   TEXT PRIMARY KEY,      -- 채번
  ship_date       TEXT NOT NULL,          -- 주문의 출고예정일 기준
  customer_code   TEXT NOT NULL REFERENCES customer(customer_code),
  delivery_site_id INTEGER REFERENCES delivery_site(delivery_site_id),
  ship_method     TEXT,
  status          TEXT NOT NULL DEFAULT 'CREATED'
                    CHECK (status IN ('CREATED', 'CONFIRMED', 'RESULT_REGISTERED')),
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ship_order_date ON ship_order(ship_date);
CREATE INDEX IF NOT EXISTS idx_ship_order_customer ON ship_order(customer_code);

-- 출고지시 상세 (동일 납품처·제품 합산 결과 1건)
CREATE TABLE IF NOT EXISTS ship_order_dtl (
  ship_order_dtl_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_order_no     TEXT NOT NULL REFERENCES ship_order(ship_order_no) ON DELETE CASCADE,
  product_code      TEXT NOT NULL REFERENCES product(product_code),
  instructed_qty    NUMERIC NOT NULL,     -- 합산 수량 (원 단위, 예: kg)
  packed_qty        NUMERIC,              -- 포장 단위 환산 수량 (예: 박스)
  pack_unit         TEXT,
  note              TEXT                  -- 생성 후 현장 확인 비고 (R1-F-06 세부4 수정 가능 항목)
);
CREATE INDEX IF NOT EXISTS idx_ship_order_dtl_order ON ship_order_dtl(ship_order_no);

-- 출고지시상세 생성 후 수량/비고 수정 이력 (R1-F-06 세부4 "수정 이력 보관")
CREATE TABLE IF NOT EXISTS ship_order_dtl_revision (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_order_dtl_id INTEGER NOT NULL REFERENCES ship_order_dtl(ship_order_dtl_id) ON DELETE CASCADE,
  field             TEXT NOT NULL,
  old_value         TEXT,
  new_value         TEXT,
  changed_by        TEXT,
  changed_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ship_order_dtl_revision_dtl ON ship_order_dtl_revision(ship_order_dtl_id);

-- 출고지시상세 ↔ 원 주문라인 역참조 (N:M 합산 근거 보관, 기획서 6.2 "원 주문번호 목록 보관")
CREATE TABLE IF NOT EXISTS ship_order_src (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_order_dtl_id INTEGER NOT NULL REFERENCES ship_order_dtl(ship_order_dtl_id) ON DELETE CASCADE,
  order_no          TEXT NOT NULL,
  order_line_no     INTEGER NOT NULL,
  allocated_qty     NUMERIC NOT NULL,
  FOREIGN KEY (order_no, order_line_no) REFERENCES order_dtl(order_no, line_no)
);
CREATE INDEX IF NOT EXISTS idx_ship_order_src_order ON ship_order_src(order_no, order_line_no);

-- 출고 실적 (R1-F-07, 포장 LOT 연계)
CREATE TABLE IF NOT EXISTS ship_result (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  ship_order_dtl_id INTEGER NOT NULL REFERENCES ship_order_dtl(ship_order_dtl_id) ON DELETE CASCADE,
  actual_qty        NUMERIC NOT NULL,
  pack_lot          TEXT,
  diff_reason_code  TEXT,                 -- 지시수량 대비 차이 발생 시 사유
  registered_by     TEXT,
  registered_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ship_result_dtl ON ship_result(ship_order_dtl_id);

-- 거래 명세서 헤더 (R1-D-03)
CREATE TABLE IF NOT EXISTS invoice_hdr (
  invoice_no        TEXT PRIMARY KEY,     -- 채번
  invoice_date      TEXT NOT NULL,         -- 거래일자 (출고일 기준)
  customer_code     TEXT NOT NULL REFERENCES customer(customer_code),
  supply_amount     NUMERIC NOT NULL DEFAULT 0,  -- 공급가액 합계
  tax_amount        NUMERIC NOT NULL DEFAULT 0,  -- 세액 합계
  total_amount      NUMERIC NOT NULL DEFAULT 0,  -- 합계금액
  status            TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT', 'APPROVED', 'ISSUED')),
  erp_send_status   TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (erp_send_status IN ('PENDING', 'SENDING', 'SUCCESS', 'FAILED')),
  erp_invoice_no    TEXT,                  -- ERP 반영 결과 회신
  erp_error_message TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_hdr_customer_date ON invoice_hdr(customer_code, invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoice_hdr_erp_status ON invoice_hdr(erp_send_status);

-- 거래 명세서 상세 (출고지시서에서 승계, 주문번호까지 역참조)
CREATE TABLE IF NOT EXISTS invoice_dtl (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no        TEXT NOT NULL REFERENCES invoice_hdr(invoice_no) ON DELETE CASCADE,
  product_code      TEXT NOT NULL REFERENCES product(product_code),
  spec              TEXT,
  quantity          NUMERIC NOT NULL,
  unit              TEXT,
  unit_price        NUMERIC NOT NULL,
  supply_amount     NUMERIC NOT NULL,
  tax_amount        NUMERIC NOT NULL,
  tax_type          TEXT NOT NULL DEFAULT 'TAXABLE' CHECK (tax_type IN ('TAXABLE', 'EXEMPT')),
  ship_order_no     TEXT,                  -- 원 출고지시번호 (역참조)
  order_no          TEXT                   -- 원 주문번호 (역참조)
);
CREATE INDEX IF NOT EXISTS idx_invoice_dtl_invoice ON invoice_dtl(invoice_no);
CREATE INDEX IF NOT EXISTS idx_invoice_dtl_order ON invoice_dtl(order_no);

-- 거래 명세서 승인 이력 (R1-F-12 세부2)
CREATE TABLE IF NOT EXISTS invoice_approval_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no  TEXT NOT NULL REFERENCES invoice_hdr(invoice_no) ON DELETE CASCADE,
  user_id     TEXT,
  approved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_approval_log_invoice ON invoice_approval_log(invoice_no);
