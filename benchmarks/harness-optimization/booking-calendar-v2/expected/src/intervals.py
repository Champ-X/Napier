from datetime import datetime,timezone

def parse_instant(text):
 try:
  if not isinstance(text,str):raise ValueError('Invalid datetime')
  result=datetime.fromisoformat(text.replace('Z','+00:00'))
  if result.tzinfo is None or result.utcoffset() is None:raise ValueError('Timezone required')
  return result.astimezone(timezone.utc)
 except (TypeError,OverflowError) as exc:raise ValueError('Invalid datetime') from exc

def normalize_bookings(bookings):
 if not isinstance(bookings,list):raise ValueError('Invalid bookings')
 seen=set();out=[]
 for b in bookings:
  if not isinstance(b,dict) or not isinstance(b.get('id'),str) or not b['id'] or b['id'] in seen or not isinstance(b.get('resource'),str) or not b['resource']:raise ValueError('Invalid booking')
  start=parse_instant(b.get('start'));end=parse_instant(b.get('end'))
  if start>=end:raise ValueError('Invalid interval')
  seen.add(b['id']);out.append(dict(b,start=start,end=end))
 return sorted(out,key=lambda b:(b['resource'],b['start'],b['end'],b['id']))
