import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRanges } from "../src/ranges.mjs";
import { rangeResponse } from "../src/response.mjs";
test("suffix and overlapping ranges", () => {
  assert.deepEqual(parseRanges("bytes=0-2,2-5,-2", 10n), [
    [0n, 5n],
    [8n, 9n],
  ]);
});
test("malformed differs from unsatisfiable", () => {
  assert.equal(rangeResponse("bytes=9-2", 10n).status, 200);
  assert.equal(rangeResponse("bytes=10-", 10n).status, 416);
});
