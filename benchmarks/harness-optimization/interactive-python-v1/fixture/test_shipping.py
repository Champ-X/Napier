import unittest
from shipping import shipping


class ShippingTests(unittest.TestCase):
    def test_boundary(self):
        self.assertEqual(shipping(49.99), 5)
        self.assertEqual(shipping(50), 0)
        self.assertEqual(shipping(50, True), 8)

    def test_invalid(self):
        for value in [-1, True, "50", float("nan"), float("inf")]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                shipping(value)


if __name__ == "__main__":
    unittest.main()
