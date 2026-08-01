The checkout log shows that `loyaltyTotalCents(2_000, "gold")` in
`src/loyalty.js` returns 1,985 cents, but a 15% loyalty discount should produce
1,700 cents.

Inspect the file, then use `node_debugger` before editing. Pause after the
discount calculation and inspect the live `subtotalCents`, `discountPercent`,
and `discountCents` values. Continue or cancel the debugger when inspection is
complete.

Make the smallest correct repair without changing validation or rounding
behavior. Modify only `src/loyalty.js` and finish with a concise result.
