import assert from "node:assert/strict";
import { TransactionStore } from "./src/store.mjs";
import { cloneJson } from "./src/value.mjs";
const cycle = {};
cycle.x = cycle;
for (const v of [
  undefined,
  NaN,
  Infinity,
  1n,
  () => 0,
  Symbol(),
  Array(2),
  new Date(),
  cycle,
])
  assert.throws(() => cloneJson(v), TypeError);
const shared = { x: 1 },
  copied = cloneJson([shared, shared]);
assert.notEqual(copied[0], copied[1]);
const special = JSON.parse(
    '{"__proto__":{"safe":1},"constructor":2,"prototype":3}',
  ),
  s = new TransactionStore(special);
assert.deepEqual(s.snapshot(), special);
assert.equal({}.safe, undefined);
assert.deepEqual(s.get("toString"), { found: false });
s.begin("a");
s.set("__proto__", { safe: 2 });
s.begin("b");
s.delete("constructor");
s.begin("c");
s.set("x", [1]);
const before = s.snapshot();
for (const fn of [
  () => s.begin("a"),
  () => s.rollback("missing"),
  () => s.set("", 1),
  () => s.set("x", cycle),
  () => s.get(null),
]) {
  assert.throws(fn, TypeError);
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.depth(), 3);
}
s.rollback("b");
assert.equal(s.depth(), 1);
assert.deepEqual(s.get("constructor"), { found: true, value: 2 });
assert.deepEqual(s.get("x"), { found: false });
s.begin("b");
s.commit();
s.rollback("a");
assert.deepEqual(s.snapshot(), special);
assert.throws(() => s.commit(), TypeError);
const external = s.snapshot();
external.__proto__.safe = 99;
assert.equal(s.get("__proto__").value.safe, 1);
// Independent full-state stack oracle.
let model = {},
  frames = [],
  seed = 8721;
const store = new TransactionStore();
for (let i = 0; i < 400; i++) {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  const op = seed % 5,
    key = "k" + ((seed >>> 9) % 7);
  if (op === 0) {
    model[key] = [i];
    store.set(key, [i]);
  }
  if (op === 1) {
    assert.equal(store.delete(key), Object.hasOwn(model, key));
    delete model[key];
  }
  if (op === 2) {
    const name = "f" + i;
    frames.push({ name, state: JSON.stringify(model) });
    store.begin(name);
  }
  if (op === 3 && frames.length) {
    frames.pop();
    store.commit();
  }
  if (op === 4 && frames.length) {
    const index = (seed >>> 14) % frames.length;
    model = JSON.parse(frames[index].state);
    store.rollback(frames[index].name);
    frames.length = index;
  }
  assert.deepEqual(store.snapshot(), model);
  assert.equal(store.depth(), frames.length);
}
console.log("Nested rollback, ownership, literal keys and state traces passed");
