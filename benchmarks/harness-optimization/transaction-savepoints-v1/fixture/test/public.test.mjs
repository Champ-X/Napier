import { test } from "node:test";
import assert from "node:assert/strict";
import { TransactionStore } from "../src/store.mjs";
test("inner commit still belongs to outer transaction", () => {
  const s = new TransactionStore({ a: 0 });
  s.begin("outer");
  s.set("a", 1);
  s.begin("inner");
  s.set("a", 2);
  s.commit();
  assert.equal(s.depth(), 1);
  s.rollback("outer");
  assert.deepEqual(s.get("a"), { found: true, value: 0 });
});
test("owned values", () => {
  const v = { n: [1] },
    s = new TransactionStore();
  s.set("a", v);
  v.n.push(2);
  assert.deepEqual(s.get("a").value, { n: [1] });
});
