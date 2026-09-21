from intervals import normalize_bookings,parse_instant

def reserve(bookings,request):
 r=normalize_bookings([request])[0]
 conflicts=[b['id'] for b in normalize_bookings(bookings) if b['start']<=r['end'] and b['end']>=r['start']]
 return dict(accepted=not conflicts,conflicts=conflicts,bookings=bookings if conflicts else bookings+[request])
def next_free(bookings,resource,earliest,duration_minutes): return earliest
