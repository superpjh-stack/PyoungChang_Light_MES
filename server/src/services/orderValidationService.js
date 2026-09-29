import * as orderRepo from '../repositories/orderRepository.js';

// R1-F-05: 확정(RECEIVED → CONFIRMED) 전 정합성 검증.
// 필수값(거래처/출고예정일)·수량>0·출고예정일≥주문일은 스키마 CHECK 제약으로 등록 시점에 이미 차단되므로,
// 여기서는 DB 제약만으로는 잡을 수 없는 두 가지에 집중한다: ①제품 매핑 완료 여부 ②중복 주문 경고.
export function validateOrderForConfirm(db, orderNo) {
  const order = orderRepo.getOrderWithLines(db, orderNo);
  if (!order) {
    const err = new Error('주문을 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }

  const errors = [];
  const warnings = [];

  for (const line of order.lines) {
    if (!line.product_code) {
      errors.push({
        line_no: line.line_no,
        column: '제품명(거래처 표기)',
        reason: `표준 제품으로 매핑되지 않았습니다 (매핑 대기함에서 확정 필요): ${line.raw_product_name}`,
      });
      continue;
    }

    const duplicates = db
      .prepare(
        `SELECT DISTINCT o.order_no
         FROM order_dtl d
         JOIN order_hdr o ON o.order_no = d.order_no
         WHERE o.customer_code = ? AND d.product_code = ? AND o.order_date = ? AND o.order_no != ?`
      )
      .all(order.customer_code, line.product_code, order.order_date, orderNo);
    if (duplicates.length > 0) {
      warnings.push({
        line_no: line.line_no,
        column: '제품명(거래처 표기)',
        reason: `동일 거래처·제품·주문일자의 주문이 이미 존재합니다: ${duplicates.map((d) => d.order_no).join(', ')}`,
      });
    }
  }

  return { order_no: orderNo, valid: errors.length === 0, errors, warnings };
}

export function confirmOrder(db, orderNo) {
  const order = orderRepo.getOrderWithLines(db, orderNo);
  if (!order) {
    const err = new Error('주문을 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }
  if (order.status !== 'RECEIVED') {
    const err = new Error(`RECEIVED 상태의 주문만 확정할 수 있습니다 (현재 상태: ${order.status})`);
    err.status = 409;
    throw err;
  }

  const validation = validateOrderForConfirm(db, orderNo);
  if (!validation.valid) {
    const err = new Error('검증 실패로 확정할 수 없습니다');
    err.status = 422;
    err.details = validation;
    throw err;
  }

  db.prepare(`UPDATE order_hdr SET status = 'CONFIRMED', updated_at = datetime('now') WHERE order_no = ?`).run(orderNo);
  return { ...orderRepo.getOrderWithLines(db, orderNo), warnings: validation.warnings };
}
