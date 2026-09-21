import json
def parse_record(raw):
 if not isinstance(raw,bytes) or b'\r' in raw or b'\n' in raw:raise ValueError('Invalid record')
 def pairs(items):
  out={}
  for k,v in items:
   if k in out:raise ValueError('Duplicate key')
   out[k]=v
  return out
 def constant(_):raise ValueError('Nonfinite constant')
 try:value=json.loads(raw.decode('utf-8'),object_pairs_hook=pairs,parse_constant=constant)
 except (UnicodeError,ValueError) as e:raise ValueError('Invalid record') from e
 if not isinstance(value,dict):raise ValueError('Object required')
 return value
