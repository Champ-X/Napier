# Current artifact facts and recorded version history

Local implementation commit `53e2eaf2406cf8ed007f96d51de51afbd150e499` separates current filesystem observations from plan artifact declarations. The Task validation matrix now consumes the shared facts instead of treating `artifact.status === "verified"` as a current integrity pass. This completes the recorded G01 slice; broader G01 remains open.

## What is established

Runtime inspects formal file deliverables on every task-detail or cached narrative request. The cache retains event reduction only, so a file change without a new ledger event is observed on the next request. An observation binds the plan ID and revision, path, and complete artifact manifest. A pass requires current digest and byte count to match the verified declaration. Missing bytes, changed bytes, and unchecked observations remain distinct; a historical missing declaration cannot override a file that has reappeared. A declaration without current observation keeps accessibility unchecked.

Checks use asynchronous file I/O, reject symlink path segments and non-regular files, and compare descriptor/path device, inode, size, mtime and ctime across the read. Each response permits at most 64 file checks and 64 path segments, 8 MiB per file and 32 MiB actual read bytes overall. The extra growth probe is clipped to both byte budgets. Unsupported kinds, unsafe paths, exhausted budgets, unreadable files and unstable reads remain unchecked. These are count/byte bounds, not a universal filesystem wall-time guarantee; the workspace is not scanned.

Existing `plan.artifact.*` events supply historical metadata assertions with event identity, sequence, plan revision, path and digest. They do not prove that a Run created the file, authenticate a producer, or archive old bytes. History is explicitly incomplete because historical state updates and event appends were not atomic. Current event binding requires the exact current plan revision: an identical update in the same millisecond cannot borrow an older event after an append failure. Later unrelated plan changes conservatively move that event into history while fresh matching bytes can still pass integrity.

Different artifact identities are selected by creation/declaration order. A late update of an older declaration cannot reclaim a newer continuation, including same-clock creation ties; a missing current generation never revives an older verified version. Within one identity, emitted metadata history follows event sequence and revision. `sourceRunId` remains the recording/verifying Run, not a creator claim. Existing uploaded-byte verification receipts retain their transfer-verification scope.

## Verification and retained counterexamples

The [delivery receipt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/task-artifact-facts-regression-2026-10-30.json) binds the 20 committed source/test/CSS files to tree `070547477f6d97d73639110d66b654b192a448e5`. The 19-file logical candidate was independently compiled and tested in tree `2429b60835e78659eccf1ea3812c1e56f2fda83d`; the additional CSS file has separate production-build and browser evidence.

| Evidence | Recorded result and scope |
| --- | --- |
| Root isolated functional validation | 47 files / 279 tests: Runtime 143, Server 36, Web 92, CLI 8; no failures or skips. Contracts/Runtime/CLI/Server declaration emission, related types and strict changed tests passed. All 4,040 source and 5,096 emitted hashes stayed stable. |
| Implementation regression | 16 files / 110 tests passed, including real Hono handlers, SQLite restart, filesystem changes and read races. This overlaps the root pack. |
| Independent review | 3 real HTTP/Store probes passed; 19 source hashes matched before and after. Same-clock commit gaps, missing-size/revision/drift bindings, file reappearance and warm/cold restart were checked. |
| Production browser | Final v5 exercised 6 scenarios and saved 9 screenshots using light Chromium at 1440, 390 and 320 CSS px, in EN/ZH. State text, refresh, keyboard selection, cell/tab horizontal containment and tab-center hit tests passed. Root inspected the six panel captures and three narrow top captures. Source/emitted/Web-dist sets of 4,040 / 5,096 / 339 files remained stable. |

The browser build includes the exact retained user overlay and excludes parallel G07 work; it is not a clean-commit-only release claim. All 28 protected user files remained unchanged. No external model calls were made. Packs overlap and their counts must not be summed.

The archive retains the original three failures: nonexistent files receiving metadata-only verified declarations, same-artifact overwrite losing previous versions, and native-verified bytes drifting while validation stayed passed. It also preserves the restart-fixture failures, strict configuration failures, the actual 8 MiB + 1-byte read, same-millisecond state/event gap, reappeared-file contradiction, TS2742 declaration-emission failure, and the older-generation continuation regression. A passing intermediate pack did not erase a later counterexample.

Browser v1 and v2 failed during fixture setup and executed zero browser cases. Browser v3's raw receipt says `passed`, but its visual acceptance was rejected: page width, DOM text and zero console errors did not detect clipped evidence/source cells and task navigation. That receipt and screenshots remain unchanged. The final `workspace-shell.css` change reflows narrow validation cells and navigation. V4 verified six wrapped panel states; v5 added separate task-top screenshots and hit tests so normal vertical scrolling was not confused with hidden navigation.

Seven preexisting isolated architecture findings remain, plus Runtime root exports 1897/1896, internal exports 18/16 and both semantic-digest mismatches. The 48 old `agent-runtime.test.ts` strict diagnostics still match baseline `d2e33ac3` after normalization. The UI detector retains one unrelated preexisting diff-pane accent-border warning. No budgets, compatibility digests or old release records were rewritten.

The [documentation check](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/task-artifact-facts-documentation-check-2026-10-30.json) retains five whitespace findings in three raw historical evidence files. Their original bytes and hashes are preserved; the final evidence commit was not whitespace-clean. The authored source/CSS diff check passed before its separate implementation commit.

## Remaining boundaries

A current observation establishes bytes seen while producing that response. It does not establish future immutability or whole-objective acceptance. Directories and URLs are unchecked in this slice. Whole-objective status remains unverified/partial as appropriate, with no new mandatory operator acceptance gate. Tool-only discovery, a complete historical byte archive, independent whole-goal acceptance sources, migration of every artifact-card consumer, and full G01 acceptance remain unfinished. Physical mobile, dark mode, screen-reader acceptance, model quality and general performance improvement are not claimed.

The [hash index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/task-artifact-facts-evidence-index-2026-10-30.json) maps unchanged raw receipts to their historical temporary paths. The archived [reconciliation script](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/task-artifact-facts-2026-10-30/reconcile.py) verifies the committed source hashes, receipt relationships and every archived byte without requiring temporary files:

Run these evidence commands in the [archived checkout](archive/README.md#verification-snapshot).

```sh
python3 docs/artifacts/task-artifact-facts-2026-10-30/reconcile.py --check
```
