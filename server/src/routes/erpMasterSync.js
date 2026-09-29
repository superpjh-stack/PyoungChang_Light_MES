import { Router } from 'express';
import { importCustomers, importProducts, importCustomerPrices } from '../services/erpMasterSyncService.js';
import { requireRole } from '../middleware/auth.js';
import { recordAuditLog } from '../repositories/auditLogRepository.js';

// R1-I-01: ERP→MES 마스터 동기화 (수동 Import 스텁). 마스터 데이터 일괄 변경이라 관리자만 허용.
export function erpMasterSyncRouter(db) {
  const router = Router();

  function importRoute(path, action, importFn) {
    router.post(path, requireRole('ADMIN'), (req, res, next) => {
      try {
        const rows = Array.isArray(req.body) ? req.body : req.body?.rows;
        const result = importFn(db, rows);
        recordAuditLog(db, {
          entity_type: 'ERP_MASTER_SYNC',
          entity_id: action,
          action,
          user_id: req.user.user_id,
          detail: `생성 ${result.createdCount}건, 갱신 ${result.updatedCount}건, 오류 ${result.errors.length}건`,
        });
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    });
  }

  importRoute('/customers', 'ERP_SYNC_CUSTOMERS', importCustomers);
  importRoute('/products', 'ERP_SYNC_PRODUCTS', importProducts);
  importRoute('/customer-prices', 'ERP_SYNC_CUSTOMER_PRICES', importCustomerPrices);

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return router;
}
