"""Scenario-review fixes: return URL after errors, account administration, read-only VIEWER,
role-filtered menu, approver separation, pending-list menu items and display labels."""

import re

from test_login import PASSWORD, csrf, production_client
from test_workflow import ADMIN, OP, invoice, ok, row, setup, upload

from tools.create_user import provision

NEW_PASSWORD = 'changed-test-password!'


def sign_in(c, username, password=PASSWORD):
    token = csrf(c.get('/login'))
    return c.post('/login', data={'_csrf': token, 'username': username, 'password': password, 'next': '/'},
                  follow_redirects=False)


def action(c, path, target, method='POST', **fields):
    token = csrf(c.get(target))
    return c.post('/actions', data={'_csrf': token, '_path': path, '_return': target, '_method': method, **fields},
                  follow_redirects=False)


def test_error_page_forms_return_to_screen_not_actions(client):
    setup(client)
    for number in upload(client):
        ok(client.post(f'/api/orders/{number}/confirm'))
    shipment = ok(client.post('/api/ship-orders/generate', json={'ship_date': '2026-11-05'}), 201)['shipOrders'][0]
    line = ok(client.get(f'/api/ship-orders/{shipment}'))['lines'][0]['ship_order_dtl_id']
    target = f'/ship-orders/{shipment}'
    failed = action(client, f'/ship-orders/lines/{line}/results', target, actual_qty='9')
    assert failed.status_code == 400 and '차이 사유' in failed.text
    assert 'name="_return" value="/actions"' not in failed.text
    assert f'name="_return" value="{target}"' in failed.text
    # Re-submitting from the error page now lands back on the screen with a success message.
    token = csrf(failed)
    again = client.post('/actions', data={'_csrf': token, '_path': f'/ship-orders/lines/{line}/results',
                                          '_return': target, '_method': 'POST', 'actual_qty': '9',
                                          'diff_reason_code': '재고부족'}, follow_redirects=False)
    assert again.status_code == 303 and again.headers['location'] == target
    assert '저장했습니다' in client.get(target).text


def test_admin_creates_resets_and_disables_login_accounts(db, db_url):
    provision(db, 'admin', '관리자', 'ADMIN', PASSWORD)
    with production_client(db, db_url) as admin, production_client(db, db_url) as worker:
        assert sign_in(admin, 'admin').status_code == 303
        created = action(admin, '/users', '/users', user_id='pack01', name='포장', role='VIEWER', password=PASSWORD)
        assert created.status_code == 303
        page = admin.get('/users').text
        assert PASSWORD not in page and 'pbkdf2' not in page and 'href="/users/pack01"' in page
        assert sign_in(worker, 'pack01').status_code == 303
        assert worker.get('/orders').status_code == 200
        audit = db.q("SELECT action, detail FROM audit_log WHERE entity_type='USER' ORDER BY id")
        assert audit == [{'action': 'USER_CREATE', 'detail': 'VIEWER'}]
        # Short password is rejected and never echoed back into the form.
        short = action(admin, '/users/pack01/password', '/users/pack01', password='short')
        assert short.status_code == 400 and 'value="short"' not in short.text
        assert action(admin, '/users/pack01/password', '/users/pack01', password=NEW_PASSWORD).status_code == 303
        assert worker.get('/orders', follow_redirects=False).status_code == 303  # session revoked
        assert sign_in(worker, 'pack01', PASSWORD).status_code == 401
        assert sign_in(worker, 'pack01', NEW_PASSWORD).status_code == 303
        assert action(admin, '/users/pack01', '/users/pack01', 'PUT', name='포장반장', role='OPERATOR').status_code == 303
        assert db.one("SELECT role FROM app_user WHERE user_id='pack01'")['role'] == 'OPERATOR'
        assert action(admin, '/users/pack01/status', '/users/pack01', enabled='false').status_code == 303
        assert worker.get('/orders', follow_redirects=False).status_code == 303
        assert sign_in(worker, 'pack01', NEW_PASSWORD).status_code == 401
        own = action(admin, '/users/admin/status', '/users/admin', enabled='false')
        assert own.status_code == 409 and '본인 계정' in own.text
        demote = action(admin, '/users/admin', '/users/admin', 'PUT', name='관리자', role='VIEWER')
        assert demote.status_code == 409
        assert not db.q("SELECT 1 FROM audit_log WHERE detail LIKE %s", ('%' + NEW_PASSWORD + '%',))


def test_user_changes_own_password_and_keeps_current_session(db, db_url):
    provision(db, 'clerk', '경리', 'OPERATOR', PASSWORD)
    with production_client(db, db_url) as c, production_client(db, db_url) as other:
        assert sign_in(c, 'clerk').status_code == 303 and sign_in(other, 'clerk').status_code == 303
        page = c.get('/account/password')
        assert page.status_code == 200 and '현재 비밀번호' in page.text
        assert '비밀번호 변경' in c.get('/').text
        token = csrf(page)
        wrong = c.post('/account/password', data={'_csrf': token, 'current_password': 'nope',
                                                  'new_password': NEW_PASSWORD, 'new_password_confirm': NEW_PASSWORD})
        assert wrong.status_code == 400 and '현재 비밀번호가 올바르지 않습니다' in wrong.text
        mismatch = c.post('/account/password', data={'_csrf': token, 'current_password': PASSWORD,
                                                     'new_password': NEW_PASSWORD, 'new_password_confirm': 'x' * 9})
        assert mismatch.status_code == 400
        done = c.post('/account/password', data={'_csrf': token, 'current_password': PASSWORD,
                                                 'new_password': NEW_PASSWORD, 'new_password_confirm': NEW_PASSWORD},
                      follow_redirects=False)
        assert done.status_code == 303
        assert c.get('/orders').status_code == 200
        assert other.get('/orders', follow_redirects=False).status_code == 303
        assert sign_in(other, 'clerk', NEW_PASSWORD).status_code == 303


def test_viewer_is_read_only_and_users_are_admin_only(client):
    setup(client)
    viewer = {'X-User-Id': 'viewer1'}
    assert client.get('/api/orders', headers=viewer).status_code == 200
    for method, path, body in [('post', '/api/orders/upload/commit', {'rows': []}),
                               ('post', '/api/ship-orders/generate', {'ship_date': '2026-11-05'}),
                               ('post', '/api/mapping-queue/resolve', {})]:
        response = getattr(client, method)(path, json=body, headers=viewer)
        assert response.status_code == 403, (path, response.text)
        assert 'OPERATOR' in response.json()['error']
    assert client.post('/api/users', json={'user_id': 'x', 'name': 'x'}, headers=OP).status_code == 403
    assert client.post('/api/users', json={'user_id': 'x', 'name': 'x'}, headers=ADMIN).status_code == 201
    assert client.post('/api/users/x/password', json={'password': 'abc'}).status_code == 401



def test_master_data_writes_are_admin_only(client):
    setup(client)
    writes = [('post', '/api/customers', {'customer_code': 'C8', 'name': 'ok'}),
              ('put', '/api/customers/C1', {'name': '수정'}),
              ('post', '/api/customers/C1/delivery-sites', {'site_name': '센터'}),
              ('post', '/api/customers/C1/prices', {'product_code': 'P1', 'unit_price': 90, 'effective_from': '2026-01-01'}),
              ('post', '/api/products', {'product_code': 'P8', 'name': 'ok'}),
              ('put', '/api/products/P1', {'name': '수정'})]
    for method, path, body in writes:
        denied = getattr(client, method)(path, json=body, headers=OP)
        assert denied.status_code == 403 and 'ADMIN' in denied.json()['error'], path
    for method, path, body in writes:
        assert getattr(client, method)(path, json=body, headers=ADMIN).status_code in (200, 201), path
    assert client.get('/api/customers', headers=OP).status_code == 200
    # Mapping work stays with OPERATOR: aliases are not master maintenance.
    alias = {'customer_code': 'C1', 'raw_name': '배추10kg', 'product_code': 'P1'}
    assert client.post('/api/product-aliases', json=alias, headers=OP).status_code == 201


def test_menu_follows_role_and_admin_pages_render_html_403(db, db_url):
    provision(db, 'viewer', '조회', 'VIEWER', PASSWORD)
    provision(db, 'admin', '관리', 'ADMIN', PASSWORD)
    with production_client(db, db_url) as c:
        assert sign_in(c, 'viewer').status_code == 303
        home = c.get('/').text
        for hidden in ('주문 업로드', '원본 자료 가져오기', 'href="/users"', 'href="/settings"', 'href="/audit-log"'):
            assert hidden not in home
        assert 'href="/orders/pending-shipment"' in home and 'href="/orders/pending-invoice"' in home
        denied = c.get('/users')
        assert denied.status_code == 403 and denied.headers['content-type'].startswith('text/html')
        assert '관리자 권한이 필요합니다' in denied.text and '조회 · VIEWER' in denied.text
        assert c.get('/api/users').status_code == 403
        pending = c.get('/orders/pending-shipment').text
        # Only the exact menu item is active and only its group is open.
        assert pending.count('aria-current="page"') == 1
        assert re.search(r'class="active" aria-current="page">출고 대기', pending)
        missing = c.get('/orders/NOPE')
        assert '계정 미선택' not in missing.text and '조회 · VIEWER' in missing.text
    with production_client(db, db_url) as c:
        assert sign_in(c, 'admin').status_code == 303
        home = c.get('/').text
        assert all(h in home for h in ('href="/users"', 'href="/settings"', 'href="/audit-log"', '원본 자료 가져오기'))


def test_boolean_and_source_values_are_shown_in_korean(client):
    setup(client, approval=True)
    customer = client.get('/customers/C1').text
    assert re.search(r'<dt>승인 필요</dt><dd>\s*예\s*</dd>', customer)
    _, _, number, _ = invoice(client, [row()])
    detail = client.get(f'/invoices/{number}').text
    for raw in ('<th scope="col">erp_error_message</th>', '<dt>erp_error_message</dt>', 'tax_review_required'):
        assert raw not in detail


def test_result_keys_have_korean_labels():
    from kkotsuni.app.templating import LABELS

    for key in ("diffQty", "orderNos", "normalized_key", "price_source", "is_default", "results", "totalActualQty",
                "delivery_site_name", "erp_error_message", "tax_review_required", "registered_at", "approved_at"):
        assert key in LABELS and not LABELS[key].isascii()
