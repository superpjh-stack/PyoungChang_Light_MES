import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ORDER_UPLOAD_COLUMNS } from '../src/lib/orderUploadTemplate.js';

async function buildXlsxBuffer(dataRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('주문내역서');
  sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => c.header));
  for (const row of dataRows) {
    sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => row[c.key] ?? null));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function uploadAndConfirm(app, rows) {
  const buffer = await buildXlsxBuffer(rows);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  for (const orderNo of commit.body.orders) {
    await request(app).post(`/api/orders/${orderNo}/confirm`);
  }
  return commit.body.orders;
}

describe('R1-F-06 출고 지시서 자동 생성', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg', pack_unit: 'BOX', pack_size: 10 });
    await request(app).post('/api/products').send({ product_code: 'KC-BC-05', name: '배추김치 5kg' }); // pack_size 없음 → 환산 안 함
    await request(app).post('/api/product-aliases').send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    await request(app).post('/api/product-aliases').send({ customer_code: 'C0012', raw_name: '배추김치5kg', product_code: 'KC-BC-05' });
  });

  afterEach(() => {
    db.close();
  });

  it('확정 주문을 출고예정일 기준으로 모아 출고지시서를 생성하고 동일 제품 수량을 합산한다 (수용 기준)', async () => {
    await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 30, unit: 'kg', ship_due_date: '2026-11-05', customer_order_no: 'A' },
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 20, unit: 'kg', ship_due_date: '2026-11-05', customer_order_no: 'B' },
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '배추김치5kg', quantity: 15, ship_due_date: '2026-11-05', customer_order_no: 'C' },
    ]);

    const res = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    expect(res.status).toBe(201);
    expect(res.body.shipOrders).toHaveLength(1); // 동일 거래처/납품처 → 하나의 출고지시서
    expect(res.body.totalInstructedQty).toBe(65); // 30+20+15 누락 없이 반영
    expect(res.body.sourceOrderCount).toBe(3);

    const shipOrder = await request(app).get(`/api/ship-orders/${res.body.shipOrders[0]}`);
    const kcHw = shipOrder.body.lines.find((l) => l.product_code === 'KC-HW-10');
    expect(kcHw.instructed_qty).toBe(50); // 30+20 합산
    expect(kcHw.packed_qty).toBe(5); // pack_size=10 → 50/10
    expect(kcHw.pack_unit).toBe('BOX');
    expect(new Set(kcHw.sources.map((s) => s.order_no)).size).toBe(2);

    const kcBc = shipOrder.body.lines.find((l) => l.product_code === 'KC-BC-05');
    expect(kcBc.instructed_qty).toBe(15);
    expect(kcBc.packed_qty).toBe(15); // pack_size 없음 → 환산 없이 그대로
  });

  it('출고지시서 생성 후 주문 상태가 SHIP_ORDERED로 갱신된다', async () => {
    const [orderNo] = await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05' },
    ]);
    await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });

    const order = await request(app).get(`/api/orders/${orderNo}`);
    expect(order.body.status).toBe('SHIP_ORDERED');
  });

  it('확정되지 않은(RECEIVED) 주문은 출고지시서 생성 대상에서 제외된다', async () => {
    await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05' },
    ]);
    // 확정하지 않은 별도 주문
    const buffer = await buildXlsxBuffer([
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '배추김치5kg', quantity: 99, ship_due_date: '2026-11-05', customer_order_no: 'NOT-CONFIRMED' },
    ]);
    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });

    const res = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    expect(res.body.totalInstructedQty).toBe(10); // 99짜리 미확정 주문은 제외
  });

  it('거래처/제품 필터로 생성 대상을 좁힐 수 있다', async () => {
    await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05', customer_order_no: 'A' },
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '배추김치5kg', quantity: 20, ship_due_date: '2026-11-05', customer_order_no: 'B' },
    ]);

    const res = await request(app)
      .post('/api/ship-orders/generate')
      .send({ ship_date: '2026-11-05', product_code: 'KC-HW-10' });
    expect(res.body.totalInstructedQty).toBe(10);
  });

  it('대상 주문이 없으면 빈 결과를 반환한다', async () => {
    const res = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2099-01-01' });
    expect(res.body).toEqual({ shipOrders: [], totalInstructedQty: 0, sourceOrderCount: 0 });
  });

  it('ship_date 누락 시 400을 반환한다', async () => {
    const res = await request(app).post('/api/ship-orders/generate').send({});
    expect(res.status).toBe(400);
  });

  it('생성 후 수량·비고를 수정하면 이력이 남는다', async () => {
    await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05' },
    ]);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    const lineId = shipOrder.body.lines[0].ship_order_dtl_id;

    const update = await request(app)
      .put(`/api/ship-orders/lines/${lineId}`)
      .send({ instructed_qty: 8, note: '현장 확인 결과 2개 파손', changed_by: '현장작업자A' });
    expect(update.status).toBe(200);
    expect(update.body.instructed_qty).toBe(8);

    const revisions = await request(app).get(`/api/ship-orders/lines/${lineId}/revisions`);
    expect(revisions.body).toHaveLength(2); // instructed_qty, note 각각 기록
    expect(revisions.body.map((r) => r.field).sort()).toEqual(['instructed_qty', 'note']);
  });

  it('출고지시서를 현장 출력용 엑셀로 다운로드할 수 있다', async () => {
    await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05' },
    ]);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });

    const res = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });
});
