# Native regular-file move recovery

Local implementation commit `0d269b64eb2e109faf6ebca6cc7fb1077c7f4e04` preserves one native `workspace_file_apply` regular-file move after executor death. Full G04 remains incomplete. The accepted scope is one file of at most 32 MiB, an absent destination, existing safe parent directories, and one filesystem. Directory moves, copy/trash/restore/create operations, multiple move chains, cross-filesystem moves, arbitrary plugin effects, and external effects receive no new recovery authority.

## Durable execution and recovery

Under the existing source/destination path locks, native execution stores a private content-addressed intent and appends `workspace.file.move.prepared`. The intent binds the workspace root, both parent device/inode identities, original file device/inode/length/SHA-256, normalized paths, native call/input/operation, plan hash and writer PID. Strict private storage requires file and directory durability; a storage failure prevents the commit gate. Public events contain hashes and native identifiers rather than raw paths or file bytes.

Only the typed `LocalPrivateCapsuleDurabilityUnavailableError` from intent storage permits a compatibility fallback before any prepared/gate event. The runtime first persists a native call/operation/input/plan-bound `workspace.file.move.recovery_unavailable` fact, then permits the ordinary move without this recovery guarantee. Failure to persist that fact still blocks the move. Missing POSIX durability flags and explicitly unsupported directory open/sync belong to this typed contract; EIO, ENOSPC, EACCES, corruption, quota exhaustion and file-sync failures do not. Neither a matching error message/name nor the unavailable fact authorizes a recovery proof, non-execution inference, automatic retry or continuation. If ordinary rename succeeds but its directory sync does not, the existing mutation result retains `postcondition: indeterminate`.

For durably prepared moves, the mandatory, one-use `workspace.file.move.commit_started` event follows another precondition check and precedes the existing rename. A failed gate cannot enter rename. Direct legacy manager calls without native invocation history keep their previous behavior and do not gain these recovery guarantees; partial native invocation history fails closed.

After writer death (`kill(pid, 0)` must report ESRCH), recovery checks the exact native invocation and operation lifecycle, opens the bound private intent, canonicalizes the workspace root before locking both paths, and reads only bounded regular-file descriptors with no-follow/nonblocking flags. FIFO/symlink/special-file replacement cannot become valid completion evidence.

| Durable gate | Filesystem observation | Classification |
| --- | --- | --- |
| Absent, complete valid native journal | Original source inode/bytes present; destination absent; root/parents unchanged | `not_executed`; no automatic replay or continuation grant |
| Present | Source absent; destination is the original inode with original bytes; root/parents unchanged | `completed`; remaining read-only work may continue after another live check |
| Present | Source still unchanged | Unknown; the gate alone cannot prove execution or non-execution |
| Invalid/missing private evidence or changed identities/bytes | Any | No completion proof; conservative stop |
| Recovery explicitly unavailable | Any | Ordinary execution may have moved the file; no move recovery classification or automatic continuation grant |
| Exact path-lock contention | Not inspected | Deferred and unknown; no target operation marker, proof, terminal or lease change |

The reconciliation proof, effect-indeterminate authority fence and interrupted Run transition commit atomically in SQLite. Path locks remain held through that commit. Recovery never performs the move again and never fabricates `tool.completed` or a successful operation settlement. Settled response loss retains the original durable settlement; unsettled completion uses a distinct reconciliation proof. Every automatic continuation rechecks current file/root/parent identities before creating its recovery Run. RecoveryService claims, binds and settles one descendant and does not claim another after completion.

Concurrent initializers treat exact lock contention as a pending inspection, so a contender cannot seal a slow winner as a safety failure. A deferred lost-owner Run may still have the persisted `running` label; it is neither an active executor nor completed recovery and is ineligible for automatic continuation. If the winner also dies or another lock remains occupied, another initialization or explicit lifecycle reconciliation is required. The ordinary RecoveryService sweep does not retry lost-owner reconciliation.

## Boundaries

Path locks coordinate cooperating Napier operations. The existing POSIX rename does not provide atomic no-replace protection against an unrelated process creating/replacing the destination between the last check and rename. Identity checks also do not freeze the filesystem after locks are released. This slice makes no universal hostile-writer/no-clobber guarantee and does not add platform-specific filesystem primitives. File/content hashes are local integrity bindings, not an external authenticity or completed-objective claim. PID reuse conservatively prevents reconciliation.

The private store is bounded at 512 intents, 16 KiB per object and 8 MiB total. Exhaustion stops preparation before rename. This slice does not add intent garbage collection.

## Verification

The independent-process fixture uses actual LocalStore, AgentRuntime, native preview/apply tools and a local faux provider; no paid or external model is used. Faults cover pre-effect/prepared/gate/rename/evidence/settlement/terminal boundaries, storage/gate failure, a still-live writer, changed content, identical bytes on a new inode, recreated source, missing target, symlink/FIFO/parent replacement, missing/corrupt intent, tampered receipts, live locks, SQLite rollback, and drift after a recovery claim. Malformed-history checks include reordered phases/gate, duplicate phases/settlements, foreign run/thread attribution and missing invocation admission.

Two independent recoverers and deterministic pre-commit barriers verify one durable proof/fence/terminal. The held winner is either released or killed; the contender returns before that decision with no automatic eligibility, and later reopening yields one stable reconciliation. The recovered file's inode/mtime and single rename log remain unchanged through read-only continuation.

Source-only test command (from `packages/runtime`; the config resolves exact contract export mappings without emitting dist):

```sh
npx vitest run --config test/workspace-file-move-vitest.config.ts test/workspace-file-move-recovery.test.ts test/workspace-file-mutations.test.ts test/agent-workspace-files.test.ts test/settled-patch-recovery.test.ts test/tool-effect-indeterminate-recovery.test.ts test/local-private-capsule-store.test.ts
```

On 2026-10-30 the six-suite pack passed **76/76**: move recovery 27, workspace mutation 13, agent workspace files 1, settled patch recovery 10, effect-indeterminate recovery 9, private capsule storage 16. Runtime `tsc --noEmit` passed; the new tests/config/process fixtures also passed a strict no-emit check. The raw pack report is `/tmp/napier-g04-move-pack-final-20261030.json`; the final owned-suite report is `/tmp/napier-g04-move-owned-final-20261030.json`. Source hashes and the exact owned-file list are recorded in `/tmp/napier-g04-move-handoff-20261030.json`.

These are local process-fault and integration results, not power-loss, hostile filesystem concurrency, cross-platform or full-G04 acceptance. That development handoff performed no commit, push, goal roadmap edit or dist JavaScript emit. Later root verification and local delivery are recorded below.

The integration follow-up adds English/Chinese explanations for the three move reasons without changing the RecoveryOperations layout. Existing recovery component tests pass 7/7; one-off renders in both languages retain all three explanations. The mutation plan model and fingerprint now share a dedicated internal module, preserving the original request-type export; manager size falls from 759 to 701 lines and its stale allowance is tightened from 746 to 701. Separate settled/reconciled evidence predicates reduce maximum function complexity from 37 to 16 without changing their checks. The post-refactor move/mutation pack passes 40/40. Updated ownership, hashes and reports are in `/tmp/napier-g04-move-handoff-v2-20261030.json`; the prior manifest and reports remain intact. Whole-workspace architecture failures outside this slice remain for their respective owners and are not represented as passing here.

The final typed-capability fallback pack passes **85/85**, including 36 native move recovery cases. Nine additional independent-process cases verify ordinary move completion with a bound unavailable marker, conservative recovery after a post-rename crash, marker persistence failure, and rejection of plain/forged-name errors, EIO, ENOSPC, EACCES and file-sync ENOTSUP. The fixture injects the typed capability failure at the move intent store's `put` boundary while executing the actual native preview/apply path; existing capsule tests separately exercise capability/error classification. These tests do not establish actual Windows filesystem behavior. Runtime and strict source-contract test no-emit checks pass. The report is `/tmp/napier-g04-move-fallback-final-20261030.json`; final hashes and checks are in `/tmp/napier-g04-move-handoff-fallback-20261030.json`.

## Final frozen verification

The final isolated checkout contains base `7d022a0b` plus the exact 22 staged source/config/test files in tree `71337d2ae5c420e41e119ebb6949aaecf1754208`. Concurrent Host accounting work and the 28 preexisting user files are excluded from the tested implementation snapshot. The latter remain hash-identical.

The final pack passed **47 files / 411 tests**: Runtime 393, Server 11, and existing Web recovery component 7; zero failures or skips. Contracts/Runtime/CLI/Server compilation, Web/Harness/Benchmark types, changed/new test strict checks and staged whitespace checks passed. All **4,020 source hashes and 5,069 emitted hashes** remained stable. The 48 existing strict diagnostics in `agent-runtime.test.ts` exactly match the normalized original `d2e33ac3` baseline.

Seven preexisting architecture findings remain in this isolated snapshot. Root public API is 1897/1896; internal API is 21/16; both compatibility digests remain failing. The pending Host consolidation is intentionally absent from this snapshot. The manager allowance was only tightened from 746 to 701; no failing gate was made green by raising its allowance. Historical release-manifest failure is retained without rewriting that manifest.

The [final regression receipt](artifacts/workspace-file-move-recovery-regression-2026-10-30.json) and [hash index](artifacts/workspace-file-move-recovery-evidence-index-2026-10-30.json) retain the original v1 validation failures, invalid interrupted v2 bootstrap, passing pre-fallback v3 and final v4. The typed unsupported-capability cases inject the error at intent storage in the actual native preview/apply child-process path; separate capsule tests exercise capability/error classification. This is not an actual Windows or power-loss test. EN/ZH static render files and seven existing component tests are not browser/usability acceptance. Full G04 remains active; no remote push was performed.
