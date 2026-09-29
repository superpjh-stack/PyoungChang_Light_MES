import * as invoiceRepo from '../repositories/invoiceRepository.js';
import * as customerRepo from '../repositories/customerRepository.js';
import * as productRepo from '../repositories/productRepository.js';
import * as orderRepo from '../repositories/orderRepository.js';

const VAT_RATE = 0.1; // 부가세 10% (일반 과세 기준 가정)

// R1-F-08 세부1) 단가 적용 순서: 주문 단가 → 거래처 단가표 → 기본 단가
function resolveUnitPrice(db, order, line) {
  if (line.unit_price != null) return { unit_price: line.unit_price, source: 'ORDER' };

  const customerPrice = customerRepo.findCurrentPrice(db, order.customer_code, line.product_code, order.order_date);
  if (customerPrice) return { unit_price: customerPrice.unit_price, source: 'CUSTOMER_PRICE' };

  const product = productRepo.getProduct(db, line.product_code);
  if (product?.default_price != null) return { unit_price: product.default_price, source: 'DEFAULT' };

  return null;
}

function findShipOrderNo(db, orderNo, lineNo) {
  const row = db
    .prepare(
      `SELECT so.ship_order_no
       FROM ship_order_src src
       JOIN ship_order_dtl sod ON sod.ship_order_dtl_id = src.ship_order_dtl_id
       JOIN ship_order so ON so.ship_order_no = sod.ship_order_no
       WHERE src.order_no = ? AND src.order_line_no = ?
       LIMIT 1`
    )
    .get(orderNo, lineNo);
  return row?.ship_order_no ?? null;
}

// R1-N-05: 명세서는 "주문 수량"이 아니라 실제 "출고 실적 수량"을 근거로 발급해야 주문·출고·명세서 간
// 수량이 일치한다. 지시수량 대비 실적 차이(F-07)가 있었다면 그 차이가 그대로 청구 수량에 반영된다.
// 하나의 출고지시상세(ship_order_dtl)에 여러 주문의 라인이 합산돼 있을 수 있으므로(R1-F-06 합산 생성),
// 실적은 각 주문 라인이 배분받은 비율(allocated_qty / instructed_qty)만큼 귀속시킨다.
function getActualShippedQty(db, orderNo, lineNo) {
  const allocations = db
    .prepare(
      `SELECT src.ship_order_dtl_id, src.allocated_qty, sod.instructed_qty
       FROM ship_order_src src
       JOIN ship_order_dtl sod ON sod.ship_order_dtl_id = src.ship_order_dtl_id
       WHERE src.order_no = ? AND src.order_line_no = ?`
    )
    .all(orderNo, lineNo);

  let total = 0;
  for (const alloc of allocations) {
    if (!alloc.instructed_qty) continue;
    const actualForDtl = db
      .prepare('SELECT COALESCE(SUM(actual_qty), 0) AS total FROM ship_result WHERE ship_order_dtl_id = ?')
      .get(alloc.ship_order_dtl_id).total;
    total += actualForDtl * (alloc.allocated_qty / alloc.instructed_qty);
  }
  return Math.round(total);
}

// R1-F-08 세부2) 공급가액·부가세·합계 계산, 과세/면세 구분
function calcLineAmounts(quantity, unitPrice, taxType) {
  const supply_amount = Math.round(quantity * unitPrice);
  const tax_amount = taxType === 'EXEMPT' ? 0 : Math.round(supply_amount * VAT_RATE);
  return { supply_amount, tax_amount };
}

// 생성 단위: 거래처 × 거래일자(=출고예정일 승계, 요구사항정의서 7.5). split_by_delivery_site면 납품처별로 분리.
function groupKey(order, splitByDeliverySite) {
  return splitByDeliverySite ? `${order.customer_code}|${order.delivery_site_id ?? ''}` : order.customer_code;
}

// R1-F-08 미리보기/생성 공통 계산 로직 — DB에 쓰지 않고 (거래처(×납품처)) 그룹별 라인·오류만 계산한다.
export function computeInvoiceGroups(db, { invoice_date, customer_code, split_by_delivery_site }) {
  if (!invoice_date) {
    const err = new Error('invoice_date(거래일자)는 필수입니다');
    err.status = 400;
    throw err;
  }

  const conditions = ["status = 'SHIPPED'", 'ship_due_date = ?'];
  const params = [invoice_date];
  if (customer_code) {
    conditions.push('customer_code = ?');
    params.push(customer_code);
  }
  const orders = db.prepare(`SELECT * FROM order_hdr WHERE ${conditions.join(' AND ')}`).all(...params);

  const groups = new Map(); // key -> { customer_code, delivery_site_id, lines: [], orderNos: Set }
  const excludedOrders = []; // 단가 미확정 등으로 이번 회차에서 제외된 주문

  for (const order of orders) {
    const orderLines = db.prepare('SELECT * FROM order_dtl WHERE order_no = ? ORDER BY line_no').all(order.order_no);
    const resolvedLines = [];
    let unresolved = null;

    for (const line of orderLines) {
      const actualQty = getActualShippedQty(db, order.order_no, line.line_no);
      if (actualQty <= 0) {
        unresolved = { ...line, __reason: '출고 실적이 없어 청구 수량을 확정할 수 없습니다' };
        break;
      }
      const price = resolveUnitPrice(db, order, line);
      if (!price) {
        unresolved = line;
        break;
      }
      const product = productRepo.getProduct(db, line.product_code);
      const { supply_amount, tax_amount } = calcLineAmounts(actualQty, price.unit_price, product?.tax_type ?? 'TAXABLE');
      resolvedLines.push({
        product_code: line.product_code,
        spec: line.spec ?? product?.spec ?? null,
        quantity: actualQty,
        unit: line.unit,
        unit_price: price.unit_price,
        price_source: price.source,
        supply_amount,
        tax_amount,
        tax_type: product?.tax_type ?? 'TAXABLE',
        ship_order_no: findShipOrderNo(db, order.order_no, line.line_no),
        order_no: order.order_no,
      });
    }

    if (unresolved) {
      excludedOrders.push({
        order_no: order.order_no,
        reason:
          unresolved.__reason ??
          `단가를 확정할 수 없습니다 (주문단가/거래처단가표/기본단가 모두 없음): ${unresolved.raw_product_name}`,
      });
      continue;
    }

    const key = groupKey(order, split_by_delivery_site);
    if (!groups.has(key)) {
      groups.set(key, { customer_code: order.customer_code, delivery_site_id: order.delivery_site_id, lines: [], orderNos: new Set() });
    }
    const group = groups.get(key);
    group.lines.push(...resolvedLines);
    group.orderNos.add(order.order_no);
  }

  return {
    groups: [...groups.values()].map((g) => ({ ...g, orderNos: [...g.orderNos] })),
    excludedOrders,
  };
}

export function previewInvoices(db, filters) {
  return computeInvoiceGroups(db, filters);
}

// R1-F-08 완료 기준 + R1-N-05: 실제 생성 및 거래처별 명세서 발급, 대상 주문을 INVOICED로 전이
export function generateInvoices(db, filters, { registered_by } = {}) {
  const { groups, excludedOrders } = computeInvoiceGroups(db, filters);
  if (groups.length === 0) {
    return { invoices: [], excludedOrders };
  }

  const invoices = [];
  const tx = db.transaction(() => {
    for (const group of groups) {
      const invoice_no = invoiceRepo.createInvoice(db, {
        invoice_date: filters.invoice_date,
        customer_code: group.customer_code,
        lines: group.lines,
      });
      invoices.push(invoice_no);
      for (const orderNo of group.orderNos) {
        orderRepo.changeOrderStatus(db, orderNo, 'INVOICED', registered_by);
      }
    }
  });
  tx();

  return { invoices, excludedOrders };
}

// R1-N-05: 발행 확정 전, 명세서에 청구된 수량/금액이 "현재" 출고 실적·계산과 여전히 일치하는지 재검증한다.
// (명세서 생성 이후 해당 주문 라인에 출고 실적이 추가/정정되면 청구 수량이 최신 실적과 어긋날 수 있다)
export function validateInvoiceConsistency(db, invoiceNo) {
  const invoice = invoiceRepo.getInvoiceWithLines(db, invoiceNo);
  if (!invoice) {
    const err = new Error('거래명세서를 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }

  const mismatches = [];
  for (const line of invoice.lines) {
    const orderLines = db
      .prepare('SELECT line_no FROM order_dtl WHERE order_no = ? AND product_code = ?')
      .all(line.order_no, line.product_code);
    const currentActualQty = orderLines.reduce(
      (sum, ol) => sum + getActualShippedQty(db, line.order_no, ol.line_no),
      0
    );
    if (currentActualQty !== line.quantity) {
      mismatches.push({
        order_no: line.order_no,
        product_code: line.product_code,
        invoiced_qty: line.quantity,
        current_shipped_qty: currentActualQty,
        reason: '명세서 생성 이후 출고 실적이 변경되어 청구 수량과 일치하지 않습니다',
      });
    }
  }

  const recomputedSupply = invoice.lines.reduce((sum, l) => sum + l.supply_amount, 0);
  const recomputedTax = invoice.lines.reduce((sum, l) => sum + l.tax_amount, 0);
  if (recomputedSupply !== invoice.supply_amount || recomputedTax !== invoice.tax_amount) {
    mismatches.push({
      reason: '명세서 헤더 합계가 라인 합계와 일치하지 않습니다',
      header: { supply_amount: invoice.supply_amount, tax_amount: invoice.tax_amount },
      recomputed: { supply_amount: recomputedSupply, tax_amount: recomputedTax },
    });
  }

  return { valid: mismatches.length === 0, mismatches };
}

// R1-N-05 완료 기준: 불일치 시 발행 차단
export function issueInvoiceWithValidation(db, invoiceNo) {
  const validation = validateInvoiceConsistency(db, invoiceNo);
  if (!validation.valid) {
    const err = new Error('주문·출고 실적과 청구 수량이 일치하지 않아 발행할 수 없습니다');
    err.status = 422;
    err.details = validation;
    throw err;
  }
  return invoiceRepo.issueInvoice(db, invoiceNo);
}
