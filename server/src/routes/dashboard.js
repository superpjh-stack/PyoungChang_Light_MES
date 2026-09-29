import { Router } from 'express';
import { getDashboardSummary } from '../services/dashboardService.js';

export function dashboardRouter(db) {
  const router = Router();

  // R1-F-11: 주문·출고 현황 대시보드. ?date=YYYY-MM-DD로 기준일 지정 가능(테스트/조회용), 미지정 시 오늘
  router.get('/summary', (req, res) => {
    res.json(getDashboardSummary(db, { date: req.query.date }));
  });

  return router;
}
