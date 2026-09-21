import {matchResource,parts} from './resource.mjs';
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_.-]+$/.test(s)&&s!=='.'&&s!=='..';
const unique=(a,p)=>Array.isArray(a)&&a.every(p)&&new Set(a).size===a.length;
export function explainAccess(rules,principal,action,resource){
 if(!Array.isArray(rules)||!principal||!id(principal.id)||!unique(principal.groups,id)||!['read','write','delete'].includes(action))throw new TypeError('Invalid request');parts(resource);
 const ids=new Set(),matched=[];for(const r of rules){if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id)||!['allow','deny'].includes(r.effect)||!unique(r.actions,a=>['read','write','delete','*'].includes(a))||!r.actions.length||!unique(r.subjects,s=>s==='*'||(typeof s==='string'&&/^(user|group):/.test(s)&&id(s.slice(s.indexOf(':')+1))))||!r.subjects.length)throw new TypeError('Invalid rule');ids.add(r.id);parts(r.resource,true);
 if(r.subjects.some(s=>s==='*'||s==='user:'+principal.id||principal.groups.some(g=>s==='group:'+g))&&(r.actions.includes(action)||r.actions.includes('*'))&&matchResource(r.resource,resource))matched.push(r);}
 const denied=matched.some(r=>r.effect==='deny'),allowed=!denied&&matched.some(r=>r.effect==='allow');return {allowed,matchedRuleIds:matched.map(r=>r.id).sort(),reason:denied?'explicit_deny':allowed?'allow':'no_match'};
}
