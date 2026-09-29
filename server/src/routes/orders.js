import { Router } from 'express';
import multer from 'multer';
import { buildOrderUploadTemplateWorkbook } from '../lib/orderUploadXlsx.js';
import { previewOrderUpload, commitOrderUpload } from '../services/orderUploadService.js';
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
    const { customer_code, status, order_date_from, order_date_to } = req.query;
    res.json(orderRepo.listOrders(db, { customer_code, status, order_date_from, order_date_to }));
  });

  router.get('/:orderNo', (req, res) => {
    const order = orderRepo.getOrderWithLines(db, req.params.orderNo);
    if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
    res.json(order);
  });

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return router;
}
