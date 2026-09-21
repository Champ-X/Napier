export function parseTagList(header){
 if(typeof header!=='string'||header.length>8192||/[\r\n]/.test(header))throw new TypeError('Invalid ETag list');const s=header.replace(/^[ \t]+|[ \t]+$/g,'');if(s==='*')return '*';if(!s)throw new TypeError('Empty ETag list');const out=[];let rest=s;
 while(rest){const m=/^(W\/)?"([\x21\x23-\x7e]*)"/.exec(rest);if(!m)throw new TypeError('Invalid ETag');out.push({weak:!!m[1],opaque:m[2]});rest=rest.slice(m[0].length).replace(/^[ \t]+/,'');if(!rest)break;if(rest[0]!==',')throw new TypeError('Missing separator');rest=rest.slice(1).replace(/^[ \t]+/,'');if(!rest)throw new TypeError('Trailing separator');}return out;
}
