# Typed event queries for subagent mailboxes

Subagent mailbox preparation, durable message acceptance and provider inspection now read only their relevant event types. Implementation commit: `a7bd8ebd399243858b6e27a4c09c107b73627c79` (seven production files and one test). This extends G07 beyond the previously completed main invocation cursor; it does not add a mailbox cursor or change the SQL query planner.

The shared mailbox reader preserves each consumer's existing scope. Continuation reads accepted messages from every parent Run in the Task lineage, validates their identities and retains the first accepted event at a sequence collision. Acceptance reads accepted messages plus durable Run terminal events across the whole parent Run, so sibling Task ID conflicts and duplicate-before-terminal retry ordering remain unchanged. Inspection reads accepted and delivered events across the entire thread; it does not impose a new Run filter or use a separately captured head that could miss a concurrent append.

Child execution fences now request terminal events only. Checkpoint commit requests parent `subagent.step` receipts only. The child checkpoint frontier still reads the complete child Run: all-event head, model and tool evidence remain authoritative. Sparse consumption, inherited provenance, checkpoint freshness and display deduplication continue to use the existing replay rules. There is no retained-result cache and no change to the meaning of the consumed prefix.

## Verification

The isolated baseline is `03a62a0f9ef634c6f38d09196917193e47e83f62`; the integration parent `d1be20ebb6d89c2b1cf11ac28350d5a9131032ee` has identical Runtime source. Both isolated Contracts/Runtime compilations passed. The candidate passed **16 suites / 146 unique tests**, including checkpoint, sparse mailbox, continuation, process death and child execution tests. Eight new cases cover identity conflicts, four durable terminal statuses, cross-Run thread projection, inherited sparse consumption, full child frontier and first-match sequence collisions.

A later strict check found two diagnostics in one new test's broad `JsonValue` access. Adding an object/non-array guard changed only that assertion. Strict checking and the same eight cases then passed. The eight are a subset of the 146, not eight additional cases. The archive retains the earlier test bytes, reconstructed by reversing that guard and verified against its original recorded hash, alongside both test reports and the strict failure.

Root source audits preserve their actual scope: clean baseline and candidate each report the same **seven** architecture findings, byte for byte. The working tree and baseline with the same protected user overlay each report **eight**, also byte for byte. The working public-API report retains four findings. These gates did not pass; this slice introduced no architecture finding in the matched comparisons. The source commit receipt records 28 protected files unchanged and no push.

## Balanced native measurement

Each immutable SQLite seed contains two accepted messages, one delivery and 100, 10,000 or 100,000 unrelated parent-Run text events. The probe uses real LocalStore/provider entrypoints, native queries and full replay oracles. It closes the reserved child invocation without model dispatch, and external fetch throws. Seed creation, Store initialization, lease renewal and one warm-up per process/scale are outside the measured intervals.

Four fresh processes ran in the actual order **baseline, candidate, candidate, baseline**. Each process measured four operations five times at each of three scales: **240 raw samples**, or ten samples per variant/operation/scale. Complete output hashes agree across both variants and all rounds for every workload. All twelve copied databases had the same ordered event-stream digest as their corresponding immutable seed.

Median wall time in milliseconds:

| Operation | 10k baseline → candidate | 100k baseline → candidate | 100k returned event rows |
| --- | ---: | ---: | ---: |
| Checkpoint preparation | 23.934 → 2.429 | 277.633 → 24.001 | 300,018 → 5 |
| Duplicate acceptance | 7.063 → 1.156 | 91.269 → 11.942 | 100,003 → 2 |
| Provider inspection | 15.373 → 1.215 | 181.611 → 11.338 | 100,006 → 3 |
| Continuation mailbox | 7.070 → 0.051 | 90.664 → 0.075 | 100,003 → 2 |

These are query-returned rows, not SQLite rows scanned. The unchanged query implementation parses each returned event JSON row; decoder CPU was not measured separately. Raw records retain wall time, process CPU, query traces, complete output hashes and boundary RSS. RSS includes fixture setup, warm-up and previous scales; it is neither peak memory nor leak evidence. OS caches were not flushed. This sparse synthetic workload does not establish dense-mailbox, long-lineage, concurrent-load, end-to-end Run latency or statistical acceptance for all G07 workloads.

The multi-type queries still grow with irrelevant history. A separate read-only SQL diagnostic found the thread query using the thread/sequence index; alternative SQL returned the same three rows faster in that sparse seed. Its report and script are archived as a future opportunity only. No planner change or dense-query acceptance belongs to this implementation.

## Evidence and replay limits

The [regression receipt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/mailbox-typed-event-queries-regression-2026-10-30.json), [member/hash index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/mailbox-typed-event-queries-evidence-index-2026-10-30.json) and [compressed archive](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/mailbox-typed-event-queries-2026-10-30.tar.gz) preserve exact source overlays, configuration and lock hashes, runners, raw reports, three immutable seeds, root verification and failure records. They omit the twelve database copies and full repository snapshots.

Two probe setup failures remain explicit: the first seed omitted other threads' events; a later seed omitted the normalized lease overlay, allowing the snapshot lease to expire before candidate initialization. The corrected seed applies production thread-summary replay and normalized leases. The successful fixed-order exploratory run is retained separately from the final balanced comparison. Historical exploratory/failing databases and the SQL diagnostic's original database are not included in this portable archive.

From any directory, with this repository at `REPO`:

Run these evidence commands in the [archived checkout](archive/README.md#verification-snapshot).

```sh
python3 REPO/docs/artifacts/mailbox-typed-event-queries-reconcile-2026-10-30.py
python3 REPO/docs/artifacts/mailbox-typed-event-queries-reconcile-2026-10-30.py --workspace REPO
```

The verifier checks member hashes, source bindings, the 146-case/eight-case relationship, all 240 samples and summaries, output equality, returned-row counts, seed event streams, gate comparisons and retained failures. It does not execute archived scripts or rerun timings. Add `--list` to list members. The archive, index, regression receipt and verifier can be moved together without the repository; `--workspace` optionally compares the eight owned current files.

Archived runners retain historical absolute paths and expired fixture leases. A new execution requires the recorded baseline plus exact source overlay, compatible installed dependencies, rebased paths and fresh native fixtures/leases, followed by a new balanced comparison. Third-party dependencies were shared installed packages; the `@napier` source/build trees were isolated. No browser validation or broad G07 completion is claimed by this slice.
