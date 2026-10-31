# 평창꽃순이 경량 MES

주문 내역서 → 출고 지시서 → 출고 실적 → 거래명세서 → ERP Import 파일을 연결하는 시스템입니다.
`develop`의 가이드에 맞춰 **Python 3.12 · uv · FastAPI · Jinja2 · PostgreSQL 17**로 이관했습니다.
React·Express 실행 없이 서버가 화면과 JSON API를 제공합니다.

## 로컬 실행

PostgreSQL에 비어 있는 `kkotsuni_db`를 준비한 뒤 실행합니다. 기존 SQLite 파일은 자동으로 읽거나 변경하지 않습니다.

```sh
make setup
export KKOTSUNI_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/kkotsuni_db'
export KKOTSUNI_SECRET_KEY='replace-with-a-random-session-secret'
# 기존 계정 선택 방식으로 로컬 업무를 검증할 때만 설정
export KKOTSUNI_DEV_AUTH=true
make db-migrate
make run
```

접속: http://127.0.0.1:8000 · API 문서: `/docs` · 상태: `/api/health`.
환경변수는 프로세스에 전달해야 합니다. `.env`를 사용할 경우 `uv run --env-file .env ...`로 실행합니다.
`make db-migrate`는 버전별 스키마만 적용하며 데이터를 초기화하거나 시드를 넣지 않습니다.
최초 사용자·거래처·제품은 각 화면에서 등록합니다. 개발 모드에서 사용자 관리로 ADMIN/OPERATOR를 등록하고 공통 계정 선택으로 작업자를 고릅니다.

현재 권한 계약은 기존 R1과 같습니다. 명세서 발행·승인·ERP 작업은 OPERATOR 이상, 승인 임계값·ERP 마스터 동기화는 ADMIN입니다. 나머지 기존 조회·입력은 공개된 경량 MES 계약을 유지합니다. **개발 계정 선택은 정식 인증이 아닙니다.** `KKOTSUNI_DEV_AUTH=false`가 기본이며 이 경우 헤더/세션 계정으로 보호 행위를 수행할 수 없습니다. 운영 인증·전사 권한표는 이번 이관 범위에 포함하지 않았습니다.

## Docker 실행

```sh
cp .env.example .env
# .env에서 DB 비밀번호와 세션 키를 교체합니다.
# 로컬 시연에는 KKOTSUNI_DEV_AUTH=true를 명시합니다.
docker compose up -d db
docker compose build app
docker compose run --rm app python tools/db_migrate.py
docker compose up -d app
```

localhost:8000만 공개합니다. PostgreSQL은 전용 볼륨 `kkotsuni_postgres`를 사용하며 기존 `mes_data` SQLite 볼륨과 분리됩니다. DB 준비 명령을 앱 시작 시 자동 실행하지 않습니다. 실제 운영 배포는 수행하지 않았습니다.

## 기존 데이터 이관

[이관 실행 안내](docs/refactoring/migration-runbook.md)를 먼저 확인하세요.

```sh
# 읽기 전용 사전 검사 — 기본값, DB 쓰기 없음
uv run python tools/migrate_sqlite.py /path/to/source.sqlite3
# 별도 빈 PostgreSQL 대상에만 실제 복사
uv run python tools/migrate_sqlite.py /path/to/source.sqlite3 --apply
```

원본을 읽기 전용으로 열며 날짜·수치·참조 무결성을 검사합니다. 복사 후 행 해시·건수·금액·상태를 비교하고 채번/identity를 이어갑니다. 재실행은 거부하며 실패 시 복사를 롤백합니다. 실데이터 이관은 자동 실행하지 않았습니다.

## 검증

```sh
export KKOTSUNI_TEST_DATABASE_URL='postgresql://TEST_USER:TEST_PASSWORD@127.0.0.1:5432/kkotsuni_test'
make gate
# 실제 브라우저 검증: 전용 DB에 임시 스키마를 생성하고 종료 시 정리
uv run playwright install chromium
uv run python -m tools.browser_smoke
```

테스트는 임의 이름의 격리 PostgreSQL 스키마를 생성·삭제합니다. 반드시 전용 테스트 DB를 지정해야 합니다. 테스트 DB가 없으면 SQLite로 대체하거나 성공으로 처리하지 않습니다.
브라우저 검증 산출물은 Git에 포함되지 않는 `artifacts/browser/`에 저장됩니다.

- [전환 설계](docs/refactoring/2026-10-31-fastapi-migration-design.md)
- [검증 결과·제약](docs/refactoring/verification.md)
- [API 계약](contracts/api-contract.json), [화면 매핑](contracts/screen-map.md)
- [기존 테스트 대응](contracts/test-coverage.md), [이관 결정](decisions.md)
- [원 기획서](docs/기획서_원문.md), [원 요구사항](docs/요구사항정의서_원문.md)

## 소스 구조

`src/kkotsuni/app`은 HTTP·권한·공통 렌더·화면, `services`는 업무 규칙과 공통 작업 등록부,
`db`는 DB 연결·저장소·스키마, `integrations`는 Excel 파일 처리입니다.
API와 화면 폼은 같은 트랜잭션 업무 서비스를 호출합니다.

`server/`, `client/` 및 기존 미커밋 변경은 비교와 복구를 위해 보존했습니다.
기존 앱은 `npm run dev`, 기존 컨테이너는 `docker compose -f docker-compose.legacy.yml ...`로 실행할 수 있습니다.
새 Docker 실행과 기존 배포 전환은 별개입니다.

가이드의 제조 AI 플랫폼 47개 화면·발효 ML·RAG는 정본 자료와 구현이 없는 별도 범위입니다.
이번 작업은 현재 경량 MES의 이관이며 해당 제조 AI 기능이 완성됐다는 의미가 아닙니다.
