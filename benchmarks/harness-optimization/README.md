# Harness optimization qualification tasks

These are real Agent tasks with independent outcome graders. Only each case's
`fixture/` is copied into the Agent workspace. The prompt and memory seeds are
supplied through their normal Runtime interfaces. The grader is introduced after
the Run stops. `expected/`, where present, is a reference used to test the grader;
it is never part of the Agent workspace or model context.

The cross-domain suite in `../harness-optimization-suite-v1.json` currently covers:

| Task                         | What the independent grader checks                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Configuration layering       | Nested merge, ownership, falsy values, deletion, unsafe keys and environment precedence |
| Feed pagination              | Stable keys, filtering, cursor validation, inserts/deletions and input ownership        |
| CSV ledger reconciliation    | Exact money, duplicates/conflicts, UTC windows, CSV quoting and malformed inputs        |
| Source-bound shipping memory | Current source precedence over stale and irrelevant memory, with limited edits          |
| Requested invoice report     | Exact paid-only totals, requested output destination and limited writes                 |
| Pricing API migration        | Updated call sites, LSP discovery and preserved validation/rounding behavior            |

Six cases are not the required thirty-case qualification. This suite also does
not establish long-task compaction/recovery quality, research-policy quality,
complete production dependency attribution or a causal cache/cost improvement.

`../harness-research-suite-v1.json` separately exercises the `research.v1`
composition through an offline compatibility audit of actual installed Pi SDK
source excerpts. `SOURCES.json` binds upstream file hashes, package version and
original/excerpt line ranges. The Agent must derive the reasoning behavior and
produce five exact, claim-supporting source citations. No browser capture,
network call or provider response is simulated. This is source-research evidence,
not live web-retrieval or long-task qualification; different policy compositions
must not be pooled into one passing gate.

Run it against two already compiled, immutable Runtime snapshots:

```sh
node --env-file-if-exists=.env scripts/run-harness-optimization-suite.mjs \
  --suite benchmarks/harness-optimization-suite-v1.json \
  --baseline-runtime /path/to/baseline-snapshot \
  --candidate-runtime /path/to/candidate-snapshot \
  --output /path/to/a-new-campaign-directory \
  --policy coding-python.v1 --context-delivery tail-v1 \
  --finalization request-aware-v1 --trials 3 --concurrency 4
```

The baseline uses its existing default profile. Candidate policy options apply
only to the candidate. Both arms retain the same per-case budgets, fixture,
prompt, memory seed and grader. Select the same available sandbox/image for both
arms through the existing environment configuration. With OCI, explicitly bind
the intended local Docker endpoint and check readiness using the same loaded
environment; a standalone Docker check does not override a stale `.env` binding.

The runner snapshots complete case inputs before any Agent starts, rejects
duplicate IDs/task inputs and input symlinks, creates new output directories,
bounds concurrent jobs, and waits for started child jobs to settle on cancellation.
Failed observations are retained. Repeating a campaign requires a new output
directory. No automatic retry replaces a failed trial.

Each campaign now inventories the installed production, optional and peer
dependency closure from the actual Runtime package. Workspace links are resolved
at their real locations; package bytes, executable bits, manifests and dependency
edges are checked again after each Run. Original graphs remain local in
`runtime-dependencies.before.json` and `trial-N/runtime-dependencies.after.json`.
Run-bound receipts enter the quality gate; missing, foreign or changed receipts
block attribution while adverse task outcomes remain visible. Historical reports
without these receipts remain historical observations, not proof of stability
under the strengthened gate. This inventory does not claim to capture undeclared
dynamic imports, OS libraries, credentials, downloaded code or external services;
OCI/browser environment identities retain their separate evidence boundaries.

`schedule.json` records the run schedule. Each arm has a log and original
`trial-N/result.json`, Run ledger and invocation capsules. `suite-result.json`
separates collection completeness from quality and promotion readiness. Inspect
the original reports before attributing failures; source/model mismatch,
degraded execution, scope violations and independent-grade failures are different
conditions. Concurrent jobs do not qualify latency or provider cache/cost effects.

Run the suite/fixture checks with:

```sh
npx vitest run scripts/harness-suite.test.mjs --testTimeout=30000
```

They exercise scheduler cancellation/concurrency, input snapshot ownership and
the new graders' rejection of original defects and acceptance of reference
implementations. They do not replace fresh model execution.
