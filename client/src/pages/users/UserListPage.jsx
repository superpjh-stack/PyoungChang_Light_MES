import { useState } from 'react';
import { api } from '../../api/client.js';
import { ErrorNotice } from '../../components/common.jsx';
import { useUser } from '../../context/UserContext.jsx';

const EMPTY_FORM = { user_id: '', name: '', role: 'VIEWER' };

export default function UserListPage() {
  const { users, refreshUsers } = useUser();
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/users', form);
      setForm(EMPTY_FORM);
      refreshUsers();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>사용자 계정</h1>
        <p className="page-subtitle">
          별도 로그인 없이 상단 계정 선택으로 신원을 식별하는 경량 방식입니다. 명세서 발행·ERP 전송은 운영자(OPERATOR) 이상만 가능합니다.
        </p>
      </div>

      <div className="card">
        <div className="card-title">계정 등록</div>
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <div className="form-field">
              <label>사용자ID *</label>
              <input required value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} />
            </div>
            <div className="form-field">
              <label>이름 *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-field">
              <label>역할</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="VIEWER">조회자</option>
                <option value="OPERATOR">운영자</option>
                <option value="ADMIN">관리자</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            등록
          </button>
        </form>
      </div>

      <ErrorNotice error={error} />

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>사용자ID</th>
                <th>이름</th>
                <th>역할</th>
                <th>등록일</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id}>
                  <td>{u.user_id}</td>
                  <td>{u.name}</td>
                  <td>
                    <span className="badge badge-blue">{u.role}</span>
                  </td>
                  <td>{u.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
