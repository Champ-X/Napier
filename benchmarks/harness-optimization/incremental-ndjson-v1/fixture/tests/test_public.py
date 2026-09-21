import unittest
from src.decoder import NdjsonDecoder
class Public(unittest.TestCase):
 def test_final_record(self):
  d=NdjsonDecoder();self.assertEqual(d.feed(b'{"n":1}'),[]);self.assertEqual(d.finish(),[{'n':1}])
