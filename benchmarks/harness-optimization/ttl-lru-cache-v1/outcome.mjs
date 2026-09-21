import assert from "node:assert/strict";
import { TtlLruCache } from "./src/cache.mjs";
import { deadline, validateTime } from "./src/clock.mjs";
for (const args of [
  [0, 1],
  [-1, 1],
  [1.5, 1],
  [Number.MAX_SAFE_INTEGER + 1, 1],
  [1, -1],
  [1, Infinity],
  [1, "2"],
])
  assert.throws(() => new TtlLruCache(...args), TypeError);
for (const args of [
  [-1, 0],
  [NaN, 0],
  [Infinity, 0],
  ["1", 0],
  [1, 2],
  [1, -1],
])
  assert.throws(() => validateTime(...args), TypeError);
assert.throws(() => deadline(Number.MAX_VALUE, Number.MAX_VALUE), TypeError);
const c = new TtlLruCache(2, 10),
  obj = { x: 1 };
c.put("a", obj, 0);
c.put("b", undefined, 1);
assert.equal(c.get("a", 2).value, obj);
assert.deepEqual(c.keys(2), ["b", "a"]);
assert.throws(() => c.put("", 1, 1000), TypeError);
assert.throws(() => c.get(null, 1000), TypeError);
assert.deepEqual(c.keys(2), ["b", "a"]);
assert.throws(() => c.delete("a", 1), TypeError);
assert.deepEqual(c.keys(2), ["b", "a"]);
c.put("a", 2, 3);
assert.deepEqual(c.keys(11), ["a"]);
assert.deepEqual(c.get("a", 13), { found: false });
const zero = new TtlLruCache(1, 0);
zero.put("a", 1, 0);
assert.equal(zero.size(0), 0);
const huge = new TtlLruCache(1, Number.MAX_VALUE);
huge.put("a", 1, 0);
assert.throws(() => huge.put("b", 2, Number.MAX_VALUE), TypeError);
assert.deepEqual(huge.keys(0), ["a"]);
for (const capacity of [1, 2, 4])
  for (const ttl of [0, 1, 7]) {
    const cache = new TtlLruCache(capacity, ttl);
    let records = [],
      now = 0,
      state = 123456;
    for (let i = 0; i < 150; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      now += state % 3;
      const key = String((state >>> 5) % 6),
        op = (state >>> 12) % 3;
      records = records.filter((x) => x.expires > now);
      const found = records.findIndex((x) => x.key === key);
      if (op === 0) {
        records = records.filter((x) => x.key !== key);
        if (ttl) records.push({ key, value: i, expires: now + ttl });
        while (records.length > capacity) records.shift();
        assert.equal(cache.put(key, i, now), undefined);
      }
      if (op === 1) {
        const expected =
          found < 0
            ? { found: false }
            : { found: true, value: records[found].value };
        if (found >= 0) records.push(...records.splice(found, 1));
        assert.deepEqual(cache.get(key, now), expected);
      }
      if (op === 2) {
        assert.equal(cache.delete(key, now), found >= 0);
        if (found >= 0) records.splice(found, 1);
      }
      const keys = cache.keys(now);
      assert.deepEqual(
        keys,
        records.map((x) => x.key),
      );
      keys.push("foreign");
      assert.equal(cache.size(now), records.length);
    }
  }
console.log(
  "TTL, recency, atomic validation and deterministic state traces passed",
);
