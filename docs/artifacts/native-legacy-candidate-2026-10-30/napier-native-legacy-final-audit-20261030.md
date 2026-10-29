# Native legacy final independent re-audit — 2026-10-30

Result: PASS, 6/6 deterministic checks against current production source. The complete historical source snapshot is enforced at migration and every strict merge preflight. Rehashed read-set replacement cannot authorize candidate writes after unrelated source drift.

- Replaced read set plus inflated source file count and byte count rejects migration, creates no receipt, and leaves the candidate unapplied.
- A rehashed capsule with only its original read set removed can migrate while the complete historical baseline remains intact. Its receipt explicitly reports `candidateIdentityEvidence=current_private_capsule` and `sourceConstraint.kind=original_full_source_snapshot`. Changing `dependency.ts` afterward rejects strict apply with no candidate state or file write.
- Adding an unrelated file before migration rejects strict apply and creates no receipt.
- Adding an unrelated file during `observeBefore` diagnostics rejects the final merge preflight: one before-diagnostics call, zero after-diagnostics calls, zero commit calls, and no candidate state.
- After an induced, verified durable rollback, source drift rejects retry and preserves the rollback state bytes exactly.
- An intact-baseline control applies the original diff. After expiry and subsequent source drift, repeated apply reuses the stored settled receipt read-only, with zero commit calls and unchanged state bytes.

The negative apply checks preserve the replacement capsule, historical Task, nonmigration event history, and original `a.ts` bytes. Intentional fixture drift is limited to the independently owned fixtures under `/tmp/napier-native-final-0et7dS`.

Evidence boundary: the old events did not log the original exact capsule ID/bytes or read set. A current protected capsule that retains historically anchored semantics and an intact full baseline can still migrate. This is explicitly a retained-private-storage trust assumption; a self-hash is not historical identity authentication. The new enforcement constrains subsequent writes using the independently published full source baseline.

Repro: `/tmp/napier-native-legacy-final-reaudit-20261030.mts` (SHA256 `846ca3d38204eadc2c47b383ad079b4c3a6cd2819bd9e037eba91e3039d5dba4`). Evidence: `/tmp/napier-native-legacy-final-reaudit-20261030.json` (SHA256 `5ab2b555e071219f4bc1a9c38fa0b6073861622ed2035c9082cd4f449ca754ab`). Historical producer used commit `8f2a26cbe074b8a543da825e6df96ab398656dc0`; three relevant historical runtime files were byte-compared with `git show` before use. The prior isolated checkout and its built contracts were copied into /tmp, so this audit ran no build.

Zero model calls, zero production edits, zero root-original fixture/storage access. Current audited source hashes were stable before/after:

- `packages/runtime/src/subagent-candidate-store.ts`: `8f6b3dca637f75cec1356460a239051bfadda694ab94e34c1c67228532631038`
- `packages/runtime/src/subagent-candidate-legacy-storage.ts`: `f62389ea61843d8aae054cb66487fc694bb704481faacb437b8140483a49fe89`
- `packages/runtime/src/subagent-candidate-legacy-validation.ts`: `9c0c51d76131806433c5cee2f2b128fc3641fe5b8b2683331d5abd0cd4915402`
- `packages/runtime/src/subagent-candidate-legacy-repository.ts`: `e7bc3ef064ab297b162e95f0ea8b0a23ce712884e88dbe751fc1f37e250cc413`
- `packages/runtime/src/subagent-candidate-legacy-capability.ts`: `fac7bb90ac791cd8aa705a165d7c7cc62516a01d0638df4993aaa5ac9b29ee49`
- `packages/runtime/src/subagent-legacy-source-snapshot.ts`: `8ab8dc900a71fcfff777bb89d4083d8727a202bb0e3b85f7b87114879d903347`
- `packages/runtime/src/subagent-worktree-merge.ts`: `e7256f329cd80f79d4e43729b34d041be0f6929253e04cdb4d089475b6eb9aaf`
- `packages/runtime/src/subagent-worktree-mutation.ts`: `b30c0689eef2529a2dac35ac9b801f1586f3c2775a760f3348c36de544936991`
