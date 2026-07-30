process.stdout.write("NAPIER_BENCHMARK_SANDBOX_STARTED\n");

const { discountedTotalCents } = await import(
  new URL("./src/pricing.js", import.meta.url)
);
const { checkoutTotalCents } = await import(
  new URL("./src/checkout.js", import.meta.url)
);
const { quoteTotalCents } = await import(
  new URL("./src/quote.js", import.meta.url)
);

assertEqual(
  discountedTotalCents({ subtotalCents: 10_000, discountPercent: 25 }),
  7_500,
  "object API",
);
assertEqual(
  discountedTotalCents({ subtotalCents: 10_000 }),
  10_000,
  "default discount",
);
assertEqual(
  checkoutTotalCents({ subtotalCents: 8_000, discountPercent: 25 }),
  6_000,
  "checkout call site",
);
assertEqual(quoteTotalCents(4_999, 20), 3_999, "quote call site");
assertEqual(quoteTotalCents(4_999), 4_999, "quote default");

assertThrows(
  () => discountedTotalCents(10_000, 25),
  TypeError,
  "legacy positional API",
);
assertThrows(
  () => discountedTotalCents({ subtotalCents: -1 }),
  TypeError,
  "negative subtotal",
);
assertThrows(
  () =>
    discountedTotalCents({
      subtotalCents: 10_000,
      discountPercent: 101,
    }),
  TypeError,
  "invalid discount",
);

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function assertThrows(callback, ErrorType, label) {
  let thrown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof ErrorType)) {
    throw new Error(`${label}: expected ${ErrorType.name}`);
  }
}
