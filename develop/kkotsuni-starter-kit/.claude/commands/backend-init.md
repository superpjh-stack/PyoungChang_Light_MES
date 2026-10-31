---
description: 기존 백엔드 구조 점검
argument-hint: "<작업 스펙 경로 또는 요청 내용>"
---

대상: $ARGUMENTS

앱 저장소 루트에서 수행한다. 루트 CLAUDE.md·goal.md·관련 contracts·최신 decisions/progress를 먼저 읽는다.
킷 경로는 develop/kkotsuni-starter-kit이며 외부 복사 시 실제 위치를 확인한다.
앱 소스·정본이 없으면 필요한 자료를 명시하고 구현 완료를 주장하지 않는다.
정본·비밀·실데이터를 임의 변경/출력하지 않는다. 가설·미수집·실측을 구분한다.

킷 backend/CLAUDE.md를 읽고 pyproject/Makefile·conn·rbac·routers·agent·ml 구조를 확인한다. 설정은 변수명과 구성 여부만 확인한다. 새 앱 생성·DB 초기화·시드 재실행을 하지 않는다. 차이와 필요한 후속 작업을 보고한다.

문서만 수정했으면 링크·ID·명령 정합성을 확인한다. DB 변경 명령을 문서 점검에 사용하지 않는다.
