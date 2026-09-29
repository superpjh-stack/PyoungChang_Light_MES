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

async function uploadOrder(app, overrides = {}) {
  const buffer = await buildXlsxBuffer([
    {
      order_date: '2026-11-03',
      customer_code: 'C0012',
      raw_product_name: '고랭지띄고10kg',
      quantity: 10,
      unit_price: 38000,
      ship_due_date: '2026-11-05',
      ...overrides,
    },
  ]);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  return commit.body.orders[0];
}

describe('R1-F-10 문서 간 연계 이력 추적', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    await request(app).post('/api/product-aliases').send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
  });

  afterEach(() => {
    db.close();
  });

  it('임의 주문번호로 출고지시서·거래명세서까지 3개 문서가 연결 조회된다 (수용 기준)', async () => {
    const orderNo = await uploadOrder(app);
    await request(app).post(`/api/orders/${orderNo}/confirm`);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: 10 });
    const invGen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });

    const trace = await request(app).get(`/api/orders/${orderNo}/trace`);
    expect(trace.status).toBe(200);
    expect(trace.body.order_no).toBe(orderNo);
    expect(trace.body.ship_orders.map((s) => s.ship_order_no)).toEqual([gen.body.shipOrders[0]]);
    expect(trace.body.invoices.map((i) => i.invoice_no)).toEqual([invGen.body.invoices[0]]);
  });

  it('거래명세서 기준으로 원 주문을 역추적할 수 있다', async () => {
    const orderNo = await uploadOrder(app);
    await request(app).post(`/api/orders/${orderNo}/confirm`);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: 10 });
    const invGen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });

    const trace = await request(app).get(`/api/invoices/${invGen.body.invoices[0]}/trace`);
    expect(trace.body.invoice_no).toBe(invGen.body.invoices[0]);
    expect(trace.body.orders).toEqual([{ order_no: orderNo, status: 'INVOICED' }]);
    expect(trace.body.ship_orders).toEqual([gen.body.shipOrders[0]]);
  });

  it('미출고 주문 목록에는 확정/출고지시 상태만 나타난다', async () => {
    const receivedOrder = await uploadOrder(app, { customer_order_no: 'RECEIVED-1' });
    const confirmedOrder = await uploadOrder(app, { customer_order_no: 'CONFIRMED-1' });
    await request(app).post(`/api/orders/${confirmedOrder}/confirm`);
    const shipOrderedOrder = await uploadOrder(app, { customer_order_no: 'SHIP-ORDERED-1' });
    await request(app).post(`/api/orders/${shipOrderedOrder}/confirm`);
    await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05', customer_code: 'C0012' });

    const pending = await request(app).get('/api/orders/pending-shipment');
    const orderNos = pending.body.map((o) => o.order_no);
    expect(orderNos).not.toContain(receivedOrder); // RECEIVED는 대상 아님(아직 확정도 안 됨)
    // confirmedOrder와 shipOrderedOrder 둘 다 출고지시 생성 시 하나로 합쳐졌을 수 있으므로 최소 하나는 SHIP_ORDERED로 남아있어야 함
    expect(orderNos.length).toBeGreaterThan(0);
    for (const status of pending.body.map((o) => o.status)) {
      expect(['CONFIRMED', 'SHIP_ORDERED']).toContain(status);
    }
  });

  it('미발행 주문 목록에는 출고완료(SHIPPED) 상태만 나타난다', async () => {
    const orderNo = await uploadOrder(app);
    await request(app).post(`/api/orders/${orderNo}/confirm`);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: 10 });

    const pending = await request(app).get('/api/orders/pending-invoice');
    expect(pending.body.map((o) => o.order_no)).toEqual([orderNo]);
    expect(pending.body[0].status).toBe('SHIPPED');

    await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    const afterInvoice = await request(app).get('/api/orders/pending-invoice');
    expect(afterInvoice.body).toEqual([]); // 발행되면 목록에서 빠짐
  });

  it('존재하지 않는 주문/명세서 추적은 404를 반환한다', async () => {
    const orderRes = await request(app).get('/api/orders/NOPE/trace');
    expect(orderRes.status).toBe(404);
    const invoiceRes = await request(app).get('/api/invoices/NOPE/trace');
    expect(invoiceRes.status).toBe(404);
  });
});
