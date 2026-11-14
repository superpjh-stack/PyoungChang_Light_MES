from kkotsuni.db.repositories import insert


def test_dashboard_empty_period_and_validation(client):
    data = client.get('/api/dashboard/overview?date=2026-10-31&days=14').json()
    assert len(data['daily']) == 14
    assert data['orders']['count'] == 0
    assert data['flow'] == {'received': 0, 'instructed': 0, 'shipped': 0, 'invoiced': 0}
    assert client.get('/api/dashboard/overview?days=999').status_code == 400
    assert client.get('/api/dashboard/overview?date=not-a-date').status_code == 400
    page = client.get('/?date=2026-10-31&days=14')
    assert page.status_code == 200 and '일별 업무 추이' in page.text
    assert '선택한 기간의 업무 문서가 없습니다' in page.text
    assert client.get('/orders/pending-shipment').status_code == 200
    assert client.get('/orders/pending-invoice').status_code == 200


def test_dashboard_avoids_line_duplication_excludes_cancelled_and_separates_drafts(client, db):
    insert(db, 'customer', {'customer_code': 'C', 'name': '테스트 거래처'})
    insert(db, 'product', {'product_code': 'P', 'name': '김치'})
    for no, status in [('TEST-ONE','SHIPPED'),('CANCEL','CANCELLED')]:
        insert(db,'order_hdr',{'order_no': no,'customer_code': 'C','order_date': '2026-10-31',
                                   'ship_due_date': '2026-10-31','status': status})
        for line in (1,2):
            insert(db,'order_dtl',{'order_no': no,'line_no': line,'raw_product_name': '김치','product_code': 'P',
                                       'quantity': 10,'unit_price': 100,'amount': 1000})
    insert(db,'ship_order',{'ship_order_no': 'S','customer_code': 'C','ship_date': '2026-10-31'})
    sid=insert(db,'ship_order_dtl',{'ship_order_no': 'S','product_code': 'P','instructed_qty': 20})
    # Read the generated identity without assuming the repository's return representation.
    sid=db.one('SELECT ship_order_dtl_id FROM ship_order_dtl')['ship_order_dtl_id']
    for line in (1,2):
        insert(db,'ship_order_src',{'ship_order_dtl_id': sid,'order_no': 'TEST-ONE','order_line_no': line,'allocated_qty': 10})
    insert(db,'ship_result',{'ship_order_dtl_id': sid,'actual_qty': 20})
    insert(db,'invoice_hdr',{'invoice_no': 'I','invoice_date': '2026-10-31','customer_code': 'C',
                                 'supply_amount': 2000,'total_amount': 2000,'status': 'DRAFT'})
    insert(db,'invoice_dtl',{'invoice_no': 'I','product_code': 'P','quantity': 20,'unit_price': 100,
                                 'supply_amount': 2000,'tax_amount': 0,'order_no': 'TEST-ONE','ship_order_no': 'S'})
    data=client.get('/api/dashboard/overview?date=2026-10-31&days=7').json()
    assert data['orders']['count']==1 and data['orders']['amount']==2000
    assert data['orders']['test_count']==1
    assert data['flow']=={'received': 1,'instructed': 1,'shipped': 1,'invoiced': 0}
    assert data['daily'][-1]['orders']==1 and data['daily'][-1]['shipments']==1
    assert data['invoices']['draft_amount']==2000 and data['invoices']['issued_amount']==0
    assert data['top_customers'][0]['amount']==2000
    db.x("UPDATE invoice_hdr SET status='ISSUED'")
    data=client.get('/api/dashboard/overview?date=2026-10-31').json()
    assert data['flow']['invoiced']==1 and data['invoices']['issued_amount']==2000
    assert client.get('/').status_code==200


def test_dashboard_shows_mapping_backlog_recent_notes_and_setup_gaps(client, db):
    insert(db, 'customer', {'customer_code': 'C', 'name': '테스트 거래처'})
    insert(db, 'product', {'product_code': 'P', 'name': '김치', 'tax_review_required': True})
    insert(db, 'order_hdr', {'order_no': 'O1', 'customer_code': 'C', 'order_date': '2026-09-01',
                             'ship_due_date': '2026-09-02', 'status': 'RECEIVED'})
    for line, name in ((1, '모르는 김치'), (2, '모르는 김치'), (3, '다른 표기')):
        insert(db, 'order_dtl', {'order_no': 'O1', 'line_no': line, 'raw_product_name': name, 'quantity': 1})
    insert(db, 'work_note', {'title': '매핑 기록', 'body': '내용', 'created_by': 'admin1'})
    data = client.get('/api/dashboard/overview?date=2026-10-31&days=7').json()
    assert data['mapping']['lines'] == 3 and data['mapping']['names'] == 2
    assert data['mapping']['top'][0] == {'customer_name': '테스트 거래처', 'raw_product_name': '모르는 김치', 'lines': 2}
    assert data['notes'][0]['title'] == '매핑 기록'
    assert data['setup']['tax_review'] == 1 and data['setup']['supplier_missing'] is True
    assert data['setup']['all_orders'] == 1 and data['orders']['count'] == 0
    page = client.get('/?date=2026-10-31&days=7').text
    for text in ('제품 매핑 대기', '모르는 김치', '최근 Note', '매핑 기록', '과세구분 확인',
                 '전체 수주 1건 중 조회 기간에 0건', '최근 90일로 보기', '공급자 등록번호가 비어 있습니다'):
        assert text in page, text
    db.x("INSERT INTO system_setting(key,value) VALUES ('SUPPLIER_BIZ_REG_NO','000-00-00000')")
    assert client.get('/api/dashboard/overview').json()['setup']['supplier_missing'] is False


def test_dashboard_default_window_falls_back_to_latest_order_period(client, db):
    insert(db, 'customer', {'customer_code': 'C', 'name': '테스트 거래처'})
    assert client.get('/api/dashboard/overview').json()['auto_adjusted'] is False
    for no, date, status in (('OLD', '2020-03-10', 'CONFIRMED'), ('GONE', '2020-05-01', 'CANCELLED')):
        insert(db, 'order_hdr', {'order_no': no, 'customer_code': 'C', 'order_date': date,
                                 'ship_due_date': '2020-05-02', 'status': status})
    data = client.get('/api/dashboard/overview').json()
    assert data['auto_adjusted'] is True and data['end'] == '2020-03-10' and data['start'] == '2020-02-10'
    assert data['orders']['count'] == 1 and data['daily'][-1]['orders'] == 1
    # Overdue stays relative to today, not to the moved window.
    assert data['pending']['overdue'] == 1 and data['attention'][0]['task'] == '출고 지연'
    page = client.get('/').text
    assert '가장 최근 수주일 2020-03-10 기준으로 표시합니다' in page and '오늘 기준으로 보기' in page
    explicit = client.get(f"/api/dashboard/overview?date={data['today']}").json()
    assert explicit['auto_adjusted'] is False and explicit['orders']['count'] == 0
    assert '오늘 기준으로 보기' not in client.get(f"/?date={data['today']}").text
    insert(db, 'order_hdr', {'order_no': 'NOW', 'customer_code': 'C', 'order_date': data['today'],
                             'ship_due_date': data['today'], 'status': 'RECEIVED'})
    recent = client.get('/api/dashboard/overview').json()
    assert recent['auto_adjusted'] is False and recent['end'] == data['today']
