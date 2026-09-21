import { validateGraph } from "./graph.mjs";
export function shortestRoute(nodes, edges, start, end) {
  validateGraph(nodes, edges);
  const e = edges.find((x) => x.from === start && x.to === end);
  return e ? { cost: e.cost, path: [start, end] } : null;
}
