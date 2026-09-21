import assert from "node:assert/strict";
import { normalizeGraph } from "./src/graph.mjs";
import { planRollout } from "./src/rollout.mjs";
const nodes = [
    { id: "z", dependsOn: [] },
    { id: "db", dependsOn: [] },
    { id: "cache", dependsOn: [] },
    { id: "api", dependsOn: ["db", "cache"] },
    { id: "web", dependsOn: ["api"] },
  ],
  before = JSON.stringify(nodes);
assert.deepEqual(planRollout(nodes, { selected: ["web"], maxParallel: 1 }), [
  ["cache"],
  ["db"],
  ["api"],
  ["web"],
]);
assert.deepEqual(planRollout(nodes, { selected: ["web"], maxParallel: 2 }), [
  ["cache", "db"],
  ["api"],
  ["web"],
]);
assert.deepEqual(planRollout(nodes, { selected: [] }), []);
assert.deepEqual(
  planRollout([...nodes].reverse(), { selected: ["web"] }),
  planRollout(nodes, { selected: ["web"] }),
);
const g = normalizeGraph(nodes);
g.get("api").push("bad");
assert.equal(JSON.stringify(nodes), before);
for (const ns of [
  [{ id: "a", dependsOn: ["x"] }],
  [{ id: "a", dependsOn: ["a"] }],
  [
    { id: "a", dependsOn: [] },
    { id: "a", dependsOn: [] },
  ],
  [
    { id: "a", dependsOn: ["b", "b"] },
    { id: "b", dependsOn: [] },
  ],
  [
    { id: "a", dependsOn: ["b"] },
    { id: "b", dependsOn: ["a"] },
  ],
])
  assert.throws(() => planRollout(ns, { selected: [] }), TypeError);
for (const options of [
  { maxParallel: 0 },
  { maxParallel: 1.5 },
  { selected: ["missing"] },
  { selected: ["api", "api"] },
])
  assert.throws(() => planRollout(nodes, options));
console.log(
  "Dependency closure, ordering, cycle validation and ownership passed",
);

function checkRolloutContract({ normalizeGraph, planRollout }) {
  const mixed = [
    { id: "é", dependsOn: ["a", "_", "Z", "A"] },
    { id: "a", dependsOn: [] },
    { id: "_", dependsOn: [] },
    { id: "Z", dependsOn: [] },
    { id: "A", dependsOn: [] },
  ];
  const snapshot = structuredClone(mixed);
  const normalized = normalizeGraph(mixed);
  assert.ok(normalized instanceof Map);
  assert.deepEqual([...normalized.keys()], ["A", "Z", "_", "a", "é"]);
  assert.deepEqual(normalized.get("é"), ["A", "Z", "_", "a"]);
  assert.deepEqual(planRollout(mixed), [["A", "Z"], ["_", "a"], ["é"]]);
  assert.deepEqual(planRollout(mixed, { selected: ["Z"] }), [["Z"]]);
  assert.deepEqual(planRollout(mixed, { selected: ["é"], maxParallel: 100 }), [
    ["A", "Z", "_", "a"],
    ["é"],
  ]);
  normalized.get("é").push("unrelated");
  normalized.delete("A");
  assert.deepEqual(
    [...normalizeGraph(mixed).keys()],
    ["A", "Z", "_", "a", "é"],
  );
  assert.deepEqual(normalizeGraph(mixed).get("é"), ["A", "Z", "_", "a"]);
  const waves = planRollout(mixed);
  waves[0].push("unrelated");
  waves.push(["extra"]);
  assert.deepEqual(planRollout(mixed), [["A", "Z"], ["_", "a"], ["é"]]);
  assert.deepEqual(mixed, snapshot);

  const merge = [
    { id: "tail", dependsOn: ["bridge", "a"] },
    { id: "bridge", dependsOn: ["A", "Z"] },
    { id: "a", dependsOn: [] },
    { id: "Z", dependsOn: [] },
    { id: "A", dependsOn: [] },
  ];
  assert.deepEqual(planRollout(merge), [["A", "Z"], ["a", "bridge"], ["tail"]]);
  assert.deepEqual(planRollout(merge, { selected: ["bridge"] }), [
    ["A", "Z"],
    ["bridge"],
  ]);
  assert.deepEqual(planRollout(merge, { selected: ["tail"], maxParallel: 1 }), [
    ["A"],
    ["Z"],
    ["a"],
    ["bridge"],
    ["tail"],
  ]);
  assert.deepEqual([...normalizeGraph([])], []);
  assert.deepEqual(planRollout([]), []);

  for (const graph of [
    null,
    {},
    [null],
    [{ id: "", dependsOn: [] }],
    [{ id: 1, dependsOn: [] }],
    [{ id: "A", dependsOn: null }],
    [{ id: "A", dependsOn: [1] }],
    new Array(1),
    [{ id: "A", dependsOn: new Array(1) }],
  ]) {
    assert.throws(() => normalizeGraph(graph), TypeError);
    assert.throws(() => planRollout(graph, { selected: [] }), TypeError);
  }
  for (const maxParallel of [-1, 101, NaN, Infinity, "2", null])
    assert.throws(() => planRollout(mixed, { maxParallel }));
  for (const selected of ["A", 1, {}, new Array(1)])
    assert.throws(() => planRollout(mixed, { selected }));
}

checkRolloutContract({ normalizeGraph, planRollout });
console.log(
  "Mixed-case ordering, independent waves, full validation and fresh results passed",
);
