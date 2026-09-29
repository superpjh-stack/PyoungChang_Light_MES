import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, triggerBlobDownload } from '../../api/client.js';
import { ErrorNotice, LoadingState, formatNumber } from '../../components/common.jsx';
import { ShipOrderStatusBadge } from '../../components/StatusBadge.jsx';
import { useUser } from '../../context/UserContext.jsx';

function ResultForm({ line, onSubmit, busy }) {
  const [actualQty, setActualQty] = useState(line.instructed_qty);
  const [reason, setReason] = useState('');
  const [lot, setLot] = useState('');
  const needsReason = Number(actualQty) !== Number(line.instructed_qty);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
      <input type="number" style={{ width: 90 }} value={actualQty} onChange={(e) => setActualQty(e.target.value)} />
      <input placeholder="포장 LOT" style={{ width: 140 }} value={lot} onChange={(e) => setLot(e.target.value)} />
      {needsReason && (
        <input placeholder="차이 사유 (필수)" style={{ width: 160 }} value={reason} onChange={(e) => setReason(e.target.value)} />
      )}
      <button
        className="btn btn-sm btn-primary"
        disabled={busy || (needsReason && !reason)}
        onClick={() => onSubmit({ actual_qty: Number(actualQty), pack_lot: lot || undefined, diff_reason_code: reason || undefined })}
      >
        실적 등록
      </button>
    </div>
  );
}

export default function ShipOrderDetailPage() {
  const { shipOrderNo } = useParams();
  const { currentUserId } = useUser();
  const [shipOrder, setShipOrder] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    Promise.all([api.get(`/ship-orders/${shipOrderNo}`), api.get(`/ship-orders/${shipOrderNo}/results`)])
      .then(([s, r]) => {
        setShipOrder(s);
        setResults(r);
      })
      .catch(setError);
  };

  useEffect(load, [shipOrderNo]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegisterResult = async (lineId, payload) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/ship-orders/lines/${lineId}/results`, { ...payload, registered_by: currentUserId || undefined });
      load();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.download(`/ship-orders/${shipOrderNo}/export`);
      triggerBlobDownload(blob, `${shipOrderNo}.xlsx`);
    } catch (err) {
      setActionError(err);
    }
  };

  if (error) return <ErrorNotice error={error} />;
  if (!shipOrder || !results) return <LoadingState />;

  const resultByLineId = Object.fromEntries(results.map((r) => [r.ship_order_dtl_id, r]));

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/ship-orders">출고 지시서</Link> / {shipOrderNo}
      </div>
      <div className="page-header toolbar">
        <div>
          <h1>{shipOrder.ship_order_no}</h1>
          <p className="page-subtitle">
            출고일 {shipOrder.ship_date} · 거래처 {shipOrder.customer_code} · 배송방법 {shipOrder.ship_method ?? '-'}
          </p>
        </div>
        <span className="spacer" />
        <ShipOrderStatusBadge status={shipOrder.status} />
        <button className="btn" onClick={handleExport}>
          현장용 엑셀 다운로드
        </button>
      </div>

      <ErrorNotice error={actionError} />

      <div className="card">
        <div className="card-title">출고 라인 및 실적</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>제품코드</th>
                <th>지시수량</th>
                <th>포장환산</th>
                <th>원 주문</th>
                <th>실적 합계</th>
                <th>차이</th>
                <th>실적 등록</th>
              </tr>
            </thead>
            <tbody>
              {shipOrder.lines.map((line) => {
                const r = resultByLineId[line.ship_order_dtl_id];
                return (
                  <tr key={line.ship_order_dtl_id}>
                    <td>{line.product_code}</td>
                    <td>{formatNumber(line.instructed_qty)}</td>
                    <td>
                      {line.packed_qty !== null ? `${formatNumber(line.packed_qty)} ${line.pack_unit ?? ''}` : '-'}
                    </td>
                    <td>{[...new Set(line.sources.map((s) => s.order_no))].join(', ')}</td>
                    <td>{r?.totalActualQty ?? '-'}</td>
                    <td>
                      {r?.diffQty ? (
                        <span className={r.diffQty < 0 ? 'badge badge-red' : 'badge badge-yellow'}>{r.diffQty > 0 ? `+${r.diffQty}` : r.diffQty}</span>
                      ) : r?.diffQty === 0 ? (
                        <span className="badge badge-green">일치</span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <ResultForm line={line} busy={busy} onSubmit={(payload) => handleRegisterResult(line.ship_order_dtl_id, payload)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
