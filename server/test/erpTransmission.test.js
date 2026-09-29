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

async function createIssuedInvoice(app, { orderQty = 10, unitPrice = 38000, shipDate = '2026-11-05' } = {}) {
  const buffer = await buildXlsxBuffer([
    { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: orderQty, unit_price: unitPrice, ship_due_date: shipDate },
  ]);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  for (const orderNo of commit.body.orders) {
    await request(app).post(`/api/orders/${orderNo}/confirm`);
  }
  const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: shipDate });
  for (const shipOrderNo of gen.body.shipOrders) {
    const shipOrder = await request(app).get(`/api/ship-orders/${shipOrderNo}`);
    for (const line of shipOrder.body.lines) {
      await request(app).post(`/api/ship-orders/lines/${line.ship_order_dtl_id}/results`).send({ actual_qty: line.instructed_qty });
    }
  }
  const invoiceGen = await request(app).post('/api/invoices/generate').send({ invoice_date: shipDate });
  const invoiceNo = invoiceGen.body.invoices[0];
  await request(app).post(`/api/invoices/${invoiceNo}/issue`);
  return invoiceNo;
}

describe('R1-F-09 ERP 거래 명세서 연동 전송', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑', erp_customer_code: 'ERP-C0012' });
    await request(app)
      .post('/api/products')
      .send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg', erp_item_code: 'ERP-ITEM-001' });
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
  });

  afterEach(() => {
    db.close();
  });

  it('DRAFT 상태 명세서는 ERP로 전송할 수 없다', async () => {
    const buffer = await buildXlsxBuffer([
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' },
    ]);
    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
    await request(app).post(`/api/orders/${commit.body.orders[0]}/confirm`);
    const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: '2026-11-05' });
    const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: shipOrder.body.lines[0].instructed_qty });
    const invoiceGen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });

    const res = await request(app).post(`/api/invoices/${invoiceGen.body.invoices[0]}/erp/send`);
    expect(res.status).toBe(409);
  });

  it('발행된 명세서를 전송하면 상태가 전송중(SENDING)이 되고 Import 파일 내용이 명세서 항목과 일치한다 (수용 기준)', async () => {
    const invoiceNo = await createIssuedInvoice(app);

    const send = await request(app).post(`/api/invoices/${invoiceNo}/erp/send`);
    expect(send.status).toBe(200);
    expect(send.body.erp_send_status).toBe('SENDING');
    expect(send.body.transmission.filename).toBe(`${invoiceNo}_erp_import.csv`);

    const file = await request(app).get(`/api/invoices/${invoiceNo}/erp/import-file`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('text/csv');
    const [header, dataLine] = file.text.trim().split('\n');
    expect(header).toContain('명세서번호');
    expect(dataLine).toContain(invoiceNo);
    expect(dataLine).toContain('ERP-C0012');
    expect(dataLine).toContain('ERP-ITEM-001');
    expect(dataLine).toContain('380000'); // 공급가액 = 10*38000
  });

  it('전송 성공을 확정하면 상태가 SUCCESS로 바뀌고 ERP 명세서번호가 저장된다', async () => {
    const invoiceNo = await createIssuedInvoice(app);
    await request(app).post(`/api/invoices/${invoiceNo}/erp/send`);

    const confirm = await request(app)
      .post(`/api/invoices/${invoiceNo}/erp/confirm`)
      .send({ success: true, erp_invoice_no: 'ERP-INV-9001' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.erp_send_status).toBe('SUCCESS');
    expect(confirm.body.erp_invoice_no).toBe('ERP-INV-9001');
  });

  it('SENDING 상태가 아니면 결과를 확정할 수 없다', async () => {
    const invoiceNo = await createIssuedInvoice(app);
    const res = await request(app).post(`/api/invoices/${invoiceNo}/erp/confirm`).send({ success: true });
    expect(res.status).toBe(409);
  });

  it('실패 확정 시 사유가 없으면 400, 있으면 FAILED로 저장된다', async () => {
    const invoiceNo = await createIssuedInvoice(app);
    await request(app).post(`/api/invoices/${invoiceNo}/erp/send`);

    const noReason = await request(app).post(`/api/invoices/${invoiceNo}/erp/confirm`).send({ success: false });
    expect(noReason.status).toBe(400);

    const withReason = await request(app)
      .post(`/api/invoices/${invoiceNo}/erp/confirm`)
      .send({ success: false, error_message: '거래처 코드 매핑 오류' });
    expect(withReason.status).toBe(200);
    expect(withReason.body.erp_send_status).toBe('FAILED');
    expect(withReason.body.erp_error_message).toBe('거래처 코드 매핑 오류');
  });

  it('실패 건은 재전송할 수 있고, 실패가 아닌 건은 재전송할 수 없다', async () => {
    const invoiceNo = await createIssuedInvoice(app);
    await request(app).post(`/api/invoices/${invoiceNo}/erp/send`);
    await request(app).post(`/api/invoices/${invoiceNo}/erp/confirm`).send({ success: false, error_message: '오류' });

    const retry = await request(app).post(`/api/invoices/${invoiceNo}/erp/retry`);
    expect(retry.status).toBe(200);
    expect(retry.body.erp_send_status).toBe('SENDING');

    const retryAgain = await request(app).post(`/api/invoices/${invoiceNo}/erp/retry`);
    expect(retryAgain.status).toBe(409); // 지금은 SENDING 상태라 재전송 불가
  });

  it('이미 성공한 명세서는 다시 전송할 수 없다', async () => {
    const invoiceNo = await createIssuedInvoice(app);
    await request(app).post(`/api/invoices/${invoiceNo}/erp/send`);
    await request(app).post(`/api/invoices/${invoiceNo}/erp/confirm`).send({ success: true });

    const resend = await request(app).post(`/api/invoices/${invoiceNo}/erp/send`);
    expect(resend.status).toBe(409);
  });

  it('일 마감 일괄 전송으로 대기 중인 명세서를 한 번에 전송할 수 있다', async () => {
    // 동일 거래처·동일 거래일자 주문은 하나의 명세서로 합쳐지므로, 배치 전송은 그 명세서 1건으로 확인한다.
    const invoiceNoA = await createIssuedInvoice(app, { shipDate: '2026-11-06' });

    const batch = await request(app).post('/api/invoices/erp/send-batch').send({ invoice_date: '2026-11-06' });
    expect(batch.body).toEqual([{ invoice_no: invoiceNoA, filename: `${invoiceNoA}_erp_import.csv`, status: 'SENDING' }]);

    const invoice = await request(app).get(`/api/invoices/${invoiceNoA}`);
    expect(invoice.body.erp_send_status).toBe('SENDING');
  });

  it('존재하지 않는 명세서에 대한 ERP 작업은 404를 반환한다', async () => {
    const res = await request(app).post('/api/invoices/NOPE/erp/send');
    expect(res.status).toBe(404);
  });
});
