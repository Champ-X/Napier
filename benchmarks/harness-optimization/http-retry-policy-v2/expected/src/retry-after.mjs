export function parseRetryAfter(value,nowMs){
 if(!Number.isSafeInteger(nowMs)||nowMs<0)throw new TypeError('Invalid clock');
 if(typeof value!=='string')return null;
 const s=value.trim();
 if(/^\d+$/.test(s)){const n=Number(s)*1000;return Number.isSafeInteger(n)?n:null;}
 if(!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(s))return null;
 const t=Date.parse(s);if(!Number.isFinite(t)||new Date(t).toUTCString()!==s)return null;return Math.max(0,t-nowMs);
}
