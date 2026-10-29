# Independent native workspace operation recovery

Recovery now retains a bounded batch of independent native file moves and patches. A restart inspects all unfinished and already settled participants before making a recovery decision. One union of path locks remains held through the atomic authority fence; read-only continuation acquires the complete set again and retains it until the recovery Run finishes. No original tool terminal, settlement or writing grant is fabricated.

Implementation commit: **`bf6a34cdeede8e95e7932339de736f209954ecc5`**. The original frozen implementation was based on `e10a7bd39b71dc74dfb4bbd05f6c5254bedd5696`, with the same fifteen source/test files listed in the [regression receipt](artifacts/workspace-operation-batch-recovery-regression-2026-10-30.json). It has not been treated as acceptance of unrelated G04 recovery work.

## Actual before and after

The same local faux-provider harness executed two successful native moves, then exited with code 73 after the second actual `tool.completed`. The BEFORE snapshot was checked against the exact base Git bytes. The AFTER harness changed only its frozen implementation import paths.

| Observed result | BEFORE | AFTER |
| --- | ---: | ---: |
| Successful native moves / actual renames | 2 / 2 | 2 / 2 |
| Move recovery evidence after restart | 0 | 2 |
| Automatic recovery eligible | false | true |
| Completed recovery Runs | 0 | 1 |
| Actual read-only `read_file` completions | 0 | 2 |
| File bytes, device, inode and mtime unchanged | yes | yes |
| External model requests | 0 | 0 |

Six additional preserved process cases cover move → move, patch → move and move → patch, each interrupted before the final commit gate or after its actual effect. Every case retains one real unfinished tail, one authority marker and one bound reconciliation proof. The unfinished call has no fabricated `tool.completed`, `tool.failed` or operation settlement. After-effect cases complete a read-only continuation with two actual reads; precommit cases remain ineligible and perform no replay.

**Native write tools currently share an exclusive execution gate.** The reachable process evidence is multiple settled operations plus at most one unfinished tail. It does not demonstrate two simultaneously unfinished native operations in one Run. An exploratory parallel fixture stopped behind this existing gate; its raw state and failed attempt are retained, and the gate was not weakened to manufacture a result.

## Scope and decision boundaries

- At most 128 total operations, 256 paths and 64 MiB of existing target bytes are inspected in one batch. Per-operation file limits still apply.
- Only built-in `apply_patch` and single regular-file `workspace_file_apply` moves are admitted. Exact endpoint reuse, ancestor overlap and hardlink aliases are rejected. The existing hash-linked pure patch version chain remains supported; cross-operation move chains receive no inferred proof.
- Preparation receipts, private capsules, original owner bindings, file identities and current postconditions must agree. Settled patch preparation is checked as well as unfinished preparation, including a changed receipt whose hash was recomputed.
- The SQLite fence checks the complete prepared participant scope and requires the marker set to equal all unfinished boundaries. A failed participant produces no partial reconciliation proof. Proof, authority fence and Run transition remain one transaction.
- A live path owner or coordinator conflict leaves the batch unresolved. Deferred sweeps re-open the complete set; a changed participant blocks the batch. Competing recoverers converge after commit or owner death, including restart.
- A claim is scheduling eligibility. Recovery rechecks the journal and private/file evidence after Run creation, before continuation, and holds cooperative path locks through the read-only Run. A failed check prevents model dispatch.
- The prior opted-in pure verified-patch executor continues to own its locks and permissions. Mixed moves with pending patches are explicitly rejected; this change grants no mixed replay authority.

Cooperative locks do not stop arbitrary external filesystem writes. The retained evidence reports observations at the reconciliation and continuation checks, not permanent immutability. Directory moves, remote effects, arbitrary tool replay, and general multi-operation recovery remain outside this slice.

## Verification

The final isolated snapshot passed **9 files / 133 tests**, without failures or skips. This includes the new 29-case batch suite plus native move, settled/unsettled/verified patch, authority-fence and deferred-reinspection regression suites. Tests cover process death, both mixed orders, commit cuts, full-batch drift/tamper rejection, hardlink/path bounds, aggregate byte bounds, transactional rollback, live contention, deferred drift, recovery-winner death, post-claim and Run-created changes, read-only continuation, and prior pure-patch chains.

Targeted strict TypeScript checking passed for the new tests/fixture and their reachable source graph. Contracts and Runtime were emitted in isolation with `--noCheck`; that emission is reported separately from strict checking. All **5,751 frozen source/configuration/evidence file hashes and 4,370 emitted hashes** stayed unchanged through final verification and preserved process capture. The fifteen owned files also matched the shared workspace. No shared build output, public export list, architecture budget or compatibility digest was edited.

Architecture findings exactly match the seven-finding base. Four existing public-API findings remain: root exports 1897/1896, internal exports 18/16, and both reviewed semantic digest mismatches. These checks are not reported as passing.

The archive preserves all development failures. They include missing event-literal type narrowing; an assessment-time mismatch in a newly added recheck; error-message compatibility; a fixture path alias and incorrect tamper target; settled-patch inode binding; legacy fallback after a damaged receipt; verified-patch self-locking and existing patch-chain compatibility; changed live-lock behavior; and a multi-process test that read modules while they were being edited. The final suites ran against frozen files. The earlier isolated 130-test pass is retained but is not added to the final 133-test total.

## Supplemental independent review and integration

Independent review found no new blocker and passed **four grouped probes** against an actual native settled patch followed by a move that exited with code 73 after its effect. The probes check complete participant validity in deferred hints, transaction scoping including a foreign-thread sequence collision, the retained union lease and external drift recheck, and release of every acquired path when a later participant fails. All fifteen source hashes remained exact; no source was edited. These grouped probes are separate from the original 133-case suite and do not represent a wholesale independent rerun. The full raw review directory includes two earlier harness failures: selecting an onboarding Run and using `/tmp` instead of the canonical `/private/tmp` lock path.

Root subsequently integrated the unchanged G04 files with G01 and G03 at tree **`338ce236b3f90c7df8106c63b0cf95f7edba4f94`**, on integration base `c3734a07f1abc93357f2becf8e255c35d60dbce3`. The recorded full strict Contracts/Runtime/CLI/Server compilation and Web typecheck passed. **75 focused integration cases passed**: 39 G03/projection cases in five files and 36 repeated G04 batch/deferred cases in two files. All 3,633 captured source hashes and 5,121 emitted hashes remained stable. The same seven architecture and four API findings remained failing.

These 75 focused cases are supplemental integration evidence and are **not added to the original 133**. The root compile also remains distinct from the earlier isolated `--noCheck` emission and targeted strict check. The archive preserves the root setup, verification and source-commit scripts, original logs/reports/manifests, and a Git commit/tree proof binding the fifteen frozen source bodies to `bf6a34cd`. It does not claim acceptance of later unrelated workspace changes.

## Portable evidence

The [archive](artifacts/workspace-operation-batch-recovery-2026-10-30.tar.gz), [member/hash index](artifacts/workspace-operation-batch-recovery-evidence-index-2026-10-30.json), [regression receipt](artifacts/workspace-operation-batch-recovery-regression-2026-10-30.json), and [portable reconciler](artifacts/workspace-operation-batch-recovery-reconcile-2026-10-30.py) preserve the exact frozen owned sources, BEFORE/AFTER journals and private fixture evidence, six process cases, independent review, root integration, scripts, source/emitted manifests, final test reports, and every retained development log. Historical absolute fixture paths remain unchanged inside raw evidence.

From any working directory, with this repository at `REPO`:

```sh
python3 REPO/docs/artifacts/workspace-operation-batch-recovery-reconcile-2026-10-30.py
python3 REPO/docs/artifacts/workspace-operation-batch-recovery-reconcile-2026-10-30.py --workspace REPO
```

The verifier reads regular archive members without extraction or execution. It validates every member and companion digest, native BEFORE/AFTER results, the six process dispositions, absence of fabricated terminals, 133 actual unique passed assertions, four independent grouped probes, the separate 75-case integration reports, source commit proof, unchanged gate findings and source/emitted reconciliation. It confirms the 36 integration G04 cases repeat original cases. `--workspace` checks the fifteen owned implementation/test files. `--snapshot PATH` additionally verifies the complete original preserved source/emitted manifests against an available frozen checkout. It does not rerun the tests or recover expired fixture leases.
