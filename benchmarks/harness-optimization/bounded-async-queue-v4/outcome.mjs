import assert from 'node:assert/strict';import {runJobs} from './src/queue.mjs';import {settleJob} from './src/job-result.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const reason={failure:true},value={ok:true};assert.deepEqual(await settleJob(()=>value),{status:'fulfilled',value});assert.equal((await settleJob(()=>{throw reason})).reason,reason);assert.equal((await settleJob(()=>Promise.reject(reason))).reason,reason);await assert.rejects(async()=>settleJob(1),TypeError);
let touched=0;for(const options of [{concurrency:0},{concurrency:1.5},{concurrency:33},{signal:{aborted:false}}])await assert.rejects(runJobs([()=>touched++],options));await assert.rejects(runJobs([()=>touched++,null]));assert.equal(touched,0);const sparse=[()=>touched++,,()=>touched++];await assert.rejects(runJobs(sparse));assert.equal(touched,0);
const controller=new AbortController(),gates=[deferred(),deferred(),deferred()],started=[];let active=0,peak=0;
const jobs=gates.map((gate,i)=>async()=>{started.push(i);active++;peak=Math.max(peak,active);try{return await gate.promise;}finally{active--;}}),before=[...jobs];
let settled=false;const pending=runJobs(jobs,{concurrency:2,signal:controller.signal}).then(x=>{settled=true;return x});assert.deepEqual(started,[0,1]);controller.abort();gates[0].resolve(value);await Promise.resolve();await Promise.resolve();assert.equal(settled,false);assert.deepEqual(started,[0,1]);gates[1].reject(reason);const result=await pending;assert.equal(result[0].value,value);assert.equal(result[1].reason,reason);assert.deepEqual(result[2],{status:'cancelled'});assert.equal(peak,2);assert.deepEqual(jobs,before);
const pre=new AbortController();pre.abort();assert.deepEqual(await runJobs([()=>touched++],{signal:pre.signal}),[{status:'cancelled'}]);await assert.rejects(runJobs([null],{signal:pre.signal}));assert.equal(touched,0);assert.deepEqual(await runJobs([]),[]);
const order=[];const sequence=await runJobs(Array.from({length:8},(_,i)=>()=>{order.push(i);if(i===2)throw reason;return i}),{concurrency:3});assert.deepEqual(order,[0,1,2,3,4,5,6,7]);assert.equal(sequence[2].reason,reason);assert.equal(sequence[7].value,7);console.log('Concurrency, cancellation, error identity and ordering passed');

// Validate nominal signal type before any job, including initially aborted fakes.
for (const signal of [null, {aborted:false,addEventListener(){}}, {aborted:true,addEventListener(){}}]) {
 let started=0;
 await assert.rejects(runJobs([()=>started++],{signal}));
 assert.equal(started,0,'Invalid signal must not start jobs');
}
console.log('Null and AbortSignal-shaped plain objects rejected');

