import unittest
from quote import quote

class QuoteTests(unittest.TestCase):
    def test_exact_capacity(self):
        self.assertEqual(quote(3, 10, 7), {"seats": 3, "allowed": True, "remaining": 0, "priceCents": 3750})
    def test_denied_preserves_capacity(self):
        self.assertEqual(quote(4, 10, 7)["remaining"], 3)
    def test_bool_is_invalid(self):
        with self.assertRaises(ValueError):
            quote(True, 10, 0)
