import re

def parse_amount(text):
 if not isinstance(text,str) or not re.fullmatch(r'-?[0-9]+\.[0-9]{2}',text):raise ValueError('Invalid amount')
 negative=text.startswith('-');whole,fraction=text.lstrip('-').split('.');value=int(whole)*100+int(fraction);return -value if negative else value

def format_amount(minor):
 if type(minor) is not int:raise ValueError('Invalid minor units')
 magnitude=abs(minor);return ('-' if minor<0 else '')+str(magnitude//100)+'.'+str(magnitude%100).zfill(2)
