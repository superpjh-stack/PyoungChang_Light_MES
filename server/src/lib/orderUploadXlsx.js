import ExcelJS from 'exceljs';
import { ORDER_UPLOAD_COLUMNS, FIRST_DATA_ROW } from './orderUploadTemplate.js';

function toDateOnlyString(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

function cellToValue(cell, column) {
  let value = cell.value;
  // exceljs는 하이퍼링크/richtext 셀을 객체로 반환할 수 있으므로 텍스트만 추출
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('text' in value) value = value.text;
    else if ('result' in value) value = value.result;
    else if ('richText' in value) value = value.richText.map((t) => t.text).join('');
  }
  if (value === undefined || value === null || value === '') return null;
  if (column.type === 'date') return toDateOnlyString(value);
  if (typeof value === 'string') return value.trim();
  return value;
}

export async function buildOrderUploadTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('주문내역서');
  sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => c.header));
  sheet.addRow(ORDER_UPLOAD_COLUMNS.map((c) => c.example ?? ''));
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  return workbook.xlsx.writeBuffer();
}

export async function parseOrderUploadWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    const err = new Error('워크시트를 찾을 수 없습니다');
    err.status = 400;
    throw err;
  }

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < FIRST_DATA_ROW) return; // 헤더/예시 행 건너뜀

    const values = {};
    let isEmpty = true;
    ORDER_UPLOAD_COLUMNS.forEach((column, idx) => {
      const cell = row.getCell(idx + 1);
      const value = cellToValue(cell, column);
      values[column.key] = value;
      if (value !== null) isEmpty = false;
    });
    if (isEmpty) return; // 완전 빈 행은 무시

    rows.push({ rowNumber, values });
  });
  return rows;
}
