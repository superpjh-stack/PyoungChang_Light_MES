import ExcelJS from 'exceljs';
import { getInvoiceWithLines } from '../repositories/invoiceRepository.js';

const HEADERS = ['품목', '규격', '수량', '단위', '단가', '공급가액', '세액', '과세구분', '원출고지시번호', '원주문번호'];

// R1-F-08 세부4) 거래 명세서 엑셀 출력 (PDF는 미구현 — R1-F-06과 동일하게 확인 필요 절 참고)
export function buildInvoiceExportWorkbook(db, invoiceNo) {
  const invoice = getInvoiceWithLines(db, invoiceNo);
  if (!invoice) {
    const err = new Error('거래명세서를 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(invoiceNo);
  sheet.addRow([`거래명세서 ${invoice.invoice_no}`]);
  sheet.addRow([`거래일자: ${invoice.invoice_date}`, `공급받는자: ${invoice.customer_code}`, `상태: ${invoice.status}`]);
  sheet.addRow([]);
  sheet.addRow(HEADERS);
  sheet.getRow(4).font = { bold: true };

  for (const line of invoice.lines) {
    sheet.addRow([
      line.product_code,
      line.spec,
      line.quantity,
      line.unit,
      line.unit_price,
      line.supply_amount,
      line.tax_amount,
      line.tax_type,
      line.ship_order_no,
      line.order_no,
    ]);
  }
  sheet.addRow([]);
  sheet.addRow(['합계', '', '', '', '', invoice.supply_amount, invoice.tax_amount, '', '', '']);
  sheet.addRow(['총액', invoice.total_amount]);

  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  return workbook.xlsx.writeBuffer();
}
