import csv,io
from cells import render_cell

def export_rows(headers,rows):
 if not isinstance(headers,list) or not headers or any(not isinstance(h,str) or not h for h in headers) or len(set(headers))!=len(headers) or not isinstance(rows,list):raise ValueError('Invalid table')
 prepared=[[render_cell(h) for h in headers]]
 for row in rows:
  if not isinstance(row,dict) or any(k not in headers for k in row):raise ValueError('Unknown column')
  prepared.append([render_cell(row.get(h)) for h in headers])
 out=io.StringIO(newline='');writer=csv.writer(out,lineterminator='\r\n');writer.writerows(prepared);return out.getvalue()
