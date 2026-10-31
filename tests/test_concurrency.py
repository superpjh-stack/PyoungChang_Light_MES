"""Concurrent HTTP requests must use separate PostgreSQL connections."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from test_workflow import ok, preview, row, setup, ship, upload


def race(call, count=4):
    barrier = Barrier(count)

    def run(index):
        barrier.wait(timeout=15)
        return call(index)

    with ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(run, range(count)))


def test_concurrent_uploads_receive_unique_document_numbers(client):
    setup(client)
    parsed = [preview(client, [row(customer_order_no=f'CONCURRENT-{index}')])['rows'] for index in range(4)]
    results = race(lambda index: client.post('/api/orders/upload/commit', json={'rows': parsed[index]}))
    ids = []
    for result in results:
        body = ok(result, 201)
        assert body['errors'] == []
        ids.extend(body['orders'])
    assert len(ids) == len(set(ids)) == 4
    assert len(ok(client.get('/api/orders'))) == 4


def test_concurrent_ship_generation_does_not_duplicate_allocations(client):
    setup(client)
    orders = upload(client, [row(customer_order_no=f'ORDER-{i}') for i in range(4)])
    for number in orders:
        ok(client.post(f'/api/orders/{number}/confirm'))
    results = race(lambda _: client.post('/api/ship-orders/generate', json={'ship_date': '2026-11-05'}))
    ids = [number for result in results for number in ok(result, 201)['shipOrders']]
    assert len(ids) == len(set(ids)) == 1
    detail = ok(client.get(f'/api/ship-orders/{ids[0]}'))
    assert sum(line['instructed_qty'] for line in detail['lines']) == 40
    for number in orders:
        assert ok(client.get(f'/api/orders/{number}'))['status'] == 'SHIP_ORDERED'


def test_concurrent_invoice_generation_does_not_double_bill(client):
    setup(client)
    ship(client, [row(customer_order_no=f'ORDER-{i}') for i in range(4)])
    results = race(lambda _: client.post('/api/invoices/generate', json={'invoice_date': '2026-11-05'}))
    ids = [number for result in results for number in ok(result, 201)['invoices']]
    assert len(ids) == len(set(ids)) == 1
    detail = ok(client.get(f'/api/invoices/{ids[0]}'))
    assert detail['supply_amount'] == 4000
    assert sum(line['quantity'] for line in detail['lines']) == 40
