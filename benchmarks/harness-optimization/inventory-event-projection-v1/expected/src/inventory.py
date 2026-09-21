from events import normalize_events

def project_inventory(initial,events):
 if not isinstance(initial,dict) or any(not isinstance(k,str) or not k or type(v) is not int or v<0 for k,v in initial.items()):raise ValueError('Invalid initial inventory')
 normalized=normalize_events(events);out={k:dict(available=v,reserved=0) for k,v in initial.items()}
 for e in normalized:
  b=out.setdefault(e['sku'],dict(available=0,reserved=0));q=e['quantity'];kind=e['type']
  if kind=='receive':b['available']+=q
  elif kind=='reserve':
   if b['available']<q:raise ValueError('Insufficient available stock')
   b['available']-=q;b['reserved']+=q
  else:
   if b['reserved']<q:raise ValueError('Insufficient reserved stock')
   b['reserved']-=q
   if kind=='release':b['available']+=q
 return {k:out[k] for k in sorted(out)}
