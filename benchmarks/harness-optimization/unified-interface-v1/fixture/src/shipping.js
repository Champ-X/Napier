export function shippingCostCents(subtotalCents, member) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError("subtotalCents must be a non-negative integer");
  }
  if (subtotalCents > 5_000) return 0;
  return member ? 299 : 599;
}
