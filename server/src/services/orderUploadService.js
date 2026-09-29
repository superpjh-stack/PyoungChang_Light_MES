import { ORDER_UPLOAD_COLUMNS } from '../lib/orderUploadTemplate.js';
import { parseOrderUploadWorkbook } from '../lib/orderUploadXlsx.js';
import * as orderRepo from '../repositories/orderRepository.js';
import { matchProductName } from './productMatchingService.js';

const COLUMN_BY_KEY = Object.fromEntries(ORDER_UPLOAD_COLUMNS.map((c) => [c.key, c]));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addError(errors, key, reason) {
  errors.push({ column: COLUMN_BY_KEY[key]?.header ?? key, reason });
}

// R1-F-01 세부내용 2) 컬럼 매핑 검증(필수 컬럼 누락, 데이터 타입 오류) — R1-N-04에 따라 한글 사유로 기록
function validateRow(db, values) {
  const errors = [];

  for (const column of ORDER_UPLOAD_COLUMNS) {
    if (column.required && (values[column.key] === null || values[column.key] === undefined)) {
      addError(errors, column.key, `${column.header}은(는) 필수 입력 항목입니다`);
    }
  }

  if (!values.customer_code && !values.customer_name) {
    addError(errors, 'customer_code', '거래처코드 또는 거래처명 중 하나는 반드시 입력해야 합니다');
  }

  let customer = null;
  if (values.customer_code || values.customer_name) {
    customer = orderRepo.resolveCustomer(db, values);
    if (!customer) {
      addError(
        errors,
        'customer_code',
        `등록되지 않은 거래처입니다 (코드: ${values.customer_code ?? '-'}, 명: ${values.customer_name ?? '-'})`
      );
    }
  }

  if (values.order_date !== null && !DATE_RE.test(values.order_date)) {
    addError(errors, 'order_date', '주문일자 형식이 올바르지 않습니다 (YYYY-MM-DD)');
  }
  if (values.ship_due_date !== null && !DATE_RE.test(values.ship_due_date)) {
    addError(errors, 'ship_due_date', '출고예정일 형식이 올바르지 않습니다 (YYYY-MM-DD)');
  }
  if (
    values.order_date &&
    values.ship_due_date &&
    DATE_RE.test(values.order_date) &&
    DATE_RE.test(values.ship_due_date) &&
    values.ship_due_date < values.order_date
  ) {
    addError(errors, 'ship_due_date', '출고예정일은 주문일자보다 빠를 수 없습니다');
  }

  if (values.quantity !== null) {
    const qty = Number(values.quantity);
    if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
      addError(errors, 'quantity', '수량은 1 이상의 정수여야 합니다');
    }
  }

  if (values.unit_price !== null) {
    const price = Number(values.unit_price);
    if (!Number.isFinite(price) || price < 0) {
      addError(errors, 'unit_price', '단가는 0 이상의 숫자여야 합니다');
    }
  }

  return { errors, customer };
}

export async function previewOrderUpload(db, buffer) {
  const rawRows = await parseOrderUploadWorkbook(buffer);

  const rows = rawRows.map(({ rowNumber, values }) => {
    const { errors } = validateRow(db, values);
    return {
      rowNumber,
      values,
      valid: errors.length === 0,
      errors,
    };
  });

  return {
    totalRows: rows.length,
    validCount: rows.filter((r) => r.valid).length,
    errorCount: rows.filter((r) => !r.valid).length,
    rows,
  };
}

function groupKey(values) {
  const customerKey = values.customer_code ?? values.customer_name ?? '';
  return [customerKey, values.order_date, values.ship_due_date, values.customer_order_no ?? ''].join('|');
}

// R1-F-01 세부내용 3) 정상 행만 선택 등록 (부분 등록) — 검증을 통과한 행만 전달받는다고 가정
export function commitOrderUpload(db, validRows) {
  const groups = new Map();
  for (const row of validRows) {
    const key = groupKey(row.values);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const orders = [];
  const errors = [];

  for (const [key, groupRows] of groups) {
    try {
      const tx = db.transaction(() => {
        const first = groupRows[0].values;
        const customer = orderRepo.resolveCustomer(db, first);
        if (!customer) {
          const err = new Error(`존재하지 않는 거래처입니다: ${first.customer_code ?? first.customer_name}`);
          err.status = 400;
          throw err;
        }
        const site = orderRepo.resolveOrCreateDeliverySite(db, customer.customer_code, {
          site_name: first.delivery_site_name,
          address: first.delivery_address,
          receiver_name: first.receiver_name,
          receiver_phone: first.receiver_phone,
        });

        return orderRepo.createOrderWithLines(db, {
          order_date: first.order_date,
          customer_code: customer.customer_code,
          delivery_site_id: site?.delivery_site_id ?? null,
          delivery_address: first.delivery_address,
          receiver_name: first.receiver_name,
          receiver_phone: first.receiver_phone,
          ship_due_date: first.ship_due_date,
          ship_method: first.ship_method,
          customer_order_no: first.customer_order_no,
          note: first.note,
          // R1-F-03 2단계 자동 검증·매핑: 정확/정규화 일치 건은 즉시 표준코드로 변환, 그 외는 매핑 대기함으로
          lines: groupRows.map((r) => {
            const match = matchProductName(db, customer.customer_code, r.values.raw_product_name);
            return {
              raw_product_name: r.values.raw_product_name,
              product_code: ['EXACT', 'NORMALIZED'].includes(match.matchType) ? match.product_code : null,
              spec: r.values.spec,
              quantity: Number(r.values.quantity),
              unit: r.values.unit,
              unit_price: r.values.unit_price != null ? Number(r.values.unit_price) : null,
            };
          }),
        });
      });

      orders.push(tx());
    } catch (err) {
      errors.push({ groupKey: key, rows: groupRows.map((r) => r.rowNumber), message: err.message });
    }
  }

  return { orders, errors };
}
