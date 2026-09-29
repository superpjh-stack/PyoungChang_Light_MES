import { listPendingMappings } from './productMatchingService.js';
import { validateOrderForConfirm } from './orderValidationService.js';

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function sumOrderCountAndQty(db, dateFrom, dateTo) {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT o.order_no) AS order_count, COALESCE(SUM(d.quantity), 0) AS order_qty
       FROM order_hdr o
       JOIN order_dtl d ON d.order_no = o.order_no
       WHERE o.order_date BETWEEN ? AND ?`
    )
    .get(dateFrom, dateTo);
  return { orderCount: row.order_count, orderQty: row.order_qty };
}

// R1-F-11 세부3) 매핑 대기·검증 실패 건수. 검증 실패는 RECEIVED 상태(아직 확정 전) 주문 중
// validateOrderForConfirm을 통과하지 못하는(=제품 매핑이 안 끝난) 건으로 정의한다 (R1-F-05와 동일 기준).
function countValidationFailedOrders(db) {
  const receivedOrders = db.prepare(`SELECT order_no FROM order_hdr WHERE status = 'RECEIVED'`).all();
  let failed = 0;
  for (const { order_no } of receivedOrders) {
    if (!validateOrderForConfirm(db, order_no).valid) failed += 1;
  }
  return failed;
}

// R1-F-11: 주문·출고 현황 대시보드 (기획서 5.5, 요구사항정의서 R1-F-11)
// 완료 기준: 여기 나오는 수치는 각각의 목록 조회 화면(주문 목록/매핑대기함/검증 등)과 항상 일치해야 하므로,
// 별도로 집계 테이블을 두지 않고 매 호출마다 원본 데이터에서 다시 계산한다.
export function getDashboardSummary(db, { date } = {}) {
  const today = date ?? isoDate(new Date());
  const weekFrom = addDays(today, -6);

  const todayStats = sumOrderCountAndQty(db, today, today);
  const weekStats = sumOrderCountAndQty(db, weekFrom, today);

  const overdueShipments = db
    .prepare(
      `SELECT order_no, customer_code, ship_due_date, status
       FROM order_hdr
       WHERE status IN ('CONFIRMED', 'SHIP_ORDERED') AND ship_due_date < ?
       ORDER BY ship_due_date`
    )
    .all(today);

  const pendingShipmentCount = db
    .prepare(`SELECT COUNT(*) AS c FROM order_hdr WHERE status IN ('CONFIRMED', 'SHIP_ORDERED')`)
    .get().c;

  const pendingInvoiceCount = db.prepare(`SELECT COUNT(*) AS c FROM order_hdr WHERE status = 'SHIPPED'`).get().c;

  const issuedTodayCount = db
    .prepare(`SELECT COUNT(*) AS c FROM invoice_hdr WHERE invoice_date = ? AND status = 'ISSUED'`)
    .get(today).c;

  const erpCounts = { PENDING: 0, SENDING: 0, SUCCESS: 0, FAILED: 0 };
  for (const row of db.prepare(`SELECT erp_send_status, COUNT(*) AS c FROM invoice_hdr GROUP BY erp_send_status`).all()) {
    erpCounts[row.erp_send_status] = row.c;
  }

  return {
    date: today,
    today: { date: today, ...todayStats },
    week: { from: weekFrom, to: today, ...weekStats },
    shipment: {
      pendingShipmentCount,
      overdueShipmentCount: overdueShipments.length,
      overdueShipments,
    },
    invoice: {
      pendingInvoiceCount,
      issuedTodayCount,
    },
    erp: {
      pendingCount: erpCounts.PENDING,
      sendingCount: erpCounts.SENDING,
      successCount: erpCounts.SUCCESS,
      failedCount: erpCounts.FAILED,
    },
    mappingPendingCount: listPendingMappings(db).length,
    validationFailedCount: countValidationFailedOrders(db),
  };
}
