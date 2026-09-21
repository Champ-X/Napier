import { validateGraph } from "./graph.mjs";
const compare = (a, b) => {
  if (a.cost !== b.cost) return a.cost < b.cost ? -1 : 1;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  for (let i = 0; i < a.path.length; i++)
    if (a.path[i] !== b.path[i]) return a.path[i] < b.path[i] ? -1 : 1;
  return 0;
};
export function shortestRoute(nodes, edges, start, end) {
  validateGraph(nodes, edges);
  if (!nodes.includes(start) || !nodes.includes(end))
    throw new TypeError("Invalid endpoints");
  const best = new Map([[start, { cost: 0, path: [start] }]]),
    done = new Set();
  while (true) {
    let current;
    for (const [id, route] of best)
      if (!done.has(id) && (!current || compare(route, current[1]) < 0))
        current = [id, route];
    if (!current) return null;
    const [id, route] = current;
    if (id === end) return { cost: route.cost, path: [...route.path] };
    done.add(id);
    for (const edge of edges)
      if (edge.from === id && !done.has(edge.to)) {
        const next = {
          cost: route.cost + edge.cost,
          path: [...route.path, edge.to],
        };
        if (!best.has(edge.to) || compare(next, best.get(edge.to)) < 0)
          best.set(edge.to, next);
      }
  }
}
