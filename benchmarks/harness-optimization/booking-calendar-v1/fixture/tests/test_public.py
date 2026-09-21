import sys,unittest
sys.path.insert(0,'src')
from scheduling import reserve
class BookingTests(unittest.TestCase):
 def test_adjacent_bookings(self):
  first=dict(id='a',resource='room',start='2026-09-01T09:00:00Z',end='2026-09-01T10:00:00Z')
  second=dict(id='b',resource='room',start='2026-09-01T10:00:00Z',end='2026-09-01T11:00:00Z')
  self.assertTrue(reserve([first],second)['accepted'])
