import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../src/db.js';

describe('T1 데이터 모델 — 스키마 삽입/조회 및 문서 간 역참조', () => {
  let db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  function seedMasterData() {
    db.prepare(
      `INSERT INTO customer (customer_code, name, biz_reg_no, erp_customer_code)
       VALUES (?, ?, ?, ?)`
    ).run('C0012', '○○홈쇼핑', '123-45-67890', 'ERP-C0012');

    const site = db
      .prepare(
        `INSERT INTO delivery_site (customer_code, site_name, address, receiver_name, receiver_phone, is_default)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      .run('C0012', '○○물류센터', '강원 평창군 ...', '홍길동', '010-0000-0000');

    db.prepare(
      `INSERT INTO product (product_code, name, spec, unit, tax_type)
       VALUES (?, ?, ?, ?, ?)`
    ).run('KC-HW-10', '고랭지 황태김치 10kg', '10kg', 'BOX', 'TAXABLE');

    db.prepare(
      `INSERT INTO customer_price (customer_code, product_code, unit_price)
       VALUES (?, ?, ?)`
    ).run('C0012', 'KC-HW-10', 38000);

    db.prepare(
      `INSERT INTO product_alias (customer_code, raw_name, normalized_key, product_code, match_type)
       VALUES (?, ?, ?, ?, ?)`
    ).run('C0012', '고랭지띄고10kg', '고랭지띄고10kg', 'KC-HW-10', 'EXACT');

    return site.lastInsertRowid;
  }

  it('거래처·제품·별칭 마스터를 삽입하고 조회할 수 있다', () => {
    const deliverySiteId = seedMasterData();

    const customer = db.prepare('SELECT * FROM customer WHERE customer_code = ?').get('C0012');
    expect(customer.erp_customer_code).toBe('ERP-C0012');

    const alias = db
      .prepare('SELECT * FROM product_alias WHERE customer_code = ? AND raw_name = ?')
      .get('C0012', '고랭지띄고10kg');
    expect(alias.product_code).toBe('KC-HW-10');

    const site = db
      .prepare('SELECT * FROM delivery_site WHERE delivery_site_id = ?')
      .get(deliverySiteId);
    expect(site.customer_code).toBe('C0012');
  });

  it('주문 → 출고지시 → 거래명세서 전체 흐름을 역참조 가능하게 저장/조회한다', () => {
    const deliverySiteId = seedMasterData();

    db.prepare(
      `INSERT INTO order_hdr (order_no, order_date, customer_code, delivery_site_id, ship_due_date, status)
       VALUES (?, ?, ?, ?, ?, 'CONFIRMED')`
    ).run('20261103-0001', '2026-11-03', 'C0012', deliverySiteId, '2026-11-05');

    db.prepare(
      `INSERT INTO order_dtl (order_no, line_no, raw_product_name, product_code, spec, quantity, unit, unit_price, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('20261103-0001', 1, '고랭지띄고10kg', 'KC-HW-10', '10kg', 25, 'BOX', 38000, 25 * 38000);

    db.prepare(
      `INSERT INTO ship_order (ship_order_no, ship_date, customer_code, delivery_site_id, status)
       VALUES (?, ?, ?, ?, 'CONFIRMED')`
    ).run('SO-20261105-0001', '2026-11-05', 'C0012', deliverySiteId);

    const shipDtl = db
      .prepare(
        `INSERT INTO ship_order_dtl (ship_order_no, product_code, instructed_qty, packed_qty, pack_unit)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run('SO-20261105-0001', 'KC-HW-10', 25, 25, 'BOX');

    db.prepare(
      `INSERT INTO ship_order_src (ship_order_dtl_id, order_no, order_line_no, allocated_qty)
       VALUES (?, ?, ?, ?)`
    ).run(shipDtl.lastInsertRowid, '20261103-0001', 1, 25);

    db.prepare(
      `INSERT INTO ship_result (ship_order_dtl_id, actual_qty, pack_lot, registered_by)
       VALUES (?, ?, ?, ?)`
    ).run(shipDtl.lastInsertRowid, 25, 'LOT-20261105-01', '현장작업자A');

    db.prepare(
      `INSERT INTO invoice_hdr (invoice_no, invoice_date, customer_code, supply_amount, tax_amount, total_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ISSUED')`
    ).run('INV-20261105-0001', '2026-11-05', 'C0012', 950000, 95000, 1045000);

    db.prepare(
      `INSERT INTO invoice_dtl
         (invoice_no, product_code, spec, quantity, unit, unit_price, supply_amount, tax_amount, tax_type, ship_order_no, order_no)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TAXABLE', ?, ?)`
    ).run(
      'INV-20261105-0001',
      'KC-HW-10',
      '10kg',
      25,
      'BOX',
      38000,
      950000,
      95000,
      'SO-20261105-0001',
      '20261103-0001'
    );

    // 주문번호 하나로 출고지시서·거래명세서까지 트리 형태 역추적 (R1-F-10 기반이 되는 조인)
    const trace = db
      .prepare(
        `SELECT o.order_no, so.ship_order_no, inv.invoice_no
         FROM order_dtl od
         JOIN order_hdr o ON o.order_no = od.order_no
         JOIN ship_order_src src ON src.order_no = od.order_no AND src.order_line_no = od.line_no
         JOIN ship_order_dtl sod ON sod.ship_order_dtl_id = src.ship_order_dtl_id
         JOIN ship_order so ON so.ship_order_no = sod.ship_order_no
         JOIN invoice_dtl idtl ON idtl.order_no = od.order_no
         JOIN invoice_hdr inv ON inv.invoice_no = idtl.invoice_no
         WHERE o.order_no = ?`
      )
      .get('20261103-0001');

    expect(trace).toEqual({
      order_no: '20261103-0001',
      ship_order_no: 'SO-20261105-0001',
      invoice_no: 'INV-20261105-0001',
    });
  });

  it('주문 상세는 원본 표기명과 표준 제품코드를 분리 보관한다', () => {
    seedMasterData();
    db.prepare(
      `INSERT INTO order_hdr (order_no, order_date, customer_code, ship_due_date, status)
       VALUES (?, ?, ?, ?, 'RECEIVED')`
    ).run('20261103-0002', '2026-11-03', 'C0012', '2026-11-05');

    // 아직 매핑되지 않은 원본 표기 (product_code NULL 허용 = 매핑 대기함 대상)
    db.prepare(
      `INSERT INTO order_dtl (order_no, line_no, raw_product_name, quantity, unit)
       VALUES (?, ?, ?, ?, ?)`
    ).run('20261103-0002', 1, '고랭지붙여서10kg', 10, 'BOX');

    const row = db
      .prepare('SELECT raw_product_name, product_code FROM order_dtl WHERE order_no = ? AND line_no = 1')
      .get('20261103-0002');

    expect(row.raw_product_name).toBe('고랭지붙여서10kg');
    expect(row.product_code).toBeNull();
  });

  it('출고예정일이 주문일보다 빠르면 CHECK 제약으로 거부된다', () => {
    seedMasterData();
    expect(() =>
      db
        .prepare(
          `INSERT INTO order_hdr (order_no, order_date, customer_code, ship_due_date, status)
           VALUES (?, ?, ?, ?, 'RECEIVED')`
        )
        .run('20261103-0003', '2026-11-03', 'C0012', '2026-11-01')
    ).toThrow();
  });

  it('수량이 0 이하이면 CHECK 제약으로 거부된다', () => {
    seedMasterData();
    db.prepare(
      `INSERT INTO order_hdr (order_no, order_date, customer_code, ship_due_date, status)
       VALUES (?, ?, ?, ?, 'RECEIVED')`
    ).run('20261103-0004', '2026-11-03', 'C0012', '2026-11-05');

    expect(() =>
      db
        .prepare(
          `INSERT INTO order_dtl (order_no, line_no, raw_product_name, quantity)
           VALUES (?, ?, ?, ?)`
        )
        .run('20261103-0004', 1, '고랭지띄고10kg', 0)
    ).toThrow();
  });
});
