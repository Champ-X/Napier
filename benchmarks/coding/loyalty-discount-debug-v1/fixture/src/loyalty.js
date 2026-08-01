export function loyaltyTotalCents(subtotalCents, tier) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError("subtotalCents must be a non-negative integer");
  }
  if (tier !== "none" && tier !== "silver" && tier !== "gold") {
    throw new TypeError("tier must be none, silver, or gold");
  }
  const discountPercent = tier === "gold" ? 15 : tier === "silver" ? 10 : 0;
  const discountCents = Math.round(discountPercent);
  return subtotalCents - discountCents;
}

globalThis.BENCHMARK_LOYALTY_TOTAL = loyaltyTotalCents(2_000, "gold");
