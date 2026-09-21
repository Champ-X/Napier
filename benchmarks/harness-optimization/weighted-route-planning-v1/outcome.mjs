import assert from "node:assert/strict";
import { shortestRoute } from "./src/route.mjs";
import { validateGraph } from "./src/graph.mjs";
for (const args of [
  [["a", "a"], []],
  [Array(1), []],
  [["a"], Array(1)],
  [["a"], [{ from: "a", to: "x", cost: 1 }]],
  [["a"], [{ from: "a", to: "a", cost: -1 }]],
  [["a"], [{ from: "a", to: "a", cost: NaN }]],
  [
    ["a"],
    [
      { from: "a", to: "a", cost: Number.MAX_SAFE_INTEGER },
      { from: "a", to: "a", cost: 1 },
    ],
  ],
])
  assert.throws(() => validateGraph(...args), TypeError);
assert.deepEqual(shortestRoute(["x"], [], "x", "x"), { cost: 0, path: ["x"] });
assert.equal(shortestRoute(["x", "y"], [], "x", "y"), null);
assert.throws(() => shortestRoute(["x"], [], "x", "y"), TypeError);
const compare = (a, b) =>
  a.cost - b.cost ||
  a.path.length - b.path.length ||
  (() => {
    for (let i = 0; i < a.path.length; i++) {
      if (a.path[i] < b.path[i]) return -1;
      if (a.path[i] > b.path[i]) return 1;
    }
    return 0;
  })();
// Exhaustively enumerate simple paths, independent from production algorithm.
const nodes = ["s", "a", "a,", "b", "t"];
let seed = 998;
for (let trial = 0; trial < 100; trial++) {
  const edges = [];
  for (const from of nodes)
    for (const to of nodes) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      if (seed % 3 === 0) edges.push({ from, to, cost: (seed >>> 8) % 5 });
    }
  const routes = [];
  function walk(path, cost) {
    const at = path.at(-1);
    if (at === "t") {
      routes.push({ path: [...path], cost });
      return;
    }
    for (const e of edges)
      if (e.from === at && !path.includes(e.to))
        walk([...path, e.to], cost + e.cost);
  }
  walk(["s"], 0);
  routes.sort(compare);
  const before = JSON.stringify(edges);
  assert.deepEqual(shortestRoute(nodes, edges, "s", "t"), routes[0] ?? null);
  assert.equal(JSON.stringify(edges), before);
}
const edges = [
  { from: "s", to: "b", cost: 0 },
  { from: "s", to: "a", cost: 0 },
  { from: "a", to: "t", cost: 0 },
  { from: "b", to: "t", cost: 0 },
  { from: "a", to: "s", cost: 0 },
];
assert.deepEqual(shortestRoute(["s", "a", "b", "t"], edges, "s", "t"), {
  cost: 0,
  path: ["s", "a", "t"],
});
console.log("Graph validation, tie rules and exhaustive route oracle passed");
