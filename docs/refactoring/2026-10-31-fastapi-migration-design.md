# 경량 MES의 가이드 기반 구조 전환 설계

작성일: 2026-10-31
상태: 사용자 설계 승인 후 구현·로컬 검증 완료. 이 문서는 설계 기준이며 실제 실행 결과는 [검증 기록](verification.md)을 따른다.

## 1. 목적과 확정 범위

사용자는 develop의 가이드·스타터킷을 활용한 리팩토링을 요청했고, 현재 기술 유지와 가이드 기술 전환을 구분해 안내한 뒤 “가이드대로 해줘”라고 답했다. 이에 Python 3.12 · uv · FastAPI · Jinja2 · PostgreSQL 17, 패키지 kkotsuni, 로컬 포트 8000을 목표 구조로 채택한다.

기존 주문·출고·거래명세서 업무를 유지하면서 API, 업무 로직, DB 접근, 서버 렌더링 화면을 분리한다. 기존 SQLite 데이터의 이관과 회귀 검증도 완료 범위에 포함한다. 단순 실행 골격만 만들어 전환 완료로 보고하지 않는다.

이번 범위는 현재 경량 MES 기능의 이관이다. 스타터킷이 언급하는 제조 AI 플랫폼 전체의 신규 개발은 포함하지 않는다. 기존 R1 요구사항을 MES-TD3 화면 ID로 임의 재명명하지 않는다.

## 2. 근거와 실제 차이

| 근거 | 확인 결과 | 적용 |
|---|---|---|
| develop/평창김치AI_바이브코딩_가이드.md | FastAPI/Jinja2/PostgreSQL, 공통 렌더·권한·DB 계층 | 목표 기술 및 구현 원칙 |
| develop/kkotsuni-starter-kit/README.md | 실행 코드가 없는 문서·명령 템플릿 | 복사만으로 실행 가능한 앱이라고 간주하지 않음 |
| develop/kkotsuni-starter-kit/docs/spec/_TEMPLATE.md | 근거·업무·권한·수용 조건 기록 | 이 설계 및 후속 기능 스펙 형식 |
| docs/기획서_원문.md, docs/요구사항정의서_원문.md | 경량 MES의 R1 요구사항 | 이관 업무의 기준 |
| server/src, server/db/schema.sql | Express·SQLite, 주문/출고/명세서 참조 | 기존 동작·데이터 계약의 기준 |
| client/src | React 화면, 출고지시서·거래명세서 인쇄 | Jinja2 화면 이관 기준 |
| PROGRESS.md | 인증·권한·ERP 등 가정과 기존 검증 이력 | 가정을 확정 사실로 승격하지 않음 |

가이드가 참조하는 루트 goal.md, contracts, decisions.md, docs/design/design.json, analysis.json, 정본 화면설명서 및 src/kkotsuni는 현재 저장소에서 확인되지 않았다. 따라서 화면 47개·테이블 56개·컬럼 569개와 D-26/D-28의 세부 계약 준수는 현재 검증할 수 없다. 스타터킷의 요약만으로 이 정본을 재구성하지 않는다.

## 3. 구조

이 저장소 내부에서 기존 앱을 단계적으로 이관한다. 전환 검증 중 client와 server는 비교·복구 기준으로 유지하며, 새 앱이 Node 서버에 프록시하거나 React 번들을 필수로 요구하는 구조를 최종 결과로 삼지 않는다.

```text
pyproject.toml / uv.lock / Makefile
src/kkotsuni/
  app/
    main.py                 # 앱 생성, 의존성, 공통 오류 처리
    settings.py             # KKOTSUNI_ 환경변수
    nav.py                  # 화면 경로·제목·메뉴 정의
    templating.py           # 공통 render
    http.py                 # saved/flash 및 HTML 응답
    rbac.py                 # 조회·대상 쓰기·행위 검사 진입점
    routers/                # API/HTML 입력 검증 및 서비스 호출
    templates/base.html     # 공통 레이아웃
    templates/              # 기존 업무별 화면 및 인쇄
    static/style.css
    static/tabs.js          # 공통 탭·팝업
  db/
    connection.py           # conn.q, conn.x, conn.tx
    repositories/           # SQL·조회·저장
    migrations/             # PostgreSQL 버전별 스키마
  services/                 # 상태 전이·가격·실적·명세서·ERP 규칙
  schemas/                  # API 입력·출력 모델
  integrations/             # Excel 및 ERP Import 파일
tools/                      # 이관·계약 검사, 운영 DB 초기화 없음
tests/                      # 단위·PostgreSQL 통합·API·HTML 시나리오
contracts/                  # 현재 앱을 기준으로 작성하는 이관 계약
```

라우터는 SQL과 금액 계산을 소유하지 않는다. API와 HTML은 같은 서비스를 호출한다. 서비스는 업무 트랜잭션을 소유하고 저장소는 동일 연결을 전달받는다. 읽기 요청은 업무 데이터를 변경하지 않는다.

## 4. 업무 및 화면 이관

| 현재 기능 | 원본 위치 | 이관 후 수용 기준 |
|---|---|---|
| 대시보드 | dashboardService, DashboardPage | 기준일·상태별 수량/금액이 상세 내역과 일치 |
| 거래처·납품처·단가 | customerRepository, customers 화면 | ERP 코드·적용일별 단가·납품처 관계 보존 |
| 제품·별칭·매핑 | productRepository, productAliasRepository, productMatchingService | 정규화/추천과 사용자 확정 구분, 매핑 대기 해소 |
| 주문 업로드·검증·확정 | orderUploadService, orderValidationService, orders 화면 | 템플릿·행별 오류·검증 결과·상태 이력 보존 |
| 출고지시·실적 | shipOrderRepository, shipResultRepository, shipOrders 화면 | 합산·원 주문 배분·수정 이력·수량 차이 사유·포장 LOT 보존 |
| 거래명세서 | invoiceService, invoiceRepository, invoices 화면 | 실제 출고 수량 기반 생성·검증·발행·인쇄 보존 |
| 승인·ERP | approvalService, erpTransmissionService, erpMasterSyncService | 승인 미완료 전송 차단, 실패/재시도, 파일·회신 상태 보존 |
| 사용자·설정·감사 | middleware/auth, 관련 routes 및 화면 | 기존 역할별 허용/거부·감사 이벤트 보존 |
| 문서 정/역추적 | traceService | 주문↔출고↔명세서의 실제 참조 및 미처리 목록 일치 |

기존 브라우저 경로와 /api 경로는 가능하면 유지한다. 세부 메서드·응답 필드·상태코드는 contracts/api-contract.md에 실제 라우터에서 추출해 고정한다. 기존 입력 오류 400과 가이드의 422 차이는 명시적 계약 변경 목록으로 관리하며 조용히 바꾸지 않는다.

HTML 저장은 공통 saved 처리로 303 이동과 성공 메시지를 제공한다. 입력 실패 시 검증 메시지와 입력값을 유지한다. API는 JSON 오류, HTML은 사용자용 오류 화면/팝업을 제공한다. DB 연결 실패는 503, 예상하지 못한 오류는 내부 정보 없는 500으로 처리한다.

## 5. 업무 불변조건

- 주문 헤더·상세·상태 이력과 출고 생성·원 주문 배분은 관련 변경 전체가 성공하거나 롤백된다.
- 단가 우선순위는 주문 단가 → 적용일에 유효한 거래처 단가 → 제품 기본 단가다. 누락 단가는 생성 제외 사유로 남긴다.
- 명세서는 실제 출고 실적과 배분 근거로 생성하며 발행 직전 정합성을 다시 검사한다.
- 수량·세액·공급가액 반올림은 기존 JavaScript 결과를 기준 사례로 고정한다. Python 기본 round로 대체하지 않고 Decimal과 명시적 반올림 규칙을 사용한다. 음수·소수 경계도 비교한다.
- PostgreSQL 동시 요청에서는 채번 충돌과 중복 생성이 없어야 한다. 날짜별 카운터 또는 잠금과 고유 제약을 사용하고 관련 업무 행을 트랜잭션 안에서 재검사한다.
- ERP는 현재 파일 Import와 수동 결과 확인 방식이다. 실제 ERP API 전송 성공으로 표현하지 않는다.
- 기존 pack_lot와 문서 참조만 보존한다. MAT/WRK/FMT/PKG 이력이 없는 데이터에 제조 LOT 이력을 생성하지 않는다.

## 6. 권한과 인증 경계

가이드의 require_screen, require_write, require_action 형태로 서버 검사 진입점을 분리하되 현재 앱의 역할과 승인 권한을 먼저 계약으로 기록한다. 현재 명세서 발행·승인·ERP 변경은 OPERATOR 이상, 승인 임계값 설정과 ERP 마스터 동기화는 ADMIN이다. PM 역할은 현재 없으므로 임의 추가하거나 기존 OPERATOR의 승인을 제거하지 않는다.

현재 X-User-Id 신뢰 방식은 실제 로그인 인증이 아니다. 이관 검증에서는 기존 동작 비교를 위한 명시적 개발 모드에서만 사용하고, 운영 인증 구성 없이 운영 준비 완료로 보고하지 않는다. Jinja2의 화면 조작으로 권한을 대체하지 않는다. 운영 인증 및 제조 플랫폼 권한표는 원 계약 확보 후 별도 결정 대상이다.

## 7. PostgreSQL 및 데이터 이관

PostgreSQL 17, 기본 DB 이름 kkotsuni_db를 사용한다. 접속 정보는 KKOTSUNI_ 환경변수로 주입하고 실제 비밀 값은 저장하지 않는다.

기존 테이블의 키·관계·상태·NULL 의미를 보존한다. SQLite AUTOINCREMENT는 PostgreSQL identity로, NUMERIC은 명시적 정밀도의 수량/금액으로 이관한다. 날짜·시간 문자열은 형식 검사를 거쳐 변환하고 오류 행은 식별자와 오류 유형만 보고한다. 근거 없는 시간대 보정은 하지 않는다.

이관 도구는 SQLite 원본을 읽기 전용으로 열고 지정한 PostgreSQL 대상에 복사한다. 기본 동작은 dry-run이며 테이블별 행 수, 키 중복, 참조 누락, 변환 실패를 보고한다. 실제 복사는 빈 대상에 한 트랜잭션으로 수행하고, 기존 데이터가 있으면 중단한다. 성공 후 identity 값과 집계 금액·상태별 건수·참조 무결성을 검증한다. 원본 파일과 기존 Docker 볼륨은 수정하지 않는다.

앱 시작 시 스키마 초기화나 시드를 실행하지 않는다. make setup/run/test/check-trace/check-routes 등은 실제 저장소 구현과 연결한다. DB 삭제 명령은 일반 설치·검증 경로에 포함하지 않는다.

## 8. 화면·인쇄

base.html, nav.py, templating.render를 공통 사용한다. 필터·검색·목록·상세·입력·빈 상태·오류·성공 메시지를 서버 렌더링한다. 탭과 팝업은 공통 tabs.js에 모은다. 검색 폼은 screen-search 규약을 적용한다.

기존 출고지시서 및 작업 중인 거래명세서 인쇄 기능의 내용·수량·금액을 보존한다. A4 인쇄, 페이지 넘김, 긴 품목명과 여러 페이지를 확인한다. 브라우저에서 1440px·1024px·390px 폭의 메뉴, 표 스크롤, 주요 버튼, 입력 오류를 검증하고 실제 수행한 결과만 기록한다.

## 9. 검증과 전환 완료 조건

1. 기존 136개 테스트의 업무 시나리오를 분류하고 대응하는 Python 테스트를 연결한다. 테스트 개수 일치보다 요구사항·경계조건 보존을 기준으로 삼는다.
2. PostgreSQL 전용 검증 DB에서 참조·트랜잭션 롤백·동시 채번·중복 생성·이관 재실행 거부를 검사한다. SQLite 테스트만으로 PostgreSQL 검증을 대체하지 않는다.
3. 주문 업로드 → 매핑 → 확정 → 출고 생성 → 실적 → 명세서 → 승인 → ERP 파일 → 결과 회신 및 정/역추적을 통합 검증한다.
4. 정상·미인증·권한 부족·입력 오류·미존재·충돌·DB 실패를 API와 HTML 각각 검증한다.
5. 1,000행 업로드와 400건 출고/명세서 생성의 기존 성능 요구를 격리 환경에서 측정한다. 실측 환경과 횟수를 기록한다.
6. 신규 앱은 Node 없이 8000 포트에서 동작하고 Docker Compose의 PostgreSQL 17과 연결된다. 기존 SQLite 볼륨을 재사용하거나 삭제하지 않는다.
7. 이관 후 데이터 대조와 브라우저 검증이 통과하기 전 기본 배포 구성을 전환 완료로 표시하지 않는다. 실제 운영 데이터 이관·배포는 현재 로컬 리팩토링과 구분한다.

## 10. 현재 확인 결과 및 보존 항목

2026-10-31 변경 전 npm test: 22개 파일, 136개 테스트 중 134개 통과, 2개 실패. erpTransmission.test.js와 perf.shipInvoiceGeneration.test.js에서 socket hang up이 발생했다. 원인은 아직 확인하지 않았으며 이관 코드의 회귀로 기록하지 않는다.

기존 미커밋 변경: client/src/App.jsx, client/src/index.css, client/src/pages/invoices/InvoiceDetailPage.jsx, server/src/repositories/invoiceRepository.js, server/test/invoices.test.js. 미추적 InvoicePrintPage.jsx, develop, docs/promo도 존재한다. 이 파일들을 초기화하거나 일괄 덮어쓰지 않는다.

설계 작성 중 제품 코드·DB·컨테이너는 변경하지 않았다. 가이드의 make gate 및 제조 AI 게이트는 이 저장소에 구현되어 있지 않아 실행하지 않았다. 47개 화면·발효 ML·RAG 성능을 완료 항목으로 보고하지 않는다.
