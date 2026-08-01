process.stdout.write("NAPIER_BENCHMARK_SANDBOX_STARTED\n");

const { loyaltyTotalCents } = await import(
  new URL("./src/loyalty.js", import.meta.url)
);

assertEqual(loyaltyTotalCents(2_000, "gold"), 1_700, "gold discount");
assertEqual(loyaltyTotalCents(1_999, "silver"), 1_799, "silver rounding");
assertEqual(loyaltyTotalCents(2_000, "none"), 2_000, "no discount");
assertEqual(loyaltyTotalCents(6, "gold"), 5, "cent rounding");
assertEqual(loyaltyTotalCents(0, "gold"), 0, "zero subtotal");

assertThrows(
  () => loyaltyTotalCents(-1, "gold"),
  TypeError,
  "negative subtotal",
);
assertThrows(
  () => loyaltyTotalCents(1_000.5, "silver"),
  TypeError,
  "fractional subtotal",
);
assertThrows(
  () => loyaltyTotalCents(1_000, "platinum"),
  TypeError,
  "unknown tier",
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
