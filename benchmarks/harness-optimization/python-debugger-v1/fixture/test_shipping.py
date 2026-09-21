import unittest
from shipping import shipping
class ShippingTest(unittest.TestCase):
    def test_standard(self):
        self.assertEqual(shipping(49), 5)
        self.assertEqual(shipping(50), 0)
    def test_expedited(self):
        self.assertEqual(shipping(49, True), 13)
        self.assertEqual(shipping(50, True), 8)
