import { Router } from 'express';
import * as invoiceRepo from '../repositories/invoiceRepository.js';
import { previewInvoices, generateInvoices, issueInvoiceWithValidation, validateInvoiceConsistency } from '../services/invoiceService.js';
import { sendToErp, confirmErpResult, retryErpTransmission, sendBatch } from '../services/erpTransmissionService.js';
import { fileImportAdapter } from '../services/erpAdapters/fileImportAdapter.js';
import { traceInvoice } from '../services/traceService.js';
import { buildInvoiceExportWorkbook } from '../lib/invoiceExportXlsx.js';
import { requireRole } from '../middleware/auth.js';
import { recordAuditLog } from '../repositories/auditLogRepository.js';

export function invoicesRouter(db) {
  const router = Router();

  // R1-F-08 발행 절차 1) 미리보기 — 저장하지 않고 계산 결과만 반환
  router.get('/preview', (req, res, next) => {
    try {
      const { invoice_date, customer_code, split_by_delivery_site } = req.query;
      res.json(previewInvoices(db, { invoice_date, customer_code, split_by_delivery_site: split_by_delivery_site === 'true' }));
    } catch (err) {
      next(err);
    }
  });

  // R1-F-08: 출고 완료(SHIPPED) 주문을 거래처×거래일자로 묶어 명세서 생성 (DRAFT)
  router.post('/generate', (req, res, next) => {
    try {
      const { invoice_date, customer_code, split_by_delivery_site, registered_by } = req.body ?? {};
      const result = generateInvoices(db, { invoice_date, customer_code, split_by_delivery_site }, { registered_by });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/', (req, res) => {
    res.json(invoiceRepo.listInvoices(db, req.query));
  });

  router.get('/:invoiceNo', (req, res) => {
    const invoice = invoiceRepo.getInvoiceWithLines(db, req.params.invoiceNo);
    if (!invoice) return res.status(404).json({ error: '거래명세서를 찾을 수 없습니다' });
    res.json(invoice);
  });

  // R1-F-08 발행 절차 3) 발행 확정 (DRAFT → ISSUED). R1-N-05: 불일치 시 차단(422)
  // R1-N-06: 명세서 발행은 운영자(OPERATOR) 이상만 가능
  router.post('/:invoiceNo/issue', requireRole('OPERATOR'), (req, res, next) => {
    try {
      const result = issueInvoiceWithValidation(db, req.params.invoiceNo);
      recordAuditLog(db, {
        entity_type: 'INVOICE',
        entity_id: req.params.invoiceNo,
        action: 'INVOICE_ISSUE',
        user_id: req.user.user_id,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // R1-F-10 세부2) 거래 명세서 기준 원 주문 역추적
  router.get('/:invoiceNo/trace', (req, res, next) => {
    try {
      res.json(traceInvoice(db, req.params.invoiceNo));
    } catch (err) {
      next(err);
    }
  });

  // R1-N-05: 발행 전 정합성 사전 확인용 (선택)
  router.get('/:invoiceNo/validate', (req, res, next) => {
    try {
      res.json(validateInvoiceConsistency(db, req.params.invoiceNo));
    } catch (err) {
      next(err);
    }
  });

  // R1-F-09: ERP Import 파일 생성 + 상태 대기→전송중. R1-N-06: 운영자 이상만 가능
  router.post('/:invoiceNo/erp/send', requireRole('OPERATOR'), (req, res, next) => {
    try {
      const { invoice, transmission } = sendToErp(db, req.params.invoiceNo);
      recordAuditLog(db, {
        entity_type: 'INVOICE',
        entity_id: req.params.invoiceNo,
        action: 'ERP_SEND',
        user_id: req.user.user_id,
        detail: transmission.filename,
      });
      res.json({ ...invoice, transmission: { filename: transmission.filename } });
    } catch (err) {
      next(err);
    }
  });

  // 전송 시 생성된 Import 파일을 다시 내려받고 싶을 때 (재확인용, 상태는 변경하지 않음)
  router.get('/:invoiceNo/erp/import-file', (req, res, next) => {
    try {
      const invoice = invoiceRepo.getInvoiceWithLines(db, req.params.invoiceNo);
      if (!invoice) return res.status(404).json({ error: '거래명세서를 찾을 수 없습니다' });
      const transmission = fileImportAdapter.prepareTransmission(db, invoice);
      res.setHeader('Content-Type', transmission.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${transmission.filename}"`);
      res.send(transmission.content);
    } catch (err) {
      next(err);
    }
  });

  // R1-F-09 세부4) ERP 반영 결과 회신 저장 (방안 C는 수동 확정). R1-N-06: 운영자 이상만 가능
  router.post('/:invoiceNo/erp/confirm', requireRole('OPERATOR'), (req, res, next) => {
    try {
      const { success, erp_invoice_no, error_message } = req.body ?? {};
      const result = confirmErpResult(db, req.params.invoiceNo, { success, erp_invoice_no, error_message });
      recordAuditLog(db, {
        entity_type: 'INVOICE',
        entity_id: req.params.invoiceNo,
        action: 'ERP_CONFIRM',
        user_id: req.user.user_id,
        detail: success ? `SUCCESS:${erp_invoice_no ?? ''}` : `FAILED:${error_message}`,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // R1-F-09 세부3) 실패 건 재전송. R1-N-06: 운영자 이상만 가능
  router.post('/:invoiceNo/erp/retry', requireRole('OPERATOR'), (req, res, next) => {
    try {
      const { invoice, transmission } = retryErpTransmission(db, req.params.invoiceNo);
      recordAuditLog(db, {
        entity_type: 'INVOICE',
        entity_id: req.params.invoiceNo,
        action: 'ERP_RETRY',
        user_id: req.user.user_id,
        detail: transmission.filename,
      });
      res.json({ ...invoice, transmission: { filename: transmission.filename } });
    } catch (err) {
      next(err);
    }
  });

  // 일 마감 일괄 전송 (대기/실패 건을 모아 재시도). R1-N-06: 운영자 이상만 가능
  router.post('/erp/send-batch', requireRole('OPERATOR'), (req, res, next) => {
    try {
      const { invoice_date } = req.body ?? {};
      if (!invoice_date) {
        return res.status(400).json({ error: 'invoice_date는 필수입니다' });
      }
      const result = sendBatch(db, invoice_date);
      recordAuditLog(db, {
        entity_type: 'INVOICE',
        entity_id: invoice_date,
        action: 'ERP_SEND_BATCH',
        user_id: req.user.user_id,
        detail: `${result.length}건`,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:invoiceNo/export', async (req, res, next) => {
    try {
      const buffer = await buildInvoiceExportWorkbook(db, req.params.invoiceNo);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.invoiceNo}.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.message, details: err.details });
  });

  return router;
}
