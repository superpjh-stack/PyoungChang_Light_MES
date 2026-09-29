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

async function createIssuedInvoice(app, customerCode, shipDate) {
  const buffer = await buildXlsxBuffer([
    { order_date: '2026-11-03', customer_code: customerCode, raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: shipDate },
  ]);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  const orderNo = commit.body.orders[0];
  await request(app).post(`/api/orders/${orderNo}/confirm`);
  const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: shipDate, customer_code: customerCode });
  const shipOrder = await request(app).get(`/api/ship-orders/${gen.body.shipOrders[0]}`);
  await request(app).post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`).send({ actual_qty: 10 });
  const invGen = await request(app).post('/api/invoices/generate').send({ invoice_date: shipDate, customer_code: customerCode });
  const invoiceNo = invGen.body.invoices[0];
  await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');
  return { orderNo, invoiceNo };
}

describe('R1-N-08 가용성 — ERP 장애 시 MES 단독 운영 + 복구 후 일괄 재전송', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    for (const code of ['C0001', 'C0002', 'C0003']) {
      await request(app).post('/api/customers').send({ customer_code: code, name: `거래처${code}` });
    }
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    for (const code of ['C0001', 'C0002', 'C0003']) {
      await request(app).post('/api/product-aliases').send({ customer_code: code, raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    }
    await request(app).post('/api/users').send({ user_id: 'op1', name: '운영자', role: 'OPERATOR' });
  });

  afterEach(() => {
    db.close();
  });

  it('ERP 전송이 실패(장애)해도 MES 주문·출고·명세서 생성은 영향받지 않는다', async () => {
    const shipDate = '2026-11-05';
    const { invoiceNo: invA } = await createIssuedInvoice(app, 'C0001', shipDate);

    // ERP 장애 발생: 전송 시도 후 실패로 회신 (ERP 쪽 문제이지 MES 쪽 문제가 아님)
    await request(app).post(`/api/invoices/${invA}/erp/send`).set('X-User-Id', 'op1');
    const fail = await request(app)
      .post(`/api/invoices/${invA}/erp/confirm`)
      .set('X-User-Id', 'op1')
      .send({ success: false, error_message: 'ERP 서버 응답 없음 (연결 시간 초과)' });
    expect(fail.status).toBe(200);
    expect(fail.body.erp_send_status).toBe('FAILED');

    // ERP가 죽어 있는 동안에도 새로운 주문·출고·명세서 생성은 그대로 동작해야 한다 (MES 단독 운영)
    const { invoiceNo: invB } = await createIssuedInvoice(app, 'C0002', shipDate);
    expect(invB).not.toBe(invA);
    const invoiceBAfter = await request(app).get(`/api/invoices/${invB}`);
    expect(invoiceBAfter.body.status).toBe('ISSUED');
    expect(invoiceBAfter.body.erp_send_status).toBe('PENDING'); // 아직 전송 시도 전이지만 발행 자체는 완료됨
  });

  it('장애 복구 후 미전송(대기/실패) 건을 일괄 재전송하면 전송중이던 건은 건드리지 않는다', async () => {
    const shipDate = '2026-11-06';
    const { invoiceNo: invFailed } = await createIssuedInvoice(app, 'C0001', shipDate);
    const { invoiceNo: invPending } = await createIssuedInvoice(app, 'C0002', shipDate);
    const { invoiceNo: invInFlight } = await createIssuedInvoice(app, 'C0003', shipDate);

    // invFailed: 전송 시도했으나 장애로 실패
    await request(app).post(`/api/invoices/${invFailed}/erp/send`).set('X-User-Id', 'op1');
    await request(app)
      .post(`/api/invoices/${invFailed}/erp/confirm`)
      .set('X-User-Id', 'op1')
      .send({ success: false, error_message: 'ERP 서버 응답 없음' });
    // invPending: 아직 전송을 시도조차 못함 (대기)
    // invInFlight: 전송은 보냈지만 아직 결과 회신 전 (전송중) — 장애 복구 배치가 건드리면 안 됨
    await request(app).post(`/api/invoices/${invInFlight}/erp/send`).set('X-User-Id', 'op1');

    // 장애 복구: 일 마감 일괄 재전송
    const batch = await request(app)
      .post('/api/invoices/erp/send-batch')
      .set('X-User-Id', 'op1')
      .send({ invoice_date: shipDate });

    const resentInvoiceNos = batch.body.map((r) => r.invoice_no).sort();
    expect(resentInvoiceNos).toEqual([invFailed, invPending].sort());
    expect(batch.body.every((r) => r.status === 'SENDING')).toBe(true);

    const inFlightAfter = await request(app).get(`/api/invoices/${invInFlight}`);
    expect(inFlightAfter.body.erp_send_status).toBe('SENDING'); // 배치 대상이 아니었으므로 상태 그대로

    const failedAfter = await request(app).get(`/api/invoices/${invFailed}`);
    expect(failedAfter.body.erp_send_status).toBe('SENDING'); // FAILED → 재전송으로 SENDING 복귀
  });

  it('성공한 건은 복구 배치에서 다시 전송되지 않는다', async () => {
    const shipDate = '2026-11-07';
    const { invoiceNo } = await createIssuedInvoice(app, 'C0001', shipDate);
    await request(app).post(`/api/invoices/${invoiceNo}/erp/send`).set('X-User-Id', 'op1');
    await request(app).post(`/api/invoices/${invoiceNo}/erp/confirm`).set('X-User-Id', 'op1').send({ success: true, erp_invoice_no: 'ERP-1' });

    const batch = await request(app)
      .post('/api/invoices/erp/send-batch')
      .set('X-User-Id', 'op1')
      .send({ invoice_date: shipDate });
    expect(batch.body).toEqual([]);
  });
});
