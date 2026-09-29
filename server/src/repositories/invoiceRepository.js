export function nextInvoiceNo(db, invoiceDateIso) {
  const prefix = `INV-${invoiceDateIso.replaceAll('-', '')}`;
  const row = db
    .prepare(`SELECT invoice_no FROM invoice_hdr WHERE invoice_no LIKE ? ORDER BY invoice_no DESC LIMIT 1`)
    .get(`${prefix}-%`);
  const nextSeq = row ? Number(row.invoice_no.split('-')[2]) + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
}

// R1-F-08 세부3) 명세서 번호 채번 + 출고지시서·주문번호 역참조. lines는 이미 금액 계산이 끝난 상태로 전달받는다.
export function createInvoice(db, { invoice_date, customer_code, lines }) {
  const invoice_no = nextInvoiceNo(db, invoice_date);
  const supply_amount = lines.reduce((sum, l) => sum + l.supply_amount, 0);
  const tax_amount = lines.reduce((sum, l) => sum + l.tax_amount, 0);
  const total_amount = supply_amount + tax_amount;

  db.prepare(
    `INSERT INTO invoice_hdr (invoice_no, invoice_date, customer_code, supply_amount, tax_amount, total_amount, status)
     VALUES (?, ?, ?, ?, ?, ?, 'DRAFT')`
  ).run(invoice_no, invoice_date, customer_code, supply_amount, tax_amount, total_amount);

  const insertLine = db.prepare(
    `INSERT INTO invoice_dtl
       (invoice_no, product_code, spec, quantity, unit, unit_price, supply_amount, tax_amount, tax_type, ship_order_no, order_no)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const line of lines) {
    insertLine.run(
      invoice_no,
      line.product_code,
      line.spec ?? null,
      line.quantity,
      line.unit ?? null,
      line.unit_price,
      line.supply_amount,
      line.tax_amount,
      line.tax_type,
      line.ship_order_no ?? null,
      line.order_no
    );
  }

  return invoice_no;
}

export function getInvoiceWithLines(db, invoiceNo) {
  const hdr = db.prepare('SELECT * FROM invoice_hdr WHERE invoice_no = ?').get(invoiceNo);
  if (!hdr) return null;
  hdr.lines = db.prepare('SELECT * FROM invoice_dtl WHERE invoice_no = ? ORDER BY id').all(invoiceNo);
  return hdr;
}

export function listInvoices(db, { customer_code, invoice_date, status, erp_send_status } = {}) {
  const conditions = [];
  const params = [];
  if (customer_code) {
    conditions.push('customer_code = ?');
    params.push(customer_code);
  }
  if (invoice_date) {
    conditions.push('invoice_date = ?');
    params.push(invoice_date);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (erp_send_status) {
    conditions.push('erp_send_status = ?');
    params.push(erp_send_status);
  }
  let sql = 'SELECT * FROM invoice_hdr';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY invoice_no DESC';
  return db.prepare(sql).all(...params);
}

// R1-F-08 세부4) 발행 확정 (DRAFT → ISSUED)
export function issueInvoice(db, invoiceNo) {
  const invoice = db.prepare('SELECT * FROM invoice_hdr WHERE invoice_no = ?').get(invoiceNo);
  if (!invoice) {
    const err = new Error('거래명세서를 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }
  if (invoice.status !== 'DRAFT') {
    const err = new Error(`DRAFT 상태의 명세서만 발행할 수 있습니다 (현재 상태: ${invoice.status})`);
    err.status = 409;
    throw err;
  }
  db.prepare(`UPDATE invoice_hdr SET status = 'ISSUED', updated_at = datetime('now') WHERE invoice_no = ?`).run(invoiceNo);
  return getInvoiceWithLines(db, invoiceNo);
}
