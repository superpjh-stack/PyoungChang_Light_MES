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

async function uploadConfirmShip(app, rows, shipDate) {
  const buffer = await buildXlsxBuffer(rows);
  const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
  const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
  for (const orderNo of commit.body.orders) {
    await request(app).post(`/api/orders/${orderNo}/confirm`);
  }
  const gen = await request(app).post('/api/ship-orders/generate').send({ ship_date: shipDate });
  return { orders: commit.body.orders, shipOrderNo: gen.body.shipOrders[0] };
}

describe('R1-N-05 주문·출고·명세서 수량/금액 정합성', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    await request(app).post('/api/product-aliases').send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    await request(app).post('/api/users').send({ user_id: 'op1', name: '운영자', role: 'OPERATOR' });
  });

  afterEach(() => {
    db.close();
  });

  it('출고 실적이 주문수량보다 적으면(부족) 명세서는 실적 수량 기준으로 청구된다', async () => {
    const { shipOrderNo } = await uploadConfirmShip(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );
    const shipOrder = await request(app).get(`/api/ship-orders/${shipOrderNo}`);
    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: 8, diff_reason_code: 'SHORTAGE' });

    const gen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    const invoice = await request(app).get(`/api/invoices/${gen.body.invoices[0]}`);
    expect(invoice.body.lines[0].quantity).toBe(8); // 주문수량 10이 아니라 실적수량 8
    expect(invoice.body.supply_amount).toBe(8 * 38000);
  });

  it('두 주문이 하나의 출고지시 라인으로 합산된 경우, 실적 부족분이 배분 비율대로 귀속된다', async () => {
    const { orders, shipOrderNo } = await uploadConfirmShip(
      app,
      [
        { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05', customer_order_no: 'A' },
        { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 5, unit_price: 38000, ship_due_date: '2026-11-05', customer_order_no: 'B' },
      ],
      '2026-11-05'
    );
    const shipOrder = await request(app).get(`/api/ship-orders/${shipOrderNo}`);
    expect(shipOrder.body.lines[0].instructed_qty).toBe(15);
    // 15개 지시 중 12개만 실제 출고 (부족 3개)
    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: 12, diff_reason_code: 'SHORTAGE' });

    const gen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    const invoice = await request(app).get(`/api/invoices/${gen.body.invoices[0]}`);
    // 명세서 라인은 원 주문 추적성을 위해 주문별로 유지된다 (order_no 역참조, R1-D-03)
    expect(invoice.body.lines).toHaveLength(2);
    const byOrder = Object.fromEntries(invoice.body.lines.map((l) => [l.order_no, l.quantity]));
    // 15개 지시 중 12개 출고 → 10:5 배분 비율대로 8개/4개씩 귀속
    expect(byOrder[orders[0]]).toBe(8);
    expect(byOrder[orders[1]]).toBe(4);
    expect(invoice.body.supply_amount).toBe(12 * 38000);

    for (const orderNo of orders) {
      const order = await request(app).get(`/api/orders/${orderNo}`);
      expect(order.body.status).toBe('INVOICED');
    }
  });

  it('명세서 생성 후 출고 실적이 추가/정정되면 청구 수량과 어긋나 발행이 차단된다 (수용 기준)', async () => {
    const { shipOrderNo } = await uploadConfirmShip(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );
    const shipOrder = await request(app).get(`/api/ship-orders/${shipOrderNo}`);
    const lineId = shipOrder.body.lines[0].ship_order_dtl_id;
    await request(app).post(`/api/ship-orders/lines/${lineId}/results`).send({ actual_qty: 8, diff_reason_code: 'SHORTAGE' });

    const gen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    const invoiceNo = gen.body.invoices[0];

    // 이후 담당자가 나머지 2개를 추가로 출고 확인해 실적을 정정 (총 실적 8 → 10)
    await request(app).post(`/api/ship-orders/lines/${lineId}/results`).send({ actual_qty: 2, diff_reason_code: 'LATE_FOUND' });

    const validate = await request(app).get(`/api/invoices/${invoiceNo}/validate`);
    expect(validate.body.valid).toBe(false);
    expect(validate.body.mismatches[0]).toMatchObject({ invoiced_qty: 8, current_shipped_qty: 10 });

    const issue = await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');
    expect(issue.status).toBe(422);
    expect(issue.body.details.mismatches).toHaveLength(1);

    const invoice = await request(app).get(`/api/invoices/${invoiceNo}`);
    expect(invoice.body.status).toBe('DRAFT'); // 발행되지 않음
  });

  it('정합성이 맞으면 정상적으로 발행된다', async () => {
    const { shipOrderNo } = await uploadConfirmShip(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );
    const shipOrder = await request(app).get(`/api/ship-orders/${shipOrderNo}`);
    await request(app)
      .post(`/api/ship-orders/lines/${shipOrder.body.lines[0].ship_order_dtl_id}/results`)
      .send({ actual_qty: 10 });

    const gen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    const invoiceNo = gen.body.invoices[0];

    const validate = await request(app).get(`/api/invoices/${invoiceNo}/validate`);
    expect(validate.body).toEqual({ valid: true, mismatches: [] });

    const issue = await request(app).post(`/api/invoices/${invoiceNo}/issue`).set('X-User-Id', 'op1');
    expect(issue.status).toBe(200);
    expect(issue.body.status).toBe('ISSUED');
  });

  it('출고 실적이 전혀 없는 주문은 명세서 생성 대상에서 제외된다', async () => {
    // SHIPPED 상태가 아니므로애초에 대상이 아니지만, 방어적으로도 실적 0이면 제외되는지 확인
    await uploadConfirmShip(
      app,
      [{ order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 10, unit_price: 38000, ship_due_date: '2026-11-05' }],
      '2026-11-05'
    );
    // 실적 등록을 하지 않았으므로 주문 상태가 아직 SHIP_ORDERED → invoice 대상(SHIPPED) 자체가 아님
    const gen = await request(app).post('/api/invoices/generate').send({ invoice_date: '2026-11-05' });
    expect(gen.body.invoices).toEqual([]);
  });
});
