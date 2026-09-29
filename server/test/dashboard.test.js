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

async function uploadOrders(app, rows) {
  const buffer = await buildXlsxBuffer(rows);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  return commit.body.orders;
}

const TODAY = '2026-11-10';

describe('R1-F-11 주문·출고 현황 대시보드', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    await request(app).post('/api/users').send({ user_id: 'op1', name: '운영자', role: 'OPERATOR' });
  });

  afterEach(() => {
    db.close();
  });

  it('당일/주간 주문 건수·수량이 실제 주문과 일치한다', async () => {
    await uploadOrders(app, [
      { order_date: TODAY, customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: TODAY, customer_order_no: 'TODAY-1' },
      { order_date: TODAY, customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 3, ship_due_date: TODAY, customer_order_no: 'TODAY-2' },
      { order_date: '2026-11-06', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-08', customer_order_no: 'WEEK-1' }, // 주간(7일) 범위 안
      { order_date: '2026-10-01', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 100, ship_due_date: '2026-10-03', customer_order_no: 'OLD-1' }, // 범위 밖
    ]);

    const res = await request(app).get(`/api/dashboard/summary?date=${TODAY}`);
    expect(res.body.today).toMatchObject({ date: TODAY, orderCount: 2, orderQty: 8 });
    expect(res.body.week).toMatchObject({ from: '2026-11-04', to: TODAY, orderCount: 3, orderQty: 18 });
  });

  it('출고예정일이 지났는데 아직 확정/출고지시 단계인 주문이 출고지연으로 강조된다', async () => {
    const [overdueOrder] = await uploadOrders(app, [
      { order_date: '2026-11-05', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: '2026-11-08', customer_order_no: 'OVERDUE-1' },
    ]);
    await request(app).post(`/api/orders/${overdueOrder}/confirm`);

    const [notYetDueOrder] = await uploadOrders(app, [
      { order_date: TODAY, customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: '2026-11-15', customer_order_no: 'NOT-DUE-1' },
    ]);
    await request(app).post(`/api/orders/${notYetDueOrder}/confirm`);

    const res = await request(app).get(`/api/dashboard/summary?date=${TODAY}`);
    expect(res.body.shipment.overdueShipmentCount).toBe(1);
    expect(res.body.shipment.overdueShipments[0].order_no).toBe(overdueOrder);
    expect(res.body.shipment.pendingShipmentCount).toBe(2); // 지연 1건 + 정상대기 1건
  });

  it('미출고·미발행 건수가 각 목록 조회 화면 건수와 일치한다 (완료 기준)', async () => {
    const [orderA] = await uploadOrders(app, [
      { order_date: TODAY, customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: TODAY, customer_order_no: 'A' },
    ]);
    await request(app).post(`/api/orders/${orderA}/confirm`);

    const [orderB] = await uploadOrders(app, [
      { order_date: TODAY, customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: TODAY, customer_order_no: 'B' },
    ]);
    await request(app).post(`/api/orders/${orderB}/confirm`);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: TODAY, customer_code: 'C0012' });
    // orderA, orderB가 같은 ship_order로 합쳐졌을 것이므로 전체 라인에 실적 등록
    for (const shipOrderNo of gen.body.shipOrders) {
      const shipOrder = await request(app).get(`/api/ship-orders/${shipOrderNo}`);
      for (const line of shipOrder.body.lines) {
        await request(app).post(`/api/ship-orders/lines/${line.ship_order_dtl_id}/results`).send({ actual_qty: line.instructed_qty });
      }
    }

    const dashboard = await request(app).get(`/api/dashboard/summary?date=${TODAY}`);
    const pendingShipmentList = await request(app).get('/api/orders/pending-shipment');
    const pendingInvoiceList = await request(app).get('/api/orders/pending-invoice');

    expect(dashboard.body.shipment.pendingShipmentCount).toBe(pendingShipmentList.body.length);
    expect(dashboard.body.invoice.pendingInvoiceCount).toBe(pendingInvoiceList.body.length);
    expect(dashboard.body.invoice.pendingInvoiceCount).toBe(2); // orderA, orderB 모두 SHIPPED
  });

  it('매핑 대기 건수가 매핑 대기함 화면 건수와 일치한다', async () => {
    await uploadOrders(app, [
      { order_date: TODAY, customer_code: 'C0012', raw_product_name: '알수없는표기', quantity: 1, ship_due_date: TODAY, customer_order_no: 'UNMAPPED-1' },
    ]);

    const dashboard = await request(app).get(`/api/dashboard/summary?date=${TODAY}`);
    const queue = await request(app).get('/api/mapping-queue');
    expect(dashboard.body.mappingPendingCount).toBe(queue.body.length);
    expect(dashboard.body.mappingPendingCount).toBe(1);
  });

  it('제품 매핑이 안 끝나 확정할 수 없는 주문이 검증 실패 건수에 잡힌다', async () => {
    await uploadOrders(app, [
      { order_date: TODAY, customer_code: 'C0012', raw_product_name: '알수없는표기', quantity: 1, ship_due_date: TODAY, customer_order_no: 'UNMAPPED-2' },
    ]);

    const dashboard = await request(app).get(`/api/dashboard/summary?date=${TODAY}`);
    expect(dashboard.body.validationFailedCount).toBe(1);
  });

  it('ERP 전송 상태별 건수가 명세서 상태와 일치한다', async () => {
    const [orderA] = await uploadOrders(app, [
      { order_date: TODAY, customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, unit_price: 38000, ship_due_date: TODAY },
    ]);
    await request(app).post(`/api/orders/${orderA}/confirm`);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: TODAY });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: shipOrder.body.lines[0].instructed_qty });
    const invGen = await request(app).post('/api/invoices/generate').send({ invoice_date: TODAY });
    await request(app).post(`/api/invoices/${invGen.body.invoices[0]}/issue`).set('X-User-Id', 'op1');
    await request(app).post(`/api/invoices/${invGen.body.invoices[0]}/erp/send`).set('X-User-Id', 'op1');

    const dashboard = await request(app).get(`/api/dashboard/summary?date=${TODAY}`);
    expect(dashboard.body.erp.sendingCount).toBe(1);
    expect(dashboard.body.erp.pendingCount).toBe(0);
    expect(dashboard.body.invoice.issuedTodayCount).toBe(1);
  });
});
