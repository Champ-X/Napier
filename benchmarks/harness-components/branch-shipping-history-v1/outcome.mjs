import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("./src/shipping.js", import.meta.url),
  "utf8",
);
const { shippingCostCents } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);
for (const member of [true, false]) {
  for (const subtotal of [0, 5999, 6000, 6001, 6999])
    assert.equal(shippingCostCents(subtotal, member), member ? 299 : 599);
  for (const subtotal of [7000, 7001, 8999, 9000, 50000])
    assert.equal(shippingCostCents(subtotal, member), 0);
  for (const subtotal of [
    -1,
    0.5,
    6999.5,
    NaN,
    Infinity,
    "7000",
    null,
    undefined,
  ])
    assert.throws(() => shippingCostCents(subtotal, member), TypeError);
}
console.log(
  "Branch amendment boundaries and integer validation passed (36 checks).",
);
