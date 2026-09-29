export function resolveCustomer(db, { customer_code, customer_name }) {
  if (customer_code) {
    return db.prepare('SELECT * FROM customer WHERE customer_code = ?').get(customer_code) ?? null;
  }
  if (customer_name) {
    return db.prepare('SELECT * FROM customer WHERE name = ?').get(customer_name) ?? null;
  }
  return null;
}

export function resolveDeliverySite(db, customerCode, siteName) {
  if (!siteName) return null;
  const existing = db
    .prepare('SELECT * FROM delivery_site WHERE customer_code = ? AND site_name = ?')
    .get(customerCode, siteName);
  return existing ?? null;
}

// 납품처명이 기존 마스터에 없으면 새로 생성 (주문 업로드 시 즉석 등록 허용 — 확인 필요 절 참고)
export function resolveOrCreateDeliverySite(db, customerCode, { site_name, address, receiver_name, receiver_phone }) {
  if (!site_name) return null;
  const existing = resolveDeliverySite(db, customerCode, site_name);
  if (existing) return existing;
  const result = db
    .prepare(
      `INSERT INTO delivery_site (customer_code, site_name, address, receiver_name, receiver_phone)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(customerCode, site_name, address ?? null, receiver_name ?? null, receiver_phone ?? null);
  return db.prepare('SELECT * FROM delivery_site WHERE delivery_site_id = ?').get(result.lastInsertRowid);
}

// 채번 규칙: 주문일자(YYYYMMDD) + 4자리 일련번호 (R1-F-02 세부 내용)
export function nextOrderNo(db, orderDateIso) {
  const prefix = orderDateIso.replaceAll('-', '');
  const row = db
    .prepare(
      `SELECT order_no FROM order_hdr WHERE order_no LIKE ? ORDER BY order_no DESC LIMIT 1`
    )
    .get(`${prefix}-%`);
  const nextSeq = row ? Number(row.order_no.split('-')[1]) + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
}

export function createOrderWithLines(db, order) {
  const {
    order_date,
    customer_code,
    delivery_site_id,
    delivery_address,
    receiver_name,
    receiver_phone,
    ship_due_date,
    ship_method,
    customer_order_no,
    note,
    lines,
  } = order;

  const order_no = nextOrderNo(db, order_date);

  db.prepare(
    `INSERT INTO order_hdr
       (order_no, order_date, customer_code, delivery_site_id, delivery_address, receiver_name,
        receiver_phone, ship_due_date, ship_method, customer_order_no, note, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED')`
  ).run(
    order_no,
    order_date,
    customer_code,
    delivery_site_id ?? null,
    delivery_address ?? null,
    receiver_name ?? null,
    receiver_phone ?? null,
    ship_due_date,
    ship_method ?? null,
    customer_order_no ?? null,
    note ?? null
  );

  const insertLine = db.prepare(
    `INSERT INTO order_dtl (order_no, line_no, raw_product_name, product_code, spec, quantity, unit, unit_price, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  lines.forEach((line, idx) => {
    const amount = line.unit_price != null ? line.quantity * line.unit_price : null;
    insertLine.run(
      order_no,
      idx + 1,
      line.raw_product_name,
      line.product_code ?? null,
      line.spec ?? null,
      line.quantity,
      line.unit ?? null,
      line.unit_price ?? null,
      amount
    );
  });

  return order_no;
}

export function getOrderWithLines(db, orderNo) {
  const hdr = db.prepare('SELECT * FROM order_hdr WHERE order_no = ?').get(orderNo);
  if (!hdr) return null;
  hdr.lines = db
    .prepare('SELECT * FROM order_dtl WHERE order_no = ? ORDER BY line_no')
    .all(orderNo);
  return hdr;
}

export function listOrders(db, { customer_code, status, order_date_from, order_date_to } = {}) {
  let sql = 'SELECT * FROM order_hdr';
  const conditions = [];
  const params = [];
  if (customer_code) {
    conditions.push('customer_code = ?');
    params.push(customer_code);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (order_date_from) {
    conditions.push('order_date >= ?');
    params.push(order_date_from);
  }
  if (order_date_to) {
    conditions.push('order_date <= ?');
    params.push(order_date_to);
  }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY order_no DESC';
  return db.prepare(sql).all(...params);
}
