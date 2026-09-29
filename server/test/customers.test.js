import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

describe('R1-F-04 거래처 마스터 관리', () => {
  let db;
  let app;

  beforeEach(() => {
    db = openDb(':memory:');
    app = createApp(db);
    db.prepare(
      `INSERT INTO product (product_code, name, spec, unit, tax_type) VALUES (?, ?, ?, ?, ?)`
    ).run('KC-HW-10', '고랭지 황태김치 10kg', '10kg', 'BOX', 'TAXABLE');
  });

  afterEach(() => {
    db.close();
  });

  it('거래처를 등록하고 조회할 수 있다 (ERP 코드 매핑 포함)', async () => {
    const createRes = await request(app).post('/api/customers').send({
      customer_code: 'C0012',
      name: '○○홈쇼핑',
      biz_reg_no: '123-45-67890',
      erp_customer_code: 'ERP-C0012',
    });
    expect(createRes.status).toBe(201);

    const getRes = await request(app).get('/api/customers/C0012');
    expect(getRes.status).toBe(200);
    expect(getRes.body.erp_customer_code).toBe('ERP-C0012');
    expect(getRes.body.delivery_sites).toEqual([]);
    expect(getRes.body.prices).toEqual([]);
  });

  it('필수값 누락 시 400을 반환한다', async () => {
    const res = await request(app).post('/api/customers').send({ name: '이름만 있음' });
    expect(res.status).toBe(400);
  });

  it('중복 거래처코드는 409를 반환한다', async () => {
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: 'A' });
    const res = await request(app).post('/api/customers').send({ customer_code: 'C0012', name: 'B' });
    expect(res.status).toBe(409);
  });

  it('ERP 코드 매핑이 누락된 거래처가 목록에서 식별된다 (수용 기준)', async () => {
    await request(app).post('/api/customers').send({
      customer_code: 'C0012',
      name: '○○홈쇼핑',
      erp_customer_code: 'ERP-C0012',
    });
    await request(app).post('/api/customers').send({
      customer_code: 'C0020',
      name: '△△온라인몰',
      // erp_customer_code 미입력
    });

    const all = await request(app).get('/api/customers');
    expect(all.body.map((c) => c.customer_code).sort()).toEqual(['C0012', 'C0020']);

    const missing = await request(app).get('/api/customers?missingErpMapping=true');
    expect(missing.body.map((c) => c.customer_code)).toEqual(['C0020']);
  });

  it('납품처를 복수 등록하고 조회할 수 있다', async () => {
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });

    await request(app)
      .post('/api/customers/C0012/delivery-sites')
      .send({ site_name: '본사창고', address: '서울 ...', is_default: true });
    await request(app)
      .post('/api/customers/C0012/delivery-sites')
      .send({ site_name: '물류센터', address: '강원 평창군 ...' });

    const res = await request(app).get('/api/customers/C0012/delivery-sites');
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s) => s.site_name)).toEqual(['본사창고', '물류센터']);
  });

  it('존재하지 않는 거래처에 납품처 등록 시 404를 반환한다', async () => {
    const res = await request(app).post('/api/customers/NOPE/delivery-sites').send({ site_name: 'x' });
    expect(res.status).toBe(404);
  });

  it('거래처별 기준 단가를 등록·조회할 수 있다', async () => {
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });

    const res = await request(app)
      .post('/api/customers/C0012/prices')
      .send({ product_code: 'KC-HW-10', unit_price: 38000 });
    expect(res.status).toBe(201);
    expect(res.body[0]).toMatchObject({ product_code: 'KC-HW-10', unit_price: 38000 });

    const list = await request(app).get('/api/customers/C0012/prices');
    expect(list.body).toHaveLength(1);
  });

  it('존재하지 않는 제품코드로 단가 등록 시 400을 반환한다', async () => {
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    const res = await request(app)
      .post('/api/customers/C0012/prices')
      .send({ product_code: 'NOPE', unit_price: 1000 });
    expect(res.status).toBe(400);
  });

  it('거래처 정보를 수정할 수 있다 (ERP 코드 매핑 보완 포함)', async () => {
    await request(app).post('/api/customers').send({ customer_code: 'C0012', name: '○○홈쇼핑' });
    const res = await request(app)
      .put('/api/customers/C0012')
      .send({ erp_customer_code: 'ERP-C0012', contact_name: '김담당' });
    expect(res.status).toBe(200);
    expect(res.body.erp_customer_code).toBe('ERP-C0012');
    expect(res.body.contact_name).toBe('김담당');

    const missing = await request(app).get('/api/customers?missingErpMapping=true');
    expect(missing.body).toEqual([]);
  });
});
