import { normalizeProductName } from '../lib/normalize.js';

function assertCustomerAndProductExist(db, customerCode, productCode) {
  const customer = db.prepare('SELECT 1 FROM customer WHERE customer_code = ?').get(customerCode);
  if (!customer) {
    const err = new Error(`존재하지 않는 거래처코드입니다: ${customerCode}`);
    err.status = 400;
    throw err;
  }
  const product = db.prepare('SELECT 1 FROM product WHERE product_code = ?').get(productCode);
  if (!product) {
    const err = new Error(`존재하지 않는 제품코드입니다: ${productCode}`);
    err.status = 400;
    throw err;
  }
}

export function createAlias(db, { customer_code, raw_name, product_code, match_type, registered_by }) {
  if (!customer_code || !raw_name || !product_code) {
    const err = new Error('customer_code, raw_name, product_code는 필수입니다');
    err.status = 400;
    throw err;
  }
  assertCustomerAndProductExist(db, customer_code, product_code);

  const existing = db
    .prepare('SELECT 1 FROM product_alias WHERE customer_code = ? AND raw_name = ?')
    .get(customer_code, raw_name);
  if (existing) {
    const err = new Error(`이미 등록된 별칭입니다: ${customer_code}/${raw_name}`);
    err.status = 409;
    throw err;
  }

  db.prepare(
    `INSERT INTO product_alias (customer_code, raw_name, normalized_key, product_code, match_type, registered_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    customer_code,
    raw_name,
    normalizeProductName(raw_name),
    product_code,
    match_type ?? 'MANUAL',
    registered_by ?? null
  );
  return getAlias(db, customer_code, raw_name);
}

// 붙임 참고: 기존 엑셀 이력에서 추출한 (거래처, 원본표기, 표준코드) 묶음을 한 번에 적재
export function bulkCreateAliases(db, aliases) {
  const results = [];
  const errors = [];
  const insert = db.transaction((rows) => {
    for (const row of rows) {
      try {
        results.push(createAlias(db, row));
      } catch (err) {
        errors.push({ row, message: err.message });
      }
    }
  });
  insert(aliases);
  return { created: results, errors };
}

export function getAlias(db, customerCode, rawName) {
  return db
    .prepare('SELECT * FROM product_alias WHERE customer_code = ? AND raw_name = ?')
    .get(customerCode, rawName);
}

export function listAliases(db, { customer_code, product_code } = {}) {
  let sql = 'SELECT * FROM product_alias';
  const conditions = [];
  const params = [];
  if (customer_code) {
    conditions.push('customer_code = ?');
    params.push(customer_code);
  }
  if (product_code) {
    conditions.push('product_code = ?');
    params.push(product_code);
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY customer_code, raw_name';
  return db.prepare(sql).all(...params);
}

// 매핑 엔진(추후 작업)에서 별칭이 실제 사용될 때마다 호출 — 사용 횟수/최근 사용일 갱신
export function recordAliasUsage(db, aliasId) {
  db.prepare(
    `UPDATE product_alias SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?`
  ).run(aliasId);
  return db.prepare('SELECT * FROM product_alias WHERE id = ?').get(aliasId);
}
