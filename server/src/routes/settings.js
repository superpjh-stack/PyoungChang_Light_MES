import { Router } from 'express';
import { getApprovalAmountThreshold, setApprovalAmountThreshold } from '../services/approvalService.js';
import { requireRole } from '../middleware/auth.js';

export function settingsRouter(db) {
  const router = Router();

  // R1-F-12: 금액 기준 승인 임계값 조회/설정 (설정 변경은 관리자만)
  router.get('/approval-amount-threshold', (req, res) => {
    res.json({ value: getApprovalAmountThreshold(db) });
  });

  router.put('/approval-amount-threshold', requireRole('ADMIN'), (req, res, next) => {
    try {
      const value = setApprovalAmountThreshold(db, req.body?.value ?? null);
      res.json({ value });
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
