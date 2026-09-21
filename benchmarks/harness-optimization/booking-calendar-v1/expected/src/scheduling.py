from datetime import timedelta
from intervals import normalize_bookings,parse_instant

def reserve(bookings,request):
 current=normalize_bookings(bookings);r=normalize_bookings([request])[0]
 if any(b['id']==r['id'] for b in current):raise ValueError('Duplicate booking ID')
 conflicts=sorted(b['id'] for b in current if b['resource']==r['resource'] and b['start']<r['end'] and r['start']<b['end'])
 return dict(accepted=not conflicts,conflicts=conflicts,bookings=[dict(b) for b in bookings]+([] if conflicts else [dict(request)]))

def next_free(bookings,resource,earliest,duration_minutes):
 current=normalize_bookings(bookings)
 if not isinstance(resource,str) or not resource or type(duration_minutes) is not int or duration_minutes<=0:raise ValueError('Invalid search')
 candidate=parse_instant(earliest);duration=timedelta(minutes=duration_minutes)
 for b in current:
  if b['resource']!=resource or b['end']<=candidate:continue
  if candidate+duration<=b['start']:break
  candidate=max(candidate,b['end'])
 return candidate.isoformat().replace('+00:00','Z')
