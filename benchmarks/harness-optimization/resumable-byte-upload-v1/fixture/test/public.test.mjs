import { test } from "node:test";
import assert from "node:assert/strict";
import { UploadBuffer } from "../src/upload.mjs";
test("out-of-order and duplicate writes", () => {
  const u = new UploadBuffer(4);
  assert.equal(u.write(2, new Uint8Array([3, 4])), 2);
  assert.deepEqual(u.missing(), [[0, 2]]);
  assert.equal(u.write(2, new Uint8Array([3, 4])), 0);
  assert.equal(u.complete(), false);
  u.write(0, new Uint8Array([1, 2]));
  assert.deepEqual([...u.finish()], [1, 2, 3, 4]);
});
