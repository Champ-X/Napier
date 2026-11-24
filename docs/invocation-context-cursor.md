# Main invocation context event cursor

The main model lifecycle now owns one invocation-context preparer for its Run. When memory context is enabled and the Store supports native event queries, the preparer retains only event input and reads new relevant rows. It still rebuilds working state and memory context for every physical invocation, including reconstructed route, thinking and overflow calls. Implementation: `a056a3b1bf3b503353b19e47c9a981363dc58f68`.

The cursor obtains the committed head through `findLatestEvent`, then reads the fixed inclusive range through `listEventsRange`. The eleven relevant types cover user and runtime prompts, queued/delivered/cancelled controls, and tool starts and terminal events. Later appends belong to the next invocation. Serialized refreshes validate scope, type, sequence and head bounds; reads, copies and the existing projectors must all succeed before cached history or the watermark advances. A malformed batch, regressing head or incomplete control-delivery prefix leaves the previous state intact.

Run metadata and recovery lineage are read again before each preparation. Typed history retains same-thread events so newly visible Runs can contribute earlier input. Any observed branch metadata permanently selects the existing full-history oracle for that Run: filtering before branch provenance validation would hide forbidden events. Legacy adapters without native queries and state-only preparation also retain their existing full reads. Memory eligibility, dependency files, workspace artifacts and the current budget remain fresh on each invocation.

## Verification

The final isolated checkout was base `53e2eaf2406cf8ed007f96d51de51afbd150e499` plus the exact six-file tree `681b9726790722c672dbef4b261d28394a0cd675`, committed as `a056a3b1`. **33 files / 306 tests passed**: Runtime 302 and Server 4, with no failures or skips. Contracts/Runtime/CLI/Server compilation, Web/Harness/Benchmark types and strict owned tests passed. All **4,043 source / 5,099 emitted hashes** stayed stable; 28 protected user files were unchanged. The 48 existing strict diagnostics in `agent-runtime.test.ts` matched the retained `d2e33ac3` baseline.

The earlier frozen 109 tests cover native cold/warm ranges, appended controls, fixed-head races, recovery metadata, branch copies and rejection, legacy fallback, state-only reads, revoked/expired facts, changed dependencies, workspace freshness and budget updates. They overlap the final regression and are not added to its total. Independent source/evidence review found no blocking issue in its scope and independently checked all 82 original artifact hashes plus 24 smoke and 36 full raw output/receipt pairs; it did not rerun the suite or measurement.

The first development run retained 18 passes and three fixture failures: the demo model rejected control-message setup in two cases, and the freshness assertion used the wrong existing status string. The corrected run passed 22 tests. Initial direct lifecycle-to-cursor wiring added two architecture findings; moving cursor ownership into the real preparation boundary removed them. The original ten-finding report and subsequent eight-finding workspace report remain archived. The final isolated checkout has seven preexisting architecture findings and four public-API findings: root exports 1897/1896, internal exports 18/16, and both semantic digest mismatches. No budget, digest or historical release receipt was changed to make these pass.

## Frozen mechanism measurement

The measurement baseline is **`5adf1d9d6ebc30cc9fc0b6e503f7356308800f1f`**, not the later integration base. Both arms were privately compiled from that source; the candidate added exactly the six implementation/test/script files. Source, dist, scripts, lock and bound dependency hashes were unchanged before and after capture. The worker invokes the production preparer factory and verifies actual native head/range use. Both arms already include dependency-read reuse.

Each capture used eight fresh subprocesses: AB then BA with the probe enabled, followed by AB then BA with the probe disabled. Each workload had one cold and two warm invocations. Smoke retained 24 paired comparisons; the 100,000-event capture retained 36. Prepared state/memory outputs and memory receipt semantics were equal in every pair. Receipt comparison excludes only `index` and `dependencyValidation` telemetry.

For the noise-dominated 100,000-event fixture, cold returned event rows fell from **100,001 to 1,002**: 1,001 typed rows plus one durable head. Warm reads fell from 100,002/100,003 rows to **one head row and zero typed delta rows**. These are rows returned by queries, not SQLite internal rows scanned.

Probe-disabled observations across AB/BA, in milliseconds:

| Memory workload | Cold baseline → candidate | Warm baseline → candidate |
| --- | --- | --- |
| 1,000 facts sharing 32 files | 292–311 → 90–151 | 245–271 → 27–48 |
| 10,000 facts sharing 32 files | 3,404–3,460 → 3,172–3,227 | 300–325 → 74–78 |
| 1,000 facts with unique files | 380 → 174–177 | 331–337 → 113–116 |

All observations are retained. Smoke includes one adverse wall-time ratio of **1.186×** and **12/24 pairs with higher sampled peak RSS**. Full-capture wall ratios range from 0.105× to 0.944×; no full pair had a higher sampled peak RSS in this capture. These small synthetic samples do not establish statistical significance or a universal workload improvement. Cold means application cursor/index cold; OS caches were not flushed. RSS was sampled at boundaries and 20 ms intervals, so short peaks can be missed.

## Retained evidence and limits

The [regression receipt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/invocation-context-cursor-regression-2026-10-30.json), [member/hash index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/invocation-context-cursor-evidence-index-2026-10-30.json) and [compressed archive](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/invocation-context-cursor-2026-10-30.tar.gz) preserve the original 82 artifacts, every failure and adverse sample, fixed SQLite seeds and workspace/fact fixtures, frozen source files and scripts, independent review, and the complete root setup/verification artifacts. Original bytes and historical absolute paths are unchanged. The index maps every archived member to its digest and origin.

The portable verifier reads regular archive members without extracting or executing them. It checks all digests, original evidence bindings, raw paired outputs, native-read counts, fixed fixtures, the final regression and retained strict baseline. From any working directory, with this repository at `REPO`:

Run these evidence commands in the [archived checkout](archive/README.md#verification-snapshot).

```sh
python3 REPO/docs/artifacts/invocation-context-cursor-reconcile-2026-10-30.py
python3 REPO/docs/artifacts/invocation-context-cursor-reconcile-2026-10-30.py --list
```

Add `--workspace REPO` to compare the six current implementation files with the measured snapshot. Reconciliation is an evidence check; it does not rerun timing. Archived measurement runners retain their original paths and expired fixture leases.

This slice covers **main invocation preparation only**. Mailbox preparation, state-only and branch optimization, model quality, end-to-end Run latency and full G07 acceptance remain unestablished. Retained typed history and replay CPU still grow with relevant history. Batch completeness relies on the append-only native reader contract; the cursor is not an independent ledger-integrity verifier. Measurements used no model requests; final integration tests used local fixtures or loopback HTTP with zero external model calls.
