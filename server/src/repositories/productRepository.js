export function createProduct(db, { product_code, name, spec, unit, tax_type, erp_item_code }) {
  if (!product_code || !name) {
    const err = new Error('product_code, name은 필수입니다');
    err.status = 400;
    throw err;
  }
  const existing = db.prepare('SELECT 1 FROM product WHERE product_code = ?').get(product_code);
  if (existing) {
    const err = new Error(`이미 존재하는 제품코드입니다: ${product_code}`);
    err.status = 409;
    throw err;
  }
  db.prepare(
    `INSERT INTO product (product_code, name, spec, unit, tax_type, erp_item_code)
     VALUES (?, ?, ?, ?, COALESCE(?, 'TAXABLE'), ?)`
  ).run(product_code, name, spec ?? null, unit ?? 'EA', tax_type ?? null, erp_item_code ?? null);
  return getProduct(db, product_code);
}

export function listProducts(db) {
  return db.prepare('SELECT * FROM product ORDER BY product_code').all();
}

export function getProduct(db, productCode) {
  return db.prepare('SELECT * FROM product WHERE product_code = ?').get(productCode) ?? null;
}

export function updateProduct(db, productCode, patch) {
  const existing = getProduct(db, productCode);
  if (!existing) return null;

  const fields = ['name', 'spec', 'unit', 'tax_type', 'erp_item_code'];
  const updates = [];
  const params = [];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      updates.push(`${field} = ?`);
      params.push(patch[field]);
    }
  }
  if (updates.length === 0) return existing;

  updates.push("updated_at = datetime('now')");
  params.push(productCode);
  db.prepare(`UPDATE product SET ${updates.join(', ')} WHERE product_code = ?`).run(...params);
  return getProduct(db, productCode);
}
