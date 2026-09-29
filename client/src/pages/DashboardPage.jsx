import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { ErrorNotice, LoadingState, formatNumber } from '../components/common.jsx';

export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/dashboard/summary')
      .then(setSummary)
      .catch(setError);
  }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!summary) return <LoadingState />;

  return (
    <div>
      <div className="page-header">
        <h1>대시보드</h1>
        <p className="page-subtitle">{summary.date} 기준 (당일 / 최근 7일)</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">당일 주문 건수</div>
          <div className="stat-value">{formatNumber(summary.today.orderCount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">당일 주문 수량</div>
          <div className="stat-value">{formatNumber(summary.today.orderQty)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">주간 주문 건수</div>
          <div className="stat-value">{formatNumber(summary.week.orderCount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">주간 주문 수량</div>
          <div className="stat-value">{formatNumber(summary.week.orderQty)}</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className={`stat-card ${summary.shipment.overdueShipmentCount > 0 ? 'danger' : ''}`}>
          <div className="stat-label">출고 지연</div>
          <div className="stat-value">{formatNumber(summary.shipment.overdueShipmentCount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">미출고 대기</div>
          <div className="stat-value">{formatNumber(summary.shipment.pendingShipmentCount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">미발행(출고완료) 대기</div>
          <div className="stat-value">{formatNumber(summary.invoice.pendingInvoiceCount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">당일 명세서 발행</div>
          <div className="stat-value">{formatNumber(summary.invoice.issuedTodayCount)}</div>
        </div>
        <div className={`stat-card ${summary.mappingPendingCount > 0 ? 'warning' : ''}`}>
          <div className="stat-label">매핑 대기</div>
          <div className="stat-value">{formatNumber(summary.mappingPendingCount)}</div>
        </div>
        <div className={`stat-card ${summary.validationFailedCount > 0 ? 'warning' : ''}`}>
          <div className="stat-label">검증 실패(확정 불가)</div>
          <div className="stat-value">{formatNumber(summary.validationFailedCount)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">ERP 전송 현황</div>
        <div style={{ display: 'flex', gap: 20 }}>
          <div>
            대기 <strong>{formatNumber(summary.erp.pendingCount)}</strong>
          </div>
          <div>
            전송중 <strong>{formatNumber(summary.erp.sendingCount)}</strong>
          </div>
          <div>
            성공 <strong style={{ color: 'var(--color-success)' }}>{formatNumber(summary.erp.successCount)}</strong>
          </div>
          <div>
            실패 <strong style={{ color: 'var(--color-danger)' }}>{formatNumber(summary.erp.failedCount)}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">출고 지연 주문 ({summary.shipment.overdueShipmentCount}건)</div>
        {summary.shipment.overdueShipments.length === 0 ? (
          <p className="muted">지연 건이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>주문번호</th>
                  <th>거래처</th>
                  <th>출고예정일</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {summary.shipment.overdueShipments.map((o) => (
                  <tr key={o.order_no}>
                    <td>
                      <Link to={`/orders/${o.order_no}`}>{o.order_no}</Link>
                    </td>
                    <td>{o.customer_code}</td>
                    <td>{o.ship_due_date}</td>
                    <td>{o.status}</td>
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
