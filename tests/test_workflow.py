"""PostgreSQL HTTP regression scenarios, using real upload and state transitions."""
from io import BytesIO

import pytest
from openpyxl import Workbook, load_workbook

COLUMNS = [
    ('order_date', '주문일자'), ('customer_code', '거래처코드'), ('customer_name', '거래처명'),
    ('delivery_site_name', '납품처명'), ('delivery_address', '배송지 주소'), ('receiver_name', '수령인'),
    ('receiver_phone', '연락처'), ('raw_product_name', '제품명(거래처 표기)'), ('spec', '규격'),
    ('quantity', '수량'), ('unit', '단위'), ('unit_price', '단가'), ('ship_due_date', '출고예정일'),
    ('ship_method', '배송방법'), ('customer_order_no', '거래처 주문번호'), ('note', '비고'),
]
OP = {'X-User-Id': 'op1'}
ADMIN = {'X-User-Id': 'admin1'}


def ok(response, status=200):
    assert response.status_code == status, response.text
    return response.json()


def setup(client, *, approval=False, price=100, tax_type='TAXABLE'):
    ok(client.post('/api/customers', json={'customer_code': 'C1', 'name': '거래처', 'approval_required': approval}), 201)
    ok(client.post('/api/products', json={'product_code': 'P1', 'name': '배추김치 10kg', 'default_price': price, 'tax_type': tax_type}), 201)
    ok(client.post('/api/product-aliases', json={'customer_code': 'C1', 'raw_name': '김치10kg', 'product_code': 'P1'}), 201)
    for uid, role in [('op1', 'OPERATOR'), ('admin1', 'ADMIN'), ('viewer1', 'VIEWER')]:
        ok(client.post('/api/users', json={'user_id': uid, 'name': role, 'role': role}), 201)


def row(**changes):
    return {'order_date': '2026-11-03', 'customer_code': 'C1', 'raw_product_name': '김치10kg', 'quantity': 10,
                'unit_price': 100, 'ship_due_date': '2026-11-05'} | changes


def workbook(rows):
    wb = Workbook()
    ws = wb.active
    ws.append([header for _, header in COLUMNS])
    for values in rows:
        ws.append([values.get(key) for key, _ in COLUMNS])
    stream = BytesIO()
    wb.save(stream)
    return stream.getvalue()


def preview(client, rows):
    return ok(client.post('/api/orders/upload/preview', files={'file': ('orders.xlsx', workbook(rows))}))


def upload(client, rows=None):
    parsed = preview(client, rows if rows is not None else [row()])
    assert parsed['errorCount'] == 0, parsed
    result = ok(client.post('/api/orders/upload/commit', json={'rows': parsed['rows']}), 201)
    assert result['errors'] == [], result
    return result['orders']


def ship(client, rows=None, actual=None):
    orders = upload(client, rows)
    for number in orders:
        ok(client.post(f'/api/orders/{number}/confirm'))
    generated = ok(client.post('/api/ship-orders/generate', json={'ship_date': '2026-11-05'}), 201)
    number = generated['shipOrders'][0]
    detail = ok(client.get(f'/api/ship-orders/{number}'))
    for line in detail['lines']:
        qty = line['instructed_qty'] if actual is None else actual
        ok(client.post(f"/api/ship-orders/lines/{line['ship_order_dtl_id']}/results", json={
            'actual_qty': qty, 'diff_reason_code': 'DAMAGED' if qty != line['instructed_qty'] else None,
            'pack_lot': 'PACK-001'}), 201)
    return orders, number, detail


def invoice(client, rows=None, actual=None):
    orders, shipment, detail = ship(client, rows, actual)
    generated = ok(client.post('/api/invoices/generate', json={'invoice_date': '2026-11-05'}), 201)
    return orders, shipment, generated['invoices'][0], detail


def test_full_workflow_actual_quantity_trace_approval_erp_and_audit(client):
    setup(client, approval=True)
    orders, shipment, number, _ = invoice(client, actual=8)
    inv = ok(client.get(f'/api/invoices/{number}'))
    assert inv['lines'][0]['quantity'] == 8
    assert inv['lines'][0]['supply_amount'] == 800
    assert ok(client.get('/api/orders/pending-invoice')) == []
    trace = ok(client.get(f'/api/orders/{orders[0]}/trace'))
    assert [s['ship_order_no'] for s in trace['ship_orders']] == [shipment]
    assert [i['invoice_no'] for i in trace['invoices']] == [number]
    reverse = ok(client.get(f'/api/invoices/{number}/trace'))
    assert reverse['orders'] == [{'order_no': orders[0], 'status': 'INVOICED'}]
    assert reverse['ship_orders'] == [shipment]
    assert client.post(f'/api/invoices/{number}/erp/send', headers=OP).status_code == 409
    ok(client.post(f'/api/invoices/{number}/issue', headers=OP))
    assert client.post(f'/api/invoices/{number}/issue', headers=OP).status_code == 409
    assert client.post(f'/api/invoices/{number}/erp/send', headers=OP).status_code == 409
    approval = ok(client.post(f'/api/invoices/{number}/approve', headers=OP))
    assert approval['approved'] is True
    assert approval['history'][0]['user_id'] == 'op1'
    assert client.post(f'/api/invoices/{number}/approve', headers=OP).status_code == 409
    ok(client.post(f'/api/invoices/{number}/erp/send', headers=OP))
    ok(client.post(f'/api/invoices/{number}/erp/confirm', headers=OP, json={'success': True, 'erp_invoice_no': 'ERP-001'}))
    assert client.post(f'/api/invoices/{number}/erp/send', headers=OP).status_code == 409
    events = ok(client.get('/api/audit-log', params={'entity_type': 'INVOICE', 'entity_id': number}))
    assert {'INVOICE_ISSUE', 'ERP_SEND', 'ERP_CONFIRM'} <= {e['action'] for e in events}
    assert all(e['created_at'] for e in events)


def test_actual_result_difference_and_invoice_consistency(client):
    setup(client)
    _orders, _shipment, number, detail = invoice(client)
    line = detail['lines'][0]['ship_order_dtl_id']
    assert client.post(f'/api/ship-orders/lines/{line}/results', json={'actual_qty': 1}).status_code == 400
    ok(client.post(f'/api/ship-orders/lines/{line}/results', json={'actual_qty': 1, 'diff_reason_code': 'EXTRA'}), 201)
    assert client.post(f'/api/invoices/{number}/issue', headers=OP).status_code == 422


def test_combined_shipments_allocate_actual_quantity(client):
    setup(client)
    _orders, _shipment, number, detail = invoice(client, [row(quantity=6, customer_order_no='A'), row(quantity=4, customer_order_no='B')], actual=5)
    assert len(detail['lines']) == 1
    assert detail['lines'][0]['instructed_qty'] == 10
    inv = ok(client.get(f'/api/invoices/{number}'))
    assert sorted(line['quantity'] for line in inv['lines']) == [2, 3]
    assert sum(line['supply_amount'] for line in inv['lines']) == 500


def test_mapping_queue_validation_and_state_history(client):
    setup(client)
    orders = upload(client, [row(raw_product_name='새 표기', customer_order_no='A'), row(raw_product_name='새 표기', customer_order_no='B')])
    queue = ok(client.get('/api/mapping-queue'))
    assert queue[0]['line_count'] == 2
    assert client.post(f'/api/orders/{orders[0]}/confirm').status_code == 422
    resolved = ok(client.post('/api/mapping-queue/resolve', json={'customer_code': 'C1', 'raw_name': '새 표기', 'product_code': 'P1'}))
    assert resolved['updatedLines'] == 2
    assert ok(client.get('/api/mapping-queue')) == []
    ok(client.put(f'/api/orders/{orders[0]}', json={'note': '수정'}, headers=OP))
    ok(client.post(f'/api/orders/{orders[0]}/confirm'))
    assert client.post(f'/api/orders/{orders[0]}/confirm').status_code == 409
    assert client.put(f'/api/orders/{orders[0]}', json={'note': '불가'}).status_code == 409
    pending = ok(client.get('/api/orders/pending-shipment'))
    assert [o['order_no'] for o in pending] == [orders[0]]


def test_partial_commit_revalidates_rows_and_rolls_back_invalid_group(client):
    setup(client)
    rows = preview(client, [row(customer_order_no='GOOD'), row(customer_order_no='BAD'), row(customer_order_no='BAD')])['rows']
    rows[-1]['values']['quantity'] = 0
    result = ok(client.post('/api/orders/upload/commit', json={'rows': rows}), 201)
    assert len(result['orders']) == 1
    assert len(result['errors']) == 1
    saved = ok(client.get('/api/orders'))
    assert len(saved) == 1
    assert saved[0]['customer_order_no'] == 'GOOD'


@pytest.mark.parametrize('changes,column', [
    ({'quantity': 0}, '수량'), ({'quantity': 1.5}, '수량'), ({'unit_price': -1}, '단가'),
    ({'customer_code': 'NOPE'}, '거래처코드'), ({'raw_product_name': None}, '제품명(거래처 표기)'),
    ({'ship_due_date': None}, '출고예정일'), ({'ship_due_date': '2026-11-01'}, '출고예정일'),
    ({'order_date': 'not-a-date'}, '주문일자'),
])
def test_upload_errors_include_row_column_and_reason(client, changes, column):
    setup(client)
    result = preview(client, [row(), row(**changes)])
    assert (result['validCount'], result['errorCount']) == (1, 1)
    bad = result['rows'][1]
    assert bad['rowNumber'] == 3
    assert any(e['column'] == column and e['reason'] for e in bad['errors'])


def test_upload_template_and_empty_workbook(client):
    response = client.get('/api/orders/upload-template')
    assert response.status_code == 200
    ws = load_workbook(BytesIO(response.content)).active
    assert list(next(ws.values)) == [header for _, header in COLUMNS]
    assert preview(client, [])['totalRows'] == 0


def test_group_failure_after_first_line_rolls_back_header_lines_site_and_history(client, db, monkeypatch):
    from kkotsuni.app.errors import BusinessError
    from kkotsuni.services import matching

    setup(client)
    parsed = preview(client, [row(customer_order_no='GOOD'),
                              row(customer_order_no='BAD', delivery_site_name='임시센터'),
                              row(customer_order_no='BAD', delivery_site_name='임시센터', raw_product_name='FAIL')])['rows']
    original = matching.match

    def fail_second_line(connection, customer_code, raw_name, **kwargs):
        if raw_name == 'FAIL':
            raise BusinessError('injected second-line failure')
        return original(connection, customer_code, raw_name, **kwargs)

    monkeypatch.setattr(matching, 'match', fail_second_line)
    result = ok(client.post('/api/orders/upload/commit', json={'rows': parsed}), 201)
    assert len(result['orders']) == 1 and len(result['errors']) == 1
    assert db.one('SELECT count(*) AS n FROM order_hdr')['n'] == 1
    assert db.one('SELECT count(*) AS n FROM order_dtl')['n'] == 1
    assert db.one('SELECT count(*) AS n FROM order_status_log')['n'] == 1
    assert db.one('SELECT count(*) AS n FROM delivery_site')['n'] == 0


def test_multiple_product_order_finishes_only_after_all_results(client):
    setup(client)
    ok(client.post('/api/products', json={'product_code': 'P2', 'name': '깍두기', 'default_price': 200}), 201)
    ok(client.post('/api/product-aliases', json={'customer_code': 'C1', 'raw_name': '깍두기', 'product_code': 'P2'}), 201)
    [number] = upload(client, [row(), row(raw_product_name='깍두기', quantity=5)])
    ok(client.post(f'/api/orders/{number}/confirm'))
    generated = ok(client.post('/api/ship-orders/generate', json={'ship_date': '2026-11-05'}), 201)
    shipment = generated['shipOrders'][0]
    lines = ok(client.get(f'/api/ship-orders/{shipment}'))['lines']
    assert len(lines) == 2
    for index, line in enumerate(lines):
        ok(client.post(f"/api/ship-orders/lines/{line['ship_order_dtl_id']}/results", json={'actual_qty': line['instructed_qty']}), 201)
        assert ok(client.get(f'/api/orders/{number}'))['status'] == ('SHIP_ORDERED' if index == 0 else 'SHIPPED')
    assert ok(client.get(f'/api/ship-orders/{shipment}'))['status'] == 'RESULT_REGISTERED'
