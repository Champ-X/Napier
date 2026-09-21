import math

def render_cell(value):
 if value is None:return ''
 if isinstance(value,bool):return 'true' if value else 'false'
 if isinstance(value,int):return str(value)
 if isinstance(value,float):
  if not math.isfinite(value):raise ValueError('Nonfinite number')
  return str(value)
 if isinstance(value,str):return "'"+value if value.lstrip()[:1] in ('=','+','-','@') else value
 raise ValueError('Unsupported cell')
