import {settleJob} from './job-result.mjs';
export async function runJobs(jobs,{concurrency=2,signal}={}){
 if(!Array.isArray(jobs)||Array.from(jobs).some(j=>typeof j!=='function')||!Number.isInteger(concurrency)||concurrency<1||concurrency>32||(signal!==undefined&&!(signal instanceof AbortSignal)))throw new TypeError('Invalid queue options');
 const copy=[...jobs],out=copy.map(()=>({status:'cancelled'}));let next=0;
 async function worker(){while(next<copy.length&&!signal?.aborted){const i=next++;out[i]=await settleJob(copy[i]);}}
 await Promise.all(Array.from({length:Math.min(concurrency,copy.length)},worker));return out;
}
