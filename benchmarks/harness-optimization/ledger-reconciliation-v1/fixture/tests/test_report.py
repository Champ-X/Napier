import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from events import parse_events
from report import reconcile
class ReportTests(unittest.TestCase):
    def test_refunds_and_pending(self):
        text=(Path(__file__).resolve().parents[1]/'data/events.csv').read_text()
        self.assertEqual(reconcile(parse_events(text),'2026-09-01','2026-09-02'),[{'customer_id':'alice','charges':1,'refunds':1,'gross_total':'10.10','refund_total':'0.20','net_total':'9.90'}])
