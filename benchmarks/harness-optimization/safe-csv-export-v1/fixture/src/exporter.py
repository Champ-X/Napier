from cells import render_cell

def export_rows(headers,rows): return '\n'.join([','.join(headers)]+[','.join(render_cell(r.get(h)) for h in headers) for r in rows])
