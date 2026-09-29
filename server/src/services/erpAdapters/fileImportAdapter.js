import { buildErpImportCsv } from '../../lib/erpImportFile.js';

// 방안 C: 표준 Import 파일. 실시간 전송이 아니라 파일을 만들어 담당자가 ERP에 업로드하고,
// 결과는 사람이 ERP 화면에서 확인 후 MES에 입력(반자동) — 요구사항정의서 6장.
// 어댑터는 prepareTransmission(db, invoice)만 구현하면 되므로, 이후 API/DB View 방안으로
// 교체할 때는 이 시그니처를 유지하는 새 어댑터 파일만 추가하고 아래 레지스트리만 바꾸면 된다.
export const fileImportAdapter = {
  name: 'FILE_IMPORT',
  autoConfirms: false, // 결과 회신이 자동이 아니라 수동 확정 필요
  prepareTransmission(db, invoice) {
    return {
      content: buildErpImportCsv(db, invoice),
      filename: `${invoice.invoice_no}_erp_import.csv`,
      contentType: 'text/csv; charset=utf-8',
    };
  },
};
