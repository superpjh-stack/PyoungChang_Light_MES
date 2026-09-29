export function createCustomer(db, { customer_code, name, biz_reg_no, contact_name, contact_phone, erp_customer_code }) {
  if (!customer_code || !name) {
    const err = new Error('customer_code, name은 필수입니다');
    err.status = 400;
    throw err;
  }
  const existing = db.prepare('SELECT 1 FROM customer WHERE customer_code = ?').get(customer_code);
  if (existing) {
    const err = new Error(`이미 존재하는 거래처코드입니다: ${customer_code}`);
    err.status = 409;
    throw err;
  }
  db.prepare(
    `INSERT INTO customer (customer_code, name, biz_reg_no, contact_name, contact_phone, erp_customer_code)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(customer_code, name, biz_reg_no ?? null, contact_name ?? null, contact_phone ?? null, erp_customer_code ?? null);
  return getCustomer(db, customer_code);
}

export function listCustomers(db, { missingErpMapping } = {}) {
  let sql = 'SELECT * FROM customer';
  const params = [];
  if (missingErpMapping) {
    sql += ' WHERE erp_customer_code IS NULL OR erp_customer_code = ?';
    params.push('');
  }
  sql += ' ORDER BY customer_code';
  return db.prepare(sql).all(...params);
}

export function getCustomer(db, customerCode) {
  const customer = db.prepare('SELECT * FROM customer WHERE customer_code = ?').get(customerCode);
  if (!customer) return null;
  customer.delivery_sites = listDeliverySites(db, customerCode);
  customer.prices = listCustomerPrices(db, customerCode);
  return customer;
}

export function updateCustomer(db, customerCode, patch) {
  const existing = db.prepare('SELECT * FROM customer WHERE customer_code = ?').get(customerCode);
  if (!existing) return null;

  const fields = ['name', 'biz_reg_no', 'contact_name', 'contact_phone', 'erp_customer_code'];
  const updates = [];
  const params = [];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      updates.push(`${field} = ?`);
      params.push(patch[field]);
    }
  }
  if (updates.length === 0) return getCustomer(db, customerCode);

  updates.push("updated_at = datetime('now')");
  params.push(customerCode);
  db.prepare(`UPDATE customer SET ${updates.join(', ')} WHERE customer_code = ?`).run(...params);
  return getCustomer(db, customerCode);
}

export function addDeliverySite(db, customerCode, { site_name, address, receiver_name, receiver_phone, is_default }) {
  const customer = db.prepare('SELECT 1 FROM customer WHERE customer_code = ?').get(customerCode);
  if (!customer) {
    const err = new Error(`존재하지 않는 거래처코드입니다: ${customerCode}`);
    err.status = 404;
    throw err;
  }
  const result = db
    .prepare(
      `INSERT INTO delivery_site (customer_code, site_name, address, receiver_name, receiver_phone, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(customerCode, site_name ?? null, address ?? null, receiver_name ?? null, receiver_phone ?? null, is_default ? 1 : 0);
  return db.prepare('SELECT * FROM delivery_site WHERE delivery_site_id = ?').get(result.lastInsertRowid);
}

export function listDeliverySites(db, customerCode) {
  return db.prepare('SELECT * FROM delivery_site WHERE customer_code = ? ORDER BY delivery_site_id').all(customerCode);
}

export function addCustomerPrice(db, customerCode, { product_code, unit_price, effective_from }) {
  const customer = db.prepare('SELECT 1 FROM customer WHERE customer_code = ?').get(customerCode);
  if (!customer) {
    const err = new Error(`존재하지 않는 거래처코드입니다: ${customerCode}`);
    err.status = 404;
    throw err;
  }
  const product = db.prepare('SELECT 1 FROM product WHERE product_code = ?').get(product_code);
  if (!product) {
    const err = new Error(`존재하지 않는 제품코드입니다: ${product_code}`);
    err.status = 400;
    throw err;
  }
  if (!(unit_price > 0)) {
    const err = new Error('unit_price는 0보다 커야 합니다');
    err.status = 400;
    throw err;
  }
  db.prepare(
    `INSERT INTO customer_price (customer_code, product_code, unit_price, effective_from)
     VALUES (?, ?, ?, COALESCE(?, date('now')))`
  ).run(customerCode, product_code, unit_price, effective_from ?? null);
  return listCustomerPrices(db, customerCode);
}

export function listCustomerPrices(db, customerCode) {
  return db
    .prepare('SELECT * FROM customer_price WHERE customer_code = ? ORDER BY product_code, effective_from DESC')
    .all(customerCode);
}

// 거래처별 표준 제품 기준 단가 조회 (거래명세서 생성 시 사용할 "주문단가 → 거래처단가표 → 기본단가" 우선순위의 2단계)
export function findCurrentPrice(db, customerCode, productCode, asOfDate = new Date().toISOString().slice(0, 10)) {
  return db
    .prepare(
      `SELECT * FROM customer_price
       WHERE customer_code = ? AND product_code = ? AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`
    )
    .get(customerCode, productCode, asOfDate);
}
