import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, triggerBlobDownload } from '../../api/client.js';
import { ErrorNotice, LoadingState, EmptyState, formatNumber } from '../../components/common.jsx';
import { OrderStatusBadge } from '../../components/StatusBadge.jsx';

const STATUS_OPTIONS = [
  ['', '전체'],
  ['RECEIVED', '접수'],
  ['CONFIRMED', '확정'],
  ['SHIP_ORDERED', '출고지시'],
  ['SHIPPED', '출고완료'],
  ['INVOICED', '명세서발행'],
];

export default function OrderListPage() {
  const [filters, setFilters] = useState({
    customer_code: '',
    status: '',
    order_date_from: '',
    order_date_to: '',
    ship_due_date_from: '',
    ship_due_date_to: '',
    product_code: '',
  });
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    setError(null);
    api
      .get(`/orders?${params.toString()}`)
      .then(setOrders)
      .catch(setError);
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = async () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    try {
      const blob = await api.download(`/orders/export?${params.toString()}`);
      triggerBlobDownload(blob, 'orders_export.xlsx');
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>주문 목록</h1>
        <p className="page-subtitle">기간·거래처·제품·상태로 조회합니다.</p>
      </div>

      <div className="card">
        <div className="form-grid">
          <div className="form-field">
            <label>거래처코드</label>
            <input value={filters.customer_code} onChange={(e) => setFilters({ ...filters, customer_code: e.target.value })} />
          </div>
          <div className="form-field">
            <label>제품코드</label>
            <input value={filters.product_code} onChange={(e) => setFilters({ ...filters, product_code: e.target.value })} />
          </div>
          <div className="form-field">
            <label>상태</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              {STATUS_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label>주문일자(부터)</label>
            <input type="date" value={filters.order_date_from} onChange={(e) => setFilters({ ...filters, order_date_from: e.target.value })} />
          </div>
          <div className="form-field">
            <label>주문일자(까지)</label>
            <input type="date" value={filters.order_date_to} onChange={(e) => setFilters({ ...filters, order_date_to: e.target.value })} />
          </div>
          <div className="form-field">
            <label>출고예정일(부터)</label>
            <input type="date" value={filters.ship_due_date_from} onChange={(e) => setFilters({ ...filters, ship_due_date_from: e.target.value })} />
          </div>
          <div className="form-field">
            <label>출고예정일(까지)</label>
            <input type="date" value={filters.ship_due_date_to} onChange={(e) => setFilters({ ...filters, ship_due_date_to: e.target.value })} />
          </div>
        </div>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={load}>
            조회
          </button>
          <button className="btn" onClick={handleExport}>
            엑셀 다운로드
          </button>
          <span className="spacer" />
          <Link className="btn btn-primary" to="/orders/upload">
            + 주문 업로드
          </Link>
        </div>
      </div>

      <ErrorNotice error={error} />

      <div className="card">
        {!orders ? (
          <LoadingState />
        ) : orders.length === 0 ? (
          <EmptyState>조건에 맞는 주문이 없습니다.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>주문번호</th>
                  <th>주문일자</th>
                  <th>거래처</th>
                  <th>출고예정일</th>
                  <th>배송방법</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.order_no}>
                    <td>
                      <Link to={`/orders/${o.order_no}`}>{o.order_no}</Link>
                    </td>
                    <td>{o.order_date}</td>
                    <td>{o.customer_code}</td>
                    <td>{o.ship_due_date}</td>
                    <td>{o.ship_method ?? '-'}</td>
                    <td>
                      <OrderStatusBadge status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ marginTop: 8 }}>
              총 {formatNumber(orders.length)}건
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
