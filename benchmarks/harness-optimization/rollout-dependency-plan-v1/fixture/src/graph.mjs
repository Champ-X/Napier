export function normalizeGraph(nodes){return new Map(nodes.map(n=>[n.id,n.dependsOn]));}
