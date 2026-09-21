from events import normalize_events

def project_inventory(initial,events):
 out={k:dict(available=v,reserved=0) for k,v in initial.items()}
 for e in normalize_events(events):
  b=out.setdefault(e['sku'],dict(available=0,reserved=0));b['available']+=e['quantity'] if e['type']=='receive' else -e['quantity']
 return out
