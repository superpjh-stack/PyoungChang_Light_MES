import { getSetting, setSetting } from '../repositories/settingRepository.js';
import { getInvoiceWithLines } from '../repositories/invoiceRepository.js';

const APPROVAL_AMOUNT_THRESHOLD_KEY = 'APPROVAL_AMOUNT_THRESHOLD';

export function getApprovalAmountThreshold(db) {
  const raw = getSetting(db, APPROVAL_AMOUNT_THRESHOLD_KEY, null);
  return raw === null ? null : Number(raw);
}

export function setApprovalAmountThreshold(db, amount) {
  if (amount === null) {
    setSetting(db, APPROVAL_AMOUNT_THRESHOLD_KEY, '');
    return null;
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) < 0) {
    const err = new Error('amount는 0 이상의 숫자여야 합니다');
    err.status = 400;
    throw err;
  }
  setSetting(db, APPROVAL_AMOUNT_THRESHOLD_KEY, amount);
  return Number(amount);
}

// R1-F-12 세부1) 승인 필요 여부: 거래처별 설정 또는 금액 기준(둘 중 하나라도 해당하면 승인 필요)
export function isApprovalRequired(db, invoice) {
  const customer = db.prepare('SELECT approval_required FROM customer WHERE customer_code = ?').get(invoice.customer_code);
  if (customer?.approval_required) return true;

  const threshold = getApprovalAmountThreshold(db);
  if (threshold !== null && invoice.total_amount >= threshold) return true;

  return false;
}

export function isApproved(db, invoiceNo) {
  const row = db.prepare('SELECT 1 FROM invoice_approval_log WHERE invoice_no = ? LIMIT 1').get(invoiceNo);
  return Boolean(row);
}

export function getApprovalStatus(db, invoiceNo) {
  const invoice = getInvoiceWithLines(db, invoiceNo);
  if (!invoice) {
    const err = new Error('거래명세서를 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }
  const required = isApprovalRequired(db, invoice);
  const history = db
    .prepare('SELECT * FROM invoice_approval_log WHERE invoice_no = ? ORDER BY id')
    .all(invoiceNo);
  return { invoice_no: invoiceNo, required, approved: history.length > 0, history };
}

// R1-F-12 세부2) 승인 이력 저장
export function approveInvoice(db, invoiceNo, { user_id } = {}) {
  const invoice = getInvoiceWithLines(db, invoiceNo);
  if (!invoice) {
    const err = new Error('거래명세서를 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }
  if (!isApprovalRequired(db, invoice)) {
    const err = new Error('이 명세서는 승인이 필요하지 않습니다');
    err.status = 400;
    throw err;
  }
  if (isApproved(db, invoiceNo)) {
    const err = new Error('이미 승인된 명세서입니다');
    err.status = 409;
    throw err;
  }
  db.prepare('INSERT INTO invoice_approval_log (invoice_no, user_id) VALUES (?, ?)').run(invoiceNo, user_id ?? null);
  return getApprovalStatus(db, invoiceNo);
}

// R1-F-12 완료 기준: 승인 미완료 명세서는 ERP 전송이 차단됨 — erpTransmissionService.sendToErp에서 호출
export function assertErpSendAllowed(db, invoice) {
  if (isApprovalRequired(db, invoice) && !isApproved(db, invoice.invoice_no)) {
    const err = new Error('승인이 필요한 명세서입니다. 먼저 승인 후 ERP로 전송하세요');
    err.status = 409;
    throw err;
  }
}
