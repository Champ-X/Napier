/** @param {number} subtotal @param {boolean} expedited */
export function deliveryFee(subtotal, expedited = false) {
  if (
    typeof subtotal !== "number" ||
    !Number.isFinite(subtotal) ||
    subtotal < 0
  )
    throw new TypeError("subtotal must be a finite nonnegative number");
  if (typeof expedited !== "boolean")
    throw new TypeError("expedited must be boolean");
  return (subtotal < 120 ? 9 : 0) + (expedited ? 3 : 0);
}
