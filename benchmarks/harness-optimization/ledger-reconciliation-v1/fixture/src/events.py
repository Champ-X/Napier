import csv,io
from datetime import datetime

def parse_events(text):
    rows=[]
    for row in csv.DictReader(io.StringIO(text)):
        row['amount']=float(row['amount'])
        row['occurred_at']=datetime.fromisoformat(row['occurred_at'].replace('Z','+00:00'))
        rows.append(row)
    return rows
