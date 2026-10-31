---
description: 근거를 작업 스펙으로 정리
argument-hint: "<작업 스펙 경로 또는 요청 내용>"
---

대상: $ARGUMENTS

앱 저장소 루트에서 수행한다. 루트 CLAUDE.md·goal.md·관련 contracts·최신 decisions/progress를 먼저 읽는다.
킷 경로는 develop/kkotsuni-starter-kit이며 외부 복사 시 실제 위치를 확인한다.
앱 소스·정본이 없으면 필요한 자료를 명시하고 구현 완료를 주장하지 않는다.
정본·비밀·실데이터를 임의 변경/출력하지 않는다. 가설·미수집·실측을 구분한다.

정본 JSON·화면설명서·계약을 읽고 요구사항/화면/프로그램 ID, 테이블, 권한, 결정 ID를 추출한다. docs/spec/_TEMPLATE.md로 작업 스펙을 작성하고 미결 항목을 00-open-questions.md에 연결한다. 읽기 전용 정본은 수정하지 않는다.

문서만 수정했으면 링크·ID·명령 정합성을 확인한다. DB 변경 명령을 문서 점검에 사용하지 않는다.
