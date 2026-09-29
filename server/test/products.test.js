import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

describe('R1-F-03(마스터 부분) 표준 제품 마스터 + 별칭 관리', () => {
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

  it('표준 제품을 등록하고 조회할 수 있다', async () => {
    const createRes = await request(app).post('/api/products').send({
      product_code: 'KC-HW-10',
      name: '고랭지 황태김치 10kg',
      spec: '10kg',
      unit: 'BOX',
      tax_type: 'TAXABLE',
      erp_item_code: 'ERP-ITEM-001',
    });
    expect(createRes.status).toBe(201);

    const getRes = await request(app).get('/api/products/KC-HW-10');
    expect(getRes.status).toBe(200);
    expect(getRes.body.name).toBe('고랭지 황태김치 10kg');
    expect(getRes.body.erp_item_code).toBe('ERP-ITEM-001');
  });

  it('필수값 누락/중복 코드를 각각 400/409로 거부한다', async () => {
    const missing = await request(app).post('/api/products').send({ name: '이름만' });
    expect(missing.status).toBe(400);

    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: 'A' });
    const dup = await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: 'B' });
    expect(dup.status).toBe(409);
  });

  it('제품 마스터 정보를 수정할 수 있다', async () => {
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    const res = await request(app).put('/api/products/KC-HW-10').send({ erp_item_code: 'ERP-ITEM-001' });
    expect(res.status).toBe(200);
    expect(res.body.erp_item_code).toBe('ERP-ITEM-001');
  });

  it('거래처별 별칭을 등록하면 정규화 키가 자동 계산된다', async () => {
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });

    const res = await request(app).post('/api/product-aliases').send({
      customer_code: 'C0012',
      raw_name: '고랭지 띄고 10KG',
      product_code: 'KC-HW-10',
    });
    expect(res.status).toBe(201);
    expect(res.body.normalized_key).toBe('고랭지띄고10KG'.toUpperCase());
    expect(res.body.use_count).toBe(0);
    expect(res.body.last_used_at).toBeNull();
  });

  it('별칭 사용을 기록하면 사용횟수와 최근사용일이 갱신된다 (수용 기준)', async () => {
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    const created = await request(app).post('/api/product-aliases').send({
      customer_code: 'C0012',
      raw_name: '고랭지띄고10kg',
      product_code: 'KC-HW-10',
    });

    const used = await request(app).post(`/api/product-aliases/${created.body.id}/use`);
    expect(used.status).toBe(200);
    expect(used.body.use_count).toBe(1);
    expect(used.body.last_used_at).not.toBeNull();

    const list = await request(app).get('/api/product-aliases?customer_code=C0012');
    expect(list.body[0].use_count).toBe(1);
  });

  it('동일 거래처·원본표기 별칭 중복 등록은 409를 반환한다', async () => {
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    const dup = await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' });
    expect(dup.status).toBe(409);
  });

  it('존재하지 않는 거래처/제품코드로 별칭 등록 시 400을 반환한다', async () => {
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    const badCustomer = await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'NOPE', raw_name: 'x', product_code: 'KC-HW-10' });
    expect(badCustomer.status).toBe(400);

    const badProduct = await request(app)
      .post('/api/product-aliases')
      .send({ customer_code: 'C0012', raw_name: 'x', product_code: 'NOPE' });
    expect(badProduct.status).toBe(400);
  });

  it('일괄 등록으로 여러 별칭을 한 번에 적재하고, 일부 실패 건은 errors로 분리 반환한다', async () => {
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });

    const res = await request(app)
      .post('/api/product-aliases/bulk')
      .send({
        aliases: [
          { customer_code: 'C0012', raw_name: '고랭지띄고10kg', product_code: 'KC-HW-10' },
          { customer_code: 'C0012', raw_name: '고랭지붙여서10kg', product_code: 'KC-HW-10' },
          { customer_code: 'C0012', raw_name: '알수없는제품', product_code: 'NOPE' }, // 실패 케이스
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.created).toHaveLength(2);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].row.raw_name).toBe('알수없는제품');
  });

  it('별칭 목록을 거래처/제품 기준으로 필터링할 수 있다', async () => {
    await request(app).post('/api/products').send({ product_code: 'KC-HW-10', name: '고랭지 황태김치 10kg' });
    await request(app).post('/api/products').send({ product_code: 'KC-BC-05', name: '배추김치 5kg' });
    await request(app).post('/api/product-aliases').send({
      customer_code: 'C0012',
      raw_name: '고랭지띄고10kg',
      product_code: 'KC-HW-10',
    });
    await request(app).post('/api/product-aliases').send({
      customer_code: 'C0012',
      raw_name: '배추5키로',
      product_code: 'KC-BC-05',
    });

    const byProduct = await request(app).get('/api/product-aliases?product_code=KC-HW-10');
    expect(byProduct.body).toHaveLength(1);
    expect(byProduct.body[0].raw_name).toBe('고랭지띄고10kg');
  });
});
