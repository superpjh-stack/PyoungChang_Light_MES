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
