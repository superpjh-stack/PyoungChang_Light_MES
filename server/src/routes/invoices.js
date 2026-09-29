import { Router } from 'express';
import * as invoiceRepo from '../repositories/invoiceRepository.js';
import { previewInvoices, generateInvoices } from '../services/invoiceService.js';
import { buildInvoiceExportWorkbook } from '../lib/invoiceExportXlsx.js';

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

  // R1-F-08 발행 절차 3) 발행 확정 (DRAFT → ISSUED). ERP 전송은 R1-F-09에서
  router.post('/:invoiceNo/issue', (req, res, next) => {
    try {
      res.json(invoiceRepo.issueInvoice(db, req.params.invoiceNo));
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
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return router;
}
