import {parseRetryAfter} from './retry-after.mjs';
export function retryDelay({method,status,attempt,retryAfter=null,nowMs,baseMs=100,maxMs=30000,maxRetries=3,jitter=1,idempotencyKey=null}){
 if(typeof method!=='string'||! /^[A-Za-z]+$/.test(method)||!Number.isInteger(status)||status<100||status>599||![attempt,maxRetries].every(n=>Number.isSafeInteger(n)&&n>=0)||![baseMs,maxMs].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isFinite(jitter)||jitter<0||jitter>1||(idempotencyKey!==null&&typeof idempotencyKey!=='string'))throw new TypeError('Invalid retry options');
 const header=parseRetryAfter(retryAfter,nowMs);method=method.toUpperCase();
 if(![408,429,500,502,503,504].includes(status)||attempt>=maxRetries||!(['GET','HEAD','OPTIONS','PUT','DELETE'].includes(method)||(method==='POST'&&idempotencyKey?.trim())))return null;
 if(header!==null&&header>maxMs)return null;
 const backoff=Math.floor(Math.min(maxMs,baseMs*2**attempt)*jitter);return Math.max(backoff,header??0);
}
