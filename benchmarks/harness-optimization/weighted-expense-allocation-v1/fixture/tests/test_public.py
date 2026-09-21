import sys,unittest
sys.path.insert(0,'src')
from allocation import allocate
class AllocationTests(unittest.TestCase):
 def test_rounding(self):self.assertEqual(allocate(5,{'a':1,'b':1}),{'a':3,'b':2})
