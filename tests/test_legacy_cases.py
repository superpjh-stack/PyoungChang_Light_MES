"""Focused legacy scenario groups: ERP recovery, prices, dashboard and exports."""
from io import BytesIO

import pytest
from openpyxl import load_workbook
from test_workflow import ADMIN, OP, invoice, ok, row, setup, ship, upload


def test_erp_failure_retry_and_file_contents(client):
    setup(client)
    _, _, number, _ = invoice(client)
    prefix = f'/api/invoices/{number}/erp'
    ok(client.post(f'/api/invoices/{number}/issue', headers=OP))
    assert client.post(prefix + '/confirm', headers=OP, json={'success': True}).status_code == 409
    sent = ok(client.post(prefix + '/send', headers=OP))
    assert sent['erp_send_status'] == 'SENDING'
    downloaded = client.get(prefix + '/import-file')
    assert downloaded.status_code == 200
    assert number in downloaded.text
    assert '1000' in downloaded.text
    assert client.post(prefix + '/confirm', headers=OP, json={'success': False}).status_code == 400
    failed = ok(client.post(prefix + '/confirm', headers=OP, json={'success': False, 'error_message': 'ERP 장애'}))
    assert failed['erp_send_status'] == 'FAILED'
    assert ok(client.post(prefix + '/retry', headers=OP))['erp_send_status'] == 'SENDING'
    assert client.post(prefix + '/retry', headers=OP).status_code == 409
    confirmed = ok(client.post(prefix + '/confirm', headers=OP, json={'success': True, 'erp_invoice_no': 'ERP-1'}))
    assert confirmed['erp_invoice_no'] == 'ERP-1'
    batch = ok(client.post('/api/invoices/erp/send-batch', headers=OP, json={'invoice_date': '2026-11-05'}))
    assert batch == []


def test_erp_master_sync_partial_errors_idempotent_update_and_audit(client):
    setup(client)
    data = {'rows': [{'customer_code': 'NEW', 'name': '신규'}, {'customer_code': 'BAD'}]}
    assert client.post('/api/erp-sync/customers', json=data).status_code == 401
    assert client.post('/api/erp-sync/customers', json=data, headers=OP).status_code == 403
    first = ok(client.post('/api/erp-sync/customers', json=data, headers=ADMIN), 201)
    assert first['createdCount'] == 1
    assert len(first['errors']) == 1
    second = ok(client.post('/api/erp-sync/customers', json={'rows': [{'customer_code': 'NEW', 'name': '수정'}]}, headers=ADMIN), 201)
    assert second['updatedCount'] == 1
    assert ok(client.get('/api/customers/NEW'))['name'] == '수정'
    prices = {'rows': [{'customer_code': 'C1', 'product_code': 'P1', 'unit_price': 90, 'effective_from': '2026-01-01'}]}
    assert ok(client.post('/api/erp-sync/customer-prices', headers=ADMIN, json=prices), 201)['createdCount'] == 1
    prices['rows'][0]['unit_price'] = 95
    assert ok(client.post('/api/erp-sync/customer-prices', headers=ADMIN, json=prices), 201)['updatedCount'] == 1
    saved = ok(client.get('/api/customers/C1/prices'))
    assert len(saved) == 1 and saved[0]['unit_price'] == 95
    events = ok(client.get('/api/audit-log', params={'entity_type': 'ERP_MASTER_SYNC'}))
    assert any(e['action'] == 'ERP_SYNC_CUSTOMERS' and e['user_id'] == 'admin1' for e in events)


@pytest.mark.parametrize('order_price,customer_price,default_price,expected', [
    (120, 90, 50, 120), (None, 90, 50, 90), (None, None, 50, 50), (0, 90, 50, 0),
])
def test_price_priority(client, order_price, customer_price, default_price, expected):
    setup(client, price=default_price)
    if customer_price is not None:
        ok(client.post('/api/customers/C1/prices', json={'product_code': 'P1', 'unit_price': customer_price, 'effective_from': '2026-01-01'}), 201)
        ok(client.post('/api/customers/C1/prices', json={'product_code': 'P1', 'unit_price': 999, 'effective_from': '2027-01-01'}), 201)
    _, _, number, _ = invoice(client, [row(unit_price=order_price)])
    saved = ok(client.get(f'/api/invoices/{number}'))
    assert saved['lines'][0]['unit_price'] == expected
    assert saved['supply_amount'] == expected * 10


@pytest.mark.parametrize('price,tax_type,supply,tax', [(0.5, 'TAXABLE', 1, 0), (5, 'TAXABLE', 5, 1), (15, 'TAXABLE', 15, 2), (15, 'EXEMPT', 15, 0)])
def test_javascript_positive_half_rounding_in_invoice(client, price, tax_type, supply, tax):
    setup(client, tax_type=tax_type)
    _, _, number, _ = invoice(client, [row(quantity=1, unit_price=price)])
    saved = ok(client.get(f'/api/invoices/{number}'))
    assert saved['supply_amount'] == supply
    assert saved['tax_amount'] == tax
    assert saved['total_amount'] == supply + tax


def test_missing_price_skips_invoice_and_preview_does_not_write(client):
    setup(client, price=None)
    orders, _, _ = ship(client, [row(unit_price=None)])
    preview = ok(client.get('/api/invoices/preview', params={'invoice_date': '2026-11-05'}))
    assert preview['groups'] == []
    assert ok(client.get('/api/invoices')) == []
    generated = ok(client.post('/api/invoices/generate', json={'invoice_date': '2026-11-05'}), 201)
    assert generated['invoices'] == []
    assert ok(client.get(f'/api/orders/{orders[0]}'))['status'] == 'SHIPPED'


def test_dashboard_reconciles_pending_counts_and_mapping(client):
    setup(client)
    upload(client, [row(raw_product_name='미매핑', quantity=3)])
    orders = upload(client, [row(quantity=5)])
    ok(client.post(f'/api/orders/{orders[0]}/confirm'))
    dashboard = ok(client.get('/api/dashboard/summary', params={'date': '2026-11-03'}))
    assert dashboard['today']['orderCount'] == 2
    assert dashboard['today']['orderQty'] == 8
    assert dashboard['mappingPendingCount'] == len(ok(client.get('/api/mapping-queue')))
    assert dashboard['shipment']['pendingShipmentCount'] == len(ok(client.get('/api/orders/pending-shipment')))
    assert dashboard['invoice']['pendingInvoiceCount'] == len(ok(client.get('/api/orders/pending-invoice')))


def test_excel_exports_are_readable_and_include_document_data(client):
    setup(client)
    orders, shipment, number, _ = invoice(client)
    for path, identifier in [('/api/orders/export', orders[0]), (f'/api/ship-orders/{shipment}/export', shipment),
                              (f'/api/invoices/{number}/export', number)]:
        result = client.get(path)
        assert result.status_code == 200, result.text
        wb = load_workbook(BytesIO(result.content))
        cells = [str(cell) for sheet in wb for values in sheet.values for cell in values if cell is not None]
        assert any(identifier in cell for cell in cells), (path, cells)
        assert 'P1' in cells, (path, cells)
        assert any(orders[0] in cell for cell in cells), (path, cells)
        if '/invoices/' in path:
            assert '1000' in cells


@pytest.mark.parametrize('value,expected', [('0.5', 1), ('1.5', 2), ('-0.5', 0), ('-1.5', -1), ('-1.500001', -2), ('2.499999', 2)])
def test_javascript_rounding_negative_and_fractional_boundaries(value, expected):
    from kkotsuni.services.common import js_round
    assert js_round(value) == expected


def test_batch_isolates_missing_approval_and_erp_failure_does_not_block_new_orders(client):
    setup(client, approval=True)
    _, _, required, _ = invoice(client)
    ok(client.post(f'/api/invoices/{required}/issue', headers=OP))
    ok(client.put('/api/customers/C1', json={'approval_required': False}))
    _, _, normal, _ = invoice(client)
    ok(client.post(f'/api/invoices/{normal}/issue', headers=OP))
    # Per-customer approval is evaluated dynamically, so an amount threshold isolates the larger invoice.
    ok(client.put('/api/settings/approval-amount-threshold', json={'value': 2000}, headers=ADMIN))
    _, _, blocked, _ = invoice(client, [row(quantity=30)])
    ok(client.post(f'/api/invoices/{blocked}/issue', headers=OP))
    batch = ok(client.post('/api/invoices/erp/send-batch', headers=OP, json={'invoice_date': '2026-11-05'}))
    entries = {entry['invoice_no']: entry for entry in batch}
    assert entries[blocked]['error']
    assert entries[normal]['status'] == 'SENDING'
    ok(client.post(f'/api/invoices/{normal}/erp/confirm', headers=OP, json={'success': False, 'error_message': 'ERP 장애'}))
    _, _, later, _ = invoice(client)
    assert ok(client.get(f'/api/invoices/{later}'))['status'] == 'DRAFT'
    recovery = ok(client.post('/api/invoices/erp/send-batch', headers=OP, json={'invoice_date': '2026-11-05'}))
    recovered = {entry['invoice_no']: entry for entry in recovery}
    assert recovered[normal]['status'] == 'SENDING'
    assert required not in recovered  # already SENDING; never exported twice
