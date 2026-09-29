import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, EmptyState } from '../../components/common.jsx';

const EMPTY_FORM = { product_code: '', name: '', spec: '', unit: 'EA', tax_type: 'TAXABLE', erp_item_code: '' };

export default function ProductListPage() {
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError(null);
    api.get('/products').then(setProducts).catch(setError);
  };

  useEffect(load, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/products', form);
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
        <h1>제품 마스터</h1>
        <p className="page-subtitle">표준 제품코드·규격·단위·과세구분을 관리합니다.</p>
      </div>

      <div className="card">
        <div className="card-title">제품 등록</div>
        <form onSubmit={handleCreate}>
          <div className="form-grid">
            <div className="form-field">
              <label>제품코드 *</label>
              <input required value={form.product_code} onChange={(e) => setForm({ ...form, product_code: e.target.value })} />
            </div>
            <div className="form-field">
              <label>표준명 *</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-field">
              <label>규격</label>
              <input value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} placeholder="예: 10kg" />
            </div>
            <div className="form-field">
              <label>단위</label>
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>
            <div className="form-field">
              <label>과세구분</label>
              <select value={form.tax_type} onChange={(e) => setForm({ ...form, tax_type: e.target.value })}>
                <option value="TAXABLE">과세</option>
                <option value="EXEMPT">면세</option>
              </select>
            </div>
            <div className="form-field">
              <label>ERP 품목코드</label>
              <input value={form.erp_item_code} onChange={(e) => setForm({ ...form, erp_item_code: e.target.value })} />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            등록
          </button>
        </form>
      </div>

      <ErrorNotice error={error} />

      <div className="card">
        {!products ? (
          <LoadingState />
        ) : products.length === 0 ? (
          <EmptyState>제품이 없습니다.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>제품코드</th>
                  <th>표준명</th>
                  <th>규격</th>
                  <th>단위</th>
                  <th>과세구분</th>
                  <th>ERP품목코드</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.product_code}>
                    <td>
                      <Link to={`/products/${p.product_code}`}>{p.product_code}</Link>
                    </td>
                    <td>{p.name}</td>
                    <td>{p.spec ?? '-'}</td>
                    <td>{p.unit}</td>
                    <td>{p.tax_type === 'TAXABLE' ? '과세' : '면세'}</td>
                    <td>{p.erp_item_code ?? '-'}</td>
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
