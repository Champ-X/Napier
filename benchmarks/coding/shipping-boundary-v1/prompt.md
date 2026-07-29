Fix the boundary bug in `src/shipping.js`.

`shippingCostCents(subtotalCents, member)` must return zero for every order
whose subtotal is 5,000 cents or higher. Below that threshold, members must
still pay 299 cents and non-members must still pay 599 cents.

Inspect the actual file before editing, make the smallest correct change, and
do not modify or create any other file. Finish with a concise result.
