"""HTTP contracts: statuses, master data, development identity and permissions."""
import pytest
from test_workflow import ADMIN, OP, invoice, ok, setup


def test_health(client):
    assert ok(client.get('/api/health'))['status'] == 'ok'


@pytest.mark.parametrize('path,payload', [
    ('customers', {'customer_code': 'NEW'}), ('products', {'product_code': 'NEW'}),
    ('users', {'user_id': 'NEW', 'name': 'bad', 'role': 'SUPERUSER'}),
    ('ship-orders/generate', {}), ('invoices/generate', {}),
])
def test_business_input_errors_remain_400(client, path, payload):
    response = client.post('/api/' + path, json=payload)
    assert response.status_code == 400, response.text
    assert response.json()['error']


@pytest.mark.parametrize('path', ['customers/MISSING', 'products/MISSING', 'orders/MISSING', 'invoices/MISSING',
                                  'ship-orders/MISSING', 'orders/MISSING/trace', 'invoices/MISSING/trace'])
def test_missing_resources(client, path):
    assert client.get('/api/' + path).status_code == 404


def test_master_crud_duplicate_and_reference_validation(client):
    setup(client)
    for path, data in [('customers', {'customer_code': 'C1', 'name': 'dup'}),
                       ('products', {'product_code': 'P1', 'name': 'dup'}),
                       ('users', {'user_id': 'op1', 'name': 'dup', 'role': 'OPERATOR'}),
                       ('product-aliases', {'customer_code': 'C1', 'raw_name': '김치10kg', 'product_code': 'P1'})]:
        assert client.post('/api/' + path, json=data).status_code == 409
    changed = ok(client.put('/api/customers/C1', json={'erp_customer_code': 'ERP-C1', 'name': '수정'}))
    assert changed['erp_customer_code'] == 'ERP-C1'
    changed = ok(client.put('/api/products/P1', json={'name': '수정제품', 'default_price': 123}))
    assert changed['default_price'] == 123
    assert client.post('/api/product-aliases', json={'customer_code': 'NOPE', 'raw_name': 'x', 'product_code': 'P1'}).status_code == 400
    assert client.post('/api/customers/C1/prices', json={'product_code': 'NOPE', 'unit_price': 100, 'effective_from': '2026-01-01'}).status_code == 400


def test_delivery_sites_and_effective_prices(client):
    setup(client)
    for name in ['센터A', '센터B']:
        ok(client.post('/api/customers/C1/delivery-sites', json={'site_name': name, 'address': '평창'}), 201)
    assert len(ok(client.get('/api/customers/C1/delivery-sites'))) == 2
    assert client.post('/api/customers/NOPE/delivery-sites', json={'site_name': '센터'}).status_code == 404
    ok(client.post('/api/customers/C1/prices', json={'product_code': 'P1', 'unit_price': 90, 'effective_from': '2026-01-01'}), 201)
    assert ok(client.get('/api/customers/C1/prices'))[0]['unit_price'] == 90


@pytest.mark.parametrize('headers,status', [({}, 401), ({'X-User-Id': 'ghost'}, 401), ({'X-User-Id': 'viewer1'}, 403)])
def test_issue_requires_operator_identity(client, headers, status):
    setup(client)
    _, _, number, _ = invoice(client)
    assert client.post(f'/api/invoices/{number}/issue', headers=headers).status_code == status
    assert ok(client.get(f'/api/invoices/{number}'))['status'] == 'DRAFT'


def test_admin_threshold_and_inherited_operator_permission(client):
    setup(client)
    assert client.put('/api/settings/approval-amount-threshold', headers=OP, json={'value': 500}).status_code == 403
    assert ok(client.put('/api/settings/approval-amount-threshold', headers=ADMIN, json={'value': 500}))['value'] == 500
    _, _, number, _ = invoice(client)
    ok(client.post(f'/api/invoices/{number}/issue', headers=ADMIN))
    assert ok(client.get(f'/api/invoices/{number}/approval'))['required'] is True


def test_matching_get_is_read_only_but_explicit_usage_is_recorded(client):
    setup(client)
    before = ok(client.get('/api/product-aliases'))
    for name, kind in [('김치10kg', 'EXACT'), ('김치 10KG', 'NORMALIZED')]:
        match = ok(client.get('/api/product-aliases/match', params={'customer_code': 'C1', 'raw_name': name}))
        assert match['matchType'] == kind
        assert match['product_code'] == 'P1'
    assert ok(client.get('/api/product-aliases')) == before
    used = ok(client.post(f"/api/product-aliases/{before[0]['id']}/use"))
    assert used['use_count'] == before[0]['use_count'] + 1


def test_malformed_json_is_framework_validation_error(client):
    response = client.post('/api/customers', content='{', headers={'Content-Type': 'application/json'})
    assert response.status_code == 422
