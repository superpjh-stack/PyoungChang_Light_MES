import * as orderRepo from './orderRepository.js';

export function nextShipOrderNo(db, shipDateIso) {
  const prefix = `SO-${shipDateIso.replaceAll('-', '')}`;
  const row = db
    .prepare(`SELECT ship_order_no FROM ship_order WHERE ship_order_no LIKE ? ORDER BY ship_order_no DESC LIMIT 1`)
    .get(`${prefix}-%`);
  const nextSeq = row ? Number(row.ship_order_no.split('-')[2]) + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
}

// R1-F-06 세부1) 생성 기준: 출고예정일(필수) + 거래처/납품처/배송방법/제품(군) 선택 필터
// CONFIRMED 상태의 주문만 대상으로 한다 (R1-F-05에서 검증을 통과한 주문만 출고지시로 넘어가도록)
export function findEligibleOrderLines(db, { ship_date, customer_code, delivery_site_id, ship_method, product_code }) {
  if (!ship_date) {
    const err = new Error('ship_date(출고예정일)는 필수입니다');
    err.status = 400;
    throw err;
  }
  const conditions = ["o.status = 'CONFIRMED'", 'o.ship_due_date = ?'];
  const params = [ship_date];
  if (customer_code) {
    conditions.push('o.customer_code = ?');
    params.push(customer_code);
  }
  if (delivery_site_id) {
    conditions.push('o.delivery_site_id = ?');
    params.push(delivery_site_id);
  }
  if (ship_method) {
    conditions.push('o.ship_method = ?');
    params.push(ship_method);
  }
  if (product_code) {
    conditions.push('d.product_code = ?');
    params.push(product_code);
  }
  return db
    .prepare(
      `SELECT o.order_no, d.line_no, o.customer_code, o.delivery_site_id, o.ship_method,
              d.product_code, d.quantity, d.unit
       FROM order_dtl d
       JOIN order_hdr o ON o.order_no = d.order_no
       WHERE ${conditions.join(' AND ')}
       ORDER BY o.customer_code, o.delivery_site_id, d.product_code, o.order_no, d.line_no`
    )
    .all(...params);
}

function computePackedQty(db, productCode, instructedQty) {
  const product = db.prepare('SELECT pack_unit, pack_size FROM product WHERE product_code = ?').get(productCode);
  if (product?.pack_size && product.pack_size > 0) {
    return { packed_qty: instructedQty / product.pack_size, pack_unit: product.pack_unit };
  }
  return { packed_qty: instructedQty, pack_unit: null };
}

// R1-F-06 세부2,3) 동일 납품처·제품 수량 합산 + 포장단위 환산 + 채번 + 원주문 역참조
// R1-F-06 완료 기준: 대상 주문 전체가 누락 없이 반영되고 수량 합계가 일치해야 하므로,
// 거래처+납품처 단위로 출고지시서 헤더를 묶고 그 안에서 제품별로 합산한다.
export function generateShipOrders(db, filters, { registered_by } = {}) {
  const eligibleLines = findEligibleOrderLines(db, filters);
  if (eligibleLines.length === 0) {
    return { shipOrders: [], totalInstructedQty: 0, sourceOrderCount: 0 };
  }

  const groupsByHeader = new Map(); // key: customer_code|delivery_site_id -> { ship_method, products: Map(product_code -> {qty, sources[]}) }
  for (const line of eligibleLines) {
    const headerKey = `${line.customer_code}|${line.delivery_site_id ?? ''}`;
    if (!groupsByHeader.has(headerKey)) {
      groupsByHeader.set(headerKey, {
        customer_code: line.customer_code,
        delivery_site_id: line.delivery_site_id,
        ship_method: line.ship_method,
        products: new Map(),
      });
    }
    const header = groupsByHeader.get(headerKey);
    if (!header.products.has(line.product_code)) {
      header.products.set(line.product_code, { quantity: 0, sources: [] });
    }
    const productGroup = header.products.get(line.product_code);
    productGroup.quantity += line.quantity;
    productGroup.sources.push({ order_no: line.order_no, line_no: line.line_no, allocated_qty: line.quantity });
  }

  const shipOrders = [];
  let totalInstructedQty = 0;
  const touchedOrderNos = new Set();

  const tx = db.transaction(() => {
    for (const [, header] of groupsByHeader) {
      const ship_order_no = nextShipOrderNo(db, filters.ship_date);
      db.prepare(
        `INSERT INTO ship_order (ship_order_no, ship_date, customer_code, delivery_site_id, ship_method, status)
         VALUES (?, ?, ?, ?, ?, 'CREATED')`
      ).run(ship_order_no, filters.ship_date, header.customer_code, header.delivery_site_id ?? null, header.ship_method ?? null);

      const insertDtl = db.prepare(
        `INSERT INTO ship_order_dtl (ship_order_no, product_code, instructed_qty, packed_qty, pack_unit)
         VALUES (?, ?, ?, ?, ?)`
      );
      const insertSrc = db.prepare(
        `INSERT INTO ship_order_src (ship_order_dtl_id, order_no, order_line_no, allocated_qty) VALUES (?, ?, ?, ?)`
      );

      for (const [product_code, group] of header.products) {
        const { packed_qty, pack_unit } = computePackedQty(db, product_code, group.quantity);
        const result = insertDtl.run(ship_order_no, product_code, group.quantity, packed_qty, pack_unit);
        totalInstructedQty += group.quantity;
        for (const src of group.sources) {
          insertSrc.run(result.lastInsertRowid, src.order_no, src.line_no, src.allocated_qty);
          touchedOrderNos.add(src.order_no);
        }
      }

      shipOrders.push(ship_order_no);
    }

    for (const orderNo of touchedOrderNos) {
      orderRepo.changeOrderStatus(db, orderNo, 'SHIP_ORDERED', registered_by);
    }
  });
  tx();

  return { shipOrders, totalInstructedQty, sourceOrderCount: touchedOrderNos.size };
}

// 미리보기/PDF 출력용 명칭 보강 (거래처명, 납품처, 제품명 등 코드만으로는 알 수 없는 정보)
export function getShipOrderWithLines(db, shipOrderNo) {
  const hdr = db
    .prepare(
      `SELECT so.*, c.name AS customer_name
       FROM ship_order so
       JOIN customer c ON c.customer_code = so.customer_code
       WHERE so.ship_order_no = ?`
    )
    .get(shipOrderNo);
  if (!hdr) return null;

  if (hdr.delivery_site_id) {
    hdr.delivery_site = db
      .prepare('SELECT site_name, address, receiver_name, receiver_phone FROM delivery_site WHERE delivery_site_id = ?')
      .get(hdr.delivery_site_id);
  }

  const lines = db
    .prepare(
      `SELECT d.*, p.name AS product_name, p.spec AS product_spec, p.unit AS product_unit
       FROM ship_order_dtl d
       JOIN product p ON p.product_code = d.product_code
       WHERE d.ship_order_no = ?
       ORDER BY d.ship_order_dtl_id`
    )
    .all(shipOrderNo);
  const srcStmt = db.prepare('SELECT * FROM ship_order_src WHERE ship_order_dtl_id = ?');
  hdr.lines = lines.map((line) => ({ ...line, sources: srcStmt.all(line.ship_order_dtl_id) }));
  return hdr;
}

export function listShipOrders(db, { customer_code, ship_date, status } = {}) {
  const conditions = [];
  const params = [];
  if (customer_code) {
    conditions.push('customer_code = ?');
    params.push(customer_code);
  }
  if (ship_date) {
    conditions.push('ship_date = ?');
    params.push(ship_date);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  let sql = 'SELECT * FROM ship_order';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY ship_order_no DESC';
  return db.prepare(sql).all(...params);
}

const EDITABLE_SHIP_DTL_FIELDS = ['instructed_qty', 'note'];

// R1-F-06 세부4) 생성 후 수량·비고 수정 가능 (수정 이력 보관)
export function updateShipOrderDtl(db, shipOrderDtlId, patch, changedBy) {
  const existing = db.prepare('SELECT * FROM ship_order_dtl WHERE ship_order_dtl_id = ?').get(shipOrderDtlId);
  if (!existing) return null;

  const tx = db.transaction(() => {
    for (const field of EDITABLE_SHIP_DTL_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== existing[field]) {
        db.prepare(`UPDATE ship_order_dtl SET ${field} = ? WHERE ship_order_dtl_id = ?`).run(
          patch[field],
          shipOrderDtlId
        );
        db.prepare(
          `INSERT INTO ship_order_dtl_revision (ship_order_dtl_id, field, old_value, new_value, changed_by)
           VALUES (?, ?, ?, ?, ?)`
        ).run(shipOrderDtlId, field, existing[field] == null ? null : String(existing[field]), patch[field] == null ? null : String(patch[field]), changedBy ?? null);
      }
    }
  });
  tx();

  return db.prepare('SELECT * FROM ship_order_dtl WHERE ship_order_dtl_id = ?').get(shipOrderDtlId);
}

export function getShipOrderDtlRevisions(db, shipOrderDtlId) {
  return db
    .prepare('SELECT * FROM ship_order_dtl_revision WHERE ship_order_dtl_id = ? ORDER BY id')
    .all(shipOrderDtlId);
}
