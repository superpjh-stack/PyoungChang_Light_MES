# PyoungChang Light MES

평창꽃순이(주)농업회사법인 — 주문 내역서 · 출고 지시서 · 거래 명세서 연동 경량 MES
(제조AI특화 스마트공장 구축사업, 과제번호 SF26179540, 추가요구사항 1번)

## 문서

- `docs/기획서_원문.md` — 기획서 (추진 배경/목표, AS-IS/TO-BE, 핵심 기능, 일정)
- `docs/요구사항정의서_원문.md` — 요구사항정의서 (R1-F/N/I/D 요구사항 상세, 수용 기준)
- `PROGRESS.md` — 구현 진행 현황 (`/loop` 엔지니어링 루프가 매 반복마다 읽고 갱신)
- `docs/LOOP_PROMPT.md` — `/loop`에 붙여넣는 메타 프롬프트

## 기술 스택

- 서버: Node.js + Express + SQLite(better-sqlite3) — REST API, `server/test/`에 vitest 테스트 135건
- 클라이언트: React + Vite + React Router — 대시보드/주문/매핑대기함/출고지시서/거래명세서/거래처/제품/사용자/설정/감사로그 화면
- 인증: 별도 로그인 없이 `X-User-Id` 헤더로 신원 식별하는 경량 방식(우측 상단 계정 선택). 명세서 발행·ERP 전송은 운영자(OPERATOR) 이상 필요, 마스터 동기화·승인 임계값 설정은 관리자(ADMIN) 전용

## 실행 방법

```bash
npm install                # 최초 1회 (workspaces: server, client)
npm run dev                # 서버(4000) + 클라이언트(5173) 동시 기동
npm test                    # 서버 테스트 (vitest)
```

- 브라우저에서 http://localhost:5173 접속 (서버 헬스체크는 `curl http://localhost:4000/api/health`)
- 클라이언트 개발 서버는 `/api/*` 요청을 `vite.config.js`의 프록시 설정을 통해 서버(4000)로 전달한다.
- SQLite 파일은 `server/data.sqlite3`에 생성되며(WAL 모드) git에는 포함하지 않는다.
- 최초 사용 시 화면 상단 "접속 계정"에서 사용할 사용자가 없으므로, 사용자 관리 화면(`/users`)에서 관리자(ADMIN) 계정을 먼저 만든다. 그 다음 거래처/제품 마스터를 등록하고 주문 업로드부터 시작한다.

## 진행 방식

이 저장소는 `/loop` 슬래시 커맨드로 반복 엔지니어링된다. `docs/LOOP_PROMPT.md` 전체를
`/loop` 뒤에 붙여넣어 실행하면, 매 반복마다 `PROGRESS.md`의 다음 미완료 항목 1개를 구현 →
검증 → 기록 → 커밋한다.
