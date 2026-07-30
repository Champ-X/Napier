Migrate `discountedTotalCents` in `src/pricing.js` from two positional
arguments to one options object with `subtotalCents` and optional
`discountPercent` fields. `discountPercent` must default to zero. Preserve the
existing validation and rounding behavior.

Use `lsp_references` on the function before editing, then update every
workspace call site to the new object API. Inspect each affected file before
editing. Modify only `src/pricing.js`, `src/checkout.js`, and `src/quote.js`,
and finish with a concise result.
