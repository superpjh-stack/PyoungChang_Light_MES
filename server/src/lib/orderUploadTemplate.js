// 주문 내역서 표준 업로드 템플릿 (기획서 [붙임], 요구사항정의서 R1-D-01)
// 실제 샘플 문서 확보 전까지의 가정이며, 컬럼이 바뀌어도 이 배열만 고치면 된다.
// (거래처코드/거래처명 중 하나만 있으면 되도록 완화 — 붙임의 "미입력 시 거래처명으로 조회" 주석을 반영)
export const ORDER_UPLOAD_COLUMNS = [
  { key: 'order_date', header: '주문일자', required: true, type: 'date', example: '2026-11-03' },
  { key: 'customer_code', header: '거래처코드', required: false, type: 'string', example: 'C0012' },
  { key: 'customer_name', header: '거래처명', required: false, type: 'string', example: '○○홈쇼핑' },
  { key: 'delivery_site_name', header: '납품처명', required: false, type: 'string', example: '○○물류센터' },
  { key: 'delivery_address', header: '배송지 주소', required: false, type: 'string', example: '강원 평창군 ...' },
  { key: 'receiver_name', header: '수령인', required: false, type: 'string', example: '홍길동' },
  { key: 'receiver_phone', header: '연락처', required: false, type: 'string', example: '010-0000-0000' },
  { key: 'raw_product_name', header: '제품명(거래처 표기)', required: true, type: 'string', example: '고랭지띄고10kg' },
  { key: 'spec', header: '규격', required: false, type: 'string', example: '10kg' },
  { key: 'quantity', header: '수량', required: true, type: 'integer', example: 25 },
  { key: 'unit', header: '단위', required: false, type: 'string', example: 'BOX' },
  { key: 'unit_price', header: '단가', required: false, type: 'number', example: 38000 },
  { key: 'ship_due_date', header: '출고예정일', required: true, type: 'date', example: '2026-11-05' },
  { key: 'ship_method', header: '배송방법', required: false, type: 'string', example: '택배' },
  { key: 'customer_order_no', header: '거래처 주문번호', required: false, type: 'string', example: 'HS-2026110300123' },
  { key: 'note', header: '비고', required: false, type: 'string', example: '' },
];

export const FIRST_DATA_ROW = 2; // 1행: 헤더, 2행부터 데이터
