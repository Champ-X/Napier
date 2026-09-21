export function normalizeGraph(nodes){
 if(!Array.isArray(nodes))throw new TypeError('Invalid nodes');const g=new Map();
 for(const n of nodes){if(!n||typeof n.id!=='string'||!n.id||g.has(n.id)||!Array.isArray(n.dependsOn)||n.dependsOn.some(d=>typeof d!=='string'||!d)||new Set(n.dependsOn).size!==n.dependsOn.length)throw new TypeError('Invalid node');g.set(n.id,[...n.dependsOn].sort());}
 for(const [id,deps] of g)if(deps.some(d=>d===id||!g.has(d)))throw new TypeError('Unknown dependency');
 const remaining=new Set(g.keys()),done=new Set();while(remaining.size){const ready=[...remaining].filter(id=>g.get(id).every(d=>done.has(d)));if(!ready.length)throw new TypeError('Cycle');for(const id of ready){remaining.delete(id);done.add(id);}}
 return new Map([...g].sort(([a],[b])=>a<b?-1:a>b?1:0));
}
