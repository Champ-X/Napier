import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "../src/patch.mjs";
import { decodePointer } from "../src/pointer.mjs";
test("decoded keys and array insertion", () => {
  assert.deepEqual(decodePointer("/a~1b/~0x"), ["a/b", "~x"]);
  const doc = { a: [1, 3] };
  assert.deepEqual(applyPatch(doc, [{ op: "add", path: "/a/1", value: 2 }]), {
    a: [1, 2, 3],
  });
  assert.deepEqual(doc, { a: [1, 3] });
});
