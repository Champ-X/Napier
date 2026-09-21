import sys,unittest
sys.path.insert(0,'src')
from inventory import project_inventory
class InventoryTests(unittest.TestCase):
 def test_reservation(self):self.assertEqual(project_inventory({'a':5},[dict(id='r',seq=0,sku='a',type='reserve',quantity=2)]),{'a':dict(available=3,reserved=2)})
