from lexer import parameter_spans
def bind_named(sql,params):
    values=[]
    for start,end,name in reversed(parameter_spans(sql)):
        sql=sql[:start]+'?'+sql[end:];values.append(params.get(name))
    return sql,values
