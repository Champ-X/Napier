# Agent Capability Contract v1 — Stage 7/8 evidence

This is the sanitized, reviewable evidence bundle for the Stage 7 round-2 repair and Stage 8 entry-capability closure. [`evidence.json`](./evidence.json) is the index. The three Stage 8 machine-readable receipts add the exact protected CLI sequence, exact old-reader downgrade proof, and same-Store CLI/Web parity proof:

- [`stage8-cli-dogfood.json`](./stage8-cli-dogfood.json): default status → authentic Browser override → exact non-noop restore to REV 3 → schema-v1 status → DeepSeek official-source run and valid replay.
- [`stage8-old-reader.json`](./stage8-old-reader.json): exact `d2924c7` build/read/write, binding-array preservation, unbound old write, and two current-reader reopen assertions.
- [`stage8-cli-web-parity.json`](./stage8-cli-web-parity.json): canonical Store identity, Browser sentinel, exact projection equality, and unchanged Store hash across the Web read.

All receipt paths name isolated temporary Stores that were deleted after capture. They are identifiers for reproducibility, not retained state.

The three round-2 Web screenshots are intentionally distinct:

- `web-before-rollback.jpeg`: REV 3, current/recommended.
- `web-after-rollback.jpeg`: REV 4, restored from REV 2 with explicit overrides and Browser/read-only.
- `web-after-rerestore.jpeg`: REV 5, current/recommended with zero remaining changes.

Six earlier sanitized state screenshots remain for stale, explicit-override, custom-unmanaged, broken, conflict auto-refetch, and protected-research review. All nine SHA-256 values are pinned in the index.

The state-to-proof links are explicit: `stale.jpeg` shows `stale`/`unknown_legacy`; `custom-unmanaged.jpeg` shows `custom_unmanaged`/`unmanaged`; `broken.jpeg` shows `broken`/`unmanaged`; and `conflict-auto-refetch.jpeg` shows the authoritative 409 refresh with the new revision and diff. Deterministic tests cover these state rows, restart persistence, rollback provenance, composer summaries, and the HTTP 409 refresh. REV 3/4/5 remain visibly distinct in the three round-2 screenshots above.

Before deletion, the complete raw Midscene directory was inventoried as 15 HTML reports, 193 screenshots, and 225 files; every HTML basename and hash is recorded in the index. The raw reports/assets, 131 MiB temporary Chrome profile, isolated state databases, temporary model wrapper, and exact task temp roots were then removed. No provider credential value, `.env` value, raw SSE body, browser profile, or persisted secret is retained here.

The evidence is deliberately candid: failed or over-broad automation attempts, the interrupted stalled CLI run, the retried fetch, the initial focused-test import failure, and the receipt-ordering rerun all remain disclosed. A passing final assertion does not erase an earlier anomaly.
