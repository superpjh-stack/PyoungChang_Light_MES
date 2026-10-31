# 백엔드 참고 지침

앱 루트 기준 경로다. 킷은 별도 백엔드를 생성하지 않는다.

1. 관련 계약·정본·D-26/D-28과 기존 src/kkotsuni/app/routers 모듈을 읽는다.
2. 화면 ID·HTTP 메서드·경로·대상 테이블·권한을 스펙에 기록한다.
3. 조회 require_screen, 쓰기 require_write(obj=...), 승인 등 require_action을 적용한다.
4. conn.q/x/tx와 매개변수 SQL을 사용한다. 수량·필수값·중복·상하한·LOT 존재 및 규약을 검증한다.
5. 설계의 소유 파일을 지키고 main/nav/schema 공용 파일은 담당 경계를 확인한다.
6. HTML 저장은 http.saved와 팝업, API 오류는 계약 상태코드를 따른다.
7. Agent는 agent/의 retrieval·citations·service, ML은 ml/의 features·oof·evaluate·runner를 확인한다.
8. 정상·거부·실패·재실행 시나리오를 검증하고 테스트 환경을 기록한다.

DB 초기화·합성 데이터 생성은 일반 초기 점검에 포함하지 않는다. 함수 시그니처는 실제 코드로 확인한다.
