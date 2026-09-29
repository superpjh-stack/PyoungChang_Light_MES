import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

describe('R1-I-01 ERP→MES 거래처/제품/단가 마스터 동기화 (수동 Import 스텁)', () => {
  let db;
  let app;

  beforeEach(async () => {
    db = openDb(':memory:');
    app = createApp(db);
    await request(app).post('/api/users').send({ user_id: 'admin1', name: '관리자', role: 'ADMIN' });
    await request(app).post('/api/users').send({ user_id: 'op1', name: '운영자', role: 'OPERATOR' });
  });

  afterEach(() => {
    db.close();
  });

  it('인증 없이/운영자 권한으로는 동기화를 실행할 수 없다 (관리자 전용)', async () => {
    const noAuth = await request(app).post('/api/erp-sync/customers').send({ rows: [{ customer_code: 'C0001', name: 'X' }] });
    expect(noAuth.status).toBe(401);

    const operator = await request(app)
      .post('/api/erp-sync/customers')
      .set('X-User-Id', 'op1')
      .send({ rows: [{ customer_code: 'C0001', name: 'X' }] });
    expect(operator.status).toBe(403);
  });

  it('거래처를 신규 생성하고, 재수신 시 기존 값을 갱신한다', async () => {
    const create = await request(app)
      .post('/api/erp-sync/customers')
      .set('X-User-Id', 'admin1')
      .send({
        rows: [
          { customer_code: 'C0001', name: '○○홈쇼핑', erp_customer_code: 'ERP-C0001' },
          { customer_code: 'C0002', name: '△△온라인몰', erp_customer_code: 'ERP-C0002' },
        ],
      });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ createdCount: 2, updatedCount: 0, errors: [] });

    const update = await request(app)
      .post('/api/erp-sync/customers')
      .set('X-User-Id', 'admin1')
      .send({ rows: [{ customer_code: 'C0001', name: '○○홈쇼핑(상호변경)', erp_customer_code: 'ERP-C0001' }] });
    expect(update.body).toMatchObject({ createdCount: 0, updatedCount: 1, errors: [] });

    const customer = await request(app).get('/api/customers/C0001');
    expect(customer.body.name).toBe('○○홈쇼핑(상호변경)');
  });

  it('일부 행이 잘못돼도(필수값 누락) 나머지는 정상 처리되고 오류만 별도로 보고된다', async () => {
    const res = await request(app)
      .post('/api/erp-sync/customers')
      .set('X-User-Id', 'admin1')
      .send({
        rows: [
          { customer_code: 'C0001', name: '정상거래처' },
          { customer_code: 'C0002' }, // name 누락
        ],
      });
    expect(res.body.createdCount).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].message).toContain('필수');

    const list = await request(app).get('/api/customers');
    expect(list.body.map((c) => c.customer_code)).toEqual(['C0001']);
  });

  it('제품 마스터를 동기화한다', async () => {
    const res = await request(app)
      .post('/api/erp-sync/products')
      .set('X-User-Id', 'admin1')
      .send({ rows: [{ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg', erp_item_code: 'ERP-ITEM-001' }] });
    expect(res.body).toMatchObject({ createdCount: 1, updatedCount: 0, errors: [] });

    const product = await request(app).get('/api/products/KC-HW-10');
    expect(product.body.erp_item_code).toBe('ERP-ITEM-001');
  });

  it('단가를 동기화하고, 같은 거래처·제품·적용일로 재수신하면 값만 갱신된다(중복 생성 안 됨)', async () => {
    await request(app).post('/api/erp-sync/customers').set('X-User-Id', 'admin1').send({ rows: [{ customer_code: 'C0001', name: 'X' }] });
    await request(app).post('/api/erp-sync/products').set('X-User-Id', 'admin1').send({ rows: [{ product_code: 'KC-HW-10', name: 'Y' }] });

    const first = await request(app)
      .post('/api/erp-sync/customer-prices')
      .set('X-User-Id', 'admin1')
      .send({ rows: [{ customer_code: 'C0001', product_code: 'KC-HW-10', unit_price: 38000, effective_from: '2026-11-01' }] });
    expect(first.body).toMatchObject({ createdCount: 1, updatedCount: 0 });

    const second = await request(app)
      .post('/api/erp-sync/customer-prices')
      .set('X-User-Id', 'admin1')
      .send({ rows: [{ customer_code: 'C0001', product_code: 'KC-HW-10', unit_price: 39000, effective_from: '2026-11-01' }] });
    expect(second.body).toMatchObject({ createdCount: 0, updatedCount: 1 });

    const prices = await request(app).get('/api/customers/C0001/prices');
    expect(prices.body).toHaveLength(1); // 중복 생성되지 않음
    expect(prices.body[0].unit_price).toBe(39000);
  });

  it('동기화 실행 시 감사 로그가 기록된다', async () => {
    await request(app)
      .post('/api/erp-sync/customers')
      .set('X-User-Id', 'admin1')
      .send({ rows: [{ customer_code: 'C0001', name: 'X' }] });

    const log = await request(app).get('/api/audit-log?entity_type=ERP_MASTER_SYNC');
    expect(log.body[0]).toMatchObject({ action: 'ERP_SYNC_CUSTOMERS', user_id: 'admin1' });
    expect(log.body[0].detail).toContain('생성 1건');
  });

  it('rows가 비어있거나 배열이 아니면 400을 반환한다', async () => {
    const res = await request(app).post('/api/erp-sync/customers').set('X-User-Id', 'admin1').send({ rows: [] });
    expect(res.status).toBe(400);
  });
});
