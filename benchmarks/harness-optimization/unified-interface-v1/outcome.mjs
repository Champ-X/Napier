import { readFile } from "node:fs/promises";

process.stdout.write("NAPIER_BENCHMARK_SANDBOX_STARTED\n");

const source = await readFile(
  new URL("./src/shipping.js", import.meta.url),
  "utf8",
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { shippingCostCents } = await import(moduleUrl);

assertEqual(shippingCostCents(0, true), 299, "member below threshold");
assertEqual(shippingCostCents(4_999, false), 599, "non-member below threshold");
assertEqual(shippingCostCents(5_000, true), 0, "member at threshold");
assertEqual(shippingCostCents(5_000, false), 0, "non-member at threshold");
assertEqual(shippingCostCents(5_001, true), 0, "member above threshold");
assertEqual(shippingCostCents(50_000, false), 0, "non-member above threshold");

let invalidRejected = false;
try {
  shippingCostCents(-1, false);
} catch (error) {
  invalidRejected = error instanceof TypeError;
}
if (!invalidRejected) throw new Error("negative subtotal must throw TypeError");

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}
