export function parseTagList(header){return header==='*'?'*':header.split(',').map(s=>({weak:s.startsWith('W/'),opaque:s.replaceAll('"','')}));}
