import csv,io,re
from datetime import datetime,timezone
from decimal import Decimal

def parse_events(text):
    reader=csv.DictReader(io.StringIO(text),strict=True)
    fields=['event_id','customer_id','kind','status','amount','occurred_at']
    if not reader.fieldnames or sorted(reader.fieldnames)!=sorted(fields):raise ValueError('Invalid header')
    seen={};out=[]
    try:
        for raw in reader:
            if set(raw)!=set(fields) or any(v is None for v in raw.values()):raise ValueError('Invalid row')
            event_id=raw['event_id'].strip();customer=raw['customer_id'].strip()
            if not event_id or not customer or raw['kind'] not in ('charge','refund') or raw['status'] not in ('settled','pending'):raise ValueError('Invalid event')
            if not re.fullmatch(r'[0-9]{1,12}\.[0-9]{2}',raw['amount']):raise ValueError('Invalid amount')
            instant=datetime.fromisoformat(raw['occurred_at'].replace('Z','+00:00'))
            if instant.tzinfo is None or instant.utcoffset() is None:raise ValueError('Missing timezone')
            event=dict(event_id=event_id,customer_id=customer,kind=raw['kind'],status=raw['status'],amount=Decimal(raw['amount']),occurred_at=instant.astimezone(timezone.utc))
            if event_id in seen:
                if seen[event_id]!=event:raise ValueError('Conflicting event')
                continue
            seen[event_id]=event;out.append(event)
    except (csv.Error,TypeError,OverflowError) as exc:raise ValueError('Invalid CSV event') from exc
    return out
