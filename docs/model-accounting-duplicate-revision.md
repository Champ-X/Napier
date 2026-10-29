# Coherent revisions for duplicate model reconciliation

The 2026-10-30 candidate fixes a response metadata race: another Store can commit a model receipt after the receiving Store refreshes its heap but before it reads the native claim. The duplicate branch recognized the committed claim yet returned the old heap's `accountingRevision` and, for a child, `parentAccountingRevision`. Canonical usage was already correct. Both response revisions now come from the snapshot read atomically with that claim.

This is a separate **two-file change over the frozen 17-file shared allowance candidate**: `model-accounting-repository.ts` and the new `model-accounting-reconciliation-revision.test.ts`. It was tested in an isolated snapshot of `e10a7bd39b71dc74dfb4bbd05f6c5254bedd5696` plus frozen17, then the exact2 patch. The source-manifest SHA256 is `0699f1c456c9b69b52246a83b3afc4715c6179538d9f67181b0e0e5aeb9700ee`; patch SHA256 is `6010a68a3c21794644a882a4f074b2b55059d0006c61b3c2e2304012e8d423dd`.

The source was subsequently integrated in local commit `bf3b1c7843811766c70b66625f59b872c8806b79`, whose tree matches the supplementary integration snapshot below. The archive binds both changed source blobs to that commit using the raw commit object and the required tree paths. The receipt records no push. Freeze-time staging/commit flags are retained as historical data, not current repository status.

The [previous shared allowance evidence](shared-run-model-allowance.md) truthfully records this issue as open in its frozen17 candidate. That historical page and archive are not rewritten by this slice.

The old archive's default portable verifier remains valid after this follow-up. Its optional `--workspace` mode deliberately requires the historical exact17 bytes, so use a checkout of `1bf62ef299e9935dbc27f4d9caf46aa7f75f83d2` for that check. A current checkout containing this revision fix differs in `model-accounting-repository.ts`; that expected mismatch is not evidence corruption. This page's verifier checks the new exact2 source instead.

## Behavior

`reconcile()` already obtains a coherent `readModelAttemptView`; its duplicate result now uses that view's snapshot. The already-undispatched duplicate path also uses `readModelAttemptView` instead of a standalone claim lookup. Both self and parent revisions are resolved from the same immutable snapshot. No extra forced Store reload, mutable projection, provider invocation, usage adjustment or new accounting event is needed. Applied receipts retain their existing persistence path.

The revision describes the committed snapshot at that read. It does not promise to include a later concurrent commit. An operation-scoped receipt still has revision zero; a Run-scoped duplicate without its required snapshot or Run fails instead of falling back to stale heap metadata.

## Before and after

The four new deterministic regression cases all failed on frozen17 and all passed after the patch:

| Duplicate response | Before: stale heap revision | After: coherent snapshot revision |
| --- | --- | --- |
| Run receipt | self 2 | self 3 |
| Child receipt, followed by a separate parent receipt | self 2 / parent 2 | self 3 / parent 6 |
| Already-undispatched Run receipt | self 1 | self 2 |
| Already-undispatched child receipt | self 1 / parent 1 | self 2 / parent 2 |

The response-receipt cases force another real Store to commit after the receiving queue refresh, without mocking claim, snapshot or fold data. The undispatched cases hold the receiving heap at the pre-commit state to exercise the same read boundary. Assertions check that the heap stays stale during the duplicate return, no forced reload occurs, and persistent thread/Runs/tasks/events and native claim/event counts remain unchanged by the duplicate. Raw stdout also retains the observed revisions and counts. This is deterministic interleaving coverage, not unbounded process-scheduling stress.

The original independent review had five passing cases and the one stale-revision failure. The same six supplementary cases now pass, including the actual SQLite projection-failure/receipt-drain probe that asserts provider entry remains one. Those six cases are **not added** to the final suite total.

## Validation and scope

The final suite passed **197 unique cases in 24 files**, with zero skipped: the original **193 case keys in 23 unchanged test files**, plus the four new cases. The archive retains the original 23 test file bodies, so the reconciler checks both byte equality and case-key inclusion. Earlier focused repetitions are not counted again.

Contracts and Runtime builds and strict typechecking of the new test file passed in the isolated snapshot. The final 197 cases ran with an inherited Node TCP/UDP socket guard: 40 installation records across 37 processes (including three worker-thread contexts), 24 Unix socket connections, three `127.0.0.1` connections, and zero non-loopback attempts. This is controlled Node socket enforcement and logging, not OS packet capture or an independent provider-traffic measurement. The before/focused-review reports are not retroactively described as guarded runs.

Supplementary root integration tested the exact2 patch on base `bf6a34cdeede8e95e7932339de736f209954ecc5`, including the already integrated G01, shared allowance and G04 changes; the captured tree is `9d9061fd9938344be72491de7635956d325a62c1`. All 31 cases in its three selected files passed, and Runtime/CLI/Server compilation and strict new-test checking passed. Those 31 keys are a subset of the final197 and add no unique cases. Captured source and emitted identities remained stable (2,481 source and 5,110 emitted entries). Architecture still reports seven failures and public API still reports four; their raw logs match frozen17 byte-for-byte. This supplemental run is not another guarded197 run or a current-workspace certification.

The archive preserves the initial standalone-review dependency-resolution failure separately: its report had two failures, including the real revision assertion and a missing local package link. The corrected before report had exactly the one product failure. Initial build setup diagnostics caused by incomplete isolated dependency links are also retained; successful build/typecheck logs are distinct.

This slice changes duplicate response metadata. It does not change canonical usage, provider accounting, shared nominal allowance policy, or its physical-token/invoice limitations. It does not establish a performance improvement, whole-G03 completion, or clean architecture/public API gates. The earlier frozen17 failures and the supplemental integration failures remain visible.

## Portable reconciliation

```sh
python3 docs/artifacts/model-accounting-duplicate-revision-reconcile-2026-10-30.py
python3 docs/artifacts/model-accounting-duplicate-revision-reconcile-2026-10-30.py --workspace /path/to/candidate-or-integrated-checkout
```

The default verifier uses Python's standard library only. It verifies the archive and every member hash, rejects unsafe/duplicate/unindexed members, reconstructs the base Git commit/tree identity, verifies the frozen17 predecessor and exact2 delta, regenerates the small patch from retained source bytes, counts actual assertions, compares the unchanged original193 set and test file bodies, and checks build/network receipts. It reads archive members without extraction or execution and never resolves historical `/tmp` paths. `--workspace` checks only the two changed files; `--list` includes the verified member names.

The source proof contains the raw base commit, all 421 reachable tree objects, the captured 6,424-file candidate identity manifest, previous frozen17 bytes, exact2 bytes, and selected unchanged context. It does not include all unchanged base blob bodies or installed dependencies; replay requires the named base checkout and dependencies. Snapshot/usage stability is supported by the retained test source, assertions and logs; this verifier does not rerun those tests or reconstruct their deleted fixture databases.

Artifacts: [regression summary](artifacts/model-accounting-duplicate-revision-regression-2026-10-30.json), [evidence index](artifacts/model-accounting-duplicate-revision-evidence-index-2026-10-30.json), [reconciler](artifacts/model-accounting-duplicate-revision-reconcile-2026-10-30.py), and [raw archive](artifacts/model-accounting-duplicate-revision-2026-10-30.tar.gz). The version-controlled index binds the archive and summary/reconciler companions.
