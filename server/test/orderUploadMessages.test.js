import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ORDER_UPLOAD_COLUMNS } from '../src/lib/orderUploadTemplate.js';

const KOREAN_RE = /[가-힣]/;
const KNOWN_HEADERS = new Set(ORDER_UPLOAD_COLUMNS.map((c) => c.header));

async function buildXlsxBuffer(dataRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('주문내역서');
  sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => c.header));
  for (const row of dataRows) {
    sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => row[c.key] ?? null));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function assertRowLevelKoreanErrors(row) {
  expect(typeof row.rowNumber).toBe('number');
  expect(row.errors.length).toBeGreaterThan(0);
  for (const error of row.errors) {
    expect(KNOWN_HEADERS.has(error.column)).toBe(true); // 컬럼명이 붙임 표준 헤더(한글)와 일치
    expect(error.reason).toMatch(KOREAN_RE); // 사유가 한글로 표시됨
  }
}

describe('R1-N-04 업로드 오류 메시지 — 행 번호·컬럼명·원인 한글 표시', () => {
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

  const cases = [
    {
      name: '필수값 누락 (제품명)',
      row: { order_date: '2026-11-03', customer_code: 'C0012', quantity: 1, ship_due_date: '2026-11-05' },
    },
    {
      name: '거래처코드/명 모두 누락',
      row: { order_date: '2026-11-03', raw_product_name: '고랭지10kg', quantity: 1, ship_due_date: '2026-11-05' },
    },
    {
      name: '존재하지 않는 거래처',
      row: { order_date: '2026-11-03', customer_code: 'C9999', raw_product_name: '고랭지10kg', quantity: 1, ship_due_date: '2026-11-05' },
    },
    {
      name: '주문일자 형식 오류',
      row: { order_date: '2026/11/03', customer_code: 'C0012', raw_product_name: '고랭지10kg', quantity: 1, ship_due_date: '2026-11-05' },
    },
    {
      name: '출고예정일이 주문일자보다 빠름',
      row: { order_date: '2026-11-05', customer_code: 'C0012', raw_product_name: '고랭지10kg', quantity: 1, ship_due_date: '2026-11-03' },
    },
    {
      name: '수량이 0 이하',
      row: { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지10kg', quantity: 0, ship_due_date: '2026-11-05' },
    },
    {
      name: '수량이 정수가 아님',
      row: { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지10kg', quantity: 1.5, ship_due_date: '2026-11-05' },
    },
    {
      name: '단가가 음수',
      row: { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지10kg', quantity: 1, unit_price: -100, ship_due_date: '2026-11-05' },
    },
  ];

  for (const { name, row } of cases) {
    it(`${name} → 행번호·컬럼명·한글사유로 표시된다`, async () => {
      const buffer = await buildXlsxBuffer([row]);
      const res = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
      expect(res.body.errorCount).toBe(1);
      assertRowLevelKoreanErrors(res.body.rows[0]);
    });
  }

  it('여러 오류 행이 섞여 있으면 각 행 번호가 정확히 매겨진다', async () => {
    const buffer = await buildXlsxBuffer([
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '정상행', quantity: 1, ship_due_date: '2026-11-05' },
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '오류행', quantity: -1, ship_due_date: '2026-11-05' },
    ]);
    const res = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    expect(res.body.rows[0]).toMatchObject({ rowNumber: 2, valid: true });
    expect(res.body.rows[1].rowNumber).toBe(3);
    assertRowLevelKoreanErrors(res.body.rows[1]);
  });
});
