/** @param {number} subtotal @param {boolean} expedited */
export function deliveryFee(subtotal, expedited = false) {
  return subtotal >= 100 ? 0 : 7;
}
