import { test } from "node:test";
import assert from "node:assert/strict";
import { TtlLruCache } from "../src/cache.mjs";
test("expiry is exclusive and hits affect eviction", () => {
  const c = new TtlLruCache(2, 10);
  c.put("a", 1, 0);
  c.put("b", 2, 1);
  c.get("a", 2);
  c.put("c", 3, 3);
  assert.deepEqual(c.keys(3), ["a", "c"]);
  assert.deepEqual(c.get("a", 10), { found: false });
});
test("undefined can be a cached value", () => {
  const c = new TtlLruCache(1, 1);
  c.put("a", undefined, 0);
  assert.deepEqual(c.get("a", 0), { found: true, value: undefined });
});
