# Native legacy candidate migration audit

Read-only audit, 2026-10-30 Asia/Shanghai. Reviewed current `subagent-candidate-legacy-{capability,validation,repository,storage}.ts`, candidate-store integration, delivery/apply/merge, import cutoff validation, typed-result path, lock composition and native tests. No production source edits or external model calls. Root's `/tmp/napier-native-legacy-fixture-20261030.json` and typed counterpart were not modified; their capsule/state files were not opened for writes.

## Confirmed evidence boundary

The historical `subagent.completed` payload binds outcome, changed-file set, source snapshot, verification/command summaries and counts, but lacks the candidate ID, full preview digest, readDependencies, sourceFileCount/sourceBytes, and candidate creation/expiry. Migration validates these additional fields by the retained capsule's own content address, consistency rules, publication interval and unique current inventory.

This means the original retained private capsule is a trusted local evidence source. The migration cannot prove its exact bytes or original identity from historical ledger events alone.

Own-fixture reproduction:

- `/tmp/napier-native-legacy-audit-20261030.mts`
- `/tmp/napier-native-legacy-audit-20261030.json`
- Historical source producer commit `8f2a26cbe074b8a543da825e6df96ab398656dc0`, isolated archive/dependencies, zero model calls.
- Fixture root `/var/folders/8m/cpn6ln_s0s7_ng882hksjphm0000gn/T/napier-native-legacy-test-kufahJ`.
- Original capsule moved outside candidate inventory into that own fixture root; original Task, accepted/completed/terminal events and diff remained unchanged.
- Replacement capsule changed sourceFileCount/sourceBytes and readDependencies, recomputed preview/capsule digests, and received a new candidate ID.
- `reconcileLegacySubagentCandidate` accepted the replacement and appended a migration receipt.

This is **not** a demonstrated provider-output, imported-thread, or normal tool-input authority bypass. It requires replacing files inside the trusted local private data root. Since historical evidence lacks a full capsule anchor, a claim that migration cryptographically authenticates every original capsule field would be too strong. If defending against rewritten local capsules is required, an independently retained original candidate hash/manifest is needed; self-hashes and sole inventory cannot supply it retroactively. Otherwise document the trusted retained-local-storage assumption.

Removing/replacing readDependencies can affect later merge drift checks, whereas source counts mainly affect receipt accuracy. The reproduction changed dependency metadata but did not invoke workspace apply; no claim of successful unsafe file write was tested.

## Boundaries that look correctly enforced

- Proofs are process-local WeakMap capabilities, expire after the scoped authority callback, and are not minted from serialized receipt/provider fields through the Store API. Internal proof helpers assume trusted runtime callers; they do not independently verify locks.
- Production migration enters through selected candidate lock, then inventory storage lock, then Store state queue. Completion also takes its candidate lock before the queue. No reverse ordering/deadlock was identified in these paths.
- Store state queue refreshes ledger state before execution and retries conflicts; proof lifetime covers that awaited operation.
- Migration rechecks original Task/result, matching completed child Run, complete and equal usage, unique child terminal, accepted and completed event bindings, publication order and expiry.
- The updated imported-thread rule permits native executions after the imported sequence boundary while rejecting the imported historical interval; it does not treat an imported migration event as sufficient authority.
- Typed output is revalidated against its schema and hash, with a separate accepted output digest; outcome and typed-output evidence cannot be interchanged.
- Revoked/applying/unknown settled candidates fail closed. Expired already-applied settlement reuse returns stored evidence without granting new migration authority or redoing writes; its summary states no workspace reverification.
- Existing migration receipts must match the complete newly rederived base and remain unique; no current completion receipt is manufactured or rehashed.
- Inventory ambiguity is rejected, and capsule/state/Task/terminal records are retained rather than reset.

## Remaining limits of this audit

This was a targeted source and isolated-reproduction review, not a repeat of the owner's entire native/SIGKILL suite. No additional externally reachable authority bypass was confirmed beyond the trusted-storage limitation above. Current owner tests cover native old-source positive paths, typed invalid rejection, imported boundaries, crash/reopen and interprocess uniqueness; their results should remain separately reported from this audit.
