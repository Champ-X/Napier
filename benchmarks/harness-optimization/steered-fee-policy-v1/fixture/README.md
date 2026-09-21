# Delivery fee contract

`deliveryFee(subtotal, expedited = false)` returns a number.

- `subtotal` must be a finite nonnegative number. Reject all other values with
  TypeError; do not coerce strings, booleans or null.
- `expedited` must be a boolean after applying its default. Reject other values
  with TypeError, even when standard delivery is free.
- Standard delivery costs 7 for subtotal below 100, and 0 for subtotal at least 100. Expedited delivery adds 3, including when standard delivery is free.
- Preserve the export and its two arguments. No network or persistent state.

Public checks: `node --test test/public.test.mjs`; source type check:
`verify_workspace` with `kind=typecheck`, `cwd=.`. Public tests cover validation
and free-delivery examples, not every fee or threshold boundary.
