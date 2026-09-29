import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, triggerBlobDownload } from '../../api/client.js';
import { ErrorNotice, LoadingState, Notice, formatMoney, formatNumber } from '../../components/common.jsx';
import { InvoiceStatusBadge, ErpStatusBadge } from '../../components/StatusBadge.jsx';

export default function InvoiceDetailPage() {
  const { invoiceNo } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [approval, setApproval] = useState(null);
  const [trace, setTrace] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmForm, setConfirmForm] = useState({ success: true, erp_invoice_no: '', error_message: '' });

  const load = () => {
    setError(null);
    Promise.all([api.get(`/invoices/${invoiceNo}`), api.get(`/invoices/${invoiceNo}/approval`), api.get(`/invoices/${invoiceNo}/trace`)])
      .then(([inv, appr, tr]) => {
        setInvoice(inv);
        setApproval(appr);
        setTrace(tr);
      })
      .catch(setError);
  };

  useEffect(load, [invoiceNo]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = () => run(() => api.post(`/invoices/${invoiceNo}/approve`));
  const handleIssue = () => run(() => api.post(`/invoices/${invoiceNo}/issue`));
  const handleErpSend = () => run(() => api.post(`/invoices/${invoiceNo}/erp/send`));
  const handleErpRetry = () => run(() => api.post(`/invoices/${invoiceNo}/erp/retry`));
  const handleErpConfirm = () =>
    run(() =>
      api.post(`/invoices/${invoiceNo}/erp/confirm`, {
        success: confirmForm.success,
        erp_invoice_no: confirmForm.success ? confirmForm.erp_invoice_no || undefined : undefined,
        error_message: confirmForm.success ? undefined : confirmForm.error_message,
      })
    );

  const handleDownloadImportFile = async () => {
    try {
      const blob = await api.download(`/invoices/${invoiceNo}/erp/import-file`);
      triggerBlobDownload(blob, `${invoiceNo}_erp_import.csv`);
    } catch (err) {
      setActionError(err);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.download(`/invoices/${invoiceNo}/export`);
      triggerBlobDownload(blob, `${invoiceNo}.xlsx`);
    } catch (err) {
      setActionError(err);
    }
  };

  if (error) return <ErrorNotice error={error} />;
  if (!invoice || !approval || !trace) return <LoadingState />;

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/invoices">거래명세서</Link> / {invoiceNo}
      </div>
      <div className="page-header toolbar">
        <div>
          <h1>{invoice.invoice_no}</h1>
          <p className="page-subtitle">
            거래일자 {invoice.invoice_date} · 거래처 {invoice.customer_code}
          </p>
        </div>
        <span className="spacer" />
        <InvoiceStatusBadge status={invoice.status} />
        <ErpStatusBadge status={invoice.erp_send_status} />
        <button className="btn" onClick={handleExport}>
          엑셀 다운로드
        </button>
      </div>

      <ErrorNotice error={actionError} />

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">공급가액</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {formatMoney(invoice.supply_amount)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">세액</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {formatMoney(invoice.tax_amount)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">합계</div>
          <div className="stat-value" style={{ fontSize: 18 }}>
            {formatMoney(invoice.total_amount)}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">품목</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>제품코드</th>
                <th>규격</th>
                <th>수량</th>
                <th>단가</th>
                <th>공급가액</th>
                <th>세액</th>
                <th>과세구분</th>
                <th>원 주문</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.product_code}</td>
                  <td>{l.spec ?? '-'}</td>
                  <td>{formatNumber(l.quantity)}</td>
                  <td>{formatNumber(l.unit_price)}</td>
                  <td>{formatMoney(l.supply_amount)}</td>
                  <td>{formatMoney(l.tax_amount)}</td>
                  <td>{l.tax_type}</td>
                  <td>
                    <Link to={`/orders/${l.order_no}`}>{l.order_no}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {approval.required && (
        <div className="card">
          <div className="card-title">승인</div>
          {approval.approved ? (
            <Notice type="success">
              승인 완료 — {approval.history[approval.history.length - 1]?.user_id ?? '-'} (
              {approval.history[approval.history.length - 1]?.approved_at})
            </Notice>
          ) : (
            <>
              <Notice type="info">이 명세서는 승인이 필요합니다 (거래처 설정 또는 금액 기준). 승인 전까지 ERP 전송이 차단됩니다.</Notice>
              <button className="btn btn-primary" onClick={handleApprove} disabled={busy}>
                승인 처리
              </button>
            </>
          )}
        </div>
      )}

      {invoice.status === 'DRAFT' && (
        <div className="card">
          <div className="card-title">발행</div>
          <button className="btn btn-primary" onClick={handleIssue} disabled={busy}>
            발행 확정 (DRAFT → ISSUED)
          </button>
        </div>
      )}

      {invoice.status === 'ISSUED' && (
        <div className="card">
          <div className="card-title">ERP 전송</div>
          <div className="toolbar">
            {invoice.erp_send_status !== 'SUCCESS' && invoice.erp_send_status !== 'SENDING' && (
              <button className="btn btn-primary" onClick={handleErpSend} disabled={busy}>
                ERP로 전송
              </button>
            )}
            {invoice.erp_send_status === 'FAILED' && (
              <button className="btn" onClick={handleErpRetry} disabled={busy}>
                재전송
              </button>
            )}
            <button className="btn" onClick={handleDownloadImportFile}>
              Import 파일 다운로드
            </button>
          </div>

          {invoice.erp_error_message && <Notice type="error">전송 오류: {invoice.erp_error_message}</Notice>}

          {invoice.erp_send_status === 'SENDING' && (
            <div className="section">
              <div className="muted" style={{ marginBottom: 6 }}>
                전송 결과 회신 확정 (방안 C는 담당자가 ERP 화면을 확인한 뒤 결과를 수동으로 입력합니다)
              </div>
              <div className="toolbar">
                <label className="checkbox-label">
                  <input type="radio" checked={confirmForm.success} onChange={() => setConfirmForm({ ...confirmForm, success: true })} />
                  성공
                </label>
                <label className="checkbox-label">
                  <input type="radio" checked={!confirmForm.success} onChange={() => setConfirmForm({ ...confirmForm, success: false })} />
                  실패
                </label>
                {confirmForm.success ? (
                  <input
                    placeholder="ERP 명세서번호"
                    value={confirmForm.erp_invoice_no}
                    onChange={(e) => setConfirmForm({ ...confirmForm, erp_invoice_no: e.target.value })}
                  />
                ) : (
                  <input
                    placeholder="실패 사유 (필수)"
                    value={confirmForm.error_message}
                    onChange={(e) => setConfirmForm({ ...confirmForm, error_message: e.target.value })}
                  />
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleErpConfirm}
                  disabled={busy || (!confirmForm.success && !confirmForm.error_message)}
                >
                  결과 확정
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">문서 연계</div>
        <div className="muted">
          원 주문:{' '}
          {trace.orders.length === 0
            ? '-'
            : trace.orders.map((o, i) => (
                <span key={o.order_no}>
                  {i > 0 && ', '}
                  <Link to={`/orders/${o.order_no}`}>{o.order_no}</Link>
                </span>
              ))}
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          출고지시서:{' '}
          {trace.ship_orders.length === 0
            ? '-'
            : trace.ship_orders.map((s, i) => (
                <span key={s}>
                  {i > 0 && ', '}
                  <Link to={`/ship-orders/${s}`}>{s}</Link>
                </span>
              ))}
        </div>
      </div>
    </div>
  );
}
