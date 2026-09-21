import re
from datetime import datetime,date,time,timezone
from decimal import Decimal

def reconcile(events,start_date,end_date):
    if not all(isinstance(d,str) and re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',d) for d in (start_date,end_date)):raise ValueError('Invalid date')
    start=datetime.combine(date.fromisoformat(start_date),time(),timezone.utc);end=datetime.combine(date.fromisoformat(end_date),time(),timezone.utc)
    if start>=end:raise ValueError('Invalid window')
    totals={}
    for e in events:
        if e['status']!='settled' or not start<=e['occurred_at']<end:continue
        c=totals.setdefault(e['customer_id'],dict(customer_id=e['customer_id'],charges=0,refunds=0,gross_total=Decimal(0),refund_total=Decimal(0)))
        if e['kind']=='charge':c['charges']+=1;c['gross_total']+=e['amount']
        else:c['refunds']+=1;c['refund_total']+=e['amount']
    result=[]
    for key in sorted(totals):
        c=totals[key];c['net_total']=c['gross_total']-c['refund_total']
        for field in ('gross_total','refund_total','net_total'):c[field]=format(c[field],'.2f')
        result.append(c)
    return result
