# 진행 현황 — 평창꽃순이김치 경량 MES (주문·출고·거래명세서 연동)

이 파일은 `/loop` 엔지니어링 루프가 **매 반복(iteration)마다 읽고 갱신**하는 단일 진행 상태 파일이다.
작업 순서는 `docs/요구사항정의서_원문.md`의 우선순위(`상` → `중` → `하`)를 따른다.
각 항목의 "완료 기준"은 요구사항정의서의 "수용 기준(검증)"을 그대로 가져온 것이며, 이를 만족해야 체크한다.

체크 표시 규칙: `[ ]` 미착수, `[~]` 진행 중, `[x]` 완료(테스트/검증 통과), `[!]` 블로킹(아래 "확인 필요" 절에 사유 기록).

---

## 0. 착수 전 확인 사항 (기획서 9.2 / 요구사항정의서 8. 전제조건)

> 실제 주문 내역서·출고 지시서·거래 명세서 샘플과 ERP(뉴젠솔루션) 연동 정보가 **아직 도입기업으로부터 확보되지 않았다.**
> 따라서 1차 루프는 요구사항정의서의 붙임 템플릿(R1-D-01~04, 기획서 [붙임])을 "확정 전 가정"으로 삼아 구현하고,
> 실제 샘플이 도착하면 컬럼 매핑만 교체할 수 있도록 **템플릿 정의를 코드에서 한 곳(설정/스키마)으로 분리**해야 한다.
> 이 가정 위에서 만든 부분은 반드시 코드 주석이 아니라 이 PROGRESS.md의 "확인 필요" 절에 기록한다.

## T0. 프로젝트 스캐폴딩 [x]

- [x] Node.js + Express(서버) + React/Vite(클라이언트) + SQLite(better-sqlite3) 모노레포 구조 생성 (`server/`, `client/`)
- [x] `npm run dev`로 서버+클라이언트 동시 구동, `npm test`로 서버 테스트 실행 가능
- [x] SQLite 파일은 `.gitignore` 처리, 스키마는 `server/db/schema.sql`(또는 마이그레이션 파일)로 버전 관리
- [x] README.md에 실행 방법 기록
- 완료 기준: `npm install && npm run dev` 실행 시 서버·클라이언트가 각각 기동되고 헬스체크(`/api/health`)가 200 응답
- 검증 방법: `npm test`(vitest, health 테스트 통과) + 서버 기동 후 `curl localhost:4000/api/health` → `{"status":"ok"}` + 클라이언트(5173)에서 프록시로 동일 응답 확인. npm 네이티브 모듈(better-sqlite3, esbuild, fsevents) install script는 `npm approve-scripts`로 승인 필요(`package.json`의 `allowScripts`에 기록됨).

## T1. 데이터 모델 (R1-D-01~04, 기획서 6.2) [x]

- [x] 테이블: 거래처(CUSTOMER), 납품처(DELIVERY_SITE), 제품(PRODUCT), 제품별칭(PRODUCT_ALIAS),
      주문(ORDER_HDR/ORDER_DTL), 출고지시(SHIP_ORDER, SHIP_ORDER_DTL, SHIP_ORDER_SRC), 출고실적(SHIP_RESULT),
      거래명세서(INVOICE_HDR/INVOICE_DTL). 추가로 거래처별 단가표(CUSTOMER_PRICE)도 포함(R1-F-04 세부 요구사항).
- [x] 문서 간 상호 역참조 키 보유(주문번호 ↔ 출고지시번호 ↔ 명세서번호) — `ship_order_src`, `invoice_dtl.order_no/ship_order_no`로 구현, 조인 테스트로 3단계 역추적 확인
- [x] 원본 표기명(거래처 제품명) 컬럼과 표준 제품코드 컬럼 분리 저장 — `order_dtl.raw_product_name` vs `order_dtl.product_code`(매핑 전 NULL 허용)
- 완료 기준: 스키마로 생성된 DB에 샘플 데이터 삽입/조회 테스트 통과, ERD가 기획서 6.2 표와 1:1 대응
- 검증 방법: `server/db/schema.sql` + `server/test/schema.test.js` (5 테스트: 마스터 삽입/조회, 주문→출고지시→명세서 조인 역추적, 원본표기/표준코드 분리, CHECK 제약 2건). `npm test` 전체 6개 통과.
- 참고: `ship_order_dtl`은 "동일 납품처·제품 수량 합산" 결과 1행이며, 원 주문 라인과의 배분 관계는 `ship_order_src`(N:M)로 별도 보관해 기획서 6.2의 "합산 수량, 원 주문 매핑 테이블" 요건을 충족.

## 우선순위 "상" — 1차 완료 필수 (기능)

- [x] **R1-F-04 거래처 마스터 관리** — 거래처코드/상호/사업자번호/담당자/납품처(복수)/ERP코드 매핑/단가표. 완료 기준: ERP 코드 매핑 누락 거래처가 목록에서 식별됨
  - `POST/GET/PUT /api/customers`, `/api/customers/:code`, `?missingErpMapping=true` 필터, 납품처(`/delivery-sites`)·거래처별 단가(`/prices`) 하위 리소스 CRUD
  - `server/src/repositories/customerRepository.js` + `server/src/routes/customers.js`, 테스트 9건(`server/test/customers.test.js`) + 기동 후 curl 스모크로 매핑 누락 필터 실동작 확인
  - UI 화면은 요구사항정의서에 명시가 없어 이번 범위에서는 API까지만 구현 (대시보드/화면 요구사항인 R1-F-11 등에서 필요 시 프런트 연결)
- [x] **R1-F-03(마스터 부분) 표준 제품 마스터 + 별칭 관리** — 제품코드/표준명/규격/단위/과세구분, 거래처별 별칭 CRUD. 완료 기준: 별칭 목록에서 사용횟수·최근사용일 확인 가능
  - `productRepository`(제품 CRUD) + `productAliasRepository`(별칭 등록/일괄등록/사용기록) + `lib/normalize.js`(정규화 키 계산, 매핑 엔진 단계에서도 재사용)
  - 라우트: `/api/products`, `/api/product-aliases`(+`/bulk`, `/:id/use`)
  - 테스트 9건: 제품 CRUD, 별칭 등록 시 정규화키 자동계산, 사용기록 시 use_count/last_used_at 갱신(수용 기준), 중복/존재하지않음 오류, 일괄등록 부분실패 분리, 거래처·제품 필터
  - `use_count`/`last_used_at` 갱신 훅(`recordAliasUsage`)은 다음 태스크(R1-F-03 매핑엔진)에서 자동 매핑 성공 시 호출하도록 연결 예정
- [x] **R1-F-01 주문 내역서 엑셀 업로드** — 표준 템플릿(붙임 15컬럼) 다운로드/업로드, 컬럼 매핑 검증, 오류 행 표시, 부분 등록. 완료 기준: 1,000건 샘플 업로드 시 오류 행이 명확히 표시되고 정상 행이 누락 없이 등록됨
  - `lib/orderUploadTemplate.js`(컬럼 정의 단일 소스) + `lib/orderUploadXlsx.js`(exceljs로 템플릿 생성/파싱) + `services/orderUploadService.js`(행 검증 → 미리보기 → 부분 커밋) + `repositories/orderRepository.js`(채번, 주문+라인 생성)
  - 라우트: `GET /api/orders/upload-template`, `POST /api/orders/upload/preview`, `POST /api/orders/upload/commit`, `GET /api/orders`, `GET /api/orders/:orderNo`
  - 검증 오류는 행번호·컬럼명(한글 헤더)·한글 사유로 반환 (R1-N-04와 자연히 겹치는 부분, N-04 작업 때 참조)
  - 테스트 7건(단위/통합) + 실서버 curl 스모크: 템플릿 다운로드→그 파일을 그대로 업로드→미리보기→커밋까지 실제 라운드트립 확인. 100건 업로드로 "정상 행 누락 없이 등록" 확인(1,000건 처리시간은 R1-N-01에서 별도 측정)
  - xlsx 파싱 라이브러리로 `xlsx`(SheetJS) 대신 `exceljs`를 채택 — `xlsx`는 프로토타입 오염/ReDoS 취약점이 npm에 "수정본 없음" 상태로 등록되어 있고 업로드는 공격자가 통제하는 입력이라 위험이 큼

  **확인 필요(가정 기록)**:
  - 붙임 템플릿의 "수령인 / 연락처" 1개 컬럼을 "수령인"/"연락처" 2개 컬럼으로 분리 — 실 샘플 도착 시 원본이 1컬럼이면 재분리 로직 필요
  - "거래처코드/거래처명" 모두 필수로 표기돼 있으나 본문 설명("미입력 시 거래처명으로 조회")을 근거로 "둘 중 하나 필수"로 완화 구현
  - 주문 그룹핑 키를 (거래처, 주문일자, 출고예정일, 거래처주문번호)로 가정 — 동일 키의 여러 행을 한 주문의 여러 라인으로 묶음. 실 샘플에서 그룹핑 기준이 다르면(예: 거래처주문번호 필수) 이 부분만 교체
  - 납품처명이 마스터에 없으면 업로드 시 즉석 자동 생성 — 오타로 인한 납품처 중복 생성 위험이 있어, 추후 매핑대기함과 유사한 "납품처 확인" 큐를 만들지 여부는 별도 판단 필요
- R1-F-07을 요구사항정의서상 "중" 우선순위임에도 "상" 항목인 R1-F-08(거래명세서) 전에 앞당겨 구현함 — 거래명세서가 "출고 완료된 주문"을 입력으로 요구하는데(4.1 TO-BE 흐름 ⑤) 출고완료 상태(SHIPPED)로의 전이는 R1-F-07에서만 만들어지는 기술적 선행 요건이라 순서를 조정. 나머지 "중" 항목(F-10, F-11, N-06~10)은 "상" 항목을 모두 마친 뒤 원래 순서대로 진행 예정
- 출고 실적이 여러 건 분할 등록될 수 있는지(부분 출고) 여부 미확정 — 현재는 라인당 실적을 여러 번 등록할 수 있게 허용(단순 누적 합계로 계산)하지만, 실제로 부분 출고가 빈번하면 "최종 확정" 개념이 별도로 필요할 수 있음
- 부가세율 10%(일반과세 기준)로 고정 가정, 공급가액/세액 모두 원 단위 반올림 — 실제 세금계산서 발행 규칙(절사/절상, 특례세율 등)은 ERP·세무 규정 확인 후 재검증 필요. 거래일자는 "출고예정일" 값을 그대로 승계(요구사항정의서 7.5 승계관계표 기준)했고 별도의 "실제 출고일" 필드는 두지 않음
- ERP(뉴젠솔루션) Import 파일의 실제 컬럼/코드 체계는 확인된 바 없어 `lib/erpImportFile.js`에 가정으로 작성 — 실 스펙 확보 후 이 파일만 교체하면 됨. 방안 C 특성상 ERP 반영 결과가 자동 회신되지 않는다고 가정하고 `POST .../erp/confirm`으로 담당자가 수동 확정하는 구조로 설계함(실제로 ERP가 결과 파일을 자동 생성해준다면 그 폴링/업로드 로직으로 대체 가능)
- R1-N-05를 4개 비기능 항목(N-01,02,04,05) 중 가장 먼저 진행 — 실제 버그(청구수량=주문수량 오류) 수정이 걸려 있어 성능 측정(N-01/02) 항목보다 시급하다고 판단해 순서 조정
- 명세서 라인은 "주문번호"별로 유지되며(원 주문 추적성 우선), 동일 제품이라도 여러 주문에서 온 라인을 하나로 합치지 않음 — 실 거래명세서 양식이 "품목당 1행"을 요구한다면 이후 합산 로직 추가 필요
- 여러 주문이 하나의 출고지시 라인으로 합산된 뒤 실적 부족이 발생하면, 각 주문에는 배분비율(allocated_qty/instructed_qty)로 실적을 귀속시키고 반올림한다 — 실제로 "어느 주문의 물량이 먼저 부족했는지"는 알 수 없으므로 비례 배분이 최선의 근사치라는 가정
- [x] **R1-F-03(매핑 엔진) 제품명 표준화 3단계 매핑** — ①정확일치 ②정규화일치(공백·특수문자 제거, 대소문자 통일) ③유사도 추천(편집거리/n-gram, 후보 3개, 선택 시 자동 학습). 매핑 대기함 UI. 완료 기준: 동일 제품의 서로 다른 표기 5종 이상이 하나의 표준코드로 자동 변환됨
  - `services/productMatchingService.js`: `matchProductName`(3단계 순차 시도) + `listPendingMappings`(매핑 대기함) + `resolvePendingMapping`(후보 확정 시 별칭 학습 + 기존 미매핑 주문 라인 일괄 갱신)
  - `lib/similarity.js`: 레벤슈타인 편집거리 기반 유사도 + 규격 토큰(숫자+단위) 보너스
  - `POST /api/orders/upload/commit`에 매핑 엔진을 연결 — 업로드 시점에 정확/정규화 일치 건은 자동으로 표준코드가 붙고, 나머지는 매핑 대기함으로 이동 (R1-F-01과 자연히 통합)
  - 라우트: `GET /api/product-aliases/match`(수동 확인용), `GET/POST /api/mapping-queue`, `POST /api/mapping-queue/resolve`
  - 테스트 7건: 1~3단계 각각 단위 검증, 매핑 대기함 집계, 확정 시 일괄 갱신, 업로드 자동매핑 통합, **수용 기준 테스트(동일 제품의 표기 5종이 모두 KC-HW-10으로 자동 변환)**. 실서버 curl로 유사도 추천(SUGGESTED, score 0.6167) 확인.
- [x] **R1-F-05 주문 데이터 검증** — 필수값(거래처/제품/수량/출고예정일), 논리검증(수량>0, 출고예정일≥주문일, 중복 주문 경고), 검증 실패 시 '확정' 불가. 완료 기준: 검증 실패 사유가 행 단위로 표시됨
  - 거래처 존재/필수값/수량>0/출고예정일≥주문일은 업로드 단계(R1-F-01)와 DB CHECK 제약으로 이미 차단됨. F-05에서는 그 위에 ①제품 매핑 완료 여부 ②중복 주문 경고, 2가지를 추가
  - `services/orderValidationService.js`: `validateOrderForConfirm`(행 단위 오류/경고 반환) + `confirmOrder`(RECEIVED→CONFIRMED, 오류 있으면 422로 차단)
  - 라우트: `GET /api/orders/:orderNo/validate`, `POST /api/orders/:orderNo/confirm`
  - 테스트 5건: 정상 확정, 매핑 미완료 시 행단위 오류로 확정 차단(수용 기준), 중복 주문은 경고만(확정은 허용), 중복 확정 409, 미존재 404. 실서버 curl로 확정 흐름 확인.
- [x] **R1-F-02 주문 내역 등록·수정·조회** — 상태(접수/확정/출고지시/출고완료/명세서발행), 채번(일자+일련번호), 기간/거래처/제품/상태 필터, 엑셀 다운로드. 완료 기준: 주문 등록 후 상태 변경 이력이 화면에서 확인됨
  - `order_status_log` 테이블 추가 + `orderRepository.changeOrderStatus/logStatusChange/getStatusHistory` — 생성 시 NULL→RECEIVED, 확정 시 RECEIVED→CONFIRMED 자동 기록 (이후 F-06/07/08/09에서 SHIP_ORDERED/SHIPPED/INVOICED 전이도 같은 함수로 기록하면 됨)
  - `orderRepository.updateOrder`: RECEIVED 상태에서만 배송지/수령인/배송방법/비고 수정 허용(409로 차단), `listOrders`에 출고예정일·제품코드 필터 추가(제품은 order_dtl JOIN)
  - `lib/orderExportXlsx.js` + `GET /api/orders/export`: 조회 결과를 주문+라인 단위로 펼쳐 엑셀 다운로드
  - 라우트: `PUT /api/orders/:orderNo`, `GET /api/orders/:orderNo/status-history`, `GET /api/orders/export`
  - 테스트 6건(상태이력 수용 기준, 수정 허용/차단, 4종 필터 조회, 엑셀 다운로드) + 실서버 curl로 상태이력/수정/엑셀 다운로드 확인
- [x] **R1-F-06 출고 지시서 자동 생성** — 출고예정일/거래처/납품처/배송방법/제품군 조건, 동일 납품처·제품 수량 합산 및 포장단위 환산, 채번+원주문 역참조, 수정 이력 보관, PDF/엑셀 출력. 완료 기준: 특정 출고일의 확정 주문 전체가 누락 없이 반영되고 수량 합계 일치
  - `product.pack_unit`/`product.pack_size` 컬럼 추가(포장단위 환산 기준, 미설정 시 환산 없이 원 수량 그대로) — 실 샘플 없어 가정한 부분, 아래 "확인 필요" 참고
  - `repositories/shipOrderRepository.js`: `findEligibleOrderLines`(CONFIRMED 주문만 대상) → `generateShipOrders`(거래처+납품처 단위로 헤더 생성, 그 안에서 제품별 수량 합산 + 포장환산 + 원주문 역참조(`ship_order_src`) + 소스 주문 상태를 SHIP_ORDERED로 일괄 전이)
  - `ship_order_dtl_revision` 테이블 + `updateShipOrderDtl`: 생성 후 수량/비고 수정 시 필드별 변경 이력 기록
  - `lib/shipOrderExportXlsx.js`: 현장 출력용 엑셀 (PDF는 미구현 — 아래 확인 필요 참고)
  - 라우트: `POST /api/ship-orders/generate`, `GET /api/ship-orders`, `GET /api/ship-orders/:shipOrderNo`, `GET /:shipOrderNo/export`, `PUT /lines/:lineId`, `GET /lines/:lineId/revisions`
  - "스마트패드 조회"는 별도 전용 화면 없이 위 JSON API로 어떤 기기에서도 조회 가능하다고 가정(경량 MES 특성상 반응형 웹으로 충분하다고 판단, 별도 네이티브 UI는 범위 밖)
  - 테스트 8건(수량합산·포장환산 수용 기준, 상태전이, 미확정 제외, 필터, 빈 결과, 수정이력, 엑셀다운로드) + 실서버 curl로 생성→조회→엑셀→상태전이 전체 확인

  **확인 필요(가정 기록)**:
  - 포장단위 환산 계수(`pack_size`)는 실 샘플이 없어 제품 마스터에 선택 필드로만 추가 — 실제로는 "10kg=1박스"처럼 제품마다 다르고 심지어 예외가 있을 수 있어(기획서 11장 리스크7 "거래처별 예외 규칙") 실 샘플 확보 후 재검증 필요
  - 출고지시서 헤더는 (거래처, 납품처) 단위로 1건씩 생성한다고 가정 — 배송방법이 그룹 내에서 섞여 있으면 첫 라인의 배송방법만 헤더에 기록(예외적 케이스, 실 데이터로 검증 필요)
  - "PDF" 출력은 구현하지 않음 — PDF 생성 라이브러리 도입은 실제 출력 양식(붙임/레이아웃) 확정 후 진행하는 게 낫다고 판단, 엑셀 다운로드로 1차 대체
- [x] **R1-F-08 거래 명세서 자동 생성** — 거래처×거래일자 집계, 단가 적용 순서(주문단가→거래처단가표→기본단가), 공급가액/세액/합계 자동 계산(과세/면세 구분), 채번+역참조, 미리보기/PDF/엑셀. 완료 기준: 샘플 거래 명세서와 동일 항목·금액으로 생성됨(샘플 확보 전까지는 계산 로직 단위테스트로 대체)
  - `product.default_price` 컬럼 추가(기본 단가, 3단계 단가 우선순위의 마지막 단계)
  - `services/invoiceService.js`: `computeInvoiceGroups`(SHIPPED 주문을 거래처×거래일자(=출고예정일 승계)로 묶고, 라인별로 주문단가→거래처단가표(`customerRepository.findCurrentPrice` 재사용)→기본단가 순으로 단가 확정, 공급가액=반올림(수량×단가), 세액=과세품목만 VAT 10%) → `previewInvoices`(미저장) / `generateInvoices`(저장 + 대상 주문 INVOICED 전이)
  - 단가를 끝내 확정할 수 없는 주문은 이번 회차에서 제외하고 사유를 `excludedOrders`로 보고 — 전체 배치를 막지 않고 나머지는 정상 생성(R1-N-05 무결성 원칙과 일치)
  - `split_by_delivery_site` 옵션으로 납품처별 분리 생성 지원(5.4 "필요 시 납품처별 분리 옵션")
  - `repositories/invoiceRepository.js`: 채번(INV-YYYYMMDD-NNNN), `issueInvoice`(DRAFT→ISSUED, 재발행 409)
  - `lib/invoiceExportXlsx.js`: 엑셀 출력 (PDF는 R1-F-06과 동일하게 미구현)
  - 라우트: `GET /api/invoices/preview`, `POST /api/invoices/generate`, `GET /api/invoices`, `GET/:invoiceNo`, `POST /:invoiceNo/issue`, `GET /:invoiceNo/export`
  - 테스트 10건(주문단가 우선 적용 금액 검증, 면세 세액0+기본단가, 거래처단가표 적용, 단가미확정 제외, 다중주문 합산, INVOICED 전이, 미리보기 미저장, 발행/재발행409, 엑셀다운로드, 필수값400) + 실서버 curl로 미리보기→생성→발행→엑셀 전체 확인
- [x] **R1-F-09 ERP 거래 명세서 연동 전송** — 연동 방식은 방안 C(표준 Import 파일)를 우선 구현하고 API/DB View로 교체 가능하도록 어댑터 인터페이스로 추상화. 전송 상태(대기/전송중/성공/실패) 관리, 실패 건 재전송. 완료 기준: 생성된 Import 파일이 명세서 항목과 일치하고 상태가 정상 전이됨
  - `services/erpAdapters/fileImportAdapter.js`: `prepareTransmission(db, invoice)` 시그니처의 어댑터. 방안 A(API)/B(DB View) 확정 시 같은 시그니처의 새 어댑터를 만들고 `erpTransmissionService.js`의 `ACTIVE_ADAPTER` 한 줄만 바꾸면 교체됨
  - `lib/erpImportFile.js`: CSV Import 파일 생성(명세서번호/거래일자/거래처코드+ERP거래처코드/품목코드+ERP품목코드/규격/수량/단가/공급가액/세액/과세구분) — 실 ERP 스펙 확정 전 가정(아래 확인 필요)
  - `services/erpTransmissionService.js`: `sendToErp`(ISSUED만 대상, 대기/성공 건은 재전송 차단) → `confirmErpResult`(SENDING 상태에서만 성공/실패 확정, 방안 C는 자동 회신이 없어 수동 확정) → `retryErpTransmission`(FAILED 건만) → `sendBatch`(거래일자 기준 대기·실패 건 일괄 재시도, R1-N-08과 연계)
  - 라우트: `POST /:invoiceNo/erp/send`, `GET /:invoiceNo/erp/import-file`, `POST /:invoiceNo/erp/confirm`, `POST /:invoiceNo/erp/retry`, `POST /erp/send-batch`
  - 테스트 9건(DRAFT 전송차단, 전송 후 파일내용 일치 수용기준, 성공확정, 상태가드, 실패시 사유필수, 재전송, 중복전송차단, 일괄전송, 404) + 실서버 curl로 발행→전송→파일다운로드→성공확정 전체 확인
  - R1-I-02(MES→ERP 명세서 전송)·R1-I-03(ERP→MES 결과 회신)도 이 구현으로 함께 완료 처리(아래 인터페이스 요구사항 절 갱신)

## 우선순위 "상" — 비기능

- [x] **R1-N-01 성능** — 1,000건 업로드·검증·등록 5분 이내 (부하 테스트로 측정)
  - `server/test/perf.orderUpload.test.js`: 1,000행 xlsx를 실제로 만들어 미리보기→커밋까지 측정. in-memory SQLite 기준 약 150ms (목표 300,000ms 대비 여유 큼)
  - 버그 발견·수정: `express.json()` 기본 바디 크기 제한(100kb)이 1,000행 커밋 요청(응답 페이로드가 더 큼)을 자르고 있었음 → `server/src/app.js`에서 20mb로 상향. 실제 배포 시 이 문제로 1,000건 업로드가 조용히 실패했을 것
  - 실제 HTTP 서버를 띄워 1,000행 xlsx 파일을 실제로 업로드하는 curl 스모크로도 재확인: 업로드→검증→등록 전체 약 200ms
  - 요구사항정의서의 "3회 평균 측정"은 실제 운영 환경(디스크 I/O, 네트워크)에서 별도로 재측정 필요 — 지금은 로직 자체가 병목이 아님을 확인하는 수준
- [x] **R1-N-02 성능** — 400건 기준 출고지시서·거래명세서 생성 30초 이내
  - `server/test/perf.shipInvoiceGeneration.test.js`: 거래처 20곳×제품 10종에 400건을 분산 생성(실제 다채널 유통 상황을 흉내) → 확정 → 출고지시서 생성(6ms) → 실적등록(셋업) → 거래명세서 생성(17ms), 각각 30,000ms 기준 대비 압도적 여유
  - 생성 응답이 id 배열 정도로 작아(주문 커밋처럼 전체 행을 되돌려주지 않음) N-01에서 발견한 바디 크기 이슈는 이 두 엔드포인트에는 해당하지 않음을 확인
- [x] **R1-N-04 사용성** — 업로드 오류 메시지에 행 번호·컬럼명·원인을 한글로 표시
  - R1-F-01 구현 시점(`orderUploadService.validateRow`)에 이미 만족: `{rowNumber, errors: [{column: 한글헤더, reason: 한글사유}]}` 형태로 반환
  - 이번 항목에서는 "모든" 검증 규칙(필수값 누락/타입오류/거래처미존재/날짜역전/수량오류/단가오류 6종)이 예외 없이 이 계약을 지키는지 전용 테스트로 재확인
- [x] **R1-N-05 무결성** — 주문·출고·명세서 간 수량·금액 합계 불일치 시 발행 차단 및 경고
  - 구현 중 실제 버그를 하나 발견·수정: 거래명세서가 "주문 수량"을 그대로 청구하고 있어 출고 실적(F-07)과 어긋날 수 있었음 → `invoiceService.getActualShippedQty`로 명세서 라인 수량을 "출고 실적 수량" 기준으로 바꾸고, 여러 주문이 하나의 출고지시 라인으로 합산된 경우(R1-F-06) 배분비율(allocated_qty/instructed_qty)로 정확히 귀속되도록 처리
  - `validateInvoiceConsistency`: 명세서 라인의 청구수량을 "현재" 출고 실적으로 재계산해 비교 + 헤더 합계를 라인 합계로 재검산 → 발행(ISSUE) 시 `issueInvoiceWithValidation`이 불일치 시 422로 차단
  - 라우트: `GET /api/invoices/:invoiceNo/validate`
  - 테스트 5건(부족 수량 기준 청구, 배분비율 귀속, 명세서 생성 후 실적 변경 시 발행 차단(수용 기준), 정상 케이스 발행, 실적 없는 주문 제외) + 실서버 curl로 부족출고→304,000원 청구→사후 실적정정→발행차단 확인

## 우선순위 "중"

- [x] **R1-F-07 출고 실적 등록** — 지시수량 대비 실출고 차이 시 사유 입력, 포장 LOT, 상태 '출고완료' 갱신 (※순서 조정: "중" 우선순위지만 R1-F-08 거래명세서가 "출고 완료된 주문"을 입력으로 삼아야 해서 기술적 선행 요건으로 먼저 진행 — 아래 확인 필요 절 참고)
  - `repositories/shipResultRepository.js`: `registerShipResult`(차이 있으면 diff_reason_code 필수, 없으면 400) → 해당 출고지시라인의 원 주문들 중 모든 라인이 실적 등록되면 자동으로 주문 상태 SHIPPED, 출고지시서 전체 라인이 다 등록되면 출고지시서 상태 RESULT_REGISTERED
  - `getShipResultSummary`: 지시수량 대비 실적 합계·차이(diffQty)를 라인 단위로 반환 (완료 기준)
  - 라우트: `POST /api/ship-orders/lines/:lineId/results`, `GET /api/ship-orders/:shipOrderNo/results`
  - 테스트 5건(정상 전이, 차이 시 사유 필수, 차이 표시 수용 기준, 제품 2종 주문은 두 라인 모두 등록돼야 전이, 404) + 실서버 curl로 부족 수량(SHORTAGE) 등록→차이 표시→SHIPPED 전이 확인
- [ ] **R1-F-10 문서 간 연계 이력 추적** — 주문번호 기준 하위 문서 트리 조회, 명세서 기준 역추적, 미출고/미발행 목록
- [ ] **R1-F-11 주문·출고 현황 대시보드** — 당일/주간 건수·수량, 출고지연 강조, 매핑대기/검증실패 건수
- [ ] **R1-N-06 RBAC** — 관리자/운영자/조회자, 명세서 발행·ERP 전송은 운영자 이상
- [ ] **R1-N-07 감사 로그** — 주문 수정/매핑 변경/ERP 전송에 사용자·일시 기록
- [ ] **R1-N-08 가용성** — ERP 장애 시 MES 단독 운영, 복구 후 미전송 건 일괄 재전송
- [ ] **R1-N-09 호환성** — 현행 엑셀 양식과 유사한 템플릿 유지(이미 T0/F-01에서 반영, 재검토만)
- [ ] **R1-N-10 확장성** — 2순위 과제(원부자재 재고관리)와 마스터 공유 가능한 구조인지 검토

## 우선순위 "하"

- [ ] **R1-F-12 권한별 승인 프로세스** — 거래처별/금액 기준 승인 필요 여부 설정, 승인 이력, 미승인 시 ERP 전송 차단

## 인터페이스 요구사항 (R1-I-01~05) — 해당 기능 구현 시 함께 처리

- [ ] R1-I-01 ERP→MES 거래처/제품/단가 마스터 동기화 (배치, 방안 미확정 → 우선 수동 Import로 스텁)
- [x] R1-I-02 MES→ERP 거래명세서 전송 (R1-F-09에서 구현 완료 — 방안 C 표준 Import 파일)
- [x] R1-I-03 ERP→MES 명세서 반영 결과 회신 (R1-F-09에서 구현 완료 — 방안 C 특성상 수동 확정)
- [x] R1-I-04 MES 내부 주문→출고지시→포장/출하(LOT) 연계 (R1-F-06/07에서 구현 완료 — `ship_order_src` 역참조 + `ship_result.pack_lot`)
- [x] R1-I-05 거래처→MES 주문 엑셀 업로드 (R1-F-01에서 구현 완료)

---

## 확인 필요 (도입기업/사업 측 확인이 필요해 임의로 가정하고 진행한 항목)

> 루프가 실제 비즈니스 결정이 필요한 지점을 만나면 여기에 기록하고, 합리적 가정을 명시한 뒤 다음 작업으로 넘어간다.
> (예: 실제 업로드 컬럼 순서, ERP Import 파일 정확한 컬럼 스펙, 'K랩' 명칭의 실체 등)

- (아래 R1-F-01 항목의 "확인 필요" 하위 목록 참고)
- `npm audit`상 vitest 개발 도구 체인(vite/esbuild, vitest UI 서버 관련)에 high/critical 항목이 있으나 이 프로젝트는 `vitest --ui`를 쓰지 않아 실제 노출 경로가 없음. 향후 여유 있을 때 vitest 메이저 업그레이드로 정리 권장(범위 밖이라 지금은 보류).

## 완료 로그

> 루프가 작업을 완료할 때마다 한 줄씩 추가: `날짜 | 요구사항ID | 요약 | 커밋 해시`

- 2026-09-30 | T0 | Node/Express/SQLite 서버 + React/Vite 클라이언트 모노레포 스캐폴딩, 헬스체크 동작 확인 | 6403236
- 2026-09-30 | T1 | 전체 데이터 모델(거래처/제품/별칭/주문/출고지시/출고실적/거래명세서) 스키마 및 역참조 조인 테스트 | 9cb9961
- 2026-09-30 | R1-F-04 | 거래처 마스터 API(CRUD, ERP매핑 누락 필터, 납품처/단가 하위 리소스) | e381a03
- 2026-09-30 | R1-F-03(마스터) | 제품 마스터 + 별칭 관리 API(정규화키 자동계산, 일괄등록, 사용기록) | 211f09f
- 2026-09-30 | R1-F-01, R1-I-05 | 주문 내역서 엑셀 업로드(템플릿 다운로드/미리보기/부분커밋), exceljs 채택 | f9985fe
- 2026-09-30 | R1-F-03(매핑엔진) | 3단계 매핑(정확/정규화/유사도) + 매핑대기함 + 업로드 자동연동 | d9f7fa0
- 2026-09-30 | R1-F-05 | 확정 게이트 검증(제품매핑 미완료 차단, 중복주문 경고) | 288324f
- 2026-09-30 | R1-F-02 | 주문 상태이력, 수정(RECEIVED 한정), 필터 확장, 엑셀 다운로드 | 0627ec1
- 2026-09-30 | R1-F-06 | 출고지시서 자동생성(합산/포장환산/역참조/수정이력/엑셀) | 0b35b9e
- 2026-09-30 | R1-F-07 | 출고실적 등록(차이사유 필수화, 자동 SHIPPED 전이), F-08 선행요건으로 순서조정 | 7711a81
- 2026-09-30 | R1-F-08 | 거래명세서 자동생성(3단계 단가, 과세/면세 세액계산, 미리보기/발행/엑셀) | 7a1c6f7
- 2026-09-30 | R1-F-09, R1-I-02, R1-I-03 | ERP 연동 전송(방안C 어댑터, 상태전이, 재전송, 일괄전송) | 40d3090
- 2026-09-30 | R1-N-05 | 명세서 청구수량을 출고실적 기준으로 수정(버그픽스), 발행 전 정합성 검증/차단 | 7affcf9
- 2026-09-30 | R1-N-04 | 업로드 오류메시지 행번호·컬럼명·한글사유 계약을 6종 검증규칙 전체에 대해 재확인 | ad1ee17
- 2026-09-30 | R1-N-01 | 1000건 업로드 성능측정(150ms) + express.json 바디크기 제한 버그 수정 | fec4c00
- 2026-09-30 | R1-N-02 | 400건 기준 출고지시서(6ms)·거래명세서(17ms) 생성 성능측정 | f27deb9
- 2026-09-30 | — | **"상" 우선순위(1차 범위) 전체 완료**: 기능 9개 + 인터페이스 5개 + 비기능 4개 | f27deb9
