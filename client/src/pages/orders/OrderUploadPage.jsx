import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, triggerBlobDownload } from '../../api/client.js';
import { ErrorNotice, Notice } from '../../components/common.jsx';

export default function OrderUploadPage() {
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [commitResult, setCommitResult] = useState(null);

  const handleDownloadTemplate = async () => {
    try {
      const blob = await api.download('/orders/upload-template');
      triggerBlobDownload(blob, 'order_upload_template.xlsx');
    } catch (err) {
      setError(err);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setCommitResult(null);
    setPreview(null);
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.upload('/orders/upload/preview', formData);
      setPreview(result);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    const validRows = preview.rows.filter((r) => r.valid);
    if (validRows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post('/orders/upload/commit', { rows: validRows });
      setCommitResult(result);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>주문 내역서 업로드</h1>
        <p className="page-subtitle">표준 템플릿을 받아 작성한 뒤 업로드하세요. 오류 행은 행 번호·컬럼명·사유로 표시됩니다.</p>
      </div>

      <div className="card">
        <div className="toolbar">
          <button className="btn" onClick={handleDownloadTemplate}>
            표준 템플릿 다운로드
          </button>
          <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
            파일 선택 및 업로드
            <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
          {busy && <span className="muted">처리 중…</span>}
        </div>
      </div>

      <ErrorNotice error={error} />

      {commitResult && (
        <Notice type={commitResult.errors.length ? 'error' : 'success'}>
          {commitResult.orders.length}건 등록 완료.{' '}
          {commitResult.errors.length > 0 && `${commitResult.errors.length}건 등록 실패 (아래 참고).`}{' '}
          <Link to="/orders">주문 목록에서 확인</Link>
          {commitResult.errors.length > 0 && (
            <ul>
              {commitResult.errors.map((e, i) => (
                <li key={i}>
                  {e.groupKey}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {preview && (
        <div className="card">
          <div className="card-title">
            미리보기 — 총 {preview.totalRows}건 / 정상 {preview.validCount}건 / 오류 {preview.errorCount}건
          </div>
          <div className="table-wrap" style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>행</th>
                  <th>상태</th>
                  <th>거래처</th>
                  <th>제품명(거래처표기)</th>
                  <th>수량</th>
                  <th>출고예정일</th>
                  <th>오류 사유</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber} style={{ background: row.valid ? undefined : '#fef2f2' }}>
                    <td>{row.rowNumber}</td>
                    <td>
                      <span className={`badge ${row.valid ? 'badge-green' : 'badge-red'}`}>{row.valid ? '정상' : '오류'}</span>
                    </td>
                    <td>{row.values.customer_code ?? row.values.customer_name ?? '-'}</td>
                    <td>{row.values.raw_product_name ?? '-'}</td>
                    <td>{row.values.quantity ?? '-'}</td>
                    <td>{row.values.ship_due_date ?? '-'}</td>
                    <td>
                      {row.errors.map((e, i) => (
                        <div key={i} style={{ color: 'var(--color-danger)' }}>
                          [{e.column}] {e.reason}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleCommit} disabled={busy || preview.validCount === 0}>
              정상 행만 등록 ({preview.validCount}건)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
