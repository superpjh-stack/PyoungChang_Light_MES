import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ORDER_UPLOAD_COLUMNS } from '../src/lib/orderUploadTemplate.js';

const ROW_COUNT = 1000;
const LIMIT_MS = 5 * 60 * 1000; // R1-N-01: 5분 이내

async function buildXlsxBuffer(dataRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('주문내역서');
  sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => c.header));
  for (const row of dataRows) {
    sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => row[c.key] ?? null));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('R1-N-01 성능 — 1,000건 주문 엑셀 업로드·검증·등록 5분 이내', () => {
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

  it(
    `${ROW_COUNT}건 업로드(미리보기+커밋)가 5분 이내에 끝나고 정상 행이 누락 없이 등록된다 (측정 방법: 요구사항정의서 5장 — 실제 배포에서는 3회 평균 측정)`,
    async () => {
      const rows = Array.from({ length: ROW_COUNT }, (_, i) => ({
        order_date: '2026-11-03',
        customer_code: 'C0012',
        raw_product_name: '고랭지띄고10kg',
        quantity: 1,
        ship_due_date: '2026-11-05',
        customer_order_no: `PERF-${i}`,
      }));
      const buffer = await buildXlsxBuffer(rows);

      const start = Date.now();

      const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
      expect(preview.body.totalRows).toBe(ROW_COUNT);
      expect(preview.body.validCount).toBe(ROW_COUNT);
      expect(preview.body.errorCount).toBe(0);

      const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
      expect(commit.body.orders).toHaveLength(ROW_COUNT); // 정상 행 누락 없이 등록
      expect(commit.body.errors).toEqual([]);

      const elapsedMs = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`[R1-N-01] ${ROW_COUNT}건 업로드+검증+등록 소요시간: ${elapsedMs}ms`);

      expect(elapsedMs).toBeLessThan(LIMIT_MS);

      const all = await request(app).get('/api/orders?customer_code=C0012');
      expect(all.body).toHaveLength(ROW_COUNT);
    },
    LIMIT_MS + 30_000 // 테스트 자체의 타임아웃은 기준치보다 여유 있게
  );
});
