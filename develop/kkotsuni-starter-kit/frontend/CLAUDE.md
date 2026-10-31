# 화면 참고 지침

기존 src/kkotsuni/app/templates와 static/style.css·tabs.js를 확장한다.

- design.screen()의 화면 항목·설명·체크와 nav.py 경로를 사용한다.
- base.html의 search/grid/actions 블록과 templating.render를 재사용한다.
- 조회 폼 id는 screen-search, 탭은 data-tabs/data-tab-group/data-tab-idx 규약을 따른다.
- 저장 결과와 검증 오류는 공통 팝업으로 확인한다(D-27). 필터·입력 상태 손실도 점검한다.
- 버튼 가시성과 서버 권한을 함께 확인한다. PM 승인과 작업자 입력을 구분한다.
- LOT 클릭은 MES-TD3-019로 연결한다. 연결이 없으면 실제 빈 상태를 표시한다.
- 예측·실측·가설·미수집을 구분하고 AI 인용과 사람 판정 우선 안내를 보존한다.
- 데스크톱·스마트패드·좁은 화면에서 메뉴·표·탭·팝업·주요 버튼을 확인하고 사용한 폭을 기록한다.
- 정본 HTML을 수정하거나 실제 확인하지 않은 캡처를 검증 완료로 기록하지 않는다.
