# 평창김치 AI 플랫폼 스타터 킷

평창꽃순이김치 제조AI 시스템(SF26179540)의 기존 개발을 이어가는 문서·명령 템플릿입니다. 기준일 2026-10-31.
실행 코드·DB·비밀 설정은 포함하지 않습니다. Python 3.12 · uv · FastAPI · Jinja2 · PostgreSQL 17, 패키지 `kkotsuni`, 로컬 포트 8000 기준입니다.

## 사용 순서

1. [개발 가이드](docs/guide.md)와 앱 루트의 CLAUDE.md·goal.md·contracts·decisions.md·progress.md를 읽습니다.
2. [입력 자료 안내](docs/input/README.md)에 따라 근거를 확인합니다.
3. 필요한 `.claude/commands/` 파일을 앱 루트에 검토·병합합니다. 기존 규칙·설정을 덮어쓰지 않습니다.
4. `/ingest` → `/backlog` → `/feature <스펙>` 순서로 진행합니다.
5. `/lot-scenario`, `/ai-scenario`로 업무를 검증하고 `/docgen`으로 근거를 정리합니다.

Codex에서는 명령 파일 내용을 작업 지시로 사용합니다. 앱 실행·테스트는 킷 폴더가 아니라 실제 저장소 루트에서 수행합니다.

## 구성

- [공통 규칙](CLAUDE.md), [백엔드](backend/CLAUDE.md), [화면](frontend/CLAUDE.md)
- [화면 47개 매핑](docs/asis-to-tobe.md), [백로그](docs/backlog.md), [용어](docs/glossary.md)
- [스펙 템플릿](docs/spec/_TEMPLATE.md), [확인할 결정](docs/spec/00-open-questions.md)
- `docs/adr/`: 웹 구조·LOT·AI 결정 요약과 새 결정 템플릿
- `docs/wireframe/`: 현재·변경 화면 증거 기록 안내
- `.claude/commands/`: 작업별 명령 10종
- `.claude/settings.json`: 최소 설정 예시. 실제 보안 경계를 대신하지 않음
- `tools/docgen/`: 향후 생성기 예약 폴더; 실행 가능한 생성기는 포함하지 않음

`make db-schema`·`make db-reset`은 스키마를 삭제하며 `make gate-full`은 시드를 다시 실행합니다.
기존 원본은 develop에 보존했습니다. 평창용 작업에는 이 킷을 사용하세요.
