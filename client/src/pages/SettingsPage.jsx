import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { ErrorNotice, Notice } from '../components/common.jsx';
import { useUser } from '../context/UserContext.jsx';

function ImportPanel({ title, description, placeholder, onImport }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleImport = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const rows = JSON.parse(text);
      const res = await onImport(rows);
      setResult(res);
    } catch (err) {
      setError(err instanceof SyntaxError ? { message: 'JSON 형식이 올바르지 않습니다' } : err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <p className="muted" style={{ marginTop: -4 }}>
        {description}
      </p>
      <textarea rows={6} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'monospace', fontSize: 12 }} />
      <div className="toolbar">
        <button className="btn btn-primary" onClick={handleImport} disabled={busy || !text.trim()}>
          동기화 실행
        </button>
      </div>
      <ErrorNotice error={error} />
      {result && (
        <Notice type={result.errors.length ? 'error' : 'success'}>
          생성 {result.createdCount}건 / 갱신 {result.updatedCount}건 / 오류 {result.errors.length}건
          {result.errors.length > 0 && (
            <ul>
              {result.errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { currentUser } = useUser();
  const [threshold, setThreshold] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const isAdmin = currentUser?.role === 'ADMIN';

  useEffect(() => {
    api
      .get('/settings/approval-amount-threshold')
      .then((r) => {
        setThreshold(r.value);
        setInputValue(r.value ?? '');
      })
      .catch(setError);
  }, []);

  const handleSaveThreshold = async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await api.put('/settings/approval-amount-threshold', { value: inputValue === '' ? null : Number(inputValue) });
      setThreshold(result.value);
      setNotice('저장되었습니다.');
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>설정</h1>
        <p className="page-subtitle">승인 임계값과 ERP→MES 마스터 동기화(수동 Import)를 관리합니다. 관리자(ADMIN) 권한이 필요합니다.</p>
      </div>

      {!isAdmin && <Notice type="info">현재 계정은 관리자가 아닙니다 — 조회만 가능하고 저장/동기화는 차단됩니다.</Notice>}

      <div className="card">
        <div className="card-title">승인 필요 금액 임계값 (R1-F-12)</div>
        <p className="muted" style={{ marginTop: -4 }}>
          거래명세서 합계금액이 이 값 이상이면 거래처 설정과 무관하게 승인이 필요합니다. 비우면 금액 기준 승인을 사용하지 않습니다.
        </p>
        <div className="toolbar">
          <input type="number" style={{ maxWidth: 200 }} value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={!isAdmin} />
          <button className="btn btn-primary" onClick={handleSaveThreshold} disabled={!isAdmin}>
            저장
          </button>
          <span className="muted">현재 값: {threshold ?? '미설정'}</span>
        </div>
        {notice && <Notice type="success">{notice}</Notice>}
        <ErrorNotice error={error} />
      </div>

      {isAdmin && (
        <>
          <ImportPanel
            title="거래처 마스터 동기화 (R1-I-01)"
            description='JSON 배열로 입력하세요. 예: [{"customer_code":"C0001","name":"○○홈쇼핑","erp_customer_code":"ERP-C0001"}]'
            placeholder='[{"customer_code": "C0001", "name": "예시거래처", "erp_customer_code": "ERP-C0001"}]'
            onImport={(rows) => api.post('/erp-sync/customers', { rows })}
          />
          <ImportPanel
            title="제품 마스터 동기화"
            description='JSON 배열로 입력하세요. 예: [{"product_code":"KC-HW-10","name":"고랭지 황태김치 10kg","erp_item_code":"ERP-ITEM-001"}]'
            placeholder='[{"product_code": "KC-HW-10", "name": "예시제품 10kg", "erp_item_code": "ERP-ITEM-001"}]'
            onImport={(rows) => api.post('/erp-sync/products', { rows })}
          />
          <ImportPanel
            title="거래처별 단가 동기화"
            description='JSON 배열로 입력하세요. 동일 거래처+제품+적용일이면 단가만 갱신됩니다.'
            placeholder='[{"customer_code": "C0001", "product_code": "KC-HW-10", "unit_price": 38000, "effective_from": "2026-11-01"}]'
            onImport={(rows) => api.post('/erp-sync/customer-prices', { rows })}
          />
        </>
      )}
    </div>
  );
}
