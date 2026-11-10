import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root = process.cwd();
const filename = 'apps/cli/src/rpc-transport.ts';
const before = execFileSync('git',['show',`42a35898:${filename}`],{cwd:root,encoding:'utf8'});
const after = readFileSync(`${root}/${filename}`,'utf8');
async function load(source) {
 const js = ts.transpileModule(source.replace('import { MAX_RPC_LINE_BYTES } from "./rpc-protocol.js";','const MAX_RPC_LINE_BYTES = 1024 * 1024;'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023}}).outputText;
 return (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).readRpcLines;
}
const readers = {before:await load(before),after:await load(after)};
const cases = [];
for (const chunkBytes of [64,1024,16384,1048576]) {
 const samples = {before:[],after:[]};
 const chunk = Buffer.alloc(chunkBytes,97);
 for(let trial=-2;trial<10;trial++) {
  for(const key of (trial%2===0?['before','after']:['after','before'])) {
   const started = performance.now();
   let lines = 0;
   for await(const line of readers[key]((async function*(){for(let n=0;n<1048576/chunkBytes;n++)yield chunk;yield Buffer.from('\n');})())) { assert.equal(line.length,1048576); lines++; }
   assert.equal(lines,1);
   if(trial>=0)samples[key].push(performance.now()-started);
  }
 }
 const median=values=>[...values].sort((a,b)=>a-b).slice(4,6).reduce((a,b)=>a+b)/2;
 cases.push({lineBytes:1048576,chunkBytes,samples,medianMs:{before:median(samples.before),after:median(samples.after)}});
}
const result={kind:'napier.rpc-framing-review-benchmark',node:process.version,platform:process.platform,arch:process.arch,source:{before:createHash('sha256').update(before).digest('hex'),after:createHash('sha256').update(after).digest('hex')},limitations:'Local isolated parser microbenchmark; no model or end-to-end latency measured. Two warmups then ten alternating paired samples.',cases};
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
console.log(JSON.stringify(cases.map(({chunkBytes,medianMs})=>({chunkBytes,medianMs})),null,2));
