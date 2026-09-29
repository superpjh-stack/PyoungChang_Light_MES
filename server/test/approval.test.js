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

async function createIssuedInvoice(app, { customerCode, quantity = 10, unitPrice = 38000, shipDate = '2026-11-05' }) {
  const buffer = await buildXlsxBuffer([
    { order_date: '2026-11-03', customer_code: customerCode, raw_product_name: '고랭지띄고10kg', quantity, unit_price: unitPrice, ship_due_date: shipDate },
  ]);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  const orderNo = commit.body.orders[0];
  await request(app).post(`/api/orders/${orderNo}/confirm`);
  const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: shipDate, customer_code: customerCode });
  const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
  await request(app).post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`).send({ actual_qty: quantity });
  const invGen = await request(app).post('/api/invoices/generate').send({ invoice_date: shipDate, customer_code: customerCode });
  const invoiceNo = invGen.body.invoices[0];
  await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');
  return invoiceNo;
}

describe('R1-F-12 권한별 승인 프로세스', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '일반거래처' }); // 승인 불필요
    await request(app).post('/api/customers').send({ customer_code: 'C0099', name: '주요거래처', approval_required: true });
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    for (const code of ['C0012', 'C0099']) {
      await request(app).post('/api/product-aliases').send({ customer_code: code, raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    }
    await request(app).post('/api/users').send({ user_id: 'op1', name: '운영자', role: 'OPERATOR' });
    await request(app).post('/api/users').send({ user_id: 'admin1', name: '관리자', role: 'ADMIN' });
  });

  afterEach(() => {
    db.close();
  });

  it('승인이 필요 없는 거래처는 승인 없이 바로 ERP 전송이 가능하다', async () => {
    const invoiceNo = await createIssuedInvoice(app, { customerCode: 'C0012' });
    const approval = await request(app).get(`/api/invoices/${invoiceNo}/approval`);
    expect(approval.body).toMatchObject({ required: false, approved: false });

    const send = await request(app).post(`/api/invoices/${invoiceNo}/erp/send`).set('X-User-Id', 'op1');
    expect(send.status).toBe(200);
  });

  it('거래처별로 승인이 설정돼 있으면 승인 전까지 ERP 전송이 차단된다 (수용 기준)', async () => {
    const invoiceNo = await createIssuedInvoice(app, { customerCode: 'C0099' });
    const approval = await request(app).get(`/api/invoices/${invoiceNo}/approval`);
    expect(approval.body).toMatchObject({ required: true, approved: false });

    const blocked = await request(app).post(`/api/invoices/${invoiceNo}/erp/send`).set('X-User-Id', 'op1');
    expect(blocked.status).toBe(409);

    const approve = await request(app).post(`/api/invoices/${invoiceNo}/approve`).set('X-User-Id', 'op1');
    expect(approve.status).toBe(200);
    expect(approve.body.approved).toBe(true);
    expect(approve.body.history[0]).toMatchObject({ user_id: 'op1' });
    expect(approve.body.history[0].approved_at).toBeTruthy();

    const send = await request(app).post(`/api/invoices/${invoiceNo}/erp/send`).set('X-User-Id', 'op1');
    expect(send.status).toBe(200);
  });

  it('금액 기준으로도 승인이 필요해질 수 있다 (관리자만 임계값 설정 가능)', async () => {
    const forbidden = await request(app)
      .put('/api/settings/approval-amount-threshold')
      .set('X-User-Id', 'op1')
      .send({ value: 300000 });
    expect(forbidden.status).toBe(403);

    const setThreshold = await request(app)
      .put('/api/settings/approval-amount-threshold')
      .set('X-User-Id', 'admin1')
      .send({ value: 300000 });
    expect(setThreshold.status).toBe(200);
    expect(setThreshold.body.value).toBe(300000);

    // C0012는 거래처 승인 설정이 없지만, 380,000원(10*38,000)으로 임계값 300,000원을 초과 → 승인 필요
    const invoiceNo = await createIssuedInvoice(app, { customerCode: 'C0012' });
    const approval = await request(app).get(`/api/invoices/${invoiceNo}/approval`);
    expect(approval.body.required).toBe(true);

    const blocked = await request(app).post(`/api/invoices/${invoiceNo}/erp/send`).set('X-User-Id', 'op1');
    expect(blocked.status).toBe(409);
  });

  it('승인이 필요 없는 명세서를 승인하려 하면 400을 반환한다', async () => {
    const invoiceNo = await createIssuedInvoice(app, { customerCode: 'C0012' });
    const res = await request(app).post(`/api/invoices/${invoiceNo}/approve`).set('X-User-Id', 'op1');
    expect(res.status).toBe(400);
  });

  it('이미 승인된 명세서를 다시 승인하려 하면 409를 반환한다', async () => {
    const invoiceNo = await createIssuedInvoice(app, { customerCode: 'C0099' });
    await request(app).post(`/api/invoices/${invoiceNo}/approve`).set('X-User-Id', 'op1');
    const res = await request(app).post(`/api/invoices/${invoiceNo}/approve`).set('X-User-Id', 'op1');
    expect(res.status).toBe(409);
  });

  it('승인은 조회자(VIEWER)가 아니라 운영자 이상만 할 수 있다', async () => {
    await request(app).post('/api/users').send({ user_id: 'viewer1', name: '조회자', role: 'VIEWER' });
    const invoiceNo = await createIssuedInvoice(app, { customerCode: 'C0099' });
    const res = await request(app).post(`/api/invoices/${invoiceNo}/approve`).set('X-User-Id', 'viewer1');
    expect(res.status).toBe(403);
  });

  it('일 마감 일괄 전송에서도 승인 미완료 건은 개별 오류로 표시되고 전체 배치는 막히지 않는다', async () => {
    const approvedRequired = await createIssuedInvoice(app, { customerCode: 'C0099', shipDate: '2026-11-06' });
    const noApprovalNeeded = await createIssuedInvoice(app, { customerCode: 'C0012', shipDate: '2026-11-06' });

    const batch = await request(app)
      .post('/api/invoices/erp/send-batch')
      .set('X-User-Id', 'op1')
      .send({ invoice_date: '2026-11-06' });

    const failedEntry = batch.body.find((r) => r.invoice_no === approvedRequired);
    expect(failedEntry.error).toContain('승인');
    const okEntry = batch.body.find((r) => r.invoice_no === noApprovalNeeded);
    expect(okEntry.status).toBe('SENDING');
  });
});
