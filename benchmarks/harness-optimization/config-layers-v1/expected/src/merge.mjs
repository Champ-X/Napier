const forbidden=new Set(['__proto__','prototype','constructor']);
function plain(v){return v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);}
function clone(v,active=new Set()){
 if(v===null||typeof v==='string'||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return v;
 if(!plain(v)&&!Array.isArray(v)||active.has(v))throw new TypeError('Invalid configuration');
 active.add(v);let result;
 if(Array.isArray(v))result=v.map(x=>clone(x,active));
 else{result={};for(const key of Object.keys(v)){if(forbidden.has(key))throw new TypeError('Unsafe configuration key');if(v[key]!==undefined)result[key]=clone(v[key],active);}}
 active.delete(v);return result;
}
export function mergeConfig(base,layer){
 if(!plain(base)||!plain(layer))throw new TypeError('Expected object layer');
 const result=clone(base),next=clone(layer);
 for(const [key,v] of Object.entries(next)){
  if(v===null)delete result[key];
  else if(plain(v))result[key]=mergeConfig(plain(result[key])?result[key]:{},v);
  else result[key]=v;
 }
 return result;
}
