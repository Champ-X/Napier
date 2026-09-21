import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryFee } from "../src/fees.mjs";

test("rejects invalid inputs even for free delivery", () => {
  for (const value of [NaN, Infinity, -1, null, "10", true])
    assert.throws(() => deliveryFee(value), TypeError);
  for (const value of [null, 0, "false"])
    assert.throws(() => deliveryFee(200, value), TypeError);
});

test("free standard delivery retains the expedited surcharge", () => {
  assert.equal(deliveryFee(200), 0);
  assert.equal(deliveryFee(200, true), 3);
});
