const ORDER_STATUS_LABEL = {
  RECEIVED: ['접수', 'gray'],
  CONFIRMED: ['확정', 'blue'],
  SHIP_ORDERED: ['출고지시', 'yellow'],
  SHIPPED: ['출고완료', 'green'],
  INVOICED: ['명세서발행', 'green'],
  CANCELLED: ['취소', 'red'],
};

const SHIP_ORDER_STATUS_LABEL = {
  CREATED: ['생성됨', 'gray'],
  CONFIRMED: ['확정', 'blue'],
  RESULT_REGISTERED: ['실적등록완료', 'green'],
};

const INVOICE_STATUS_LABEL = {
  DRAFT: ['임시저장', 'gray'],
  APPROVED: ['승인됨', 'blue'],
  ISSUED: ['발행완료', 'green'],
};

const ERP_STATUS_LABEL = {
  PENDING: ['대기', 'gray'],
  SENDING: ['전송중', 'yellow'],
  SUCCESS: ['성공', 'green'],
  FAILED: ['실패', 'red'],
};

function Badge({ map, value }) {
  const [label, color] = map[value] ?? [value ?? '-', 'gray'];
  return <span className={`badge badge-${color}`}>{label}</span>;
}

export const OrderStatusBadge = ({ status }) => <Badge map={ORDER_STATUS_LABEL} value={status} />;
export const ShipOrderStatusBadge = ({ status }) => <Badge map={SHIP_ORDER_STATUS_LABEL} value={status} />;
export const InvoiceStatusBadge = ({ status }) => <Badge map={INVOICE_STATUS_LABEL} value={status} />;
export const ErpStatusBadge = ({ status }) => <Badge map={ERP_STATUS_LABEL} value={status} />;
