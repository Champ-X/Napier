import sys,unittest
sys.path.insert(0,'src')
from cells import render_cell
class CellTests(unittest.TestCase):
 def test_formula(self):self.assertEqual(render_cell(' =1+1'),"' =1+1")
 def test_none(self):self.assertEqual(render_cell(None),'')
