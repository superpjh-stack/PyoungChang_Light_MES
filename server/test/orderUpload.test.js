import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ORDER_UPLOAD_COLUMNS } from '../src/lib/orderUploadTemplate.js';
import { buildOrderUploadTemplateWorkbook } from '../src/lib/orderUploadXlsx.js';

async function buildXlsxBuffer(dataRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('주문내역서');
  sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => c.header));
  for (const row of dataRows) {
    sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => row[c.key] ?? null));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('R1-F-01 주문 내역서 엑셀 업로드', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
  });

  afterEach(() => {
    db.close();
  });

  it('표준 업로드 템플릿을 다운로드할 수 있다', async () => {
    const res = await request(app).get('/api/orders/upload-template');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('order_upload_template.xlsx');
  });

  it('템플릿 워크북의 헤더가 붙임 컬럼 정의와 일치한다', async () => {
    const buffer = await buildOrderUploadTemplateWorkbook();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const headerRow = workbook.worksheets[0].getRow(1).values.slice(1);
    expect(headerRow).toEqual(ORDER_UPLOAD_COLUMNS.map((c) => c.header));
  });

  it('미리보기에서 정상 행/오류 행을 행 번호·컬럼명·한글 사유로 구분해 보여준다', async () => {
    const buffer = await buildXlsxBuffer([
      {
        order_date: '2026-11-03',
        customer_code: 'C0012',
        raw_product_name: '고랭지띄고10kg',
        quantity: 25,
        ship_due_date: '2026-11-05',
      },
      {
        // 수량 오류(0), 출고예정일 누락
        order_date: '2026-11-03',
        customer_code: 'C0012',
        raw_product_name: '배추김치5kg',
        quantity: 0,
      },
      {
        // 존재하지 않는 거래처
        order_date: '2026-11-03',
        customer_code: 'C9999',
        raw_product_name: '무언가',
        quantity: 5,
        ship_due_date: '2026-11-05',
      },
    ]);

    const res = await request(app)
      .post('/api/orders/upload/preview')
      .attach('file', buffer, 'orders.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(3);
    expect(res.body.validCount).toBe(1);
    expect(res.body.errorCount).toBe(2);

    const row2 = res.body.rows.find((r) => r.rowNumber === 3); // 헤더=1행, 첫 데이터=2행
    expect(row2.valid).toBe(false);
    expect(row2.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ column: '수량', reason: expect.stringContaining('1 이상의 정수') }),
        expect.objectContaining({ column: '출고예정일', reason: expect.stringContaining('필수') }),
      ])
    );

    const row3 = res.body.rows.find((r) => r.rowNumber === 4);
    expect(row3.valid).toBe(false);
    expect(row3.errors[0].reason).toContain('등록되지 않은 거래처');
  });

  it('정상 행만 선택 등록하면 주문이 누락 없이 생성된다 (부분 등록, 수용 기준)', async () => {
    const buffer = await buildXlsxBuffer([
      {
        order_date: '2026-11-03',
        customer_code: 'C0012',
        raw_product_name: '고랭지띄고10kg',
        quantity: 25,
        ship_due_date: '2026-11-05',
      },
      {
        order_date: '2026-11-03',
        customer_code: 'C0012',
        raw_product_name: '배추김치5kg',
        quantity: 0, // 오류 행 → 커밋 대상에서 제외
        ship_due_date: '2026-11-05',
      },
    ]);

    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    const validRows = preview.body.rows.filter((r) => r.valid);
    expect(validRows).toHaveLength(1);

    const commit = await request(app).post('/api/orders/upload/commit').send({ rows: validRows });
    expect(commit.status).toBe(201);
    expect(commit.body.orders).toHaveLength(1);
    expect(commit.body.errors).toEqual([]);

    const order = await request(app).get(`/api/orders/${commit.body.orders[0]}`);
    expect(order.body.lines).toHaveLength(1);
    expect(order.body.lines[0].raw_product_name).toBe('고랭지띄고10kg');
    expect(order.body.status).toBe('RECEIVED');
  });

  it('동일 거래처·주문일·출고예정일의 여러 제품 행은 하나의 주문으로 묶여 라인으로 등록된다', async () => {
    const buffer = await buildXlsxBuffer([
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 25, ship_due_date: '2026-11-05' },
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '배추김치5kg', quantity: 10, ship_due_date: '2026-11-05' },
    ]);

    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    const commit = await request(app)
      .post('/api/orders/upload/commit')
      .send({ rows: preview.body.rows.filter((r) => r.valid) });

    expect(commit.body.orders).toHaveLength(1);
    const order = await request(app).get(`/api/orders/${commit.body.orders[0]}`);
    expect(order.body.lines).toHaveLength(2);
  });

  it('대량 업로드(100건) 시 정상 행이 누락 없이 등록된다', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      order_date: '2026-11-03',
      customer_code: 'C0012',
      raw_product_name: `테스트제품${i}`,
      quantity: 1,
      ship_due_date: '2026-11-05',
      customer_order_no: `ORD-${i}`, // 행마다 다른 주문번호 → 100개의 개별 주문으로 생성
    }));
    const buffer = await buildXlsxBuffer(rows);

    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    expect(preview.body.validCount).toBe(100);
    expect(preview.body.errorCount).toBe(0);

    const commit = await request(app)
      .post('/api/orders/upload/commit')
      .send({ rows: preview.body.rows });

    expect(commit.body.orders).toHaveLength(100);
    expect(commit.body.errors).toEqual([]);

    const all = await request(app).get('/api/orders?customer_code=C0012');
    expect(all.body).toHaveLength(100);
  });

  it('빈 파일(데이터 행 없음)은 총 0건으로 처리된다', async () => {
    const buffer = await buildXlsxBuffer([]);
    const res = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    expect(res.body.totalRows).toBe(0);
  });
});
