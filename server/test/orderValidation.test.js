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

describe('R1-F-05 주문 데이터 검증 (확정 게이트)', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    await request(app)
      .post('/api/products')
      .send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg', spec: '10kg' });
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
  });

  afterEach(() => {
    db.close();
  });

  it('제품 매핑까지 끝난 정상 주문은 검증을 통과하고 확정된다', async () => {
    const [orderNo] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 25, ship_due_date: '2026-11-05' },
    ]);

    const validate = await request(app).get(`/api/orders/${orderNo}/validate`);
    expect(validate.body).toEqual({ order_no: orderNo, valid: true, errors: [], warnings: [] });

    const confirm = await request(app).post(`/api/orders/${orderNo}/confirm`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe('CONFIRMED');
  });

  it('제품 매핑이 안 된 행이 있으면 행 단위 오류를 표시하고 확정을 차단한다 (수용 기준)', async () => {
    const [orderNo] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지붙여서10kg', quantity: 5, ship_due_date: '2026-11-05' },
    ]);

    const validate = await request(app).get(`/api/orders/${orderNo}/validate`);
    expect(validate.body.valid).toBe(false);
    expect(validate.body.errors).toEqual([
      {
        line_no: 1,
        column: '제품명(거래처 표기)',
        reason: expect.stringContaining('매핑되지 않았습니다'),
      },
    ]);

    const confirm = await request(app).post(`/api/orders/${orderNo}/confirm`);
    expect(confirm.status).toBe(422);
    expect(confirm.body.details.errors).toHaveLength(1);

    const order = await request(app).get(`/api/orders/${orderNo}`);
    expect(order.body.status).toBe('RECEIVED'); // 상태 변경 안 됨
  });

  it('동일 거래처·제품·주문일자의 중복 주문은 경고로 표시되지만 확정은 차단하지 않는다', async () => {
    const [orderA] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 25, ship_due_date: '2026-11-05', customer_order_no: 'A' },
    ]);
    const [orderB] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, ship_due_date: '2026-11-05', customer_order_no: 'B' },
    ]);

    const validate = await request(app).get(`/api/orders/${orderB}/validate`);
    expect(validate.body.valid).toBe(true);
    expect(validate.body.warnings).toEqual([
      { line_no: 1, column: '제품명(거래처 표기)', reason: expect.stringContaining(orderA) },
    ]);

    const confirm = await request(app).post(`/api/orders/${orderB}/confirm`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe('CONFIRMED');
    expect(confirm.body.warnings).toHaveLength(1);
  });

  it('이미 확정된 주문을 다시 확정하려 하면 409를 반환한다', async () => {
    const [orderNo] = await uploadOrders(app, [
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 25, ship_due_date: '2026-11-05' },
    ]);
    await request(app).post(`/api/orders/${orderNo}/confirm`);
    const second = await request(app).post(`/api/orders/${orderNo}/confirm`);
    expect(second.status).toBe(409);
  });

  it('존재하지 않는 주문번호는 404를 반환한다', async () => {
    const res = await request(app).get('/api/orders/NOPE/validate');
    expect(res.status).toBe(404);
  });
});
