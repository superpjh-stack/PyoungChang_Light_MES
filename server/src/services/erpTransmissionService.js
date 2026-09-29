import { getInvoiceWithLines } from '../repositories/invoiceRepository.js';
import { fileImportAdapter } from './erpAdapters/fileImportAdapter.js';

const ACTIVE_ADAPTER = fileImportAdapter; // 방안 A(API)/B(DB View) 확정 시 이 한 줄만 교체

function requireInvoice(db, invoiceNo) {
  const invoice = getInvoiceWithLines(db, invoiceNo);
  if (!invoice) {
    const err = new Error('거래명세서를 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }
  return invoice;
}

// R1-F-09 세부1,2) 연동 방식(어댑터)으로 전송물 생성 + 상태 대기→전송중
export function sendToErp(db, invoiceNo) {
  const invoice = requireInvoice(db, invoiceNo);
  if (invoice.status !== 'ISSUED') {
    const err = new Error(`발행(ISSUED)된 명세서만 ERP로 전송할 수 있습니다 (현재 상태: ${invoice.status})`);
    err.status = 409;
    throw err;
  }
  if (invoice.erp_send_status === 'SUCCESS') {
    const err = new Error('이미 ERP 전송이 성공한 명세서입니다');
    err.status = 409;
    throw err;
  }

  const transmission = ACTIVE_ADAPTER.prepareTransmission(db, invoice);
  db.prepare(
    `UPDATE invoice_hdr SET erp_send_status = 'SENDING', erp_error_message = NULL, updated_at = datetime('now') WHERE invoice_no = ?`
  ).run(invoiceNo);

  return { invoice: getInvoiceWithLines(db, invoiceNo), transmission };
}

// R1-F-09 세부4) ERP 반영 결과 회신을 MES에 저장 (방안 C는 자동 회신이 없어 담당자가 수동 확정)
export function confirmErpResult(db, invoiceNo, { success, erp_invoice_no, error_message }) {
  const invoice = requireInvoice(db, invoiceNo);
  if (invoice.erp_send_status !== 'SENDING') {
    const err = new Error(`전송중 상태의 명세서만 결과를 확정할 수 있습니다 (현재 상태: ${invoice.erp_send_status})`);
    err.status = 409;
    throw err;
  }

  if (success) {
    db.prepare(
      `UPDATE invoice_hdr SET erp_send_status = 'SUCCESS', erp_invoice_no = ?, erp_error_message = NULL, updated_at = datetime('now') WHERE invoice_no = ?`
    ).run(erp_invoice_no ?? null, invoiceNo);
  } else {
    if (!error_message) {
      const err = new Error('실패 처리 시 error_message가 필요합니다');
      err.status = 400;
      throw err;
    }
    db.prepare(
      `UPDATE invoice_hdr SET erp_send_status = 'FAILED', erp_error_message = ?, updated_at = datetime('now') WHERE invoice_no = ?`
    ).run(error_message, invoiceNo);
  }

  return getInvoiceWithLines(db, invoiceNo);
}

// R1-F-09 세부3) 실패 건 재전송
export function retryErpTransmission(db, invoiceNo) {
  const invoice = requireInvoice(db, invoiceNo);
  if (invoice.erp_send_status !== 'FAILED') {
    const err = new Error(`전송 실패 상태의 명세서만 재전송할 수 있습니다 (현재 상태: ${invoice.erp_send_status})`);
    err.status = 409;
    throw err;
  }
  return sendToErp(db, invoiceNo);
}

// R1-N-08과 연계: 일 마감 일괄 전송 — 발행되었지만 아직 전송(PENDING) 또는 실패(FAILED)한 건을 모아 재시도
export function sendBatch(db, invoiceDate) {
  const targets = db
    .prepare(
      `SELECT invoice_no FROM invoice_hdr
       WHERE invoice_date = ? AND status = 'ISSUED' AND erp_send_status IN ('PENDING', 'FAILED')`
    )
    .all(invoiceDate);

  const results = [];
  for (const { invoice_no } of targets) {
    try {
      const { invoice, transmission } = sendToErp(db, invoice_no);
      results.push({ invoice_no, filename: transmission.filename, status: invoice.erp_send_status });
    } catch (err) {
      results.push({ invoice_no, error: err.message });
    }
  }
  return results;
}
