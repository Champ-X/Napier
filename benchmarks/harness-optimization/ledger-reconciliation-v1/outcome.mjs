import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const program=String.raw`import sys
sys.path.insert(0,'src')
from events import parse_events
from report import reconcile
header='event_id,customer_id,kind,status,amount,occurred_at\n'
lines=['a,z,charge,settled,0.10,2026-08-31T23:30:00-01:00','b,z,charge,settled,0.20,2026-09-01T12:00:00Z','c,z,refund,settled,0.05,2026-09-01T12:00:00Z','d,a,refund,settled,1.00,2026-09-01T00:00:00Z','e,a,charge,pending,99.00,2026-09-01T01:00:00Z','f,a,charge,settled,1.00,2026-09-02T00:00:00Z','a,z,charge,settled,0.10,2026-09-01T00:30:00Z']
def state(value, seen=None):
 if seen is None: seen={}
 if isinstance(value,(str,bytes,int,float,bool,type(None))): return (type(value).__name__,value)
 identity=id(value)
 if identity in seen: return ('reference',seen[identity][0])
 seen[identity]=(len(seen),value)
 if isinstance(value,dict): return ('dict',[(state(k,seen),state(v,seen)) for k,v in value.items()])
 if isinstance(value,(list,tuple)): return (type(value).__name__,[state(v,seen) for v in value])
 fields=dict(vars(value)) if hasattr(value,'__dict__') else {}
 for cls in type(value).__mro__:
  slots=getattr(cls,'__slots__',())
  if isinstance(slots,str): slots=(slots,)
  for key in slots:
   if key not in ('__dict__','__weakref__') and hasattr(value,key): fields[key]=getattr(value,key)
 if fields: return (type(value).__name__,state(fields,seen))
 return (type(value).__name__,repr(value))
events=parse_events(header+'\n'.join(lines));saved=state(events)
assert reconcile(events,'2026-09-01','2026-09-02')==[dict(customer_id='a',charges=0,refunds=1,gross_total='0.00',refund_total='1.00',net_total='-1.00'),dict(customer_id='z',charges=2,refunds=1,gross_total='0.30',refund_total='0.05',net_total='0.25')]
assert state(events)==saved
for amount in ['0.001','-1.00','1e2','NaN',' 1.00','1234567890123.00']:
 try:parse_events(header+'x,a,charge,settled,'+amount+',2026-09-01T00:00:00Z')
 except ValueError:pass
 else:raise AssertionError(amount)
for text in [header+'x,a,charge,settled,1.00,2026-09-01T00:00:00',header+'x,a,charge,settled,1.00,2026-09-01T00:00:00Z,extra',header+'x,a,charge,settled,1.00',header+'\n'.join([lines[0],lines[0].replace('0.10','0.11')]),'wrong,header\na,b']:
 try:parse_events(text)
 except ValueError:pass
 else:raise AssertionError('invalid row accepted')
for dates in [('2026-09-02','2026-09-01'),('2026-09-01','2026-09-01'),('bad','2026-09-01')]:
 try:reconcile([], *dates)
 except ValueError:pass
 else:raise AssertionError('invalid window')
quoted=parse_events(header+'q,"a,b",charge,settled,999999999999.99,2026-09-01T00:00:00Z')
assert reconcile(quoted,'2026-09-01','2026-09-02')[0]['gross_total']=='999999999999.99'
`;
const result=spawnSync('/usr/bin/python3',['-B','-c',program],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);console.log('Independent money, CSV, deduplication, UTC window and mutation checks passed');
