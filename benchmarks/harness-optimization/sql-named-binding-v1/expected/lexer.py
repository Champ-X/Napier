import re
def parameter_spans(sql):
    if not isinstance(sql,str): raise TypeError('SQL must be text')
    result=[];i=0;n=len(sql)
    while i<n:
        if sql.startswith('--',i):
            end=sql.find('\n',i+2);i=n if end<0 else end+1;continue
        if sql.startswith('/*',i):
            end=sql.find('*/',i+2)
            if end<0: raise ValueError('Unclosed comment')
            i=end+2;continue
        ch=sql[i]
        if ch in "'\"`[":
            close=']' if ch=='[' else ch;i+=1
            while i<n:
                if sql[i]==close:
                    if ch!='[' and i+1<n and sql[i+1]==close:i+=2;continue
                    i+=1;break
                i+=1
            else: raise ValueError('Unclosed quote')
            continue
        if sql.startswith('::',i):i+=2;continue
        if ch==':':
            match=re.match(r'[A-Za-z_][A-Za-z0-9_]*',sql[i+1:])
            if match:
                end=i+1+len(match.group());result.append((i,end,match.group()));i=end;continue
        i+=1
    return result
