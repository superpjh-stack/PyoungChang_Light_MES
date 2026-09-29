import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, formatMoney } from '../../components/common.jsx';

export default function CustomerDetailPage() {
  const { customerCode } = useParams();
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [siteForm, setSiteForm] = useState({ site_name: '', address: '', receiver_name: '', receiver_phone: '' });
  const [priceForm, setPriceForm] = useState({ product_code: '', unit_price: '', effective_from: '' });

  const load = () => {
    setError(null);
    api
      .get(`/customers/${customerCode}`)
      .then(setCustomer)
      .catch(setError);
  };

  useEffect(load, [customerCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFieldSave = async (field, value) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/customers/${customerCode}`, { [field]: value });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleAddSite = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/customers/${customerCode}/delivery-sites`, siteForm);
      setSiteForm({ site_name: '', address: '', receiver_name: '', receiver_phone: '' });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleAddPrice = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/customers/${customerCode}/prices`, {
        product_code: priceForm.product_code,
        unit_price: Number(priceForm.unit_price),
        effective_from: priceForm.effective_from || undefined,
      });
      setPriceForm({ product_code: '', unit_price: '', effective_from: '' });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNotice error={error} />;
  if (!customer) return <LoadingState />;

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/customers">거래처</Link> / {customerCode}
      </div>
      <div className="page-header">
        <h1>{customer.name}</h1>
        <p className="page-subtitle">{customer.customer_code}</p>
      </div>

      <div className="card">
        <div className="card-title">기본 정보</div>
        <div className="form-grid">
          <div className="form-field">
            <label>ERP 거래처코드</label>
            <input
              defaultValue={customer.erp_customer_code ?? ''}
              onBlur={(e) => e.target.value !== (customer.erp_customer_code ?? '') && handleFieldSave('erp_customer_code', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>담당자명</label>
            <input
              defaultValue={customer.contact_name ?? ''}
              onBlur={(e) => e.target.value !== (customer.contact_name ?? '') && handleFieldSave('contact_name', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>담당자 연락처</label>
            <input
              defaultValue={customer.contact_phone ?? ''}
              onBlur={(e) => e.target.value !== (customer.contact_phone ?? '') && handleFieldSave('contact_phone', e.target.value)}
            />
          </div>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={!!customer.approval_required}
            disabled={busy}
            onChange={(e) => handleFieldSave('approval_required', e.target.checked)}
          />
          거래명세서 발행/ERP 전송 시 승인 필요
        </label>
        <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          입력란은 포커스를 벗어나면(blur) 자동 저장됩니다.
        </p>
      </div>

      <div className="card">
        <div className="card-title">납품처</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>납품처명</th>
                <th>주소</th>
                <th>수령인</th>
                <th>연락처</th>
              </tr>
            </thead>
            <tbody>
              {customer.delivery_sites.map((s) => (
                <tr key={s.delivery_site_id}>
                  <td>{s.site_name}</td>
                  <td>{s.address}</td>
                  <td>{s.receiver_name}</td>
                  <td>{s.receiver_phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={handleAddSite} className="section">
          <div className="form-grid">
            <div className="form-field">
              <label>납품처명</label>
              <input required value={siteForm.site_name} onChange={(e) => setSiteForm({ ...siteForm, site_name: e.target.value })} />
            </div>
            <div className="form-field">
              <label>주소</label>
              <input value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} />
            </div>
            <div className="form-field">
              <label>수령인</label>
              <input value={siteForm.receiver_name} onChange={(e) => setSiteForm({ ...siteForm, receiver_name: e.target.value })} />
            </div>
            <div className="form-field">
              <label>연락처</label>
              <input value={siteForm.receiver_phone} onChange={(e) => setSiteForm({ ...siteForm, receiver_phone: e.target.value })} />
            </div>
          </div>
          <button className="btn" type="submit" disabled={busy}>
            납품처 추가
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card-title">거래처별 기준 단가</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>제품코드</th>
                <th>단가</th>
                <th>적용일</th>
              </tr>
            </thead>
            <tbody>
              {customer.prices.map((p) => (
                <tr key={p.id}>
                  <td>{p.product_code}</td>
                  <td>{formatMoney(p.unit_price)}</td>
                  <td>{p.effective_from}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={handleAddPrice} className="section">
          <div className="form-grid">
            <div className="form-field">
              <label>제품코드</label>
              <input required value={priceForm.product_code} onChange={(e) => setPriceForm({ ...priceForm, product_code: e.target.value })} />
            </div>
            <div className="form-field">
              <label>단가</label>
              <input required type="number" value={priceForm.unit_price} onChange={(e) => setPriceForm({ ...priceForm, unit_price: e.target.value })} />
            </div>
            <div className="form-field">
              <label>적용일 (비우면 오늘)</label>
              <input type="date" value={priceForm.effective_from} onChange={(e) => setPriceForm({ ...priceForm, effective_from: e.target.value })} />
            </div>
          </div>
          <button className="btn" type="submit" disabled={busy}>
            단가 추가
          </button>
        </form>
      </div>
    </div>
  );
}
