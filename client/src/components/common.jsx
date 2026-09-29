export function formatNumber(value) {
  if (value === null || value === undefined) return '-';
  return Number(value).toLocaleString('ko-KR');
}

export function formatMoney(value) {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toLocaleString('ko-KR')}원`;
}

export function Notice({ type = 'info', children }) {
  if (!children) return null;
  return <div className={`notice notice-${type}`}>{children}</div>;
}

export function ErrorNotice({ error }) {
  if (!error) return null;
  const message = error.message ?? String(error);
  return (
    <div className="notice notice-error">
      {message}
      {error.details && (
        <pre style={{ marginTop: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {JSON.stringify(error.details, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function EmptyState({ children }) {
  return <div className="empty-state">{children ?? '데이터가 없습니다'}</div>;
}

export function LoadingState() {
  return <div className="empty-state">불러오는 중…</div>;
}
