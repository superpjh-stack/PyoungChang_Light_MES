import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, EmptyState } from '../../components/common.jsx';

const ENTITY_TYPES = ['', 'ORDER', 'PRODUCT_ALIAS', 'INVOICE', 'ERP_MASTER_SYNC'];

export default function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [logs, setLogs] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    const params = new URLSearchParams();
    if (entityType) params.set('entity_type', entityType);
    if (entityId) params.set('entity_id', entityId);
    setError(null);
    api
      .get(`/audit-log?${params.toString()}`)
      .then(setLogs)
      .catch(setError);
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header">
        <h1>감사 로그</h1>
        <p className="page-subtitle">주문 수정 · 매핑 변경 · ERP 전송 행위에 대한 사용자·일시 기록입니다.</p>
      </div>

      <div className="card">
        <div className="toolbar">
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} style={{ maxWidth: 220 }}>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t || '전체 유형'}
              </option>
            ))}
          </select>
          <input placeholder="대상 ID (예: 주문번호, 명세서번호)" value={entityId} onChange={(e) => setEntityId(e.target.value)} style={{ maxWidth: 240 }} />
          <button className="btn btn-primary" onClick={load}>
            조회
          </button>
        </div>
      </div>

      <ErrorNotice error={error} />

      <div className="card">
        {!logs ? (
          <LoadingState />
        ) : logs.length === 0 ? (
          <EmptyState>기록이 없습니다.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>일시</th>
                  <th>유형</th>
                  <th>대상</th>
                  <th>행위</th>
                  <th>사용자</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{l.created_at}</td>
                    <td>{l.entity_type}</td>
                    <td>{l.entity_id}</td>
                    <td>{l.action}</td>
                    <td>{l.user_id ?? <span className="muted">(미인증)</span>}</td>
                    <td>{l.detail ?? '-'}</td>
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
