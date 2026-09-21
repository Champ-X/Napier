import unittest
from shipping import shipping


class ShippingTest(unittest.TestCase):
    def test_below_boundary(self):
        self.assertEqual(shipping(49), 5)

    def test_above_boundary(self):
        self.assertEqual(shipping(51), 0)

    def test_expedited(self):
        self.assertEqual(shipping(51, True), 8)

    def test_invalid(self):
        with self.assertRaises(ValueError):
            shipping(-1)
