import { discountedTotalCents } from "./pricing.js";

export function checkoutTotalCents(order) {
  return discountedTotalCents(
    order.subtotalCents,
    order.discountPercent,
  );
}
