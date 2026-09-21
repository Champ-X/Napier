import unittest
from binder import bind_named
class BindingTests(unittest.TestCase):
    def test_order_and_repeat(self):
        self.assertEqual(bind_named('select :b,:a,:b',{'a':1,'b':2}),('select ?,?,?',[2,1,2]))
    def test_quoted(self):
        self.assertEqual(bind_named("select ':x',:x",{'x':3}),("select ':x',?",[3]))
