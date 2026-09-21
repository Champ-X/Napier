import assert from "node:assert/strict";
import { parseRanges } from "./src/ranges.mjs";
import { rangeResponse } from "./src/response.mjs";
for (const h of [
  "bytes=",
  "bytes=-",
  "bytes=1-2,",
  "bytes=1 -2",
  "bytes=+1-2",
  "bytes=3-2",
  "bytes=999-,3-2",
  "bytes=1-2\n",
  "Bytes=1-2",
  "items=1-2",
  "bytes=1--2",
])
  assert.equal(parseRanges(h, 10n), null, h);
assert.equal(parseRanges("bytes=0-1,0-1", 10n, 1), null);
assert.equal(parseRanges(null, 1n), null);
for (const args of [
  [null, -1n],
  [null, 1],
  [null, 1n, 0],
  [true, 1n],
])
  assert.throws(() => parseRanges(...args), TypeError);
assert.deepEqual(parseRanges(" \tbytes= 001-003 , 4-8\t", 10n), [[1n, 8n]]);
assert.deepEqual(parseRanges("bytes=-0,100-", 10n), []);
assert.deepEqual(parseRanges("bytes=0-0,-1,1-", 0n), []);
assert.deepEqual(parseRanges("bytes=-1000", 3n), [[0n, 2n]]);
const big = 10n ** 80n;
assert.deepEqual(parseRanges(`bytes=${big - 2n}-${big + 20n}`, big), [
  [big - 2n, big - 1n],
]);
assert.deepEqual(rangeResponse("bytes=0-2", 10n), {
  status: 206,
  ranges: [[0n, 2n]],
  contentRange: "bytes 0-2/10",
});
assert.deepEqual(rangeResponse("bytes=-0", 10n), {
  status: 416,
  ranges: [],
  contentRange: "bytes */10",
});
assert.deepEqual(rangeResponse("bytes=0-0,2-2", 10n), {
  status: 206,
  ranges: [
    [0n, 0n],
    [2n, 2n],
  ],
  contentRange: null,
});
// Independent set-of-byte oracle for small valid headers.
for (let n = 0; n < 12; n++)
  for (let seed = 0; seed < 40; seed++) {
    const selected = new Set(),
      parts = [];
    for (let k = 0; k < 4; k++) {
      const start = (seed * 3 + k * 7) % 16,
        end = start + ((seed + k) % 6);
      parts.push(`${start}-${end}`);
      for (let j = start; j <= end && j < n; j++) selected.add(j);
    }
    const actual = parseRanges("bytes=" + parts.join(","), BigInt(n)),
      expected = [];
    for (const value of [...selected].sort((a, b) => a - b)) {
      const last = expected.at(-1);
      if (last && last[1] + 1n === BigInt(value)) last[1] = BigInt(value);
      else expected.push([BigInt(value), BigInt(value)]);
    }
    assert.deepEqual(actual, expected);
  }
console.log(
  "Byte range syntax, exact boundaries, coalescing and projection passed",
);
