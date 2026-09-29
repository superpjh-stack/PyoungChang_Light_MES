import { Router } from 'express';
import multer from 'multer';
import { buildOrderUploadTemplateWorkbook } from '../lib/orderUploadXlsx.js';
import { buildOrdersExportWorkbook } from '../lib/orderExportXlsx.js';
import { previewOrderUpload, commitOrderUpload } from '../services/orderUploadService.js';
import { validateOrderForConfirm, confirmOrder } from '../services/orderValidationService.js';
import { traceOrder, listPendingShipment, listPendingInvoice } from '../services/traceService.js';
import * as orderRepo from '../repositories/orderRepository.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export function ordersRouter(db) {
  const router = Router();

  router.get('/upload-template', async (req, res, next) => {
    try {
      const buffer = await buildOrderUploadTemplateWorkbook();
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="order_upload_template.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (err) {
      next(err);
    }
  });

  router.post('/upload/preview', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: '업로드할 파일(file)이 필요합니다' });
      }
      const result = await previewOrderUpload(db, req.file.buffer);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/upload/commit', (req, res, next) => {
    try {
      const rows = req.body?.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: '등록할 rows 배열이 필요합니다' });
      }
      const result = commitOrderUpload(db, rows);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/', (req, res) => {
    res.json(orderRepo.listOrders(db, req.query));
  });

  // R1-F-02 세부 4) 조회 결과 엑셀 다운로드 (목록과 동일한 필터 조건)
  router.get('/export', async (req, res, next) => {
    try {
      const buffer = await buildOrdersExportWorkbook(db, req.query);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="orders_export.xlsx"');
      res.send(Buffer.from(buffer));
    } catch (err) {
      next(err);
    }
  });

  // R1-F-10 세부3) 미출고/미발행 주문 목록 (/:orderNo 보다 먼저 등록해야 경로가 파라미터로 잡히지 않음)
  router.get('/pending-shipment', (req, res) => {
    res.json(listPendingShipment(db));
  });

  router.get('/pending-invoice', (req, res) => {
    res.json(listPendingInvoice(db));
  });

  router.get('/:orderNo', (req, res) => {
    const order = orderRepo.getOrderWithLines(db, req.params.orderNo);
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
    res.json(order);
  });

  // R1-F-02 세부 1) 수정 (RECEIVED 상태에서만 허용)
  router.put('/:orderNo', (req, res, next) => {
    try {
      const updated = orderRepo.updateOrder(db, req.params.orderNo, req.body ?? {});
      if (!updated) return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // R1-F-02 완료 기준: 주문 등록 후 상태 변경 이력을 화면에서 확인
  router.get('/:orderNo/status-history', (req, res) => {
    res.json(orderRepo.getStatusHistory(db, req.params.orderNo));
  });

  // R1-F-10 세부1) 주문번호 기준 하위 문서 트리 조회
  router.get('/:orderNo/trace', (req, res, next) => {
    try {
      res.json(traceOrder(db, req.params.orderNo));
    } catch (err) {
      next(err);
    }
  });

  // R1-F-05: 확정 전 정합성 검증 (행 단위 오류/경고)
  router.get('/:orderNo/validate', (req, res, next) => {
    try {
      res.json(validateOrderForConfirm(db, req.params.orderNo));
    } catch (err) {
      next(err);
    }
  });

  // R1-F-05 세부내용 3) 검증 실패 건은 확정 불가
  router.post('/:orderNo/confirm', (req, res, next) => {
    try {
      res.json(confirmOrder(db, req.params.orderNo));
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
