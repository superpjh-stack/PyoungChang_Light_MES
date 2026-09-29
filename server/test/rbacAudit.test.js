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

async function createIssuableInvoice(app) {
  const buffer = await buildXlsxBuffer([
    { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' },
  ]);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  const orderNo = commit.body.orders[0];
  await request(app).post(`/api/orders/${orderNo}/confirm`);
  const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
  const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
  await request(app).post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`).send({ actual_qty: 10 });
  const invGen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
  return { orderNo, invoiceNo: invGen.body.invoices[0] };
}

describe('R1-N-06 RBAC + R1-N-07 감사 로그', () => {
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
    await request(app).post('/api/users').send({ user_id: 'admin1', name: '관리자', role: 'ADMIN' });
    await request(app).post('/api/users').send({ user_id: 'op1', name: '운영자', role: 'OPERATOR' });
    await request(app).post('/api/users').send({ user_id: 'viewer1', name: '조회자', role: 'VIEWER' });
  });

  afterEach(() => {
    db.close();
  });

  it('사용자 계정 등록: 중복/잘못된 역할은 각각 409/400', async () => {
    const dup = await request(app).post('/api/users').send({ user_id: 'admin1', name: 'x', role: 'ADMIN' });
    expect(dup.status).toBe(409);
    const badRole = await request(app).post('/api/users').send({ user_id: 'newbie', name: 'x', role: 'SUPERUSER' });
    expect(badRole.status).toBe(400);
  });

  it('X-User-Id 헤더가 없으면 명세서 발행이 401로 차단된다', async () => {
    const { invoiceNo } = await createIssuableInvoice(app);
    const res = await request(app).post(`/api/invoices/${invoiceNo}/issue`);
    expect(res.status).toBe(401);
  });

  it('조회자(VIEWER)는 명세서를 발행할 수 없다 (403)', async () => {
    const { invoiceNo } = await createIssuableInvoice(app);
    const res = await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'viewer1');
    expect(res.status).toBe(403);
  });

  it('운영자(OPERATOR) 이상만 명세서 발행·ERP 전송이 가능하다', async () => {
    const { invoiceNo } = await createIssuableInvoice(app);
    const issue = await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');
    expect(issue.status).toBe(200);

    const send = await request(app).post(`/api/invoices/${invoiceNo}/erp/send`).set('X-User-Id', 'op1');
    expect(send.status).toBe(200);

    const confirm = await request(app)
      .post(`/api/invoices/${invoiceNo}/erp/confirm`)
      .set('X-User-Id', 'op1')
      .send({ success: true, erp_invoice_no: 'ERP-1' });
    expect(confirm.status).toBe(200);
  });

  it('관리자(ADMIN)는 운영자 권한이 필요한 동작도 수행할 수 있다 (상위 역할 포함)', async () => {
    const { invoiceNo } = await createIssuableInvoice(app);
    const issue = await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'admin1');
    expect(issue.status).toBe(200);
  });

  it('명세서 발행 시 감사 로그에 사용자·일시가 기록된다', async () => {
    const { invoiceNo } = await createIssuableInvoice(app);
    await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');

    const log = await request(app).get(`/api/audit-log?entity_type=INVOICE&entity_id=${invoiceNo}`);
    const issueEntry = log.body.find((e) => e.action === 'INVOICE_ISSUE');
    expect(issueEntry).toMatchObject({ user_id: 'op1', entity_id: invoiceNo });
    expect(issueEntry.created_at).toBeTruthy();
  });

  it('ERP 전송/확정 시에도 감사 로그가 남는다', async () => {
    const { invoiceNo } = await createIssuableInvoice(app);
    await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');
    await request(app).post(`/api/invoices/${invoiceNo}/erp/send`).set('X-User-Id', 'op1');
    await request(app)
      .post(`/api/invoices/${invoiceNo}/erp/confirm`)
      .set('X-User-Id', 'op1')
      .send({ success: true, erp_invoice_no: 'ERP-1' });

    const log = await request(app).get(`/api/audit-log?entity_type=INVOICE&entity_id=${invoiceNo}`);
    const actions = log.body.map((e) => e.action).sort();
    expect(actions).toEqual(['ERP_CONFIRM', 'ERP_SEND', 'INVOICE_ISSUE']);
  });

  it('주문 수정 시 감사 로그가 남는다', async () => {
    const { orderNo } = await createIssuableInvoice(app);
    // 이미 CONFIRMED까지 진행된 주문이라 수정 자체는 409지만, 별도 RECEIVED 주문으로 재확인
    const buffer = await buildXlsxBuffer([
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 1, ship_due_date: '2026-11-05' },
    ]);
    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
    const receivedOrderNo = commit.body.orders[0];

    await request(app).put(`/api/orders/${receivedOrderNo}`).set('X-User-Id', 'op1').send({ note: '메모 수정' });

    const log = await request(app).get(`/api/audit-log?entity_type=ORDER&entity_id=${receivedOrderNo}`);
    expect(log.body).toHaveLength(1);
    expect(log.body[0]).toMatchObject({ action: 'ORDER_UPDATE', user_id: 'op1' });
    expect(orderNo).not.toBe(receivedOrderNo);
  });

  it('별칭 등록·매핑대기함 확정 시 감사 로그가 남는다', async () => {
    const alias = await request(app)
      .post('/api/product-aliases')
      .set('X-User-Id', 'op1')
      .send({ customer_code: 'C0012', raw_name: '새표기10kg', product_code: 'KC-HW-10' });

    const aliasLog = await request(app).get(`/api/audit-log?entity_type=PRODUCT_ALIAS&entity_id=${alias.body.id}`);
    expect(aliasLog.body[0]).toMatchObject({ action: 'ALIAS_CREATE', user_id: 'op1' });

    const buffer = await buildXlsxBuffer([
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '알수없는표기', quantity: 1, ship_due_date: '2026-11-05' },
    ]);
    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });

    const resolve = await request(app)
      .post('/api/mapping-queue/resolve')
      .set('X-User-Id', 'op1')
      .send({ customer_code: 'C0012', raw_name: '알수없는표기', product_code: 'KC-HW-10' });

    const resolveLog = await request(app).get(`/api/audit-log?entity_type=PRODUCT_ALIAS&entity_id=${resolve.body.alias.id}`);
    const resolveEntry = resolveLog.body.find((e) => e.action === 'MAPPING_RESOLVE');
    expect(resolveEntry).toMatchObject({ user_id: 'op1' });
  });

  it('등록되지 않은 X-User-Id는 인증 실패로 처리된다', async () => {
    const { invoiceNo } = await createIssuableInvoice(app);
    const res = await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'ghost');
    expect(res.status).toBe(401);
  });
});
