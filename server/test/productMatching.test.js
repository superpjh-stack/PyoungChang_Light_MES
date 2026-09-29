import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { matchProductName } from '../src/services/productMatchingService.js';
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

describe('R1-F-03(매핑엔진) 제품명 표준화 3단계 매핑', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    await request(app)
      .post('/api/products')
      .send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg', spec: '10kg' });
  });

  afterEach(() => {
    db.close();
  });

  it('1단계: 등록된 별칭과 완전히 같은 표기는 정확 일치로 즉시 변환된다', async () => {
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });

    const result = matchProductName(db, 'C0012', '고랭지띄고10kg');
    expect(result.matchType).toBe('EXACT');
    expect(result.product_code).toBe('KC-HW-10');
    expect(result.alias.use_count).toBe(1);
  });

  it('2단계: 공백·대소문자만 다른 표기는 정규화 일치로 자동 변환되고 새 별칭이 학습된다', async () => {
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });

    const result = matchProductName(db, 'C0012', '고랭지 띄고 10KG');
    expect(result.matchType).toBe('NORMALIZED');
    expect(result.product_code).toBe('KC-HW-10');

    const aliases = await request(app).get('/api/product-aliases?customer_code=C0012');
    expect(aliases.body.map((a) => a.raw_name)).toEqual(
      expect.arrayContaining(['고랭지띄고10kg', '고랭지 띄고 10KG'])
    );
  });

  it('3단계: 등록된 별칭이 없으면 유사도 기반 후보를 최대 3개까지 제시한다 (문서 예시)', () => {
    const result = matchProductName(db, 'C0012', '고랭지붙여서10kg');
    expect(result.matchType).toBe('SUGGESTED');
    expect(result.product_code).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    expect(result.candidates[0].product_code).toBe('KC-HW-10');
    expect(result.candidates[0].score).toBeGreaterThan(0.5);
  });

  it('매핑 대기함: 미매핑 주문 라인이 (거래처, 원본표기) 단위로 모인다', async () => {
    const buffer = await buildXlsxBuffer([
      {
        order_date: '2026-11-03',
        customer_code: 'C0012',
        raw_product_name: '고랭지붙여서10kg', // 별칭 없음 → 매핑 대기
        quantity: 5,
        ship_due_date: '2026-11-05',
      },
    ]);
    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });

    const queue = await request(app).get('/api/mapping-queue');
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0]).toMatchObject({ customer_code: 'C0012', raw_product_name: '고랭지붙여서10kg', line_count: 1 });
  });

  it('매핑 대기함에서 표준 제품을 확정하면 별칭이 학습되고 기존 미매핑 주문이 일괄 갱신된다', async () => {
    const buffer = await buildXlsxBuffer([
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지붙여서10kg', quantity: 5, unit_price: 38000, ship_due_date: '2026-11-05', customer_order_no: 'A' },
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지붙여서10kg', quantity: 3, unit_price: 38000, ship_due_date: '2026-11-05', customer_order_no: 'B' },
    ]);
    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
    expect(commit.body.orders).toHaveLength(2); // 서로 다른 거래처주문번호 → 2개 주문

    const resolve = await request(app).post('/api/mapping-queue/resolve').send({
      customer_code: 'C0012',
      raw_name: '고랭지붙여서10kg',
      product_code: 'KC-HW-10',
      registered_by: '담당자A',
    });
    expect(resolve.status).toBe(200);
    expect(resolve.body.updatedLines).toBe(2);

    for (const orderNo of commit.body.orders) {
      const order = await request(app).get(`/api/orders/${orderNo}`);
      expect(order.body.lines[0].product_code).toBe('KC-HW-10');
      expect(order.body.lines[0].amount).toBe(order.body.lines[0].quantity * 38000);
    }

    const queueAfter = await request(app).get('/api/mapping-queue');
    expect(queueAfter.body).toHaveLength(0);
  });

  it('업로드 시 정확/정규화 일치 건은 자동으로 표준코드가 붙어 매핑 대기함에 남지 않는다', async () => {
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });

    const buffer = await buildXlsxBuffer([
      { order_date: '2026-11-03', customer_code: 'C0012', raw_product_name: '고랭지띄고10kg', quantity: 25, ship_due_date: '2026-11-05' },
    ]);
    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });

    const order = await request(app).get(`/api/orders/${commit.body.orders[0]}`);
    expect(order.body.lines[0].product_code).toBe('KC-HW-10');

    const queue = await request(app).get('/api/mapping-queue');
    expect(queue.body).toHaveLength(0);
  });

  it('수용 기준: 동일 제품의 서로 다른 표기 5종 이상이 하나의 표준코드로 자동 변환된다', async () => {
    // 최초 1건만 수동 별칭 등록, 나머지 4종은 공백/대소문자/구두점만 다른 변형 → 2단계 정규화 일치로 자동 처리
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });

    const variants = ['고랭지띄고10kg', '고랭지 띄고 10KG', '고랭지-띄고-10kg', '  고랭지띄고 10kg  ', '고랭지_띄고_10Kg'];
    const buffer = await buildXlsxBuffer(
      variants.map((raw_product_name, i) => ({
        order_date: '2026-11-03',
        customer_code: 'C0012',
        raw_product_name,
        quantity: 1,
        ship_due_date: '2026-11-05',
        customer_order_no: `VAR-${i}`,
      }))
    );

    const preview = await request(app).post('/api/orders/upload/preview').attach('file', buffer, 'orders.xlsx');
    expect(preview.body.validCount).toBe(5);

    const commit = await request(app).post('/api/orders/upload/commit').send({ rows: preview.body.rows });
    expect(commit.body.orders).toHaveLength(5);

    for (const orderNo of commit.body.orders) {
      const order = await request(app).get(`/api/orders/${orderNo}`);
      expect(order.body.lines[0].product_code).toBe('KC-HW-10');
    }

    const queue = await request(app).get('/api/mapping-queue');
    expect(queue.body).toHaveLength(0);
  });
});
