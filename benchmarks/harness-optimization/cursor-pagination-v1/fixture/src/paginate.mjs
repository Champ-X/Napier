import {encodeCursor,decodeCursor} from './cursor.mjs';
export function paginate(rows,{limit=20,status='all',cursor=null}={}){
 const offset=cursor?decodeCursor(cursor).offset:0;
 rows.sort((a,b)=>b.createdAt-a.createdAt);
 const items=rows.slice(offset,offset+limit).filter(r=>status==='all'||r.status===status);
 return {items,nextCursor:items.length===limit?encodeCursor({offset:offset+limit}):null};
}
