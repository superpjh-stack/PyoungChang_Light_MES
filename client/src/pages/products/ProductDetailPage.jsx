import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, EmptyState, formatNumber } from '../../components/common.jsx';

export default function ProductDetailPage() {
  const { productCode } = useParams();
  const [product, setProduct] = useState(null);
  const [aliases, setAliases] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aliasForm, setAliasForm] = useState({ customer_code: '', raw_name: '' });

  const load = () => {
    setError(null);
    Promise.all([api.get(`/products/${productCode}`), api.get(`/product-aliases?product_code=${productCode}`)])
      .then(([p, a]) => {
        setProduct(p);
        setAliases(a);
      })
      .catch(setError);
  };

  useEffect(load, [productCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFieldSave = async (field, value) => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/products/${productCode}`, { [field]: value });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleAddAlias = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/product-aliases', { ...aliasForm, product_code: productCode });
      setAliasForm({ customer_code: '', raw_name: '' });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <ErrorNotice error={error} />;
  if (!product || !aliases) return <LoadingState />;

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/products">제품</Link> / {productCode}
      </div>
      <div className="page-header">
        <h1>{product.name}</h1>
        <p className="page-subtitle">
          {product.product_code} · {product.spec ?? '규격 미지정'} · {product.tax_type === 'TAXABLE' ? '과세' : '면세'}
        </p>
      </div>

      <div className="card">
        <div className="card-title">기본 정보</div>
        <div className="form-grid">
          <div className="form-field">
            <label>ERP 품목코드</label>
            <input
              defaultValue={product.erp_item_code ?? ''}
              onBlur={(e) => e.target.value !== (product.erp_item_code ?? '') && handleFieldSave('erp_item_code', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>포장단위 (예: BOX)</label>
            <input
              defaultValue={product.pack_unit ?? ''}
              onBlur={(e) => e.target.value !== (product.pack_unit ?? '') && handleFieldSave('pack_unit', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>포장수량 (1포장단위 = N)</label>
            <input
              type="number"
              defaultValue={product.pack_size ?? ''}
              onBlur={(e) => Number(e.target.value) !== product.pack_size && handleFieldSave('pack_size', e.target.value ? Number(e.target.value) : null)}
            />
          </div>
          <div className="form-field">
            <label>기본 단가</label>
            <input
              type="number"
              defaultValue={product.default_price ?? ''}
              onBlur={(e) => Number(e.target.value) !== product.default_price && handleFieldSave('default_price', e.target.value ? Number(e.target.value) : null)}
            />
          </div>
        </div>
        <p className="muted" style={{ fontSize: 11 }}>
          입력란은 포커스를 벗어나면 자동 저장됩니다.
        </p>
      </div>

      <div className="card">
        <div className="card-title">거래처별 별칭 (매핑 이력)</div>
        {aliases.length === 0 ? (
          <EmptyState>등록된 별칭이 없습니다.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>거래처</th>
                  <th>원본 표기명</th>
                  <th>매핑방식</th>
                  <th>사용횟수</th>
                  <th>최근사용일</th>
                </tr>
              </thead>
              <tbody>
                {aliases.map((a) => (
                  <tr key={a.id}>
                    <td>{a.customer_code}</td>
                    <td>{a.raw_name}</td>
                    <td>{a.match_type}</td>
                    <td>{formatNumber(a.use_count)}</td>
                    <td>{a.last_used_at ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={handleAddAlias} className="section">
          <div className="form-grid">
            <div className="form-field">
              <label>거래처코드</label>
              <input required value={aliasForm.customer_code} onChange={(e) => setAliasForm({ ...aliasForm, customer_code: e.target.value })} />
            </div>
            <div className="form-field">
              <label>원본 표기명</label>
              <input required value={aliasForm.raw_name} onChange={(e) => setAliasForm({ ...aliasForm, raw_name: e.target.value })} />
            </div>
          </div>
          <button className="btn" type="submit" disabled={busy}>
            별칭 추가
          </button>
        </form>
      </div>
    </div>
  );
}
