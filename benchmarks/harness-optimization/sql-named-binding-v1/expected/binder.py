import math
from lexer import parameter_spans
def bind_named(sql,params):
    if not isinstance(params,dict):raise TypeError('Params must be a dict')
    spans=parameter_spans(sql);parts=[];values=[];offset=0
    for start,end,name in spans:
        if not dict.__contains__(params,name):raise KeyError(name)
        value=dict.__getitem__(params,name)
        if value is not None:
            if isinstance(value,bool):pass
            elif isinstance(value,int):
                if not -(2**63)<=value<2**63:raise TypeError('Integer overflow')
            elif isinstance(value,float):
                if not math.isfinite(value):raise TypeError('Nonfinite value')
            elif not isinstance(value,(str,bytes)):raise TypeError('Unsupported value')
        parts.extend([sql[offset:start],'?']);values.append(value);offset=end
    parts.append(sql[offset:]);return ''.join(parts),values
