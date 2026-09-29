import { Router } from 'express';
import { listPendingMappings, resolvePendingMapping } from '../services/productMatchingService.js';
import { recordAuditLog } from '../repositories/auditLogRepository.js';

export function mappingQueueRouter(db) {
  const router = Router();

  // R1-F-03 세부내용 3) 미매핑 건 화면에서 모아보기
  router.get('/', (req, res) => {
    res.json(listPendingMappings(db));
  });

  // R1-F-03 세부내용 4) 표준 제품 선택 시 별칭 자동 학습 + 해당 표기를 쓴 미매핑 주문 라인 일괄 갱신
  router.post('/resolve', (req, res, next) => {
    try {
      const { customer_code, raw_name, product_code, registered_by } = req.body ?? {};
      if (!customer_code || !raw_name || !product_code) {
        const err = new Error('customer_code, raw_name, product_code는 필수입니다');
        err.status = 400;
        throw err;
      }
      const result = resolvePendingMapping(db, { customer_code, raw_name, product_code, registered_by });
      recordAuditLog(db, {
        entity_type: 'PRODUCT_ALIAS',
        entity_id: String(result.alias.id),
        action: 'MAPPING_RESOLVE',
        user_id: req.user?.user_id ?? registered_by ?? null,
        detail: `${customer_code}:${raw_name} → ${product_code} (미매핑 ${result.updatedLines}건 갱신)`,
      });
      res.json(result);
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
