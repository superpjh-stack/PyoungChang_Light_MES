import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, EmptyState, Notice } from '../../components/common.jsx';
import { ShipOrderStatusBadge } from '../../components/StatusBadge.jsx';
import { useUser } from '../../context/UserContext.jsx';

export default function ShipOrderListPage() {
  const { currentUserId } = useUser();
  const [filters, setFilters] = useState({ customer_code: '', ship_date: '', status: '' });
  const [shipOrders, setShipOrders] = useState(null);
  const [error, setError] = useState(null);
  const [genDate, setGenDate] = useState('');
  const [genCustomer, setGenCustomer] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    setError(null);
    api
      .get(`/ship-orders?${params.toString()}`)
      .then(setShipOrders)
      .catch(setError);
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = async () => {
    if (!genDate) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.post('/ship-orders/generate', {
        ship_date: genDate,
        customer_code: genCustomer || undefined,
        registered_by: currentUserId || undefined,
      });
      if (result.shipOrders.length === 0) {
        setNotice({ type: 'info', text: '해당 조건의 확정 주문이 없습니다.' });
      } else {
        setNotice({
          type: 'success',
          text: `출고지시서 ${result.shipOrders.length}건 생성 (원 주문 ${result.sourceOrderCount}건, 총 수량 ${result.totalInstructedQty})`,
        });
      }
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>출고 지시서</h1>
        <p className="page-subtitle">확정된 주문을 출고예정일 기준으로 모아 출고지시서를 생성합니다.</p>
      </div>

      <div className="card">
        <div className="card-title">출고지시서 생성</div>
        <div className="form-grid">
          <div className="form-field">
            <label>출고예정일 (필수)</label>
            <input type="date" value={genDate} onChange={(e) => setGenDate(e.target.value)} />
          </div>
          <div className="form-field">
            <label>거래처코드 (선택)</label>
            <input value={genCustomer} onChange={(e) => setGenCustomer(e.target.value)} placeholder="비우면 전체" />
          </div>
        </div>
        <button className="btn btn-primary" onClick={handleGenerate} disabled={!genDate || busy}>
          생성
        </button>
        {notice && <Notice type={notice.type}>{notice.text}</Notice>}
      </div>

      <ErrorNotice error={error} />

      <div className="card">
        <div className="card-title">조회</div>
        <div className="form-grid">
          <div className="form-field">
            <label>거래처코드</label>
            <input value={filters.customer_code} onChange={(e) => setFilters({ ...filters, customer_code: e.target.value })} />
          </div>
          <div className="form-field">
            <label>출고일</label>
            <input type="date" value={filters.ship_date} onChange={(e) => setFilters({ ...filters, ship_date: e.target.value })} />
          </div>
          <div className="form-field">
            <label>상태</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">전체</option>
              <option value="CREATED">생성됨</option>
              <option value="CONFIRMED">확정</option>
              <option value="RESULT_REGISTERED">실적등록완료</option>
            </select>
          </div>
        </div>
        <button className="btn" onClick={load}>
          조회
        </button>
      </div>

      <div className="card">
        {!shipOrders ? (
          <LoadingState />
        ) : shipOrders.length === 0 ? (
          <EmptyState>출고지시서가 없습니다.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>출고지시번호</th>
                  <th>출고일</th>
                  <th>거래처</th>
                  <th>배송방법</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {shipOrders.map((s) => (
                  <tr key={s.ship_order_no}>
                    <td>
                      <Link to={`/ship-orders/${s.ship_order_no}`}>{s.ship_order_no}</Link>
                    </td>
                    <td>{s.ship_date}</td>
                    <td>{s.customer_code}</td>
                    <td>{s.ship_method ?? '-'}</td>
                    <td>
                      <ShipOrderStatusBadge status={s.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
