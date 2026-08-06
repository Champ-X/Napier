# Agent Capability Contract v1 — Stage 7 evidence

This is the sanitized, reviewable evidence bundle for the Stage 7 round-2 repair. [`evidence.json`](./evidence.json) records the exact focused and workspace commands, full repository gate, credential canary, root-CLI DeepSeek research/replay/projection evidence, generated OpenAPI responses, Web rollback/re-restore assertions, and every known automation anomaly.

The three round-2 Web screenshots are intentionally distinct:

- `web-before-rollback.jpeg`: REV 3, current/recommended.
- `web-after-rollback.jpeg`: REV 4, restored from REV 2 with explicit overrides and Browser/read-only.
- `web-after-rerestore.jpeg`: REV 5, current/recommended with zero remaining changes.

Six earlier sanitized state screenshots remain for stale, explicit-override, custom-unmanaged, broken, conflict auto-refetch, and protected-research review. All nine SHA-256 values are pinned in the index.

Before deletion, the complete raw Midscene directory was inventoried as 15 HTML reports, 193 screenshots, and 225 files; every HTML basename and hash is recorded in the index. The raw reports/assets, isolated state databases, temporary model wrapper, and exact task temp roots were then removed. No provider credential value, `.env` value, raw SSE body, or persisted secret is retained here.

The evidence is deliberately candid: failed or over-broad automation attempts, the interrupted stalled CLI run, the retried fetch, the initial focused-test import failure, and the receipt-ordering rerun all remain disclosed. A passing final assertion does not erase an earlier anomaly.
