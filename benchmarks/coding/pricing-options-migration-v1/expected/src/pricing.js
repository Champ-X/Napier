export function discountedTotalCents({
  subtotalCents,
  discountPercent = 0,
}) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new TypeError("subtotalCents must be a non-negative integer");
  }
  if (
    !Number.isInteger(discountPercent) ||
    discountPercent < 0 ||
    discountPercent > 100
  ) {
    throw new TypeError("discountPercent must be an integer from 0 to 100");
  }
  return Math.round((subtotalCents * (100 - discountPercent)) / 100);
}
