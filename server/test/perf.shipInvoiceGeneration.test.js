import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { ORDER_UPLOAD_COLUMNS } from '../src/lib/orderUploadTemplate.js';

const ORDER_COUNT = 400;
const CUSTOMER_COUNT = 20; // 실제 다채널 유통(홈쇼핑/온라인/도매)을 흉내 — 400건이 소수 거래처에 몰리지 않게 분산
const PRODUCT_COUNT = 10;
const SHIP_DATE = '2026-11-05';
const LIMIT_MS = 30 * 1000; // R1-N-02: 30초 이내

async function buildXlsxBuffer(dataRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('주문내역서');
  sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => c.header));
  for (const row of dataRows) {
    sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => row[c.key] ?? null));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('R1-N-02 성능 — 400건 기준 출고지시서·거래명세서 생성 30초 이내', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);

    for (let c = 0; c < CUSTOMER_COUNT; c += 1) {
      await request(app)
        .post('/api/customers')
        .send({ customer_code: `C${String(c).padStart(4, '0')}`, name: `거래처${c}`, erp_customer_code: `ERP-C${c}` });
    }
    for (let p = 0; p < PRODUCT_COUNT; p += 1) {
      await request(app)
        .post('/api/products')
        .send({ product_code: `P${String(p).padStart(3, '0')}`, name: `제품${p}`, erp_item_code: `ERP-P${p}` });
    }
    for (let c = 0; c < CUSTOMER_COUNT; c += 1) {
      for (let p = 0; p < PRODUCT_COUNT; p += 1) {
        await request(app).post('/api/product-aliases').send({
          customer_code: `C${String(c).padStart(4, '0')}`,
          raw_name: `제품${p}-거래처표기`,
          product_code: `P${String(p).padStart(3, '0')}`,
        });
      }
    }
  }, 60_000);

  afterEach(() => {
    db.close();
  });

  it(
    `일 ${ORDER_COUNT}건 확정 주문 기준 출고지시서·거래명세서 생성이 30초 이내에 끝난다 (측정 방법: 요구사항정의서 5장)`,
    async () => {
      const rows = Array.from({ length: ORDER_COUNT }, (_, i) => {
        const c = i % CUSTOMER_COUNT;
        const p = i % PRODUCT_COUNT;
        return {
          order_date: '2026-11-03',
          customer_code: `C${String(c).padStart(4, '0')}`,
          raw_product_name: `제품${p}-거래처표기`,
          quantity: 1,
          unit_price: 10000,
          ship_due_date: SHIP_DATE,
          customer_order_no: `PERF-${i}`,
        };
      });
      const buffer = await buildXlsxBuffer(rows);

      // 업로드·확정은 R1-N-01(업로드 성능)의 범위이므로 여기서는 시간 측정 대상에서 제외 (셋업)
      const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
      expect(preview.body.validCount).toBe(ORDER_COUNT);
      const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
      expect(commit.body.orders).toHaveLength(ORDER_COUNT);
      for (const orderNo of commit.body.orders) {
        const res = await request(app).post(`/api/orders/${orderNo}/confirm`);
        expect(res.status).toBe(200);
      }

      // ── 측정 구간 1: 출고 지시서 생성 ──────────────────────────
      const shipStart = Date.now();
      const shipGen = await request(app).post('/api/ship-orders/generate').send({ ship_date: SHIP_DATE });
      const shipElapsedMs = Date.now() - shipStart;
      expect(shipGen.body.sourceOrderCount).toBe(ORDER_COUNT); // 확정 주문 전체가 누락 없이 반영

      // 명세서 생성을 위한 출고 실적 등록 (F-07 범위, 측정 대상 아님 — 셋업)
      for (const shipOrderNo of shipGen.body.shipOrders) {
        const shipOrder = await request(app).get(`/api/ship-orders/${shipOrderNo}`);
        for (const line of shipOrder.body.lines) {
          await request(app)
            .post(`/api/ship-orders/lines/${line.ship_order_dtl_id}/results`)
            .send({ actual_qty: line.instructed_qty });
        }
      }

      // ── 측정 구간 2: 거래명세서 생성 ────────────────────────────
      const invoiceStart = Date.now();
      const invoiceGen = await request(app).post('/api/invoices/generate').send({ invoice_date: SHIP_DATE });
      const invoiceElapsedMs = Date.now() - invoiceStart;
      expect(invoiceGen.body.excludedOrders).toEqual([]);

      const totalElapsedMs = shipElapsedMs + invoiceElapsedMs;
      // eslint-disable-next-line no-console
      console.log(
        `[R1-N-02] ${ORDER_COUNT}건 기준 출고지시서 생성 ${shipElapsedMs}ms + 거래명세서 생성 ${invoiceElapsedMs}ms = ${totalElapsedMs}ms`
      );

      expect(shipElapsedMs).toBeLessThan(LIMIT_MS);
      expect(invoiceElapsedMs).toBeLessThan(LIMIT_MS);

      // 최종 정합성: 모든 주문이 INVOICED까지 도달했는지 (누락 없음)
      const allOrders = await request(app).get('/api/orders?status=INVOICED');
      expect(allOrders.body).toHaveLength(ORDER_COUNT);
    },
    LIMIT_MS * 4 // 테스트 자체 타임아웃은 셋업 포함해 여유 있게
  );
});
