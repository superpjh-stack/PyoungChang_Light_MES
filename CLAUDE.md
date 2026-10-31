# 평창꽃순이 경량 MES 작업 규칙

이 저장소의 현재 구현은 `src/kkotsuni`의 Python 3.12/FastAPI/Jinja2/PostgreSQL 17이다.
`README.md`, `docs/refactoring/2026-10-31-fastapi-migration-design.md`, `decisions.md`, `contracts/`, `PROGRESS.md`를 먼저 읽는다.

- develop 가이드·스타터킷은 참고 근거다. 제조 AI 정본·계약이 확보되지 않은 화면 ID/테이블을 지어내지 않는다.
- 실제 요구사항은 docs의 R1 원문을 따른다. 기존 주문→출고→명세서 추적과 단가·수량·승인 규칙을 보존한다.
- API/HTML은 services.operations.invoke를 공유한다. DB 쿼리는 매개변수로 바인딩하고 연결·트랜잭션은 conn.q/x/tx를 사용한다.
- 화면은 templating.render/base.html, nav.py, tabs.js를 재사용한다. 쓰기·행위 권한을 서버에서 확인한다.
- 개발 계정 선택은 명시적 KKOTSUNI_DEV_AUTH=true에서만 사용하며 운영 인증으로 표현하지 않는다.
- 설치/검증 과정에서 기존 DB를 초기화하거나 시드를 실행하지 않는다. 테스트는 전용 PostgreSQL DB의 임시 스키마에서 실행한다.
- 기존 server/client 미커밋 변경과 원본 SQLite는 보존한다. 데이터 이관 도구는 기본 dry-run이다.
- 실행한 검증만 완료로 보고한다. 소스·계약·테스트·결정을 함께 갱신한다.
- 비밀·쿠키·실데이터를 출력하거나 커밋하지 않는다. push/배포를 자동 수행하지 않는다.
