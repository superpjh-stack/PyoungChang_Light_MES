import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, Notice, formatNumber } from '../../components/common.jsx';
import { OrderStatusBadge, ShipOrderStatusBadge, InvoiceStatusBadge } from '../../components/StatusBadge.jsx';

export default function OrderDetailPage() {
  const { orderNo } = useParams();
  const [order, setOrder] = useState(null);
  const [history, setHistory] = useState(null);
  const [trace, setTrace] = useState(null);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [editNote, setEditNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    Promise.all([
      api.get(`/orders/${orderNo}`),
      api.get(`/orders/${orderNo}/status-history`),
      api.get(`/orders/${orderNo}/trace`),
    ])
      .then(([o, h, t]) => {
        setOrder(o);
        setEditNote(o.note ?? '');
        setHistory(h);
        setTrace(t);
      })
      .catch(setError);
  };

  useEffect(load, [orderNo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleValidate = async () => {
    setActionError(null);
    try {
      setValidation(await api.get(`/orders/${orderNo}/validate`));
    } catch (err) {
      setActionError(err);
    }
  };

  const handleConfirm = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/orders/${orderNo}/confirm`);
      load();
      setValidation(null);
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveNote = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.put(`/orders/${orderNo}`, { note: editNote });
      load();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNotice error={error} />;
  if (!order) return <LoadingState />;

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/orders">주문 목록</Link> / {orderNo}
      </div>
      <div className="page-header toolbar">
        <div>
          <h1>{order.order_no}</h1>
          <p className="page-subtitle">
            거래처 {order.customer_code} · 주문일 {order.order_date} · 출고예정일 {order.ship_due_date}
          </p>
        </div>
        <span className="spacer" />
        <OrderStatusBadge status={order.status} />
      </div>

      <ErrorNotice error={actionError} />

      <div className="card">
        <div className="card-title">주문 라인</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>원본 표기명</th>
                <th>표준제품코드</th>
                <th>규격</th>
                <th>수량</th>
                <th>단위</th>
                <th>단가</th>
                <th>금액</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.line_no}>
                  <td>{l.line_no}</td>
                  <td>{l.raw_product_name}</td>
                  <td>
                    {l.product_code ?? <span className="badge badge-yellow">매핑대기</span>}
                  </td>
                  <td>{l.spec ?? '-'}</td>
                  <td>{formatNumber(l.quantity)}</td>
                  <td>{l.unit ?? '-'}</td>
                  <td>{l.unit_price ? formatNumber(l.unit_price) : '-'}</td>
                  <td>{l.amount ? formatNumber(l.amount) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {order.status === 'RECEIVED' && (
        <div className="card">
          <div className="card-title">확정 전 처리</div>
          <div className="toolbar">
            <button className="btn" onClick={handleValidate}>
              검증 결과 확인
            </button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={busy}>
              주문 확정
            </button>
          </div>
          {validation && (
            <div style={{ marginTop: 8 }}>
              {validation.valid ? (
                <Notice type="success">검증을 통과했습니다. 확정 가능합니다.</Notice>
              ) : (
                <Notice type="error">
                  확정 불가 — 아래 오류를 해결하세요.
                  <ul>
                    {validation.errors.map((e, i) => (
                      <li key={i}>
                        라인 {e.line_no}: [{e.column}] {e.reason}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
              {validation.warnings.length > 0 && (
                <Notice type="info">
                  경고:
                  <ul>
                    {validation.warnings.map((w, i) => (
                      <li key={i}>
                        라인 {w.line_no}: {w.reason}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
            </div>
          )}

          <div className="card-title" style={{ marginTop: 16 }}>
            비고 수정
          </div>
          <div className="toolbar">
            <input value={editNote} onChange={(e) => setEditNote(e.target.value)} style={{ maxWidth: 320 }} />
            <button className="btn" onClick={handleSaveNote} disabled={busy}>
              저장
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">문서 연계 (출고지시서 / 거래명세서)</div>
        {trace.ship_orders.length === 0 && trace.invoices.length === 0 ? (
          <p className="muted">아직 파생된 문서가 없습니다.</p>
        ) : (
          <div style={{ display: 'flex', gap: 32 }}>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                출고지시서
              </div>
              {trace.ship_orders.map((s) => (
                <div key={s.ship_order_no} style={{ marginBottom: 4 }}>
                  <Link to={`/ship-orders/${s.ship_order_no}`}>{s.ship_order_no}</Link> <ShipOrderStatusBadge status={s.status} />
                </div>
              ))}
            </div>
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                거래명세서
              </div>
              {trace.invoices.map((i) => (
                <div key={i.invoice_no} style={{ marginBottom: 4 }}>
                  <Link to={`/invoices/${i.invoice_no}`}>{i.invoice_no}</Link> <InvoiceStatusBadge status={i.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">상태 변경 이력</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>일시</th>
                <th>이전 상태</th>
                <th>변경 상태</th>
                <th>담당자</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.changed_at}</td>
                  <td>{h.from_status ?? '-'}</td>
                  <td>{h.to_status}</td>
                  <td>{h.changed_by ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
