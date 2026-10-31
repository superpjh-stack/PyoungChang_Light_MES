# 평창김치 화면 기준 매핑

2026-10-31 contracts/screen-map.md의 47개 화면 표를 옮긴 참고본이다. 구현 완료 판정표가 아니다.
별도 AS-IS 현장 자료는 포함하지 않았으므로 전환 대응은 추측하지 않는다. 변경 시 최신 계약·nav.py와 다시 대조한다.
표의 담당은 소유권 참고이며 자동 위임 지시가 아니다.

| # | 화면ID | 이름 | 라우트 경로 | 담당 | 라우터 모듈 | 연관 테이블 |
|---|---|---|---|---|---|---|
| 1 | MES-TD3-001 | 생산현황 분석 | `/dsh/production` | 개발2 | `dsh` | `PRC_RESULTS`, `PRC_LOT_HISTORY`, `BAS_PROCESSES`, `KPI_ACHIEVEMENTS` |
| 2 | MES-TD3-002 | 품질현황 분석 | `/dsh/quality` | 개발2 | `dsh` | `SHP_INSPECTIONS`, `PRC_RESULTS`, `FMT_QUALITY_PREDICTIONS`, `KPI_ACHIEVEMENTS` |
| 3 | MES-TD3-003 | 발효상태 모니터링 대시보드 | `/dsh/fermentation` | 개발2 | `dsh` | `FMT_BATCHES`, `FMT_SENSOR_TIMESERIES`, `FMT_QUALITY_PREDICTIONS`, `FMT_COMPLETION_FORECASTS`, `FMT_ANOMALY_ALERTS` |
| 4 | MES-TD3-004 | 출하현황 분석 | `/dsh/shipment` | 개발2 | `dsh` | `SHP_SHIPMENTS`, `SHP_SHIPMENT_ITEMS`, `SHP_PACKAGING` |
| 5 | MES-TD3-005 | 원재료 입고관리 | `/mat/receipts` | 개발1 | `mat` | `MAT_RECEIPTS`, `MAT_SUPPLIERS`, `MAT_LOT_HISTORY`, `BAS_COMMON_CODES` |
| 6 | MES-TD3-006 | 원재료 이력조회 | `/mat/lot-history` | 개발1 | `mat` | `MAT_LOT_HISTORY`, `MAT_RECEIPTS`, `PRC_LOT_HISTORY`, `SHP_LOT_TRACE` |
| 7 | MES-TD3-007 | 선별데이터 관리 | `/mat/sorting` | 개발1 | `mat` | `MAT_SORTING`, `MAT_SORTING_IMAGES`, `MAT_RECEIPTS` |
| 8 | MES-TD3-008 | 공급처 품질분석 | `/mat/supplier-quality` | 개발1 | `mat` | `MAT_SUPPLIER_QUALITY`, `MAT_SUPPLIERS`, `MAT_RECEIPTS`, `SHP_INSPECTIONS` |
| 9 | MES-TD3-009 | 입고 AI Agent | `/agt/receipt-agent` | 개발3 | `agt` | `AGT_QUERY_HISTORY`, `AGT_VECTOR_DOCS`, `MAT_RECEIPTS`, `MAT_LOT_HISTORY` |
| 10 | MES-TD3-010 | 발효상태 모니터링 | `/fmt/monitor` | 개발3 | `fmt` | `FMT_BATCHES`, `FMT_SENSOR_TIMESERIES` |
| 11 | MES-TD3-011 | 품질예측결과 관리 | `/fmt/quality-prediction` | 개발3 | `fmt` | `FMT_QUALITY_PREDICTIONS`, `FMT_BATCHES`, `FMT_ML_RUNS` |
| 12 | MES-TD3-012 | 발효완료 예측 | `/fmt/completion-forecast` | 개발3 | `fmt` | `FMT_COMPLETION_FORECASTS`, `FMT_BATCHES`, `FMT_SENSOR_TIMESERIES` |
| 13 | MES-TD3-013 | 이상발효 알림 | `/fmt/anomaly-alert` | 개발3 | `fmt` | `FMT_ANOMALY_ALERTS`, `SYS_ALERT_RULES`, `SYS_ALERT_HISTORY`, `FMT_BATCHES` |
| 14 | MES-TD3-014 | ML 분석 | `/fmt/ml-analysis` | 개발3 | `fmt` | `FMT_ML_RUNS`, `DAT_ML_DATASETS`, `FMT_QUALITY_PREDICTIONS` |
| 15 | MES-TD3-015 | 영향요인 분석 | `/fmt/shap-factors` | 개발3 | `fmt` | `FMT_SHAP_FACTORS`, `FMT_ML_RUNS` |
| 16 | MES-TD3-016 | 공정조건 분석 | `/fmt/condition-recommend` | 개발3 | `fmt` | `FMT_CONDITION_RECOMMENDS`, `FMT_SENSOR_TIMESERIES`, `PRC_RECIPES`, `MAT_SORTING` |
| 17 | MES-TD3-017 | 포장실적 관리 | `/shp/packaging` | 개발2 | `shp` | `SHP_PACKAGING`, `BAS_PRODUCTS`, `PRC_LOT_HISTORY` |
| 18 | MES-TD3-018 | 출하관리 | `/shp/shipments` | 개발2 | `shp` | `SHP_SHIPMENTS`, `SHP_SHIPMENT_ITEMS`, `SHP_PACKAGING`, `FMT_QUALITY_PREDICTIONS` |
| 19 | MES-TD3-019 | LOT 추적 | `/shp/lot-trace` | 개발2 | `shp` | `SHP_LOT_TRACE`, `MAT_LOT_HISTORY`, `PRC_LOT_HISTORY`, `SHP_SHIPMENTS` |
| 20 | MES-TD3-020 | 검사결과 관리 | `/shp/inspections` | 개발2 | `shp` | `SHP_INSPECTIONS`, `BAS_QUALITY_STANDARDS`, `SHP_PACKAGING` |
| 21 | MES-TD3-021 | 클레임 분석 | `/shp/claims` | 개발2 | `shp` | `SHP_CLAIMS`, `SHP_CLAIM_ACTIONS`, `SHP_SHIPMENTS` |
| 22 | MES-TD3-022 | 출하 AI Agent | `/agt/shipping-agent` | 개발3 | `agt` | `AGT_QUERY_HISTORY`, `AGT_VECTOR_DOCS`, `SHP_SHIPMENTS`, `SHP_LOT_TRACE` |
| 23 | MES-TD3-023 | 공정실적 관리 | `/prc/results` | 개발2 | `prc` | `PRC_RESULTS`, `BAS_PROCESSES`, `SYS_USERS` |
| 24 | MES-TD3-024 | 공정 데이터 모니터링 | `/prc/monitoring` | 개발2 | `prc` | `PRC_MONITORING`, `BAS_PROCESSES` |
| 25 | MES-TD3-025 | 레시피 관리 | `/prc/recipes` | 개발2 | `prc` | `PRC_RECIPES`, `PRC_RECIPE_HISTORY`, `BAS_PRODUCTS` |
| 26 | MES-TD3-026 | 공정 이력조회 | `/prc/lot-history` | 개발2 | `prc` | `PRC_LOT_HISTORY`, `PRC_RESULTS`, `BAS_PROCESSES` |
| 27 | MES-TD3-027 | 공정 데이터 분석 | `/prc/correlations` | 개발2 | `prc` | `PRC_CORRELATIONS`, `PRC_MONITORING`, `SHP_INSPECTIONS` |
| 28 | MES-TD3-028 | 사용자 관리 | `/sys/users` | 개발1 | `sys` | `SYS_USERS`, `SYS_ROLE_PERMISSIONS`, `SYS_LOGIN_HISTORY` |
| 29 | MES-TD3-029 | 로그 관리 | `/sys/logs` | 개발1 | `sys` | `SYS_ACCESS_LOGS`, `SYS_LOGIN_HISTORY`, `SYS_USERS` |
| 30 | MES-TD3-030 | 알림 설정 | `/sys/alert-rules` | 개발1 | `sys` | `SYS_ALERT_RULES`, `SYS_ALERT_HISTORY`, `SYS_USERS` |
| 31 | MES-TD3-031 | 시스템 설정 | `/sys/configs` | 개발1 | `sys` | `SYS_CONFIGS`, `BAS_COMMON_CODES` |
| 32 | MES-TD3-032 | 품질기준 관리 | `/bas/quality-standards` | 개발1 | `bas` | `BAS_QUALITY_STANDARDS`, `BAS_PRODUCTS`, `BAS_PROCESSES` |
| 33 | MES-TD3-033 | 작업표준 관리 | `/bas/work-standards` | 개발1 | `bas` | `BAS_WORK_STANDARDS`, `BAS_PROCESSES` |
| 34 | MES-TD3-034 | 공통코드 관리 | `/bas/common-codes` | 개발1 | `bas` | `BAS_COMMON_CODES`, `BAS_PRODUCTS`, `MAT_SUPPLIERS` |
| 35 | MES-TD3-035 | 데이터 통합관리 | `/dat/hub` | 개발1 | `dat` | `DAT_HUB_SOURCES`, `DAT_HUB_DATASETS`, `DAT_COLLECT_LOGS` |
| 36 | MES-TD3-036 | 데이터 조회 | `/dat/search` | 개발1 | `dat` | `DAT_HUB_DATASETS`, `SHP_LOT_TRACE`, `PRC_LOT_HISTORY` |
| 37 | MES-TD3-037 | 데이터 시각화 | `/dat/visualize` | 개발1 | `dat` | `DAT_VIEW_CONFIGS`, `DAT_HUB_DATASETS` |
| 38 | MES-TD3-038 | 데이터 다운로드 | `/dat/download` | 개발1 | `dat` | `DAT_DOWNLOAD_LOGS`, `DAT_HUB_DATASETS`, `SYS_USERS` |
| 39 | MES-TD3-039 | AI 학습 데이터 관리 | `/agt/ml-datasets` | 개발3 | `agt` | `DAT_ML_DATASETS`, `DAT_ML_DATASET_ITEMS`, `FMT_SENSOR_TIMESERIES` |
| 40 | MES-TD3-040 | 통합 AI 질의 | `/agt/query` | 개발3 | `agt` | `AGT_QUERY_HISTORY`, `AGT_VECTOR_DOCS`, `DAT_HUB_DATASETS` |
| 41 | MES-TD3-041 | 생산/품질 분석 | `/agt/analysis` | 개발3 | `agt` | `AGT_ANALYSIS_REPORTS`, `PRC_CORRELATIONS`, `SHP_INSPECTIONS` |
| 42 | MES-TD3-042 | 의사결정 지원 | `/agt/decision` | 개발3 | `agt` | `AGT_RECOMMENDS`, `FMT_QUALITY_PREDICTIONS`, `FMT_CONDITION_RECOMMENDS` |
| 43 | MES-TD3-043 | 알림 및 추천 | `/agt/recommend` | 개발3 | `agt` | `AGT_RECOMMENDS`, `SYS_ALERT_HISTORY`, `FMT_ANOMALY_ALERTS` |
| 44 | MES-TD3-044 | 사용자 질문이력 | `/agt/query-history` | 개발3 | `agt` | `AGT_QUERY_HISTORY`, `SYS_USERS` |
| 45 | MES-TD3-045 | 생산성 KPI 조회 | `/kpi/productivity` | 개발2 | `kpi` | `KPI_METRICS`, `KPI_ACHIEVEMENTS`, `PRC_RESULTS` |
| 46 | MES-TD3-046 | 품질 KPI 조회 | `/kpi/quality` | 개발2 | `kpi` | `KPI_METRICS`, `KPI_ACHIEVEMENTS`, `SHP_INSPECTIONS`, `SHP_CLAIMS` |
| 47 | MES-TD3-047 | KPI 목표관리 | `/kpi/targets` | 개발2 | `kpi` | `KPI_TARGETS`, `KPI_METRICS`, `KPI_ACHIEVEMENTS` |

변경 요청마다 원본 자료·화면 ID·유지/변경 항목·결정 ID·검증 결과를 기록한다.
