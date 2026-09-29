import { Router } from 'express';
import * as shipOrderRepo from '../repositories/shipOrderRepository.js';
import { buildShipOrderExportWorkbook } from '../lib/shipOrderExportXlsx.js';

export function shipOrdersRouter(db) {
  const router = Router();

  // R1-F-06: 확정 주문을 기준으로 출고지시서 자동 생성
  router.post('/generate', (req, res, next) => {
    try {
      const { ship_date, customer_code, delivery_site_id, ship_method, product_code, registered_by } = req.body ?? {};
      const result = shipOrderRepo.generateShipOrders(
        db,
        { ship_date, customer_code, delivery_site_id, ship_method, product_code },
        { registered_by }
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.get('/', (req, res) => {
    res.json(shipOrderRepo.listShipOrders(db, req.query));
  });

  router.get('/:shipOrderNo', (req, res) => {
    const order = shipOrderRepo.getShipOrderWithLines(db, req.params.shipOrderNo);
    if (!order) return res.status(404).json({ error: '출고지시서를 찾을 수 없습니다' });
    res.json(order);
  });

  // R1-F-06 세부5) 현장 출력용 엑셀
  router.get('/:shipOrderNo/export', async (req, res, next) => {
    try {
      const buffer = await buildShipOrderExportWorkbook(db, req.params.shipOrderNo);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.shipOrderNo}.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (err) {
      next(err);
    }
  });

  // R1-F-06 세부4) 생성 후 수량·비고 수정 (이력 보관)
  router.put('/lines/:lineId', (req, res, next) => {
    try {
      const { changed_by, ...patch } = req.body ?? {};
      const updated = shipOrderRepo.updateShipOrderDtl(db, Number(req.params.lineId), patch, changed_by);
      if (!updated) return res.status(404).json({ error: '출고지시 라인을 찾을 수 없습니다' });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.get('/lines/:lineId/revisions', (req, res) => {
    res.json(shipOrderRepo.getShipOrderDtlRevisions(db, Number(req.params.lineId)));
  });

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return router;
}
