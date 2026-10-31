# 업무 용어

| 용어 | 코드·근거 | 뜻 |
|---|---|---|
| 원재료 LOT | MAT_RECEIPTS / MAT_LOT_HISTORY | 입고와 원재료 이력의 추적 단위 |
| 작업 이력 | PRC_RESULTS / PRC_LOT_HISTORY | 공정 실행과 LOT 관계 |
| 발효 배치 | FMT_BATCHES | 발효 관리 단위 |
| 센서 시계열 | FMT_SENSOR_TIMESERIES | 시간별 발효 측정값 |
| 포장 LOT | SHP_PACKAGING | PKG 계열 포장 추적 단위 |
| 출하번호 | SHP_SHIPMENTS.SHIPMENT_NO | D-16의 SHP 대리 추적키 |
| 통합 LOT 추적 | MES-TD3-019 | 원재료·공정·발효·포장·출하 연결 조회 |
| 레시피 | PRC_RECIPES / PRC_RECIPE_HISTORY | 배합·공정 조건과 변경 이력 |
| 품질기준 | BAS_QUALITY_STANDARDS | 승인·가설 상태를 구분하는 기준 |
| 근거 인용 | agent/citations.py | AI 답변을 뒷받침하는 출처 |
| 가설 | D-22 | 현업 확정 전 조정 가능한 값 |
| 합성 데이터 | D-08/D-23 | 실제 생산 성능과 구분할 평가 데이터 |
| 결측 | contracts/missing-policy.md | 기대 값이 없는 상태의 판정 정책 |

권한은 정본 role_matrix의 6역할·7영역과 D-26의 행위/대상 구분을 따른다.
