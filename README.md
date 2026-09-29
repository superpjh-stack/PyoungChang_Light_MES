# PyoungChang Light MES

평창꽃순이(주)농업회사법인 — 주문 내역서 · 출고 지시서 · 거래 명세서 연동 경량 MES
(제조AI특화 스마트공장 구축사업, 과제번호 SF26179540, 추가요구사항 1번)

## 문서

- `docs/기획서_원문.md` — 기획서 (추진 배경/목표, AS-IS/TO-BE, 핵심 기능, 일정)
- `docs/요구사항정의서_원문.md` — 요구사항정의서 (R1-F/N/I/D 요구사항 상세, 수용 기준)
- `PROGRESS.md` — 구현 진행 현황 (`/loop` 엔지니어링 루프가 매 반복마다 읽고 갱신)
- `docs/LOOP_PROMPT.md` — `/loop`에 붙여넣는 메타 프롬프트

## 기술 스택 (예정)

- 서버: Node.js + Express + SQLite(better-sqlite3)
- 클라이언트: React + Vite
- 상세 스캐폴딩은 `PROGRESS.md`의 T0 항목에서 진행

## 실행 방법

```bash
npm install                # 최초 1회 (workspaces: server, client)
npm run dev                # 서버(4000) + 클라이언트(5173) 동시 기동
npm test                    # 서버 테스트 (vitest)
```

- 서버 헬스체크: `curl http://localhost:4000/api/health`
- 클라이언트 개발 서버는 `/api/*` 요청을 `vite.config.js`의 프록시 설정을 통해 서버(4000)로 전달한다.
- SQLite 파일은 `server/data.sqlite3`에 생성되며(WAL 모드) git에는 포함하지 않는다.

## 진행 방식

이 저장소는 `/loop` 슬래시 커맨드로 반복 엔지니어링된다. `docs/LOOP_PROMPT.md` 전체를
`/loop` 뒤에 붙여넣어 실행하면, 매 반복마다 `PROGRESS.md`의 다음 미완료 항목 1개를 구현 →
검증 → 기록 → 커밋한다.
