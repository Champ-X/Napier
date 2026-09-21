export function validateGraph(nodes, edges) {
  const dense = (x) =>
    Array.isArray(x) &&
    Array.from({ length: x.length }, (_, i) => Object.hasOwn(x, i)).every(
      Boolean,
    );
  if (
    !dense(nodes) ||
    !dense(edges) ||
    nodes.some((x) => typeof x !== "string" || !x.length) ||
    new Set(nodes).size !== nodes.length
  )
    throw new TypeError("Invalid nodes");
  const ids = new Set(nodes);
  let total = 0;
  for (const edge of edges) {
    if (
      !edge ||
      typeof edge !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(edge)) ||
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      !Number.isSafeInteger(edge.cost) ||
      edge.cost < 0
    )
      throw new TypeError("Invalid edge");
    total += edge.cost;
    if (!Number.isSafeInteger(total)) throw new TypeError("Unsafe cost");
  }
}
