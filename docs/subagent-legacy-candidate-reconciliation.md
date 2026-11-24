# Native legacy candidate reconciliation

The durable completion extension requires a completion binding before applying
a candidate. Older native v1 candidates predate that binding. This follow-up
reconciles a bounded class of those retained local results without manufacturing
a historical completion receipt or rewriting the candidate.

## Eligible proof

Reconciliation requires the original native completed coder Task and child Run,
the original child terminal event, accepted-result event and later completed
publication, plus one matching retained private v1 capsule in the same real
workspace and data root. Outcome results and typed output use separate bindings;
typed output revalidates its original schema and output hash.

The original write scope, outcome/output digest, changed-file set and published
verification/command summaries must agree. Ambiguous candidate inventories,
missing/corrupt data, uncompleted or unknown results, revoked/applying states and
foreign capsules cannot acquire authority. A Task status alone is insufficient.
Records imported from a replay cannot acquire local authority. A new native Task
created after an import's recorded cutoff can qualify through its own original
local events and capsule.

The source path and inventory are held under the existing candidate/storage
locks while a short-lived opaque proof is submitted to the serialized Store
transaction. A distinct `subagent.candidate.legacy_migrated` event records the
reconciliation. Repeated reconciliation returns the same identity; competing
processes cannot publish two receipts. The Task, Run, old events, capsule bytes,
candidate ID, expiry and merge state remain unchanged by reconciliation.

## Historical evidence limit and source constraint

The old completed event did not record the exact capsule ID or its read-dependency
set. A capsule's self-hash cannot supply that missing historical anchor. The new
receipt explicitly identifies the selected object as `current_private_capsule`;
it does not claim that its exact ID was logged during original completion.
Retained protected local storage remains a trust assumption.

The original event does bind the complete source snapshot and changed-file set.
Migration therefore checks the full current source against that original snapshot
before granting permission for a first application or a verified rollback retry.
The normal apply path carries an additional host constraint and repeats the full
snapshot check at merge preflight, including after diagnostics. Removing or
altering an unanchored read set cannot permit a merge after source drift.

This conservative historical check means even an unrelated source change can make
a legacy candidate unavailable for automatic application. Modern completion-bound
candidates retain their existing dependency and three-way merge behavior. Older
records without the required native child terminal/publication proof remain
inspection-only; reconciliation does not invent missing history.

## Expiry, replay and repeat application

First application and rollback retries retain the original expiry. An already
settled, durably verified applied result can be returned after expiry as a read-only
receipt reuse, with no new write and no new migration authorization. Applying or
indeterminate state continues to require separate reconciliation.

Export retains native audit evidence. Replay import strips the local migration
authorization event, so an imported copy cannot carry a live local preview handle
or inherit write authority. Normal candidate apply still performs its existing
scope, diagnostics, state and merge checks.

## Verification boundaries

The final combined checkout passed 594 tests across 81 files, required compilation
and strict test type checks. Its 4,179 source/configuration hashes, 22 changed
emitted modules and all 28 preserved user files remained unchanged. The regression
receipt is [subagent-legacy-candidate-regression-2026-10-30.json](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/subagent-legacy-candidate-regression-2026-10-30.json).
The [evidence index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/subagent-legacy-candidate-evidence-index-2026-10-30.json)
also retains the owner's 116-test slice, independent six-case boundary audit,
two original-producer application cases and original child-terminal preservation
checks. These overlapping test sets must not be summed as independent coverage.

Fixtures execute the original `8f2a26c` completion code from an isolated checkout,
with its own compiled Contracts. They create real SQLite Tasks/Runs/events and
private v1 candidates, then exercise the current reconciliation path at the same
native paths. Both outcome and typed results are covered. The model-call count
is zero; valid final values are supplied directly to the original settlement
pipeline. File-hash diagnostics fixtures do not constitute a real language-server
or model-quality evaluation.

The matrix includes native work created after import, imported/foreign copies,
ambiguous candidates, invalid schemas/proofs, expiry, revoked/applying/unknown
states, SIGKILL before and after the reconciliation commit, concurrent processes,
and source drift before migration, before application and during diagnostics.
Independent tests retain the demonstrated rehashed-capsule limitation and verify
the full-source constraint at actual application. Real old-producer acceptance
also checks unchanged historical records/capsule/expiry, successful file writes,
reopen, and unchanged file inode/mtime/ctime on receipt reuse.

The first root acceptance attempt used the wrong expected discriminator (`typed`
instead of `typed_output`) after committing a valid typed migration. That failed
attempt remains archived; the final two-case acceptance used fresh original
fixtures. The observed rehashed-capsule limitation remains in the audit record.
Eight existing architecture failures, two public API failures and the historical
release manifest mismatch remain unresolved; no budget or old receipt was changed.

These are local Darwin filesystem/SQLite and controlled-process results. They do
not establish power-loss durability, arbitrary hostile data-root integrity, or
safe application for every historical candidate format. G03 and the overall
G01–G07 roadmap remain active.
