from datetime import date

def reconcile(events,start_date,end_date):
    totals={}
    for e in events:
        if e['occurred_at'].date() < date.fromisoformat(start_date) or e['occurred_at'].date() > date.fromisoformat(end_date): continue
        c=totals.setdefault(e['customer_id'],{'customer_id':e['customer_id'],'charges':0,'refunds':0,'gross_total':0.0,'refund_total':0.0})
        c['charges']+=1;c['gross_total']+=e['amount']
    for c in totals.values():
        c['net_total']=c['gross_total']-c['refund_total']
        for k in ['gross_total','refund_total','net_total']:c[k]=str(c[k])
    return list(totals.values())
