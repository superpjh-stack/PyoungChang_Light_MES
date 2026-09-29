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

describe('R1-F-07 출고 실적 등록', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    await request(app).post('/api/products').send({ product_code: 'KC-BC-05', name: '배추김치 5kg' });
    await request(app).post('/api/product-aliases').send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    await request(app).post('/api/product-aliases').send({ customer_code: 'C0012', raw_name: '배추김치5kg', product_code: 'KC-BC-05' });
  });

  afterEach(() => {
    db.close();
  });

  it('지시수량과 동일하게 실적을 등록하면 사유 없이 성공하고 주문이 출고완료로 전이된다', async () => {
    const [orderNo] = await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05' },
    ]);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    const lineId = shipOrder.body.lines[0].ship_order_dtl_id;

    const res = await request(app).post(`/api/ship-orders/lines/${lineId}/results`).send({ actual_qty: 10 });
    expect(res.status).toBe(201);

    const order = await request(app).get(`/api/orders/${orderNo}`);
    expect(order.body.status).toBe('SHIPPED');

    const finishedShipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    expect(finishedShipOrder.body.status).toBe('RESULT_REGISTERED');
  });

  it('지시수량과 실출고수량이 다른데 사유가 없으면 400을 반환한다', async () => {
    await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05' },
    ]);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    const lineId = shipOrder.body.lines[0].ship_order_dtl_id;

    const res = await request(app).post(`/api/ship-orders/lines/${lineId}/results`).send({ actual_qty: 8 });
    expect(res.status).toBe(400);
  });

  it('차이 사유를 입력하면 등록되고, 조회 화면에서 지시-실적 차이가 표시된다 (수용 기준)', async () => {
    await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05' },
    ]);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    const lineId = shipOrder.body.lines[0].ship_order_dtl_id;

    const res = await request(app)
      .post(`/api/ship-orders/lines/${lineId}/results`)
      .send({ actual_qty: 8, diff_reason_code: 'DAMAGED', pack_lot: 'LOT-20261105-01' });
    expect(res.status).toBe(201);

    const summary = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}/results`);
    const line = summary.body.find((l) => l.ship_order_dtl_id === lineId);
    expect(line.instructed_qty).toBe(10);
    expect(line.totalActualQty).toBe(8);
    expect(line.diffQty).toBe(-2);
    expect(line.results[0].diff_reason_code).toBe('DAMAGED');
  });

  it('한 주문의 모든 라인(제품 2종)에 실적이 등록되어야 출고완료로 전이된다', async () => {
    const [orderNo] = await uploadAndConfirm(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05', customer_order_no: 'A' },
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '배추김치5kg', quantity: 5, ship_due_date: '2026-11-05', customer_order_no: 'A' },
    ]);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    expect(shipOrder.body.lines).toHaveLength(2);

    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: shipOrder.body.lines[0].instructed_qty });

    let order = await request(app).get(`/api/orders/${orderNo}`);
    expect(order.body.status).toBe('SHIP_ORDERED'); // 아직 한 라인만 처리됨

    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[1].ship_order_dtl_id}/results`)
      .send({ actual_qty: shipOrder.body.lines[1].instructed_qty });

    order = await request(app).get(`/api/orders/${orderNo}`);
    expect(order.body.status).toBe('SHIPPED');
  });

  it('존재하지 않는 출고지시 라인에 실적 등록 시 404를 반환한다', async () => {
    const res = await request(app).post('/api/ship-orders/lines/9999/results').send({ actual_qty: 1 });
    expect(res.status).toBe(404);
  });
});
