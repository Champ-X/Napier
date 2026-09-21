import {encodeCursor,decodeCursor} from './cursor.mjs';
export function paginate(rows,{limit=20,status='all',cursor=null}={}){
 if(!Array.isArray(rows)||!Number.isInteger(limit)||limit<1||limit>100||!['all','open','closed'].includes(status))throw new TypeError('Invalid page');
 const ids=new Set();for(const row of rows){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id)||!Number.isSafeInteger(row.createdAt)||row.createdAt<0||!['open','closed'].includes(row.status))throw new TypeError('Invalid row');ids.add(row.id);}
 const key=cursor===null?null:decodeCursor(cursor,status);
 const compare=(a,b)=>a.createdAt===b.createdAt?(a.id<b.id?-1:a.id>b.id?1:0):a.createdAt>b.createdAt?-1:1;
 const eligible=rows.filter(r=>(status==='all'||r.status===status)&&(!key||compare(r,key)>0)).sort(compare);
 const items=eligible.slice(0,limit).map(r=>({...r}));
 const last=items.at(-1);return {items,nextCursor:eligible.length>limit?encodeCursor({createdAt:last.createdAt,id:last.id,status}):null};
}
