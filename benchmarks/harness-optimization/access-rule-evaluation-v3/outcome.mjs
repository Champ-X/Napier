import assert from 'node:assert/strict';import {matchResource} from './src/resource.mjs';import {explainAccess} from './src/access.mjs';
assert.equal(matchResource('/docs/**','/docs'),true);assert.equal(matchResource('/docs/*','/docs/a/b'),false);assert.equal(matchResource('/','/'),true);assert.equal(matchResource('/doc','/docs'),false);
for(const p of ['/a//b','/a/../b','a','/a/','/a%2fb','/a?x'])assert.throws(()=>matchResource('/**',p),TypeError);assert.throws(()=>matchResource('/**/x','/x'),TypeError);
const rules=[{id:'z',effect:'allow',subjects:['group:editors'],actions:['*'],resource:'/docs/**'},{id:'a',effect:'deny',subjects:['user:alice'],actions:['delete'],resource:'/docs/*'}],p={id:'alice',groups:['editors']},before=JSON.stringify([rules,p]);
assert.deepEqual(explainAccess(rules,p,'delete','/docs/x'),{allowed:false,matchedRuleIds:['a','z'],reason:'explicit_deny'});assert.equal(explainAccess(rules,p,'write','/docs/x').allowed,true);assert.equal(explainAccess(rules,{id:'bob',groups:[]},'read','/docs/x').reason,'no_match');assert.equal(JSON.stringify([rules,p]),before);
assert.throws(()=>explainAccess([...rules,{...rules[0],id:'bad',resource:'/../x'}],p,'delete','/docs/x'),TypeError);assert.throws(()=>explainAccess([rules[0],rules[0]],p,'read','/docs/x'));assert.throws(()=>explainAccess(rules,{id:'alice',groups:['x','x']},'read','/docs/x'));console.log('Wildcard boundaries, complete validation and deny precedence passed');

// Additional assertions derive only from the unchanged task contract.
for (const [pattern, resource, expected] of [
  ['/**','/',true], ['/*','/',false], ['/*','/one',true],
  ['/a/**','/a',true], ['/a/**','/ab',false], ['/a/*','/a',false],
  ['/a/*/c','/a/b/c',true], ['/a/*/c','/a/b/d',false],
  ['/A_1.-/b','/A_1.-/b',true],
]) assert.equal(matchResource(pattern,resource),expected);
for (const invalid of ['/a\\b','/a#b','/a/./b','/a/*','/a/**','/é',null,42])
  assert.throws(()=>matchResource('/**',invalid),TypeError);
for (const invalid of ['/a*','/**/**','/**/a','/a/**/b','/a//b'])
  assert.throws(()=>matchResource(invalid,'/a'),TypeError);
const principal={id:'alice',groups:['editors']};
const rule=(id,patch={})=>({id,effect:'allow',subjects:['*'],actions:['*'],resource:'/**',...patch});
assert.deepEqual(explainAccess([],principal,'read','/'),{allowed:false,matchedRuleIds:[],reason:'no_match'});
const mixed=[rule('a'),rule('B',{effect:'deny'}),rule('Z'),rule('_')];
const mixedBefore=JSON.stringify(mixed);
assert.deepEqual(explainAccess(mixed,principal,'read','/'),{allowed:false,matchedRuleIds:['B','Z','_','a'],reason:'explicit_deny'});
assert.equal(JSON.stringify(mixed),mixedBefore);
for(const patch of [{subjects:['user:alice2']},{subjects:['group:viewer']},{actions:['write']},{resource:'/elsewhere'}])
  assert.equal(explainAccess([rule('r',patch)],principal,'read','/a').reason,'no_match');
for(const subjects of [['user:alice'],['group:editors'],['*']])
  assert.equal(explainAccess([rule('r',{subjects,actions:['read']})],principal,'read','/a').allowed,true);
for(const patch of [
  {id:''},{effect:'Allow'},{subjects:[]},{subjects:['user:.']},
  {subjects:['group:..']},{subjects:['user:']},{subjects:['team:x']},
  {subjects:['*','*']},{subjects:new Array(1)},
  {actions:[]},{actions:['READ']},{actions:['read','read']},{actions:new Array(1)},
]) assert.throws(()=>explainAccess([rule('deny',{effect:'deny'}),rule('bad',patch)],principal,'read','/'));
for(const invalid of [{id:'.',groups:[]},{id:'..',groups:[]},{id:'alice',groups:['.']},{id:'alice',groups:new Array(1)}])
  assert.throws(()=>explainAccess([],invalid,'read','/'));
for(const action of ['*','READ','',null]) assert.throws(()=>explainAccess([],principal,action,'/'));
assert.throws(()=>explainAccess(new Array(1),principal,'read','/'));
const shared=explainAccess([rule('r')],principal,'read','/');shared.matchedRuleIds.push('changed');
assert.deepEqual(explainAccess([rule('r')],principal,'read','/').matchedRuleIds,['r']);
console.log('Lexicographic IDs, conjunction, full validation and independent outputs passed');
