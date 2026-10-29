# G02 final-two independent audit — 2026-10-30

Result: PASS. Both previously confirmed bypasses are closed in the audited source/build. No production files were edited; no model calls occurred.

- Noncanonical known-source aliases reject at canonical-path validation after resealing and rehashing: leading `./`, embedded `/./`, doubled slash, trailing slash, uppercase, and `..` segment (6 negatives).
- The standalone `readCampaignAnalysisPlan` → child-binding path rejects rehashed plans with absent physical provenance artifacts, absent provenance root, changed frozen bytes, missing physical files, and an ancestor symlink alias that remains inside the root. Wrong JSON pointers also reject (6 negatives).
- Generic corpus binding requires embedded exact artifact bytes (1 negative); valid exact bytes pass.
- A valid 30-family synthetic catalog was loaded, frozen into a fresh directory, preregistered, read, and bound successfully both before and after negative checks. There were 0 invalid child bindings and 2 valid control bindings.
- All 16 checks pass. Source digests were stable throughout this run.

Evidence: `/tmp/napier-g02-corpus-final-two-20261030.json` (SHA256 `77ee7c71322f3252f4877d1e9df2086e44088237a877d9f4b673facc301d0c6f`). Repro: `/tmp/napier-g02-corpus-final-two-20261030.mjs` (SHA256 `609eb26ee55dad5a8d154fe721d1ac3eaa98ee9bee07ed3d38fb3a10e7ac9686`). Fresh fixture root: `/tmp/napier-g02-final-two-SFmpR9`.

This verification is limited to the final two fixes and directly related boundary controls. It makes no live-model quality claim, no whole-repository acceptance claim, and no new claims about other concurrent work. Six earlier corpus fixes were independently checked in `/tmp/napier-g02-corpus-reaudit-20261030.json`.

Audited file hashes:

- `packages/harness-eval/src/harness-corpus.ts`: `890bc8f5a53da81735fab4a154eb1880954500fe266e464bec767c6816bc8fe6`
- `packages/harness-eval/dist/harness-corpus.js`: `1a19da518e0533a67e6639e8854de66ffa7eaf27548a5e7eea3175e6d05d2868`
- `scripts/harness-campaign-analysis-plan.mjs`: `770998b3592b86bc9fd12e8f51aa539098a2c7cac3b057d5dc06daad61eb8f02`
- `scripts/harness-corpus-catalog.mjs`: `f64540ebd876a024e1624625addeb2ae65442030e0447250440af4b267a9129f`
- `scripts/harness-corpus-test-fixture.mjs`: `270c3ebf0868a099f38f64504f6ca4e38ed0869e0cc3a156e58867b3864a3e78`
- `scripts/run-harness-optimization-suite.mjs`: `aaf5109a0f405aacf341782ea1c81fa95bdee150ec8c3030ab6e3ea43aceb61d`
