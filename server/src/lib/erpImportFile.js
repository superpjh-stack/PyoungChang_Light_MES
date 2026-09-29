// ERP(뉴젠솔루션) 표준 Import 파일 (방안 C, 요구사항정의서 6장). 실제 컬럼 스펙은 ERP 측 확인 전까지의 가정이며,
// 이 파일 하나만 바꾸면 실제 스펙으로 교체할 수 있도록 포맷 생성 로직을 한 곳에 모은다.
const HEADERS = [
  '명세서번호', '거래일자', '거래처코드', 'ERP거래처코드', '품목코드', 'ERP품목코드',
  '규격', '수량', '단위', '단가', '공급가액', '세액', '과세구분',
];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function buildErpImportCsv(db, invoice) {
  const customer = db.prepare('SELECT * FROM customer WHERE customer_code = ?').get(invoice.customer_code);
  const rows = [HEADERS];
  for (const line of invoice.lines) {
    const product = db.prepare('SELECT * FROM product WHERE product_code = ?').get(line.product_code);
    rows.push([
      invoice.invoice_no,
      invoice.invoice_date,
      invoice.customer_code,
      customer?.erp_customer_code ?? '',
      line.product_code,
      product?.erp_item_code ?? '',
      line.spec ?? '',
      line.quantity,
      line.unit ?? '',
      line.unit_price,
      line.supply_amount,
      line.tax_amount,
      line.tax_type,
    ]);
  }
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}
