import { spawnSync } from "node:child_process";
const script = String.raw`
import sqlite3
from lexer import parameter_spans
from binder import bind_named
sql="select ':ignored', :x, :x -- :comment\n, :y /* :hidden */"
assert bind_named(sql,{'x':3,'y':'value'})==("select ':ignored', ?, ? -- :comment\n, ? /* :hidden */",[3,3,'value'])
for sql in ["select 'oops",'select "oops','select \x60oops','select [oops','select /*oops']:
    try:parameter_spans(sql)
    except ValueError:pass
    else:raise AssertionError('Unterminated SQL accepted')
s="':a''b' \"a\"\":b\" \x60a\x60\x60:b\x60 [x:y] :ok ::cast :::last :9 :é"
assert [x[2] for x in parameter_spans(s)]==['ok','last']
assert parameter_spans('é :x')==[(2,4,'x')]
class Missing(dict):
    def __missing__(self,key):return 123
for bad,exc in [(Missing(),KeyError),({'x':[]},TypeError),({'x':float('nan')},TypeError),({'x':2**63},TypeError),({'x':-2**63-1},TypeError)]:
    try:bind_named('select :x',bad)
    except exc:pass
    else:raise AssertionError('Invalid value accepted')
for sql,params in [(None,{}),('select 1',[])]:
    try:bind_named(sql,params)
    except TypeError:pass
    else:raise AssertionError('Invalid arguments accepted')
conn=sqlite3.connect(':memory:');conn.execute('create table item(k text, v integer, payload blob)')
attack="a'); DROP TABLE item; --"
statement,values=bind_named('insert into item values(:key,:value,:payload)',{'key':attack,'value':42,'payload':b'\x00\xff'})
conn.execute(statement,values)
statement,values=bind_named('select k,v,payload from item where k=:key or k=:key',{'key':attack})
assert conn.execute(statement,values).fetchall()==[(attack,42,b'\x00\xff')]
for value in [None,True,False,-2**63,2**63-1,1.25,'? :x',b'bytes']:
    query,args=bind_named('select :x, :x',{'x':value,'extra':object()})
    assert conn.execute(query,args).fetchone()==(value,value)
print('SQL lexical boundaries and real SQLite parameter execution passed')
`;
const result = spawnSync("/usr/bin/python3", ["-B", "-c", script], {
  encoding: "utf8",
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
