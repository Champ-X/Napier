import { discountedTotalCents } from "./pricing.js";

export function quoteTotalCents(subtotalCents, discountPercent = 0) {
  return discountedTotalCents(subtotalCents, discountPercent);
}
