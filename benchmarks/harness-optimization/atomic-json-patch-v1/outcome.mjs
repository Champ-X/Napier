import assert from "node:assert/strict";
import { decodePointer } from "./src/pointer.mjs";
import { applyPatch as patch } from "./src/patch.mjs";
assert.deepEqual(decodePointer(""), []);
assert.deepEqual(decodePointer("/~01//%2F"), ["~1", "", "%2F"]);
for (const p of ["x", "/~", "/~2", null, 1])
  assert.throws(() => decodePointer(p), TypeError);
const original = { a: [{ x: 1 }, 2, 3], b: {} };
assert.deepEqual(
  patch(original, [{ op: "move", from: "/a/0", path: "/a/2" }]),
  { a: [2, 3, { x: 1 }], b: {} },
);
const copied = patch(original, [{ op: "copy", from: "/a/0", path: "/b/c" }]);
copied.b.c.x = 9;
assert.equal(copied.a[0].x, 1);
assert.equal(original.a[0].x, 1);
assert.deepEqual(
  patch(original, [
    { op: "replace", path: "", value: [1] },
    { op: "add", path: "/-", value: 2 },
  ]),
  [1, 2],
);
assert.deepEqual(
  patch({ "a/b": { "~": 1 } }, [{ op: "replace", path: "/a~1b/~0", value: 2 }]),
  { "a/b": { "~": 2 } },
);
assert.deepEqual(
  patch({ x: { a: 1, b: 2 } }, [
    { op: "test", path: "/x", value: { b: 2, a: 1 } },
  ]),
  { x: { a: 1, b: 2 } },
);
const special = patch({}, [
  { op: "add", path: "/__proto__", value: { polluted: 1 } },
  { op: "add", path: "/constructor", value: 2 },
]);
assert.equal({}.polluted, undefined);
assert.equal(Object.hasOwn(special, "__proto__"), true);
assert.equal(special.constructor, 2);
for (const op of [
  { op: "remove", path: "" },
  { op: "remove", path: "/missing" },
  { op: "replace", path: "/missing", value: 1 },
  { op: "add", path: "/missing/x", value: 1 },
  { op: "test", path: "/a", value: [] },
  { op: "move", from: "/a", path: "/a/x" },
  { op: "move", from: "", path: "/a" },
  { op: "copy", from: "/toString", path: "/b" },
  { op: "add", path: "/a/01", value: 1 },
  { op: "replace", path: "/a/-", value: 1 },
  { op: "add", path: "/a/4", value: 1 },
  { op: "add", path: "/b/x" },
  { op: "unknown", path: "" },
]) {
  const before = JSON.stringify(original);
  assert.throws(
    () => patch(original, [{ op: "replace", path: "/b", value: 1 }, op]),
    TypeError,
  );
  assert.equal(JSON.stringify(original), before);
}
assert.deepEqual(
  patch(original, [{ op: "move", from: "/a", path: "/a" }]),
  original,
);
assert.throws(() => patch(original, Array(1)), TypeError);
for (let size = 1; size < 9; size++)
  for (let from = 0; from < size; from++)
    for (let to = 0; to < size; to++) {
      const arr = Array.from({ length: size }, (_, i) => i),
        expected = [...arr],
        value = expected.splice(from, 1)[0];
      expected.splice(to, 0, value);
      assert.deepEqual(
        patch(arr, [{ op: "move", from: `/${from}`, path: `/${to}` }]),
        expected,
      );
    }
console.log("Pointer, atomic patch, ownership and array move semantics passed");
