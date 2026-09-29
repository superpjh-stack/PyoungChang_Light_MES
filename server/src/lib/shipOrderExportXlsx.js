import ExcelJS from 'exceljs';
import { getShipOrderWithLines } from '../repositories/shipOrderRepository.js';

const HEADERS = ['제품코드', '지시수량', '포장단위환산수량', '포장단위', '비고', '원주문번호'];

// R1-F-06 세부5) 현장 출력용 엑셀 (납품처별 출고지시서 1건 = 시트 1장)
export function buildShipOrderExportWorkbook(db, shipOrderNo) {
  const order = getShipOrderWithLines(db, shipOrderNo);
  if (!order) {
    const err = new Error('출고지시서를 찾을 수 없습니다');
    err.status = 404;
    throw err;
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(shipOrderNo);
  sheet.addRow([`출고지시서 ${order.ship_order_no}`]);
  sheet.addRow([`출고일: ${order.ship_date}`, `거래처: ${order.customer_code}`, `배송방법: ${order.ship_method ?? '-'}`]);
  sheet.addRow([]);
  sheet.addRow(HEADERS);
  sheet.getRow(4).font = { bold: true };

  for (const line of order.lines) {
    sheet.addRow([
      line.product_code,
      line.instructed_qty,
      line.packed_qty,
      line.pack_unit,
      line.note,
      [...new Set(line.sources.map((s) => s.order_no))].join(', '),
    ]);
  }
  sheet.columns.forEach((col) => {
    col.width = 20;
  });
  return workbook.xlsx.writeBuffer();
}
