import { Router } from 'express';
import { listAuditLog } from '../repositories/auditLogRepository.js';

export function auditLogRouter(db) {
  const router = Router();

  // R1-N-07 완료 기준: 감사 로그 조회
  router.get('/', (req, res) => {
    const { entity_type, entity_id, limit } = req.query;
    res.json(listAuditLog(db, { entity_type, entity_id, limit: limit ? Number(limit) : undefined }));
  });

  return router;
}
