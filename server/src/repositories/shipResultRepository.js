import * as orderRepo from './orderRepository.js';

// R1-F-07 세부1) 지시수량 대비 실출고 수량 차이 발생 시 사유 입력
export function registerShipResult(db, { ship_order_dtl_id, actual_qty, pack_lot, diff_reason_code, registered_by }) {
  const dtl = db.prepare('SELECT * FROM ship_order_dtl WHERE ship_order_dtl_id = ?').get(ship_order_dtl_id);
  if (!dtl) {
    const err = new Error('출고지시 라인을 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }
  if (actual_qty == null || Number.isNaN(Number(actual_qty)) || Number(actual_qty) < 0) {
    const err = new Error('actual_qty는 0 이상의 숫자여야 합니다');
    err.status = 400;
    throw err;
  }
  if (Number(actual_qty) !== Number(dtl.instructed_qty) && !diff_reason_code) {
    const err = new Error('지시수량과 실출고수량이 다르면 차이 사유(diff_reason_code)가 필요합니다');
    err.status = 400;
    throw err;
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO ship_result (ship_order_dtl_id, actual_qty, pack_lot, diff_reason_code, registered_by)
       VALUES (?, ?, ?, ?, ?)`
    ).run(ship_order_dtl_id, actual_qty, pack_lot ?? null, diff_reason_code ?? null, registered_by ?? null);

    const affectedOrders = db
      .prepare('SELECT DISTINCT order_no FROM ship_order_src WHERE ship_order_dtl_id = ?')
      .all(ship_order_dtl_id)
      .map((r) => r.order_no);
    for (const orderNo of affectedOrders) {
      maybeCompleteOrderShipment(db, orderNo, registered_by);
    }
    maybeCompleteShipOrder(db, dtl.ship_order_no);
  });
  tx();

  return getShipResultsForDtl(db, ship_order_dtl_id);
}

// 해당 주문의 모든 라인이 (하나 이상의) 출고 실적을 갖게 되면 주문 상태를 '출고완료(SHIPPED)'로 자동 갱신
function maybeCompleteOrderShipment(db, orderNo, changedBy) {
  const order = db.prepare('SELECT status FROM order_hdr WHERE order_no = ?').get(orderNo);
  if (!order || order.status !== 'SHIP_ORDERED') return;

  const total = db.prepare('SELECT COUNT(*) AS c FROM order_dtl WHERE order_no = ?').get(orderNo).c;
  const resulted = db
    .prepare(
      `SELECT COUNT(DISTINCT src.order_line_no) AS c
       FROM ship_order_src src
       JOIN ship_result r ON r.ship_order_dtl_id = src.ship_order_dtl_id
       WHERE src.order_no = ?`
    )
    .get(orderNo).c;

  if (resulted >= total) {
    orderRepo.changeOrderStatus(db, orderNo, 'SHIPPED', changedBy);
  }
}

// 출고지시서의 모든 라인에 실적이 등록되면 출고지시서 상태도 갱신
function maybeCompleteShipOrder(db, shipOrderNo) {
  const totalLines = db.prepare('SELECT COUNT(*) AS c FROM ship_order_dtl WHERE ship_order_no = ?').get(shipOrderNo).c;
  const resultedLines = db
    .prepare(
      `SELECT COUNT(DISTINCT d.ship_order_dtl_id) AS c
       FROM ship_order_dtl d
       JOIN ship_result r ON r.ship_order_dtl_id = d.ship_order_dtl_id
       WHERE d.ship_order_no = ?`
    )
    .get(shipOrderNo).c;

  if (totalLines > 0 && resultedLines >= totalLines) {
    db.prepare(`UPDATE ship_order SET status = 'RESULT_REGISTERED', updated_at = datetime('now') WHERE ship_order_no = ?`).run(
      shipOrderNo
    );
  }
}

export function getShipResultsForDtl(db, shipOrderDtlId) {
  return db.prepare('SELECT * FROM ship_result WHERE ship_order_dtl_id = ? ORDER BY id').all(shipOrderDtlId);
}

// R1-F-07 완료 기준: 지시 수량과 실출고 수량 차이가 조회 화면에 표시됨
export function getShipResultSummary(db, shipOrderNo) {
  const lines = db.prepare('SELECT * FROM ship_order_dtl WHERE ship_order_no = ? ORDER BY ship_order_dtl_id').all(shipOrderNo);
  const resultStmt = db.prepare('SELECT * FROM ship_result WHERE ship_order_dtl_id = ? ORDER BY id');
  return lines.map((line) => {
    const results = resultStmt.all(line.ship_order_dtl_id);
    const totalActual = results.reduce((sum, r) => sum + r.actual_qty, 0);
    return {
      ...line,
      results,
      totalActualQty: results.length ? totalActual : null,
      diffQty: results.length ? totalActual - line.instructed_qty : null,
    };
  });
}
