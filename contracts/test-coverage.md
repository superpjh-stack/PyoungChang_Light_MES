# FastAPI 회귀 테스트 대응표

이 문서는 기존 22개 Vitest 파일의 업무 그룹과 Python 회귀 검증을 연결한다. 기존 136개 사례를 일대일로 모두 옮겼다는 의미가 아니다. 실행 결과는 별도 검증 기록을 따른다. PostgreSQL 연결이 없는 환경에서 생략된 테스트는 통과로 간주하지 않는다.

| 기존 그룹 | Python 대응 | 아직 직접 대응하지 않은 세부 사례 |
|---|---|---|
| health | test_api.test_health | 없음 |
| customers | master_crud_duplicate_and_reference_validation, delivery_sites_and_effective_prices, customer_missing_erp_mapping_filter | 없음 |
| products | master_crud_duplicate_and_reference_validation, matching_get_is_read_only_but_explicit_usage_is_recorded, alias_bulk_partial_failure_and_intersecting_filters | 없음 |
| productMatching | matching_get_is_read_only_but_explicit_usage_is_recorded, mapping_queue_validation_and_state_history, recommendations_top_three_are_deterministic_and_not_automatic_mapping, five_normalized_variants_map_on_upload | 추천 점수 모든 문자열의 비트 단위 동일성 |
| orderUpload | upload_template_and_empty_workbook, partial_commit_revalidates_rows_and_rolls_back_invalid_group | 100행 대량 업로드는 성능 검증에서 추가 필요 |
| orderUploadMessages | upload_errors_include_row_column_and_reason | 모든 기존 메시지 문구의 완전 동일성 |
| orderValidation | mapping_queue_validation_and_state_history, duplicate_order_warning_does_not_block_confirmation | 없음 |
| orderManagement | mapping_queue_validation_and_state_history, excel_exports_are_readable_and_include_document_data, order_filter_intersection_export_details_and_status_history | 각 상태 전이 전체 로그 조합 |
| shipOrders | concurrent_ship_generation_does_not_duplicate_allocations, combined_shipments_allocate_actual_quantity, ship_edit_revision_pack_conversion_and_product_filter_remainder | 없음 |
| shipResults | actual_result_difference_and_invoice_consistency, full_workflow_actual_quantity_trace_approval_erp_and_audit | 없음(복수 제품 일부 실적 상태 포함) |
| invoices | price_priority, javascript_positive_half_rounding_in_invoice, missing_price_skips_invoice_and_preview_does_not_write, excel_exports_are_readable_and_include_document_data, invoices_split_by_delivery_site_preserve_amounts_and_sources, approval_not_required_and_csv_columns_match_invoice | 없음 |
| invoiceConsistency | actual_result_difference_and_invoice_consistency, combined_shipments_allocate_actual_quantity, shipped_without_actual_results_excluded_from_invoice, issued_invoice_prevents_source_quantity_changes | 없음 |
| approval | full_workflow_actual_quantity_trace_approval_erp_and_audit, admin_threshold_and_inherited_operator_permission, threshold_null_disables_amount_rule_without_disabling_customer_rule, approval_not_required_and_csv_columns_match_invoice | 없음 |
| erpTransmission | full_workflow_actual_quantity_trace_approval_erp_and_audit, erp_failure_retry_and_file_contents, approval_not_required_and_csv_columns_match_invoice | 없음 |
| erpAvailability | erp_failure_retry_and_file_contents, batch_isolates_missing_approval_and_erp_failure_does_not_block_new_orders | 없음(장애 중 신규 업무·SENDING 혼합 배치 포함) |
| erpMasterSync | erp_master_sync_partial_errors_idempotent_update_and_audit, erp_master_resync_updates_without_duplicate | 없음 |
| rbacAudit | issue_requires_operator_identity, admin_threshold_and_inherited_operator_permission, full workflow audit, mapping_resolution_records_actor_and_alias_audit | 별칭 확정 감사의 상세 문자열 |
| trace | full_workflow_actual_quantity_trace_approval_erp_and_audit, mapping_queue_validation_and_state_history | 없음(대표 정/역추적·미처리·404 포함) |
| dashboard | dashboard_reconciles_pending_counts_and_mapping, dashboard_week_boundaries_overdue_and_received_exclusion, dashboard_erp_state_counts_and_issued_date | 없음 |
| schema | PostgreSQL migration tests + HTTP master references, postgresql_check_constraints_reject_invalid_updates | 없음(기존 날짜·수량 CHECK 사례 포함) |
| perf.orderUpload | test_performance.test_upload_1000_rows_within_five_minutes | 메모리 별도 프로파일링 미실행 |
| perf.shipInvoiceGeneration | test_performance.test_generate_400_orders_within_thirty_seconds | 메모리 별도 프로파일링 미실행 |

추가한 PostgreSQL 전용 검증: 동시 주문 채번, 동시 출고 생성 중복 배분 방지, 동시 명세서 생성 중복 청구 방지. 테스트는 장벽으로 동시에 HTTP 요청을 시작한다. 각 요청의 DB 연결은 앱 연결 의존성에서 독립적으로 생성되어야 한다.

의도적 계약 차이: GET 별칭 매칭은 조회만 수행하며 사용횟수를 증가시키거나 정규화 별칭을 새로 만들지 않는다. 명시적 POST 사용 기록은 유지한다. 업로드 commit은 클라이언트의 valid 표기를 신뢰하지 않고 각 행을 다시 검사하며 실패한 주문 그룹 전체를 되돌린다. 일반 업무 입력 오류는 400, 기존 주문 확정/명세서 정합성 오류는 422, 잘못된 JSON은 FastAPI 422로 검사한다.

## 실행 확인 (2026-10-31)

PostgreSQL 전용 격리 스키마, 로컬 테스트 DB(127.0.0.1:55437)에서 다음 네 파일 **60개 테스트 통과, 6.60초**를 확인했다.

```sh
uv run pytest tests/test_api.py tests/test_workflow.py tests/test_legacy_cases.py tests/test_concurrency.py -q
```

실행 전 `KKOTSUNI_TEST_DATABASE_URL`을 전용 DB URL로 설정했다. 실패했던 Decimal 오류 응답 직렬화 및 Excel 문서 헤더·원주문 참조 누락은 수정 후 재실행으로 확인했다. ERP 마스터 동기화 응답은 원본의 201에 맞춰 테스트 기대값을 바로잡았다. httpx 기반 Starlette TestClient 지원 중단 예정 경고 1건이 있으며 테스트 실패는 아니다. 이 결과는 다른 테스트 파일이나 성능·브라우저 검증 결과를 포함하지 않는다.

추가 누락 사례 보완: `tests/test_regression_gaps.py`의 **24개 테스트 통과, 3.61초**를 같은 PostgreSQL 환경에서 확인했다. ERP 미매핑/재동기화, 별칭 bulk·필터·추천·5종 정규화, 주문 필터·Excel 상세·상태 이력, 출고 제품 필터 잔여분·포장 환산·수정 이력, 납품처별 명세서, 승인 임계값 해제, CSV 컬럼, 대시보드 주간 경계·지연·ERP 집계, CHECK 롤백을 포함한다. 역순 날짜 배치 동시 업로드 8건의 채번·완료, 잘못된 자료형 그룹 격리, 발행 후 원 출고 수량 변경 차단도 통과했다. CSV 숫자는 Decimal 값으로 대조하며 정수 단가가 `100.000000` 대신 기존 `100`으로 출력되는 계약도 검사한다.

최종 통합 게이트는 115건 통과했으며 성능·브라우저·컨테이너 검증 결과는 [검증 기록](../docs/refactoring/verification.md)에 정리했다.

## 사용자별 시나리오 검토 반영 (2026-11-01)

`tests/test_access_and_accounts.py` 6건: 오류 화면 재저장 시 원래 화면 복귀, 관리자 계정 생성·비밀번호 재설정·역할 변경·사용 중지와 세션 폐기·본인 보호, 본인 비밀번호 변경(현재 세션 유지·다른 세션 폐기), VIEWER 쓰기 403·사용자 쓰기 ADMIN, 역할별 메뉴·HTML 403·현재 메뉴 1개 활성, 예/아니오·영문 열 이름 표시. 기존 승인 테스트 3곳은 승인 ADMIN 정책(MIG-17)에 맞게 OPERATOR 403 → ADMIN 성공으로 바꿨다. `make gate`: ruff 통과, 계약 69건, 테스트 133건 통과(로컬 전용 테스트 DB `kkotsuni_test`의 임시 스키마).

2026-11-02 MIG-20: `test_master_data_writes_are_admin_only` 추가 — 거래처·납품처·거래처 단가·제품 등록/수정 6개 API가 OPERATOR 403·ADMIN 성공, 조회와 별칭 등록은 OPERATOR 허용. `make gate`: ruff 통과, 계약 69건, 테스트 135건 통과.

2026-11-13 MIG-21: `test_invoice_pdf_template_supplier_settings_and_download` 추가 — 공급자 정보 기본값·ADMIN 전용 저장·200자 제한, 템플릿에 문서번호·거래처·품목·한글 합계금액·초안 표시가 들어가고 발행 후 초안 표시가 사라지는지, `/api`와 `/downloads` 양쪽에서 `application/pdf`가 내려오는지, 없는 명세서 404, 상세 화면 링크. `make gate`: ruff 통과, 계약 72건, 테스트 136건 통과.

2026-11-13 MIG-22: `test_notes_menu_keeps_dated_records_and_viewer_is_read_only` 추가 — 기록 등록·최신순 조회·작성자 기록, 빈 제목 400, VIEWER 쓰기 403, 메뉴 맨 아래 Note 링크와 화면 표시. `make gate`: ruff 통과, 계약 74건, 테스트 137건 통과.

2026-11-13 MIG-23: `test_shipping_request_pdf_uses_company_layout_and_paginates` 추가 — 양식 항목·작성자·작성일자 표시, 21행 단위 쪽 나눔, 미로그인 401, VIEWER 다운로드, 없는 출고지시 404, 상세·양식 화면의 PDF 링크. `make gate`: ruff 통과, 계약 74건, 테스트 138건 통과.

2026-11-13 대시보드: `test_dashboard_shows_mapping_backlog_recent_notes_and_setup_gaps` 추가 — 매핑 대기 표기명·줄 수와 상위 목록, 최근 Note, 과세구분 확인 제품 수, 공급자 등록번호 미입력 안내, 조회 기간 밖 수주 안내. `make gate`: ruff 통과, 계약 74건, 테스트 139건 통과.
