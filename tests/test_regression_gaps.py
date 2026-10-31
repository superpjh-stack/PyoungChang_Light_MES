"""Additional legacy acceptance boundaries omitted by the first workflow pass."""
from io import BytesIO

import pytest
from openpyxl import load_workbook
from test_workflow import ADMIN, OP, invoice, ok, row, setup, upload


def product_two(client):
    ok(client.post('/api/products', json={'product_code': 'P2', 'name': '깍두기', 'default_price': 200}), 201)
    ok(client.post('/api/product-aliases', json={'customer_code': 'C1', 'raw_name': '깍두기', 'product_code': 'P2'}), 201)


def test_customer_missing_erp_mapping_filter(client):
    setup(client)
    for code, erp in [('C2', ''), ('C3', 'ERP3')]:
        ok(client.post('/api/customers', json={'customer_code': code, 'name': code, 'erp_customer_code': erp}), 201)
    assert {c['customer_code'] for c in ok(client.get('/api/customers', params={'missingErpMapping': 'true'}))} == {'C1', 'C2'}
    assert len(ok(client.get('/api/customers'))) == 3


def test_alias_bulk_partial_failure_and_intersecting_filters(client):
    setup(client)
    product_two(client)
    ok(client.post('/api/customers', json={'customer_code': 'C2', 'name': '다른거래처'}), 201)
    values = [{'customer_code': c, 'product_code': p, 'raw_name': n} for c, p, n in
              [('C1', 'P1', '새김치'), ('C1', 'P2', '새깍두기'), ('C2', 'P1', '다른김치'), ('C1', 'NOPE', '오류')]]
    result = ok(client.post('/api/product-aliases/bulk', json={'aliases': values}), 201)
    assert len(result['created']) == 3 and len(result['errors']) == 1
    filtered = ok(client.get('/api/product-aliases', params={'customer_code': 'C1', 'product_code': 'P1'}))
    assert {a['raw_name'] for a in filtered} == {'김치10kg', '새김치'}


def test_recommendations_top_three_are_deterministic_and_not_automatic_mapping(client):
    setup(client)
    for code, name in [('P5', '배추김치 10kg'), ('P4', '배추김치 10kg'), ('P3', '총각김치 5kg'), ('P2', '백김치 10kg')]:
        ok(client.post('/api/products', json={'product_code': code, 'name': name}), 201)
    params = {'customer_code': 'C1', 'raw_name': '배추김치10kg'}
    first = ok(client.get('/api/product-aliases/match', params=params))
    assert first == ok(client.get('/api/product-aliases/match', params=params))
    assert first['matchType'] == 'SUGGESTED' and first['product_code'] is None
    candidates = first['candidates']
    assert len(candidates) == 3
    assert [c['product_code'] for c in candidates] == ['P1', 'P4', 'P5']
    assert all(c['score'] > 0.5 for c in candidates)
    assert len(ok(client.get('/api/product-aliases'))) == 1


def test_order_filter_intersection_export_details_and_status_history(client):
    setup(client)
    product_two(client)
    [target] = upload(client, [row(customer_order_no='TARGET', quantity=7), row(customer_order_no='TARGET', raw_product_name='깍두기', quantity=2)])
    [other] = upload(client, [row(order_date='2026-11-02', customer_order_no='OTHER')])
    ok(client.post(f'/api/orders/{target}/confirm'))
    params = {'customer_code': 'C1', 'product_code': 'P2', 'status': 'CONFIRMED',
              'order_date_from': '2026-11-03', 'order_date_to': '2026-11-03',
              'ship_due_date_from': '2026-11-05', 'ship_due_date_to': '2026-11-05'}
    assert [o['order_no'] for o in ok(client.get('/api/orders', params=params))] == [target]
    assert ok(client.get('/api/orders', params=params | {'status': 'RECEIVED'})) == []
    history = ok(client.get(f'/api/orders/{target}/status-history'))
    assert [(h['from_status'], h['to_status']) for h in history] == [(None, 'RECEIVED'), ('RECEIVED', 'CONFIRMED')]
    result = client.get('/api/orders/export', params=params)
    assert result.status_code == 200
    cells = [str(c) for values in load_workbook(BytesIO(result.content)).active.values for c in values if c is not None]
    assert target in cells and other not in cells
    assert {'P1', 'P2', '김치10kg', '깍두기', '7', '2'} <= set(cells)


def test_ship_edit_revision_pack_conversion_and_product_filter_remainder(client):
    setup(client)
    product_two(client)
    ok(client.put('/api/products/P1', json={'pack_size': 5, 'pack_unit': 'PALLET'}))
    [number] = upload(client, [row(), row(raw_product_name='깍두기', quantity=3)])
    ok(client.post(f'/api/orders/{number}/confirm'))
    first = ok(client.post('/api/ship-orders/generate', json={'ship_date': '2026-11-05', 'product_code': 'P1'}), 201)
    line = ok(client.get('/api/ship-orders/' + first['shipOrders'][0]))['lines'][0]
    assert line['packed_qty'] == 2 and line['pack_unit'] == 'PALLET'
    assert ok(client.get(f'/api/orders/{number}'))['status'] == 'CONFIRMED'
    changed = ok(client.put(f"/api/ship-orders/lines/{line['ship_order_dtl_id']}", json={'instructed_qty': 15, 'note': '수량변경', 'changed_by': '작업자'}))
    assert changed['packed_qty'] == 3
    history = ok(client.get(f"/api/ship-orders/lines/{line['ship_order_dtl_id']}/revisions"))
    assert {h['field'] for h in history} == {'instructed_qty', 'note'}
    assert all(h['changed_by'] == '작업자' for h in history)
    remaining = ok(client.post('/api/ship-orders/generate', json={'ship_date': '2026-11-05'}), 201)
    assert remaining['totalInstructedQty'] == 3
    assert ok(client.get(f'/api/orders/{number}'))['status'] == 'SHIP_ORDERED'
    assert ok(client.post('/api/ship-orders/generate', json={'ship_date': '2026-11-05'}), 201)['shipOrders'] == []


@pytest.mark.parametrize('split,expected', [(False, 1), (True, 2)])
def test_invoices_split_by_delivery_site_preserve_amounts_and_sources(client, split, expected):
    setup(client)
    orders = upload(client, [row(delivery_site_name='센터A', customer_order_no='A', quantity=3),
                             row(delivery_site_name='센터B', customer_order_no='B', quantity=7)])
    for number in orders:
        ok(client.post(f'/api/orders/{number}/confirm'))
    generated = ok(client.post('/api/ship-orders/generate', json={'ship_date': '2026-11-05'}), 201)
    assert len(generated['shipOrders']) == 2
    for number in generated['shipOrders']:
        for line in ok(client.get(f'/api/ship-orders/{number}'))['lines']:
            ok(client.post(f"/api/ship-orders/lines/{line['ship_order_dtl_id']}/results", json={'actual_qty': line['instructed_qty']}), 201)
    query = {'invoice_date': '2026-11-05', 'split_by_delivery_site': 'true' if split else 'false'}
    assert len(ok(client.get('/api/invoices/preview', params=query))['groups']) == expected
    result = ok(client.post('/api/invoices/generate', json=query), 201)
    assert len(result['invoices']) == expected
    details = [ok(client.get(f'/api/invoices/{n}')) for n in result['invoices']]
    assert sum(d['supply_amount'] for d in details) == 1000
    assert {line['order_no'] for d in details for line in d['lines']} == set(orders)
    if split:
        assert all(len(d['lines']) == 1 for d in details)


def test_threshold_null_disables_amount_rule_without_disabling_customer_rule(client):
    setup(client)
    _, _, number, _ = invoice(client)
    ok(client.put('/api/settings/approval-amount-threshold', json={'value': 500}, headers=ADMIN))
    assert ok(client.get(f'/api/invoices/{number}/approval'))['required'] is True
    assert ok(client.put('/api/settings/approval-amount-threshold', json={'value': None}, headers=ADMIN))['value'] is None
    assert ok(client.get(f'/api/invoices/{number}/approval'))['required'] is False
    ok(client.put('/api/customers/C1', json={'approval_required': True}))
    assert ok(client.get(f'/api/invoices/{number}/approval'))['required'] is True


@pytest.mark.parametrize('kind,key,code,erpkey', [('customers', 'customer_code', 'C9', 'erp_customer_code'), ('products', 'product_code', 'P9', 'erp_item_code')])
def test_erp_master_resync_updates_without_duplicate(kind, key, code, erpkey, client):
    setup(client)
    data = {'rows': [{key: code, 'name': '첫이름', erpkey: 'ERP9'}]}
    assert ok(client.post('/api/erp-sync/' + kind, json=data, headers=ADMIN), 201)['createdCount'] == 1
    data['rows'][0]['name'] = '수정이름'
    again = ok(client.post('/api/erp-sync/' + kind, json=data, headers=ADMIN), 201)
    assert again['createdCount'] == 0 and again['updatedCount'] == 1
    saved = [item for item in ok(client.get('/api/' + kind)) if item[key] == code]
    assert len(saved) == 1 and saved[0]['name'] == '수정이름' and saved[0][erpkey] == 'ERP9'


def test_dashboard_week_boundaries_overdue_and_received_exclusion(client):
    setup(client)
    numbers = upload(client, [row(order_date=d, ship_due_date=due, quantity=q, customer_order_no=d) for d, due, q in
                              [('2026-11-03', '2026-11-05', 100), ('2026-11-04', '2026-11-08', 10),
                               ('2026-11-10', '2026-11-10', 5), ('2026-11-11', '2026-11-15', 200)]])
    for number in numbers[1:3]:
        ok(client.post(f'/api/orders/{number}/confirm'))
    dashboard = ok(client.get('/api/dashboard/summary', params={'date': '2026-11-10'}))
    assert dashboard['today'] == {'date': '2026-11-10', 'orderCount': 1, 'orderQty': 5}
    assert dashboard['week'] == {'from': '2026-11-04', 'to': '2026-11-10', 'orderCount': 2, 'orderQty': 15}
    assert dashboard['shipment']['pendingShipmentCount'] == 2
    assert [s['order_no'] for s in dashboard['shipment']['overdueShipments']] == [numbers[1]]


def test_dashboard_erp_state_counts_and_issued_date(client):
    setup(client)
    for state in ['PENDING', 'SENDING', 'SUCCESS', 'FAILED']:
        _, _, number, _ = invoice(client)
        ok(client.post(f'/api/invoices/{number}/issue', headers=OP))
        if state != 'PENDING':
            ok(client.post(f'/api/invoices/{number}/erp/send', headers=OP))
        if state in ('SUCCESS', 'FAILED'):
            ok(client.post(f'/api/invoices/{number}/erp/confirm', headers=OP, json={'success': state == 'SUCCESS', 'error_message': '실패' if state == 'FAILED' else None}))
    dashboard = ok(client.get('/api/dashboard/summary', params={'date': '2026-11-05'}))
    assert dashboard['erp'] == {'pendingCount': 1, 'sendingCount': 1, 'successCount': 1, 'failedCount': 1}
    assert dashboard['invoice']['issuedTodayCount'] == 4
    assert ok(client.get('/api/dashboard/summary', params={'date': '2026-11-06'}))['invoice']['issuedTodayCount'] == 0


def test_five_normalized_variants_map_on_upload(client):
    setup(client)
    variants = ['김치10kg', '김치 10KG', '김치-10kg', ' 김치10kg ', '김치_10Kg']
    numbers = upload(client, [row(raw_product_name=name, customer_order_no=str(i)) for i, name in enumerate(variants)])
    assert len(numbers) == 5
    assert all(ok(client.get(f'/api/orders/{n}'))['lines'][0]['product_code'] == 'P1' for n in numbers)
    assert ok(client.get('/api/mapping-queue')) == []


def test_duplicate_order_warning_does_not_block_confirmation(client):
    setup(client)
    numbers = upload(client, [row(customer_order_no='A'), row(customer_order_no='B')])
    validation = ok(client.get(f'/api/orders/{numbers[0]}/validate'))
    assert validation['warnings']
    for number in numbers:
        ok(client.post(f'/api/orders/{number}/confirm'))


def test_shipped_without_actual_results_excluded_from_invoice(client, db):
    setup(client)
    [number] = upload(client)
    db.x("UPDATE order_hdr SET status='SHIPPED' WHERE order_no=%s", (number,))
    result = ok(client.post('/api/invoices/generate', json={'invoice_date': '2026-11-05'}), 201)
    assert result['invoices'] == []
    assert result['excludedOrders'][0]['order_no'] == number
    assert '실적' in result['excludedOrders'][0]['reason']


def test_approval_not_required_and_csv_columns_match_invoice(client):
    import csv
    from decimal import Decimal
    from io import StringIO

    setup(client)
    ok(client.put('/api/customers/C1', json={'erp_customer_code': 'ERP-C1'}))
    ok(client.put('/api/products/P1', json={'erp_item_code': 'ERP-P1'}))
    _, _, number, _ = invoice(client, [row(unit='BOX', spec='10kg')])
    detail = ok(client.get(f'/api/invoices/{number}'))
    assert detail['customer_name'] == '거래처'
    assert detail['lines'][0]['product_name'] == '배추김치 10kg'
    ok(client.post(f'/api/invoices/{number}/issue', headers=OP))
    assert client.post(f'/api/invoices/{number}/approve', headers=OP).status_code == 400
    ok(client.post(f'/api/invoices/{number}/erp/send', headers=OP))
    result = client.get(f'/api/invoices/{number}/erp/import-file')
    assert result.status_code == 200
    data = list(csv.DictReader(StringIO(result.text)))
    assert len(data) == 1
    assert data[0]['단가'] == '100'
    for key in ['수량', '단가', '공급가액', '세액']:
        data[0][key] = format(Decimal(data[0][key]).normalize(), 'f')
    assert data[0] == {'명세서번호': number, '거래일자': '2026-11-05', '거래처코드': 'C1',
                       'ERP거래처코드': 'ERP-C1', '품목코드': 'P1', 'ERP품목코드': 'ERP-P1',
                       '규격': '10kg', '수량': '10', '단위': 'BOX', '단가': '100',
                       '공급가액': '1000', '세액': '100', '과세구분': 'TAXABLE'}


def test_mapping_resolution_records_actor_and_alias_audit(client):
    setup(client)
    upload(client, [row(raw_product_name='미매핑표기')])
    resolved = ok(client.post('/api/mapping-queue/resolve', headers=OP, json={'customer_code': 'C1', 'raw_name': '미매핑표기', 'product_code': 'P1'}))
    events = ok(client.get('/api/audit-log', params={'entity_type': 'PRODUCT_ALIAS', 'entity_id': resolved['alias']['id']}))
    entry = next(e for e in events if e['action'] == 'MAPPING_RESOLVE')
    assert entry['user_id'] == 'op1' and entry['created_at']


@pytest.mark.parametrize('statement', ["UPDATE order_dtl SET quantity=0", "UPDATE order_hdr SET ship_due_date='2026-01-01'"])
def test_postgresql_check_constraints_reject_invalid_updates(client, db, statement):
    import psycopg

    setup(client)
    [number] = upload(client)
    with pytest.raises(psycopg.errors.CheckViolation), db.tx():
        db.x(statement)
    saved = ok(client.get(f'/api/orders/{number}'))
    assert saved['ship_due_date'] == '2026-11-05' and saved['lines'][0]['quantity'] == 10


def test_concurrent_upload_reversed_date_batches_do_not_deadlock(client):
    from test_concurrency import race
    from test_workflow import preview

    setup(client)
    pairs = [[row(order_date=d, customer_order_no=f'{index}-{d}') for d in dates]
             for index, dates in enumerate([['2026-11-03', '2026-11-04'], ['2026-11-04', '2026-11-03'],
                                           ['2026-11-03', '2026-11-04'], ['2026-11-04', '2026-11-03']])]
    batches = [preview(client, values)['rows'] for values in pairs]
    responses = race(lambda index: client.post('/api/orders/upload/commit', json={'rows': batches[index]}))
    identifiers = []
    for response in responses:
        body = ok(response, 201)
        assert body['errors'] == []
        identifiers.extend(body['orders'])
    assert len(identifiers) == len(set(identifiers)) == 8
    assert len(ok(client.get('/api/orders'))) == 8


@pytest.mark.parametrize('bad_value', [{}, [], True])
def test_upload_scalar_field_validation_isolates_bad_group(client, bad_value):
    from test_workflow import preview

    setup(client)
    rows = preview(client, [row(customer_order_no='GOOD'), row(customer_order_no='BAD')])['rows']
    rows[1]['values']['raw_product_name'] = bad_value
    result = ok(client.post('/api/orders/upload/commit', json={'rows': rows}), 201)
    assert len(result['orders']) == 1 and len(result['errors']) == 1
    assert ok(client.get('/api/orders'))[0]['customer_order_no'] == 'GOOD'


def test_issued_invoice_prevents_source_quantity_changes(client):
    setup(client)
    _, shipment, number, detail = invoice(client)
    line_id = detail['lines'][0]['ship_order_dtl_id']
    ok(client.post(f'/api/invoices/{number}/issue', headers=OP))
    assert client.put(f'/api/ship-orders/lines/{line_id}', json={'instructed_qty': 15}).status_code == 409
    assert client.post(f'/api/ship-orders/lines/{line_id}/results', json={'actual_qty': 10}).status_code == 409
    assert ok(client.get(f'/api/ship-orders/{shipment}'))['lines'][0]['instructed_qty'] == 10
    assert ok(client.get(f'/api/invoices/{number}'))['supply_amount'] == 1000
