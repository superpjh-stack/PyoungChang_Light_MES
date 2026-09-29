import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, EmptyState, Notice, formatMoney } from '../../components/common.jsx';
import { InvoiceStatusBadge, ErpStatusBadge } from '../../components/StatusBadge.jsx';
import { useUser } from '../../context/UserContext.jsx';

export default function InvoiceListPage() {
  const { currentUserId } = useUser();
  const [filters, setFilters] = useState({ customer_code: '', invoice_date: '', status: '', erp_send_status: '' });
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState(null);
  const [genDate, setGenDate] = useState('');
  const [genCustomer, setGenCustomer] = useState('');
  const [splitBySite, setSplitBySite] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = () => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    setError(null);
    api
      .get(`/invoices?${params.toString()}`)
      .then(setInvoices)
      .catch(setError);
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePreview = async () => {
    if (!genDate) return;
    setError(null);
    try {
      const result = await api.get(
        `/invoices/preview?invoice_date=${genDate}${genCustomer ? `&customer_code=${genCustomer}` : ''}&split_by_delivery_site=${splitBySite}`
      );
      setPreview(result);
    } catch (err) {
      setError(err);
    }
  };

  const handleGenerate = async () => {
    if (!genDate) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.post('/invoices/generate', {
        invoice_date: genDate,
        customer_code: genCustomer || undefined,
        split_by_delivery_site: splitBySite,
        registered_by: currentUserId || undefined,
      });
      setNotice(
        result.invoices.length === 0
          ? { type: 'info', text: '출고 완료된 대상 주문이 없습니다.' }
          : { type: 'success', text: `명세서 ${result.invoices.length}건 생성 (제외 ${result.excludedOrders.length}건)` }
      );
      setPreview(null);
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSendBatch = async () => {
    if (!filters.invoice_date) {
      setError({ message: '일괄 전송하려면 조회 조건의 거래일자를 지정하세요.' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post('/invoices/erp/send-batch', { invoice_date: filters.invoice_date });
      setNotice({ type: 'info', text: `일괄 전송 요청 ${result.length}건 처리` });
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
        <h1>거래명세서</h1>
        <p className="page-subtitle">출고 완료된 주문을 거래처×거래일자로 묶어 명세서를 생성합니다.</p>
      </div>

      <div className="card">
        <div className="card-title">명세서 생성</div>
        <div className="form-grid">
          <div className="form-field">
            <label>거래일자 (필수)</label>
            <input type="date" value={genDate} onChange={(e) => setGenDate(e.target.value)} />
          </div>
          <div className="form-field">
            <label>거래처코드 (선택)</label>
            <input value={genCustomer} onChange={(e) => setGenCustomer(e.target.value)} placeholder="비우면 전체" />
          </div>
          <div className="form-field">
            <label className="checkbox-label" style={{ marginTop: 22 }}>
              <input type="checkbox" checked={splitBySite} onChange={(e) => setSplitBySite(e.target.checked)} />
              납품처별로 분리 생성
            </label>
          </div>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={handlePreview} disabled={!genDate}>
            미리보기
          </button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={!genDate || busy}>
            생성
          </button>
        </div>
        {notice && <Notice type={notice.type}>{notice.text}</Notice>}

        {preview && (
          <div className="section">
            <div className="muted" style={{ marginBottom: 6 }}>
              미리보기 결과 — {preview.groups.length}건 생성 예정, 제외 {preview.excludedOrders.length}건
            </div>
            {preview.groups.map((g, i) => (
              <div key={i} className="card" style={{ margin: '8px 0' }}>
                <strong>{g.customer_code}</strong> — {g.lines.length}개 라인, 주문 {g.orderNos.join(', ')}
              </div>
            ))}
            {preview.excludedOrders.map((e, i) => (
              <div key={i} className="notice notice-error">
                {e.order_no}: {e.reason}
              </div>
            ))}
          </div>
        )}
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
            <label>거래일자</label>
            <input type="date" value={filters.invoice_date} onChange={(e) => setFilters({ ...filters, invoice_date: e.target.value })} />
          </div>
          <div className="form-field">
            <label>상태</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">전체</option>
              <option value="DRAFT">임시저장</option>
              <option value="ISSUED">발행완료</option>
            </select>
          </div>
          <div className="form-field">
            <label>ERP 전송상태</label>
            <select value={filters.erp_send_status} onChange={(e) => setFilters({ ...filters, erp_send_status: e.target.value })}>
              <option value="">전체</option>
              <option value="PENDING">대기</option>
              <option value="SENDING">전송중</option>
              <option value="SUCCESS">성공</option>
              <option value="FAILED">실패</option>
            </select>
          </div>
        </div>
        <div className="toolbar">
          <button className="btn" onClick={load}>
            조회
          </button>
          <span className="spacer" />
          <button className="btn" onClick={handleSendBatch} disabled={busy}>
            일 마감 일괄 ERP 전송 (조회 거래일자 기준)
          </button>
        </div>
      </div>

      <div className="card">
        {!invoices ? (
          <LoadingState />
        ) : invoices.length === 0 ? (
          <EmptyState>거래명세서가 없습니다.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>명세서번호</th>
                  <th>거래일자</th>
                  <th>거래처</th>
                  <th>합계금액</th>
                  <th>상태</th>
                  <th>ERP</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.invoice_no}>
                    <td>
                      <Link to={`/invoices/${inv.invoice_no}`}>{inv.invoice_no}</Link>
                    </td>
                    <td>{inv.invoice_date}</td>
                    <td>{inv.customer_code}</td>
                    <td>{formatMoney(inv.total_amount)}</td>
                    <td>
                      <InvoiceStatusBadge status={inv.status} />
                    </td>
                    <td>
                      <ErpStatusBadge status={inv.erp_send_status} />
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
