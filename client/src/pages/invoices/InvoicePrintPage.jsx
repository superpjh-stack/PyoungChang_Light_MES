import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { ErrorNotice, LoadingState, formatMoney, formatNumber } from '../../components/common.jsx';

export default function InvoicePrintPage() {
  const { invoiceNo } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/invoices/${invoiceNo}`).then(setInvoice).catch(setError);
  }, [invoiceNo]);

  if (error) return <ErrorNotice error={error} />;
  if (!invoice) return <LoadingState />;

  const isDraft = invoice.status === 'DRAFT';

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
        <h1 className="print-title">거 래 명 세 서</h1>
        {isDraft && <p className="print-draft-mark">발행 전 초안 — 금액이 바뀔 수 있습니다</p>}

        <table className="print-info-table">
          <tbody>
            <tr>
              <th>명세서번호</th>
              <td>{invoice.invoice_no}</td>
              <th>거래일자</th>
              <td>{invoice.invoice_date}</td>
            </tr>
            <tr>
              <th>공급받는자</th>
              <td>
                {invoice.customer_name} ({invoice.customer_code})
              </td>
              <th>사업자번호</th>
              <td>{invoice.customer_biz_reg_no ?? '-'}</td>
            </tr>
            <tr>
              <th>공급자</th>
              <td>평창꽃순이김치</td>
              <th>합계금액</th>
              <td>
                <strong>{formatMoney(invoice.total_amount)}</strong>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="print-line-table">
          <thead>
            <tr>
              <th>No</th>
              <th>품목</th>
              <th>규격</th>
              <th>수량</th>
              <th>단가</th>
              <th>공급가액</th>
              <th>세액</th>
              <th>원 주문번호</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={line.id}>
                <td className="num">{index + 1}</td>
                <td>
                  {line.product_name}
                  {line.tax_type === 'EXEMPT' ? ' (면세)' : ''}
                </td>
                <td>{line.spec ?? '-'}</td>
                <td className="num">
                  {formatNumber(line.quantity)} {line.unit ?? ''}
                </td>
                <td className="num">{formatNumber(line.unit_price)}</td>
                <td className="num">{formatNumber(line.supply_amount)}</td>
                <td className="num">{formatNumber(line.tax_amount)}</td>
                <td>{line.order_no ?? '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>합계</td>
              <td className="num">{formatNumber(invoice.supply_amount)}</td>
              <td className="num">{formatNumber(invoice.tax_amount)}</td>
              <td className="num">{formatMoney(invoice.total_amount)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="print-footnote">평창꽃순이김치 주문출고거래연동시스템 · 출력일 {new Date().toLocaleDateString('ko-KR')}</p>
      </div>
    </div>
  );
}
