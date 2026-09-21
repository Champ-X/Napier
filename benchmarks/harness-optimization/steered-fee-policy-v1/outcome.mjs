import assert from "node:assert/strict";
import { deliveryFee } from "./src/fees.mjs";

for (const invalid of [
  undefined,
  null,
  false,
  true,
  "0",
  {},
  [],
  NaN,
  Infinity,
  -Infinity,
  -0.001,
])
  for (const expedited of [undefined, false, true])
    assert.throws(() => deliveryFee(invalid, expedited), TypeError);
for (const invalid of [null, 0, 1, "false", {}, []])
  for (const subtotal of [0, 119.99, 120, 200])
    assert.throws(() => deliveryFee(subtotal, invalid), TypeError);
for (const subtotal of [
  0,
  -0,
  99.99,
  100,
  119.99,
  120,
  120.01,
  200,
  Number.MAX_VALUE,
]) {
  const standard = subtotal < 120 ? 9 : 0;
  assert.equal(deliveryFee(subtotal), standard);
  assert.equal(deliveryFee(subtotal, false), standard);
  assert.equal(deliveryFee(subtotal, true), standard + 3);
}
console.log(
  "Revised fee values, boundaries, validation and expedited surcharge passed",
);
