import assert from "node:assert/strict";
import { UploadBuffer } from "./src/upload.mjs";
import { checkChunk } from "./src/chunk.mjs";
for (const n of [0, -1, 1.5, NaN, 1000001, "3"])
  assert.throws(() => new UploadBuffer(n), TypeError);
for (const args of [
  [3, -1, new Uint8Array([1])],
  [3, 1, []],
  [3, 0, new Uint8Array()],
  [3, 3, new Uint8Array([1])],
  [3, 0.5, new Uint8Array([1])],
])
  assert.throws(() => checkChunk(...args), TypeError);
const u = new UploadBuffer(4);
u.write(2, new Uint8Array([3, 4]));
assert.throws(() => u.write(0, new Uint8Array([1, 2, 99])), TypeError);
assert.deepEqual(u.missing(), [[0, 2]]);
assert.throws(() => u.finish(), TypeError);
const bytes = new Uint8Array([1, 2]);
u.write(0, bytes);
bytes[0] = 99;
const out = u.finish();
out[0] = 99;
assert.deepEqual([...u.finish()], [1, 2, 3, 4]);
let seed = 456;
for (let total = 1; total < 40; total++) {
  const upload = new UploadBuffer(total),
    model = new Map();
  for (let i = 0; i < 100; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const start = seed % total,
      length = 1 + ((seed >>> 8) % (total - start)),
      data = Uint8Array.from({ length }, (_, j) => ((start + j) * 7) % 256);
    let added = 0;
    for (let j = 0; j < length; j++) {
      if (!model.has(start + j)) added++;
      model.set(start + j, data[j]);
    }
    assert.equal(upload.write(start, data), added);
    const missing = [];
    for (let j = 0; j < total; j++)
      if (!model.has(j)) {
        const last = missing.at(-1);
        if (last && last[1] === j) last[1]++;
        else missing.push([j, j + 1]);
      }
    assert.deepEqual(upload.missing(), missing);
    assert.equal(upload.complete(), model.size === total);
  }
  upload.write(
    0,
    Uint8Array.from({ length: total }, (_, j) => (j * 7) % 256),
  );
  assert.deepEqual(
    [...upload.finish()],
    Array.from({ length: total }, (_, j) => (j * 7) % 256),
  );
}
console.log(
  "Chunk validation, atomic overlaps, ownership and coverage traces passed",
);
