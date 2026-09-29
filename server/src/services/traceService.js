import * as orderRepo from '../repositories/orderRepository.js';
import * as invoiceRepo from '../repositories/invoiceRepository.js';

// R1-F-10 세부1) 주문번호 기준 하위 문서 트리 조회 (주문 → 출고지시서(들) → 거래명세서(들))
export function traceOrder(db, orderNo) {
  const order = orderRepo.getOrderWithLines(db, orderNo);
  if (!order) {
    const err = new Error('주문을 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }

  const shipOrders = db
    .prepare(
      `SELECT DISTINCT so.ship_order_no, so.ship_date, so.status
       FROM ship_order_src src
       JOIN ship_order_dtl sod ON sod.ship_order_dtl_id = src.ship_order_dtl_id
       JOIN ship_order so ON so.ship_order_no = sod.ship_order_no
       WHERE src.order_no = ?
       ORDER BY so.ship_order_no`
    )
    .all(orderNo);

  const invoices = db
    .prepare(
      `SELECT DISTINCT h.invoice_no, h.invoice_date, h.status, h.erp_send_status
       FROM invoice_dtl d
       JOIN invoice_hdr h ON h.invoice_no = d.invoice_no
       WHERE d.order_no = ?
       ORDER BY h.invoice_no`
    )
    .all(orderNo);

  return {
    order_no: order.order_no,
    status: order.status,
    ship_orders: shipOrders,
    invoices,
  };
}

// R1-F-10 세부2) 거래 명세서 기준 원 주문 역추적
export function traceInvoice(db, invoiceNo) {
  const invoice = invoiceRepo.getInvoiceWithLines(db, invoiceNo);
  if (!invoice) {
    const err = new Error('거래명세서를 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }

  const orderNos = [...new Set(invoice.lines.map((l) => l.order_no))];
  const shipOrderNos = [...new Set(invoice.lines.map((l) => l.ship_order_no).filter(Boolean))];

  const orders = orderNos.map((orderNo) => {
    const order = orderRepo.getOrderWithLines(db, orderNo);
    return { order_no: orderNo, status: order?.status ?? null };
  });

  return {
    invoice_no: invoice.invoice_no,
    orders,
    ship_orders: shipOrderNos,
  };
}

// R1-F-10 세부3) 미출고 주문 목록 (확정됐지만 출고 지시/완료가 안 끝난 건)
export function listPendingShipment(db) {
  return db
    .prepare(`SELECT * FROM order_hdr WHERE status IN ('CONFIRMED', 'SHIP_ORDERED') ORDER BY ship_due_date, order_no`)
    .all();
}

// R1-F-10 세부3) 미발행 주문 목록 (출고는 완료됐지만 거래명세서가 아직 발행 전)
export function listPendingInvoice(db) {
  return db.prepare(`SELECT * FROM order_hdr WHERE status = 'SHIPPED' ORDER BY ship_due_date, order_no`).all();
}
