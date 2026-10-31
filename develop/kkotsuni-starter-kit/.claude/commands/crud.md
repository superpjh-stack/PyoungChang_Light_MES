---
description: 업무 쓰기 구현과 검증
argument-hint: "<작업 스펙 경로 또는 요청 내용>"
---

대상: $ARGUMENTS

앱 저장소 루트에서 수행한다. 루트 CLAUDE.md·goal.md·관련 contracts·최신 decisions/progress를 먼저 읽는다.
킷 경로는 develop/kkotsuni-starter-kit이며 외부 복사 시 실제 위치를 확인한다.
앱 소스·정본이 없으면 필요한 자료를 명시하고 구현 완료를 주장하지 않는다.
정본·비밀·실데이터를 임의 변경/출력하지 않는다. 가설·미수집·실측을 구분한다.

킷 backend/CLAUDE.md를 읽는다. 스펙의 메서드·경로·테이블·대상·행위를 확인한다. require_write/require_action, 입력·LOT 참조 검증, 트랜잭션을 구현한다. HTML 팝업과 API 오류를 구분한다. 정상·권한 거부·잘못된 입력·중복을 검증하고 결과를 보고한다.

문서만 수정했으면 링크·ID·명령 정합성을 확인한다. DB 변경 명령을 문서 점검에 사용하지 않는다.
