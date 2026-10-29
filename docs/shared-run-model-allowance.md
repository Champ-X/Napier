# Shared Run model allowance: frozen G03 candidate

The 2026-10-30 candidate closes the reproduced admission gap where two child calls could both enter a provider before either produced a usage receipt, even though their combined output caps exceeded the parent Run budget. Admission now includes outstanding nominal allowances across the Run and its children. This is a bounded G03 implementation; **G03 remains incomplete**, and the allowance is **not a universal physical-token or invoice hard cap**.

This page records the exact 17-file candidate frozen against `a056a3b1bf3b503353b19e47c9a981363dc58f68`. Workspace HEAD at freeze was `e10a7bd39b71dc74dfb4bbd05f6c5254bedd5696`. The source-manifest SHA256 is `1b17a9b04688c0d5e513de69aee518fc714008f7f9710fb6f55f7b578abf3323`. These are evidence identities, not an integration commit. Independent review and integration are tracked separately by the parent task.

## Behavior and boundaries

- For supported text requests, the frozen input allowance is canonical Context UTF-8 bytes plus 256 framing units, 32 per message and 128 per tool, clamped to the admitted model context window. It is explicitly labelled `request_utf8_nominal_v1`. Output uses the frozen adapter output cap; accounting weights and available tariffs are frozen with the attribution.
- Unsupported APIs, non-text representations and legacy captures use the explicit model-context fallback. An unknown tariff remains unavailable and fails admission unless zero cost was explicitly declared. Raw admission recomputes the request allowance, preventing a caller from supplying a smaller captured allowance.
- Admission exposure visits unique self/child Runs and immutable child predecessors. It is a separate projection: canonical `Usage`, receipt folding and Host workspace allowance semantics are unchanged. Recovered parent usage does not silently inherit an old child's canonical usage, but admission still sees that predecessor's exposure.
- The native `enter()` path checks the shared allowance within the Store queue and persists dispatch intent with the existing SQLite revision compare-and-swap. Child calls therefore cannot both consume the same remaining nominal parent budget.
- Unknown and partial receipts retain unresolved dimensional allowance. Caller cancellation is insufficient to release it. Affirmative undispatched proof or a complete native receipt removes the corresponding remainder. Actual receipt overruns remain visible and block later admissions; actual usage is never clamped to the reservation.
- Host cross-process settlement now reads the native attempt view coherently. Failed projection forces heap reload; only an observed ledger revision change becomes the existing bounded concurrency retry. A stable malformed/conflicting receipt remains rejected.

The request heuristic cannot promise provider tokenization, hidden reasoning use, every adapter transformation, every billing rule or invoice totals. No real-model quality, production cost, latency or throughput improvement was measured here.

## Local before/after reproduction

The local fake provider holds the first receipt while two children attempt calls under a parent limit of 1,200 tokens; each output cap is 700. The archived reproducer JSON, scripts, logs and original closed SQLite databases agree:

| Observation | Base | Frozen candidate |
| --- | ---: | ---: |
| Provider entries before first response receipt | 2 | 1 |
| Persisted dispatch intents | 2 | 1 |
| Final canonical output tokens | 1,400 | 700 |
| Native receipts | 2 responses | 1 response + 1 affirmative undispatched |

Both candidates prepare two calls. In the fixed case the rejected call has zero undispatched usage; it is not silently dropped. Provider-entry counts come from the local reproducer, while dispatch intents and native receipt totals are independently reconciled against the archived SQLite rows. These files are not an independent provider-traffic capture.

## Verification

The final original acceptance reports contain **193 unique passed cases**, zero failures and zero skips: 156 Runtime cases in 17 files, and 37 Host cases in 6 files. The Host set includes actual process SIGKILL and the local loopback provider recovery cases. Contracts and Runtime builds and strict typechecking of the changed Runtime tests passed.

The same 23 files were repeated under a Node TCP/UDP socket guard with inherited preload. All **the same 193 case keys** passed. The guard recorded 36 Node process installations, 24 Unix socket connections, three `127.0.0.1` connections and zero non-loopback attempts during the tests. A separate selfcheck rejected `203.0.113.1:9` before calling the original socket connect method. The re-run contributes no additional unique cases. This is controlled Node process-tree socket enforcement and logging, not OS packet capture or an independent measurement of provider traffic. The original unguarded reports remain available and are not retroactively described as network captures.

The candidate's 6,165 tracked/new file identities were unchanged before and after this validation, with exactly the 17 frozen paths differing from the base tree. The emitted-module manifests were unchanged too. The archive retains the Git commit and all 371 reachable tree objects, all 14 owned baseline file bodies, all 17 candidate file bodies, selected unchanged context and test files, plus the complete file-identity manifests. It does not include every unchanged source blob or installed dependency; replay requires the base checkout and dependencies.

The existing gates are **still failing**, without relaxed budgets or digests:

| Gate | Base | Candidate | Comparison |
| --- | ---: | ---: | --- |
| Architecture | 7 failures | 7 failures | Raw failure logs byte-identical |
| Public API | 4 failures | 4 failures | Full observed values, errors and budgets equal |

The API failures are the existing root semantic export count 1,897 against 1,896, internal count 18 against 16, and two digest mismatches. Named exported subpath types were needed for declaration generation; the observed Runtime root/internal surfaces did not grow.

## Preserved failures

The evidence archive keeps the original failed reports and logs separately from final acceptance:

- Initial fixtures violated existing minimum limits of 1,000 tokens or $0.01; the fixtures were corrected without changing production limits.
- Concurrent cleanup/double shutdown errors and shared `dist` rebuild collection errors were resolved with corrected cleanup and isolated validation.
- The first real Host process run failed at `source_committed`. A plain base retry passed and was not presented as a base reproduction. A later deterministic stale-claim probe on the actual base failed both selected cases, with 11 other cases skipped.
- An intermediate post-fix comparison still failed because full `getDetail` includes volatile `generatedAt`; final assertions compare persistent thread, Runs, subagents and events. The failed intermediate report remains archived.
- Tool-only TS2698 and TS4058 diagnostics were not preserved as complete raw logs. The archive explicitly labels their retained text as transcript excerpts.

Independent review also reproduced an **open, pre-existing response metadata issue**: if another Store settles after queue refresh, duplicate reconciliation returns `accountingRevision: 2` while the durable revision is `3`. The same deterministic assertion fails on both the base and frozen candidate; canonical usage remains correct. This is not a newly introduced allowance regression, and the frozen 17-file candidate was not broadened to fix it. Its raw candidate/base reports and probe sources are archived separately from the original 193-case acceptance set.

The final independent probe run passed five cases and retained that one failure. The passing cases cover dimensional partial/missing-cost allowance, actual cost above allowance without negative remainder, unique ancestor exposure with malformed links rejected, and a real SQLite claim failure followed by receipt draining with the provider entry count still one. The reviewer used deterministic local probes against the isolated source; the original 193 cases were not independently rerun wholesale. Earlier review harness mistakes and their failed raw runs are preserved as well.

The optional root review receipt is a source read-through with probes pending at the time it was written. It is not another execution of the 193 tests or a claim that independent review completed.

## Portable reconciliation

Run from a checkout containing these documentation artifacts:

```sh
python3 docs/artifacts/shared-run-model-allowance-reconcile-2026-10-30.py
python3 docs/artifacts/shared-run-model-allowance-reconcile-2026-10-30.py --workspace .
```

The default command uses Python's standard library only (Python 3.11+ with SQLite `deserialize`). It verifies the archive and member hashes, rejects unsafe/duplicate/unindexed members, reconstructs the base Git tree identity, checks the exact 17-file source delta, counts actual unique passed assertions, matches the guarded repeat case-for-case, reconciles SQLite rows and persisted parent snapshots, and preserves the failing gate dispositions. It reads archive members without extracting or executing them. Historical `/tmp` and fixture paths are retained as evidence strings and never resolved. `--workspace` additionally compares only the 17 owned current files; it does not certify unrelated workspace changes. `--list` includes all verified archive paths.

The databases were closed and checkpointed before archival, with no WAL files. To use SQLite's in-memory deserializer, the verifier changes only the journal-mode header bytes of a private in-memory copy; the archived originals remain unchanged and are hashed first.

Artifacts: [regression summary](artifacts/shared-run-model-allowance-regression-2026-10-30.json), [evidence index](artifacts/shared-run-model-allowance-evidence-index-2026-10-30.json), [reconciler](artifacts/shared-run-model-allowance-reconcile-2026-10-30.py), and [raw archive](artifacts/shared-run-model-allowance-2026-10-30.tar.gz). The index binds each raw member and the reconciliation/summary companions; its repository history supplies the durable trust anchor.
