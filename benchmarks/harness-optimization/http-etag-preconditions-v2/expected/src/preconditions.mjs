import {parseTagList} from './etag.mjs';
export function evaluatePreconditions({method,exists,etag=null,ifMatch=null,ifNoneMatch=null}){
 if(typeof method!=='string'||! /^[A-Za-z]+$/.test(method)||typeof exists!=='boolean')throw new TypeError('Invalid request');
 let current=null;if(etag!==null){const tags=parseTagList(etag);if(!exists||tags==='*'||tags.length!==1)throw new TypeError('Invalid current ETag');current=tags[0];}
 const match=ifMatch===null?null:parseTagList(ifMatch),none=ifNoneMatch===null?null:parseTagList(ifNoneMatch);
 if(match!==null&&!(exists&&(match==='*'||(current&&!current.weak&&match.some(t=>!t.weak&&t.opaque===current.opaque)))))return 412;
 if(none!==null&&exists&&(none==='*'||(current&&none.some(t=>t.opaque===current.opaque))))return ['GET','HEAD'].includes(method.toUpperCase())?304:412;return null;
}
