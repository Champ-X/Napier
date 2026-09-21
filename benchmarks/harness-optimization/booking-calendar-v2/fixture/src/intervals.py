from datetime import datetime

def parse_instant(text): return datetime.fromisoformat(text.replace('Z','+00:00'))
def normalize_bookings(bookings): return [dict(b,start=parse_instant(b['start']),end=parse_instant(b['end'])) for b in bookings]
