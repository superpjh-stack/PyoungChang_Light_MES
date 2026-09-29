import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, EmptyState } from '../../components/common.jsx';

const EMPTY_FORM = { customer_code: '', name: '', biz_reg_no: '', erp_customer_code: '' };

export default function CustomerListPage() {
  const [customers, setCustomers] = useState(null);
  const [missingOnly, setMissingOnly] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    api
      .get(`/customers${missingOnly ? '?missingErpMapping=true' : ''}`)
      .then(setCustomers)
      .catch(setError);
  };

  useEffect(load, [missingOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/customers', form);
      setForm(EMPTY_FORM);
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
        <h1>거래처 마스터</h1>
        <p className="page-subtitle">ERP 코드 매핑이 누락된 거래처를 식별할 수 있습니다.</p>
      </div>

      <div className="card">
        <div className="card-title">거래처 등록</div>
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <div className="form-field">
              <label>거래처코드 *</label>
              <input required value={form.customer_code} onChange={(e) => setForm({ ...form, customer_code: e.target.value })} />
            </div>
            <div className="form-field">
              <label>상호 *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-field">
              <label>사업자번호</label>
              <input value={form.biz_reg_no} onChange={(e) => setForm({ ...form, biz_reg_no: e.target.value })} />
            </div>
            <div className="form-field">
              <label>ERP 거래처코드</label>
              <input value={form.erp_customer_code} onChange={(e) => setForm({ ...form, erp_customer_code: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            등록
          </button>
        </form>
      </div>

      <ErrorNotice error={error} />

      <div className="card">
        <div className="toolbar">
          <label className="checkbox-label">
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
            ERP 코드 매핑 누락 거래처만 보기
          </label>
        </div>
        {!customers ? (
          <LoadingState />
        ) : customers.length === 0 ? (
          <EmptyState>거래처가 없습니다.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>거래처코드</th>
                  <th>상호</th>
                  <th>사업자번호</th>
                  <th>ERP 거래처코드</th>
                  <th>승인필요</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.customer_code}>
                    <td>
                      <Link to={`/customers/${c.customer_code}`}>{c.customer_code}</Link>
                    </td>
                    <td>{c.name}</td>
                    <td>{c.biz_reg_no ?? '-'}</td>
                    <td>{c.erp_customer_code ?? <span className="badge badge-red">누락</span>}</td>
                    <td>{c.approval_required ? <span className="badge badge-blue">필요</span> : '-'}</td>
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
