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

async function shipToCompletion(app, rows, shipDate) {
  const buffer = await buildXlsxBuffer(rows);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  for (const orderNo of commit.body.orders) {
    await request(app).post(`/api/orders/${orderNo}/confirm`);
  }
  const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: shipDate });
  for (const shipOrderNo of gen.body.shipOrders) {
    const shipOrder = await request(app).get(`/api/ship-orders/${shipOrderNo}`);
    for (const line of shipOrder.body.lines) {
      await request(app)
        .post(`/api/ship-orders/lines/${line.ship_order_dtl_id}/results`)
        .send({ actual_qty: line.instructed_qty });
    }
  }
  return commit.body.orders;
}

describe('R1-F-08 거래 명세서 자동 생성', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    await request(app)
      .post('/api/products')
      .send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg', tax_type: 'TAXABLE' });
    await request(app)
      .post('/api/products')
      .send({ product_code: 'KC-RICE-01', name: '쌀 20kg', tax_type: 'EXEMPT', default_price: 50000 });
    await request(app).post('/api/users').send({ user_id: 'op1', name: '운영자', role: 'OPERATOR' });
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '쌀20키로', product_code: 'KC-RICE-01' });
  });

  afterEach(() => {
    db.close();
  });

  it('주문 단가가 있으면 우선 적용되어 공급가액·세액·합계가 정확히 계산된다 (수용 기준)', async () => {
    await shipToCompletion(
      app,
      [
        { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' },
      ],
      '2026-11-05'
    );

    const res = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    expect(res.status).toBe(201);
    expect(res.body.invoices).toHaveLength(1);

    const invoice = await request(app).get(`/api/invoices/${res.body.invoices[0]}`);
    expect(invoice.body.status).toBe('DRAFT');
    expect(invoice.body.lines).toHaveLength(1);
    expect(invoice.body.lines[0]).toMatchObject({
      product_code: 'KC-HW-10',
      quantity: 10,
      unit_price: 38000,
      supply_amount: 380000,
      tax_amount: 38000, // VAT 10%
      tax_type: 'TAXABLE',
    });
    expect(invoice.body.supply_amount).toBe(380000);
    expect(invoice.body.tax_amount).toBe(38000);
    expect(invoice.body.total_amount).toBe(418000);
  });

  it('면세 품목은 세액이 0이고, 단가는 기본단가(default_price)가 적용된다', async () => {
    await shipToCompletion(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '쌀20키로', quantity: 5, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );

    const res = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    const invoice = await request(app).get(`/api/invoices/${res.body.invoices[0]}`);
    expect(invoice.body.lines[0]).toMatchObject({ unit_price: 50000, supply_amount: 250000, tax_amount: 0, tax_type: 'EXEMPT' });
  });

  it('주문 단가가 없으면 거래처 단가표를 적용한다', async () => {
    await request(app).post('/api/customers/C0012/prices').send({ product_code: 'KC-HW-10', unit_price: 39000 });
    await shipToCompletion(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 2, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );

    const res = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    const invoice = await request(app).get(`/api/invoices/${res.body.invoices[0]}`);
    expect(invoice.body.lines[0].unit_price).toBe(39000);
  });

  it('단가를 확정할 수 없으면 해당 주문은 이번 회차에서 제외되고 사유가 보고된다', async () => {
    const [orderNo] = await shipToCompletion(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 2, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    ); // 주문단가/거래처단가표/기본단가 모두 없음

    const res = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    expect(res.body.invoices).toEqual([]);
    expect(res.body.excludedOrders).toEqual([
      expect.objectContaining({ order_no: orderNo, reason: expect.stringContaining('단가를 확정할 수 없습니다') }),
    ]);

    const order = await request(app).get(`/api/orders/${orderNo}`);
    expect(order.body.status).toBe('SHIPPED'); // INVOICED로 넘어가지 않음
  });

  it('동일 거래처·거래일자의 여러 주문은 하나의 명세서로 합산된다', async () => {
    await shipToCompletion(
      app,
      [
        { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05', customer_order_no: 'A' },
        { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, unit_price: 38000, ship_due_date: '2026-11-05', customer_order_no: 'B' },
      ],
      '2026-11-05'
    );

    const res = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    expect(res.body.invoices).toHaveLength(1);
    const invoice = await request(app).get(`/api/invoices/${res.body.invoices[0]}`);
    expect(invoice.body.lines).toHaveLength(2);
    expect(invoice.body.supply_amount).toBe(570000); // (10+5)*38000
  });

  it('명세서 생성 후 관련 주문은 INVOICED 상태로 전이된다', async () => {
    const [orderNo] = await shipToCompletion(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );
    await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });

    const order = await request(app).get(`/api/orders/${orderNo}`);
    expect(order.body.status).toBe('INVOICED');
  });

  it('미리보기는 실제로 저장하지 않는다', async () => {
    await shipToCompletion(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );

    const preview = await request(app).get('/api/invoices/preview?invoice_date=2026-11-05');
    expect(preview.body.groups).toHaveLength(1);
    expect(preview.body.groups[0].lines[0].supply_amount).toBe(380000);

    const listAfterPreview = await request(app).get('/api/invoices');
    expect(listAfterPreview.body).toEqual([]); // 미저장 확인
  });

  it('DRAFT 상태 명세서를 발행(ISSUED)할 수 있고, 재발행은 409를 반환한다', async () => {
    await shipToCompletion(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );
    const gen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    const invoiceNo = gen.body.invoices[0];

    const issue = await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');
    expect(issue.status).toBe(200);
    expect(issue.body.status).toBe('ISSUED');

    const reissue = await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');
    expect(reissue.status).toBe(409);
  });

  it('거래명세서를 엑셀로 다운로드할 수 있다', async () => {
    await shipToCompletion(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );
    const gen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });

    const res = await request(app).get(`/api/invoices/${gen.body.invoices[0]}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
  });

  it('invoice_date 누락 시 400을 반환한다', async () => {
    const res = await request(app).post('/api/invoices/generate').send({});
    expect(res.status).toBe(400);
  });
});
