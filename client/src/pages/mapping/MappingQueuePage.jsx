import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, EmptyState, Notice } from '../../components/common.jsx';
import { useUser } from '../../context/UserContext.jsx';

export default function MappingQueuePage() {
  const { currentUserId } = useUser();
  const [queue, setQueue] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState(null);
  const [activeRow, setActiveRow] = useState(null); // {customer_code, raw_product_name}
  const [candidates, setCandidates] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = () => {
    setError(null);
    Promise.all([api.get('/mapping-queue'), api.get('/products')])
      .then(([q, p]) => {
        setQueue(q);
        setProducts(p);
      })
      .catch(setError);
  };

  useEffect(load, []);

  const openRow = async (row) => {
    setActiveRow(row);
    setSelectedProduct('');
    setNotice(null);
    try {
      const match = await api.get(
        `/product-aliases/match?customer_code=${encodeURIComponent(row.customer_code)}&raw_name=${encodeURIComponent(row.raw_product_name)}`
      );
      setCandidates(match.candidates ?? []);
      if (match.candidates?.[0]) setSelectedProduct(match.candidates[0].product_code);
    } catch (err) {
      setCandidates([]);
      setError(err);
    }
  };

  const handleResolve = async () => {
    if (!activeRow || !selectedProduct) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.post('/mapping-queue/resolve', {
        customer_code: activeRow.customer_code,
        raw_name: activeRow.raw_product_name,
        product_code: selectedProduct,
        registered_by: currentUserId || undefined,
      });
      setNotice(`매핑 완료 — 미매핑 주문 라인 ${result.updatedLines}건이 자동 갱신되었습니다.`);
      setActiveRow(null);
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNotice error={error} />;
  if (!queue) return <LoadingState />;

  return (
    <div>
      <div className="page-header">
        <h1>매핑 대기함</h1>
        <p className="page-subtitle">거래처 원본 표기명을 표준 제품코드로 확정하면, 같은 표기를 쓰는 미매핑 주문이 한 번에 갱신됩니다.</p>
      </div>

      {notice && <Notice type="success">{notice}</Notice>}

      {queue.length === 0 ? (
        <div className="card">
          <EmptyState>매핑 대기 중인 항목이 없습니다.</EmptyState>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>거래처</th>
                  <th>원본 표기명</th>
                  <th>영향 라인 수</th>
                  <th>관련 주문번호</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr key={`${row.customer_code}:${row.raw_product_name}`}>
                    <td>{row.customer_code}</td>
                    <td>{row.raw_product_name}</td>
                    <td>{row.line_count}</td>
                    <td>{row.order_nos.join(', ')}</td>
                    <td>
                      <button className="btn btn-sm btn-primary" onClick={() => openRow(row)}>
                        매핑하기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeRow && (
        <div className="card">
          <div className="card-title">
            매핑 확정 — {activeRow.customer_code} / {activeRow.raw_product_name}
          </div>

          {candidates.length > 0 && (
            <div className="section">
              <div className="muted" style={{ marginBottom: 6 }}>
                유사도 추천 후보
              </div>
              {candidates.map((c) => (
                <label key={c.product_code} className="checkbox-label" style={{ marginBottom: 4 }}>
                  <input
                    type="radio"
                    name="candidate"
                    checked={selectedProduct === c.product_code}
                    onChange={() => setSelectedProduct(c.product_code)}
                  />
                  {c.product_code} — {c.name} (유사도 {(c.score * 100).toFixed(0)}%)
                </label>
              ))}
            </div>
          )}

          <div className="form-field" style={{ maxWidth: 320 }}>
            <label>표준 제품 직접 선택</label>
            <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
              <option value="">선택하세요</option>
              {products.map((p) => (
                <option key={p.product_code} value={p.product_code}>
                  {p.product_code} — {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="toolbar">
            <button className="btn btn-primary" onClick={handleResolve} disabled={!selectedProduct || busy}>
              이 표기를 선택한 제품으로 확정
            </button>
            <button className="btn" onClick={() => setActiveRow(null)}>
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
