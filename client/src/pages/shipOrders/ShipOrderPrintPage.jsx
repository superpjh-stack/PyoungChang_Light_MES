import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, formatNumber } from '../../components/common.jsx';

const SHIP_METHOD_LABEL = { 택배: '택배', 직배송: '직배송', 화물: '화물' };

export default function ShipOrderPrintPage() {
  const { shipOrderNo } = useParams();
  const [shipOrder, setShipOrder] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/ship-orders/${shipOrderNo}`).then(setShipOrder).catch(setError);
  }, [shipOrderNo]);

  if (error) return <ErrorNotice error={error} />;
  if (!shipOrder) return <LoadingState />;

  const site = shipOrder.delivery_site;

  return (
    <div className="print-page" translate="no">
      <div className="print-toolbar">
        <button className="btn btn-primary" onClick={() => window.print()}>
          PDF로 출력
        </button>
        <span className="print-toolbar-hint">
          출력 대화상자에서 인쇄 대상을 "PDF로 저장"으로 선택하면 PDF 파일로 저장됩니다.
        </span>
      </div>

      <div className="print-doc">
        <h1 className="print-title">출 고 지 시 서</h1>

        <table className="print-info-table">
          <tbody>
            <tr>
              <th>출고지시번호</th>
              <td>{shipOrder.ship_order_no}</td>
              <th>출고일</th>
              <td>{shipOrder.ship_date}</td>
            </tr>
            <tr>
              <th>거래처</th>
              <td>
                {shipOrder.customer_name} ({shipOrder.customer_code})
              </td>
              <th>배송방법</th>
              <td>{SHIP_METHOD_LABEL[shipOrder.ship_method] ?? shipOrder.ship_method ?? '-'}</td>
            </tr>
            <tr>
              <th>납품처</th>
              <td>{site?.site_name ?? '-'}</td>
              <th>수령인</th>
              <td>
                {site?.receiver_name ?? '-'} {site?.receiver_phone ? `(${site.receiver_phone})` : ''}
              </td>
            </tr>
            <tr>
              <th>납품주소</th>
              <td colSpan={3}>{site?.address ?? '-'}</td>
            </tr>
          </tbody>
        </table>

        <table className="print-line-table">
          <thead>
            <tr>
              <th>제품명</th>
              <th>규격</th>
              <th>지시수량</th>
              <th>포장환산</th>
              <th>원 주문번호</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {shipOrder.lines.map((line) => (
              <tr key={line.ship_order_dtl_id}>
                <td>{line.product_name}</td>
                <td>{line.product_spec ?? '-'}</td>
                <td className="num">
                  {formatNumber(line.instructed_qty)} {line.product_unit}
                </td>
                <td className="num">
                  {line.packed_qty !== null ? `${formatNumber(line.packed_qty)} ${line.pack_unit ?? ''}` : '-'}
                </td>
                <td>{[...new Set(line.sources.map((s) => s.order_no))].join(', ')}</td>
                <td>{line.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="print-footnote">평창꽃순이김치 주문출고거래연동시스템 · 출력일 {new Date().toLocaleDateString('ko-KR')}</p>
      </div>
    </div>
  );
}
