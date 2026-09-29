import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ORDER_UPLOAD_COLUMNS } from '../src/lib/orderUploadTemplate.js';
import { buildOrdersExportWorkbook } from '../src/lib/orderExportXlsx.js';

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

describe('R1-F-02 주문 내역 등록·수정·조회', () => {
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
  });

  afterEach(() => {
    db.close();
  });

  it('주문 등록 후 상태 변경 이력이 확인된다 (수용 기준)', async () => {
    const [orderNo] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: '2026-11-05' },
    ]);

    const historyAfterCreate = await request(app).get(`/api/orders/${orderNo}/status-history`);
    expect(historyAfterCreate.body).toEqual([
      expect.objectContaining({ from_status: null, to_status: 'RECEIVED' }),
    ]);

    await request(app).post(`/api/orders/${orderNo}/confirm`);

    const historyAfterConfirm = await request(app).get(`/api/orders/${orderNo}/status-history`);
    expect(historyAfterConfirm.body).toEqual([
      expect.objectContaining({ from_status: null, to_status: 'RECEIVED' }),
      expect.objectContaining({ from_status: 'RECEIVED', to_status: 'CONFIRMED' }),
    ]);
  });

  it('RECEIVED 상태의 주문은 헤더 정보를 수정할 수 있다', async () => {
    const [orderNo] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: '2026-11-05' },
    ]);

    const res = await request(app).put(`/api/orders/${orderNo}`).send({ note: '고객 요청: 파손주의' });
    expect(res.status).toBe(200);
    expect(res.body.note).toBe('고객 요청: 파손주의');
  });

  it('확정된 주문은 수정할 수 없다 (409)', async () => {
    const [orderNo] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: '2026-11-05' },
    ]);
    await request(app).post(`/api/orders/${orderNo}/confirm`);

    const res = await request(app).put(`/api/orders/${orderNo}`).send({ note: '수정 시도' });
    expect(res.status).toBe(409);
  });

  it('기간·거래처·제품·상태로 조회할 수 있다', async () => {
    const [orderNo] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: '2026-11-05' },
    ]);
    await request(app).post(`/api/orders/${orderNo}/confirm`);

    const byProduct = await request(app).get('/api/orders?product_code=KC-HW-10');
    expect(byProduct.body.map((o) => o.order_no)).toEqual([orderNo]);

    const byShipDue = await request(app).get('/api/orders?ship_due_date_from=2026-11-05&ship_due_date_to=2026-11-05');
    expect(byShipDue.body.map((o) => o.order_no)).toEqual([orderNo]);

    const byStatus = await request(app).get('/api/orders?status=CONFIRMED');
    expect(byStatus.body.map((o) => o.order_no)).toEqual([orderNo]);

    const noMatch = await request(app).get('/api/orders?product_code=NOPE');
    expect(noMatch.body).toEqual([]);
  });

  it('조회 결과 엑셀 다운로드 엔드포인트가 정상 응답한다', async () => {
    await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: '2026-11-05' },
    ]);

    const res = await request(app).get('/api/orders/export?customer_code=C0012');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('orders_export.xlsx');
  });

  it('엑셀 다운로드 워크북 내용이 조회 필터·주문 데이터와 일치한다', async () => {
    await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, ship_due_date: '2026-11-05' },
    ]);

    const buffer = await buildOrdersExportWorkbook(db, { customer_code: 'C0012' });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values.slice(1)[0]).toBe('주문번호');
    expect(sheet.getRow(2).values.slice(1)[6]).toBe('고랭지띄고10kg'); // 원본제품명 컬럼
  });
});
