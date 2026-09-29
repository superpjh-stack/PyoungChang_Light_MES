const USER_STORAGE_KEY = 'mes.currentUserId';

export function getCurrentUserId() {
  try {
    return localStorage.getItem(USER_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setCurrentUserId(userId) {
  try {
    if (userId) localStorage.setItem(USER_STORAGE_KEY, userId);
    else localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // localStorage 접근 불가 환경(프라이빗 모드 등) — 무시
  }
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, headers, isFormData = false } = {}) {
  const userId = getCurrentUserId();
  const finalHeaders = { ...headers };
  if (userId) finalHeaders['X-User-Id'] = userId;
  if (!isFormData && body !== undefined) finalHeaders['Content-Type'] = 'application/json';

  const res = await fetch(`/api${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  const contentType = res.headers.get('content-type') ?? '';

  if (!res.ok) {
    let message = `요청 실패 (${res.status})`;
    let details;
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      message = data?.error ?? message;
      details = data?.details;
    }
    throw new ApiError(message, res.status, details);
  }

  if (contentType.includes('application/json')) return res.json();
  if (contentType.includes('spreadsheetml') || contentType.includes('text/csv')) return res.blob();
  return res.text();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData, isFormData: true }),
  download: (path) => request(path),
};

export function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
