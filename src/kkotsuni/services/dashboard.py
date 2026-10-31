"""Read-only dashboard aggregates; keep document counts and cohort progress distinct."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from kkotsuni.app.errors import BusinessError
from kkotsuni.services.common import day


def overview(db, query):
    end = day(query['date']) if query.get('date') else datetime.now(ZoneInfo('Asia/Seoul')).date()
    try:
        days = int(query.get('days', 30))
        if days not in (7, 14, 30, 90):
            raise ValueError
    except (ValueError, TypeError):
        raise BusinessError('조회 기간은 7일, 14일, 30일, 90일 중 선택하세요')
    start = end - timedelta(days=days-1)
    params = (start, end)
    orders = db.one('''SELECT COUNT(*) AS count,
        COUNT(*) FILTER (WHERE order_no LIKE 'TEST-%%') AS test_count,
        COUNT(DISTINCT customer_code) AS customers FROM order_hdr
        WHERE order_date BETWEEN %s AND %s AND status<>'CANCELLED' ''', params)
    amounts = db.one('''SELECT COALESCE(SUM(COALESCE(d.amount,d.quantity*d.unit_price)),0) AS amount,
        COUNT(*) FILTER (WHERE d.amount IS NULL AND d.unit_price IS NULL) AS unpriced
        FROM order_hdr h JOIN order_dtl d USING(order_no)
        WHERE h.order_date BETWEEN %s AND %s AND h.status<>'CANCELLED' ''', params)
    shipments = db.one('''SELECT COUNT(*) AS count,
        COUNT(*) FILTER (WHERE status='RESULT_REGISTERED') AS completed
        FROM ship_order WHERE ship_date BETWEEN %s AND %s''', params)
    invoices = db.one('''SELECT COUNT(*) AS count,
        COUNT(*) FILTER (WHERE status='ISSUED') AS issued,
        COUNT(*) FILTER (WHERE status<>'ISSUED') AS drafts,
        COALESCE(SUM(total_amount) FILTER (WHERE status='ISSUED'),0) AS issued_amount,
        COALESCE(SUM(total_amount) FILTER (WHERE status<>'ISSUED'),0) AS draft_amount
        FROM invoice_hdr WHERE invoice_date BETWEEN %s AND %s''', params)
    flow = db.one('''SELECT COUNT(*) AS received,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM ship_order_src s WHERE s.order_no=o.order_no)) AS instructed,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM ship_order_src s JOIN ship_result r
          USING(ship_order_dtl_id) WHERE s.order_no=o.order_no)) AS shipped,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM invoice_dtl d JOIN invoice_hdr h USING(invoice_no)
          WHERE d.order_no=o.order_no AND h.status='ISSUED')) AS invoiced
        FROM order_hdr o WHERE order_date BETWEEN %s AND %s AND status<>'CANCELLED' ''', params)
    daily = db.q('''WITH dates AS (SELECT generate_series(%s::date,%s::date,interval '1 day')::date AS day),
        o AS (SELECT order_date AS day,count(*) AS count FROM order_hdr WHERE status<>'CANCELLED' GROUP BY order_date),
        s AS (SELECT ship_date AS day,count(*) AS count FROM ship_order GROUP BY ship_date),
        i AS (SELECT invoice_date AS day,count(*) AS count FROM invoice_hdr GROUP BY invoice_date)
        SELECT dates.day,COALESCE(o.count,0) AS orders,COALESCE(s.count,0) AS shipments,
        COALESCE(i.count,0) AS invoices FROM dates LEFT JOIN o USING(day) LEFT JOIN s USING(day)
        LEFT JOIN i USING(day) ORDER BY dates.day''', params)
    max_value = max([max(row['orders'], row['shipments'], row['invoices']) for row in daily] + [2])
    max_value += max_value % 2
    series = []
    for key, label, color in [('orders', '수주', '#326745'), ('shipments', '출고지시', '#387fa0'),
                              ('invoices', '거래명세서', '#b17832')]:
        points = ' '.join(f"{45+index*710/max(days-1,1):.2f},{205-row[key]*165/max_value:.2f}"
                          for index, row in enumerate(daily))
        series.append({'key': key, 'label': label, 'color': color, 'points': points})
    states = {row['status']: row['count'] for row in db.q('''SELECT status,count(*) AS count FROM order_hdr
        WHERE order_date BETWEEN %s AND %s GROUP BY status''', params)}
    labels = [('RECEIVED','접수'),('CONFIRMED','확정'),('SHIP_ORDERED','출고지시'),
              ('SHIPPED','출고완료'),('INVOICED','명세서발행'),('CANCELLED','취소')]
    state_total = sum(states.values())
    statuses = [{'status': code, 'label': label, 'count': states.get(code, 0),
                 'percent': round(states.get(code, 0)*100/max(state_total, 1),1)} for code,label in labels]
    top = db.q('''SELECT h.customer_code,c.name,COUNT(DISTINCT h.order_no) AS count,
        COALESCE(SUM(COALESCE(d.amount,d.quantity*d.unit_price)),0) AS amount
        FROM order_hdr h JOIN customer c USING(customer_code) JOIN order_dtl d USING(order_no)
        WHERE h.order_date BETWEEN %s AND %s AND h.status<>'CANCELLED'
        GROUP BY h.customer_code,c.name ORDER BY amount DESC,h.customer_code LIMIT 5''',params)
    ceiling = max([r['amount'] for r in top] + [1])
    for row in top:
        row['percent'] = round(row['amount']*100/ceiling,1)
    pending = db.one('''SELECT
        COUNT(*) FILTER (WHERE status IN ('CONFIRMED','SHIP_ORDERED')) AS shipment,
        COUNT(*) FILTER (WHERE status IN ('CONFIRMED','SHIP_ORDERED') AND ship_due_date<%s) AS overdue,
        COUNT(*) FILTER (WHERE status='SHIPPED') AS invoice,
        COUNT(*) FILTER (WHERE status='RECEIVED' AND EXISTS
         (SELECT 1 FROM order_dtl d WHERE d.order_no=o.order_no AND product_code IS NULL)) AS mapping
        FROM order_hdr o''',(end,))
    erp = {r['erp_send_status']:r['count'] for r in db.q('''SELECT erp_send_status,count(*) AS count FROM invoice_hdr
        WHERE status='ISSUED' GROUP BY erp_send_status''')}
    pending['erp_failed'] = erp.get('FAILED',0)
    attention = db.q('''SELECT o.order_no,o.ship_due_date,o.status,c.name,
        CASE WHEN o.status='RECEIVED' THEN '품목 매핑' WHEN o.status='SHIPPED' THEN '명세서 발행'
             WHEN o.ship_due_date<%s THEN '출고 지연' ELSE '출고 대기' END AS task
        FROM order_hdr o JOIN customer c USING(customer_code)
        WHERE o.status IN ('CONFIRMED','SHIP_ORDERED','SHIPPED') OR
          (o.status='RECEIVED' AND EXISTS (SELECT 1 FROM order_dtl d
           WHERE d.order_no=o.order_no AND product_code IS NULL))
        ORDER BY CASE WHEN o.status IN ('CONFIRMED','SHIP_ORDERED') AND o.ship_due_date<%s THEN 0 ELSE 1 END,
        o.ship_due_date,o.order_no LIMIT 8''',(end,end))
    source = db.one('''SELECT count(DISTINCT file_id) AS files,
      count(*) FILTER (WHERE status='검토 필요') AS review,
      count(DISTINCT NULLIF(payload->>'tracking_no','')) AS parcels,
      count(DISTINCT order_no) AS orders FROM source_record''')
    return {'source':source,'start':start,'end':end,'days':days,'orders':{**orders,**amounts},'shipments':shipments,
            'invoices':invoices,'flow':flow,'daily':daily,'series':series,'chart_max':max_value,
            'statuses':statuses,'top_customers':top,'pending':pending,'attention':attention,
            'erp':[{'label':label,'count':erp.get(code,0)} for code,label in
                   [('PENDING','전송 대기'),('SENDING','전송 중'),('SUCCESS','반영 완료'),('FAILED','실패')]]}
