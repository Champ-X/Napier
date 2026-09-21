def normalize_events(events):
 if not isinstance(events,list):raise ValueError('Invalid events')
 ids={};sequences={}
 for e in events:
  if not isinstance(e,dict) or set(e)!=set(('id','seq','sku','type','quantity')) or not all(isinstance(e[k],str) and e[k] for k in ('id','sku')) or type(e['seq']) is not int or e['seq']<0 or type(e['quantity']) is not int or e['quantity']<=0 or e['type'] not in ('receive','reserve','release','ship'):raise ValueError('Invalid event')
  if e['id'] in ids:
   if ids[e['id']]!=e:raise ValueError('Conflicting event ID')
   continue
  if e['seq'] in sequences:raise ValueError('Conflicting sequence')
  ids[e['id']]=dict(e);sequences[e['seq']]=e['id']
 return sorted(ids.values(),key=lambda e:e['seq'])
