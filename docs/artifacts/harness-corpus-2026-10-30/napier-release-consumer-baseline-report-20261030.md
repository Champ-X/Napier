# Independent release-consumer baseline

Confirmed the **same 50 failures** on pristine `31e9edb96c022358008c1e3877697af0c2341980`. Baseline: **0 passed / 50 failed**. All test names, statuses, error messages and full stacks match the current aggregate after only normalizing checkout roots, including macOS /private/tmp resolution.

Each failure occurs while constructing the fixture at `check-release-artifacts.test.mjs:1750`, from `s1-shell-sandbox-local-evidence.mjs:169`:

```text
Error: OCI crash recovery failed: OCI crash recovery artifact shape is invalid
```

The retained stage11 artifact has four stale implementation hashes: `process-guardian.ts`, `process-guardian-worker-source.ts`, `sandbox-launch-policy.ts`, and `sandbox-oci.ts`. The exact base already contains these mismatches. The stage11 validator and implementation files match main at run start. The scoped closure has two main differences: current G02 consumer changes in `check-release-artifacts.mjs`, and a root-owned ephemeral fixture edit already present in `check-release-artifacts.test.mjs`. This baseline uses the original unmodified base test, and compares against the supplied pre-fix current aggregate. Full hashes are in the JSON report.

## Isolation and integrity

- Fresh `git archive` of exact base, at `/tmp/napier-release-baseline-31e9-gb13scbr/checkout`.
- Five isolated `tsc` builds passed: contracts, runtime, cli, benchmark-kit, harness-eval. All @napier links resolve inside that archive.
- 2610 baseline source/artifact files and 4768 emitted files remained unchanged.
- 6808 main source/emitted files remained unchanged during this run. The root-owned ephemeral test-fixture edit was already present in main at the initial snapshot and is distinguished in the report.
- No shared dist build, historical receipt rewriting, external model calls, or commits.

## Evidence

- Raw baseline JSON: `/tmp/napier-release-baseline-31e9-gb13scbr/vitest.json`
- Raw baseline metadata/source hashes: `/tmp/napier-release-consumer-baseline-20261030.json`
- Comparison and closure hashes: `/tmp/napier-release-consumer-baseline-report-20261030.json`
- Comparison report SHA256: `452cb8de7321fd3e4d78027ae8ea33d69f28a8bd55c2c2fb8b38824e52243825`
- Reproducer: `/tmp/napier-release-consumer-baseline-20261030.py`

The failures happen before release-consumer assertions. This proves the existing baseline obstruction, **not** G02 release-consumer acceptance; the separate ephemeral-fixture integration check is still required.
