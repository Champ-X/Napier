# Two-type thread event range queries

Thread-range queries with exactly two distinct normalized event types now use one ordered `UNION ALL` statement in both the synchronous SQLite reader and the asynchronous read worker. Each branch can use the existing thread/type/sequence index. This removes the whole-thread ordering scan observed in sparse mailbox inspection. Implementation commit: `8a0542311ad9960fec5c11487b827b22416c90d1`, containing three production files and one test file.

Queries with zero, one, three or more distinct types retain the existing path. The 64-type input limit still applies before deduplication. All values remain bound SQL parameters. The shared compiler receives validated inputs; its generated SQL descriptor travels only through private worker messages. The public reader API does not accept SQL. One compound statement preserves a single native statement snapshot, inclusive range boundaries, sequence order and multiplicity. Run-scoped queries, including parent admission and execution-fence checks, are unchanged.

## Rejected broad activation and retained tradeoff

The first prototype enabled the merge for every multi-type range. Its prespecified rule required exact outputs and no more than 20% median wall-time regression in any dense workload. It failed that rule: dense eight-type queries at 10k events regressed **25.3%**; dense 64-type queries regressed **44.0% at 10k** and **37.0% at 100k**. The exact four-file prototype, all raw cases and the rejection remain archived.

Activation was then limited to exactly two normalized types. A new holdout was specified before execution: 25k and 250k events, sparse two-type and dense two-/three-/64-type cases, with an exact **256-byte UTF-8 JSON payload** containing multilingual text. The original 20% dense-regression threshold was retained.

Each case ran baseline/candidate/candidate/baseline blocks, three samples per block, giving six measured samples per variant/case and **96 raw holdout samples** across eight cases. One warm-up per variant/case was excluded. These are native synchronous query measurements in one process, not separate-process or end-to-end Run measurements. Every complete output digest matched.

Median synchronous wall time, milliseconds:

| Workload | 25k baseline → candidate | 250k baseline → candidate |
| --- | ---: | ---: |
| Sparse, two types | 2.473 → 0.021 | 27.433 → 0.018 |
| Dense, two types | 29.998 → 31.521 | 349.173 → 390.359 |
| Dense, three types; existing SQL | 29.566 → 29.846 | 353.960 → 345.988 |
| Dense, 64 types; existing SQL | 31.159 → 30.499 | 360.263 → 360.725 |

All holdout cases met the original rule. The dense two-type result is an explicit cost: **5.1% slower at 25k and 11.8% slower at 250k**. Passing the bounded gate does not make these dense results improvements or establish a universal latency win.

A separate supplement exercised actual `SqliteLedgerReadWorker` instances against the same immutable sparse databases, with one warmed worker per variant/scale and the same balanced block order. Its **24 raw samples** retained six samples per variant/scale. Median async wall time was **2.536 → 0.063 ms at 25k** and **27.066 → 0.041 ms at 250k**. Digests matched the synchronous oracle, and database hashes were unchanged. Worker construction and warm-up were excluded; LocalStore initialization and fixture leases were not involved. This supplement adds no functional test cases and establishes no dense async result.

## Verification and limits

The isolated source base is `a7bd8ebd399243858b6e27a4c09c107b73627c79`; integration parent `3f9d7e2f2dbc76ad58e627f1f20f58e8705bb96d` adds documentation only. Forced Contracts/Runtime compilation and strict checking of the new test passed. **17 unique tests passed**: three new range-query cases, six existing query cases and eight mailbox cases. This is the same case set as the original prototype's report, not an additional 17 cases.

The tests cover inclusive and empty ranges, duplicate and hostile type values, 64-type limits, cross-thread isolation, detached values, fresh async reads after append and transaction snapshots across a concurrent writer. An independent review and two extra probes of the earlier broad prototype are retained separately; they are not added to the accepted 17-case total.

All **2,177 source and 4,388 emitted-file hashes** were identical before and after the synchronous measurement and again after the async supplement. The clean source architecture report retains seven findings, byte-identical to the recorded baseline; the public-API report retains four, also unchanged. These gates did not pass. The root commit receipt records 28 protected files unchanged and no push.

The repository minimum remains **Node.js >=22.19.0**. The change introduces no Node 24-only API. Compilation, tests and measurements used **Node 24.19.0** with SQLite 3.53.3; no cross-version runtime acceptance is asserted.

The records include process CPU, query plans, returned rows, complete output hashes and boundary RSS. RSS is not a peak or leak measurement. No SQLite row-visit counter, decoder-only CPU, cold-disk control, statistical significance, long-lineage acceptance, model-quality result or end-to-end latency claim is established. Wider cardinalities and Run-scoped scans remain outside the optimization.

## Portable evidence

The [regression receipt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/two-type-event-range-queries-regression-2026-10-30.json), [member/hash index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/two-type-event-range-queries-evidence-index-2026-10-30.json) and [compressed archive](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/two-type-event-range-queries-2026-10-30.tar.gz) retain both source variants, selected emitted modules, complete source/emitted hash manifests, configs and lockfile, deterministic seed/measurement scripts, all raw timing records and plans, test reports, the rejected broad results and root verification.

**No SQLite databases are archived.** The eight holdout database hashes, native event counts and exact payload byte checks are retained. The seed script deterministically regenerates the event data and refuses to overwrite prior measurements, but archived paths require rebasing and a fresh output directory. Database file bytes can vary with SQLite/runtime versions. Reconciliation checks recorded evidence; it cannot replay an omitted database or rerun timings.

From any directory, with the repository at `REPO`:

Run these evidence commands in the [archived checkout](archive/README.md#verification-snapshot).

```sh
python3 REPO/docs/artifacts/two-type-event-range-queries-reconcile-2026-10-30.py
python3 REPO/docs/artifacts/two-type-event-range-queries-reconcile-2026-10-30.py --workspace REPO
```

The verifier checks member and source bindings, stable source/emitted manifests, the 17-case identity set, every synchronous and async sample, output equality, medians and retention decisions, the three historical rejection cases, runtime scope and unchanged gates. It executes no archived code. The archive, index, regression receipt and verifier can be moved together; `--workspace` optionally compares the four current owned files, and `--list` lists members.
