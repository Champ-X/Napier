def allocate(total,weights,caps=None):
 if type(total) is not int or not isinstance(weights,dict) or not weights or any(not isinstance(k,str) or not k or type(w) is not int or w<=0 for k,w in weights.items()):raise ValueError('Invalid allocation')
 if caps is not None and (not isinstance(caps,dict) or set(caps)!=set(weights) or any(type(c) is not int or c<0 for c in caps.values())):raise ValueError('Invalid caps')
 remaining=abs(total);limits={k:remaining if caps is None else caps[k] for k in weights};out={k:0 for k in sorted(weights)}
 if sum(limits.values())<remaining:raise ValueError('Insufficient capacity')
 while remaining:
  active=[k for k in out if out[k]<limits[k]];denominator=sum(weights[k] for k in active);remainders={};assigned=0
  for k in active:
   floor,remainder=divmod(remaining*weights[k],denominator);n=min(floor,limits[k]-out[k]);out[k]+=n;assigned+=n;remainders[k]=remainder
  remaining-=assigned
  for k in sorted(active,key=lambda k:(-remainders[k],k)):
   if not remaining:break
   if out[k]<limits[k]:out[k]+=1;remaining-=1
 return {k:(-v if total<0 else v) for k,v in out.items()}
