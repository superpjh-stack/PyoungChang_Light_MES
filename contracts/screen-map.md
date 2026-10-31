# 실제 경량 MES 화면 계약

기존 client/src/App.jsx와 이관된 app/routers/pages.py를 대응한다. 제조 플랫폼의 MES-TD3 ID를 임의 부여하지 않는다.

| 경로 | 화면/기능 | 근거 |
|---|---|---|
| / | 업무 대시보드 | R1-F-11 |
| /orders | 주문 조회·필터·Excel | R1-F-02 |
| /orders/upload | Excel 미리보기·행 선택 등록 | R1-F-01 |
| /orders/{orderNo} | 상세·수정·검증·확정·이력·추적 | R1-F-02/05/10 |
| /mapping-queue | 미매핑 목록·제품 확정 | R1-F-03 |
| /ship-orders | 출고 목록·생성 | R1-F-06 |
| /ship-orders/{shipOrderNo} | 지시 수정·실적·차이·이력 | R1-F-06/07 |
| /ship-orders/{shipOrderNo}/print | A4 인쇄·PDF 저장 | R1-F-06 |
| /invoices | 거래명세서 목록·생성·일괄 ERP | R1-F-08/09 |
| /invoices/preview | 저장 전 계산·제외 사유 | R1-F-08 |
| /invoices/{invoiceNo} | 정합성·승인·발행·ERP·추적 | R1-F-08/09/10/12 |
| /invoices/{invoiceNo}/print | 거래명세서 A4 인쇄 | R1-F-08 |
| /customers | 거래처 목록·등록·ERP 미매핑 | R1-F-04 |
| /customers/{customerCode} | 거래처 수정·납품처·단가 | R1-F-04 |
| /products | 제품 목록·등록 | R1-F-04 |
| /products/{productCode} | 제품 수정·거래처 별칭 | R1-F-03/04 |
| /users | 사용자 등록·목록 | R1-N-06 |
| /settings | 승인 임계값·ERP 마스터 CSV | R1-F-12/R1-I-01 |
| /audit-log | 감사 로그 조회 | R1-N-07 |

HTML 쓰기는 `/actions`에서 CSRF 검사 후 공통 업무 서비스를 호출한다. 성공 303, 입력 실패는 입력값을 유지하는 오류 화면으로 응답한다. 스타터킷의 D-27 원 계약은 없으므로 오류 시 303+팝업과 완전히 동일하다고 주장하지 않는다. 공통 flash와 tabs.js를 사용한다.
