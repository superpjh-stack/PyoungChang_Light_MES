import ExcelJS from 'exceljs';
import * as orderRepo from '../repositories/orderRepository.js';

const EXPORT_HEADERS = [
  '주문번호', '주문일자', '거래처코드', '상태', '출고예정일',
  '라인번호', '원본제품명', '표준제품코드', '규격', '수량', '단위', '단가', '금액',
];

// R1-F-02 세부 4) 조회 결과 엑셀 다운로드
export async function buildOrdersExportWorkbook(db, filters) {
  const orders = orderRepo.listOrders(db, filters);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('주문내역');
  sheet.addRow(EXPORT_HEADERS);
  sheet.getRow(1).font = { bold: true };

  const lineStmt = db.prepare('SELECT * FROM order_dtl WHERE order_no = ? ORDER BY line_no');
  for (const order of orders) {
    for (const line of lineStmt.all(order.order_no)) {
      sheet.addRow([
        order.order_no,
        order.order_date,
        order.customer_code,
        order.status,
        order.ship_due_date,
        line.line_no,
        line.raw_product_name,
        line.product_code,
        line.spec,
        line.quantity,
        line.unit,
        line.unit_price,
        line.amount,
      ]);
    }
  }
  sheet.columns.forEach((col) => {
    col.width = 16;
  });
  return workbook.xlsx.writeBuffer();
}
