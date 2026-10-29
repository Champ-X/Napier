# Host accounting boundary: read-only design audit

Status: **proposal only; not implemented**. Audited current source in `/Users/champ/orca/Napier` on 2026-10-30. No production source, export barrel, package export, budget, baseline, frozen G03/G04 file, or historical receipt was changed. This document is a separate candidate engineering slice, not acceptance of the retained API gate debt.

## Decision

The five new internal exports have real production consumers. Removing their names without moving the associated ownership would only conceal the dependency. A coherent replacement can remove the low-level source/receipt operations from the Server boundary: one Runtime-owned `HostModelAccounting` object owns the durable source and its full lifecycle, while the Host supplies its capacity/budget policy and synchronous SQL updates against the **same** Host SQLite connection.

This is a genuine redesign only if Server can no longer construct/read/ack individual native deliveries, normalize final observations itself, or expose an arbitrary mutable `ModelUsageSource`. A wrapper that merely publishes the existing five functions as object properties is not this design.

The smallest honest named surface is one new class, replacing the five new internal symbols. Its instance/type and methods still constitute a real reviewed API. Expected internal count is **17, not 16**; exact count must be measured after implementation. The existing root 1897/1896 debt is independent. Baseline review remains an explicit compatibility decision after interface/consumer review and validation. Neither redesign nor functional tests justify claiming the gate passes.

## Current gate evidence

Ran `auditPublicApi()` from `scripts/check-public-api.mjs`, read-only against current source. Four failures remain:

- `runtimeRootSemanticExports 1897 exceeds 1896`.
- `runtimeInternalSemanticExports 21 exceeds 16`.
- Root compatibility digest mismatch.
- Internal reviewed-surface digest mismatch.

Observed root digest: `f35b9c539cf4deed01e8e34fa2a5ad09708ea9a478eebd9047b7df0fd462606b`.

Expected root digest: `8be2c3a9341c07a60b8fbb333dacef42f5008b41a2602745eea9f786e4ac6806`.

Observed internal digest: `2cca21edd37a13748769a5e2a70d7320741dc9c613c1db29b387b39b05ec082b`.

Expected internal digest: `5c079b4a87242bc3a9b2a639dc3b6069e9f79b924052ac44a8837d7ff6e8c1dc`.

The baseline is `docs/repository-hygiene-baseline.json:26-31`. `scripts/repository-hygiene.mjs:305-357` measures exported **names**, not class members or signature compatibility. A passing unchanged name digest would not establish that a changed constructor/member contract is compatible.

## Concrete dependency map

The five additions are `packages/runtime/src/internal.ts:23-27`. The preceding 16 exports predate physical accounting; none should be removed to make room.

| Export | Production external consumer | Actual responsibility |
| --- | --- | --- |
| `ModelUsageReceiptSpool` | `apps/server/src/workspace-model-admission.ts:38-41` | Attaches source tables and source identity to the existing Host admission DB; participates in reserve, physical settlement and ACK transactions. |
| `normalizeModelPhysicalObservation` | `workspace-model-admission.ts:173-190` | Reads provider usage once, caches the immutable final observation across retries, and supplies exactly that observation to Host charge calculation and durable source insertion. |
| `readVerifiedModelUsageDelivery` | `workspace-model-admission.ts:225-235` | Reads the opaque native delivery before ACK; only complete observations can reduce conservative Host charges. |
| Same reader | `apps/server/src/workspace-model-usage-source.ts:43-45` | Validates workspace/source scope before forwarding ACK. |
| Same reader | `apps/server/src/workspace-model-usage-recovery.ts:24-37` | Checks destination ledger identity, commits Store projection, then ACKs; preserves sibling attempts within a conflicted batch. |
| `ModelUsageSource` | admission and scoped-source modules | Exposes reserve/attribution/record/pending/acknowledge across the package boundary, including the distinct undispatched path. |
| `VerifiedModelUsageDelivery` | admission and scoped-source modules | Types the opaque delivery as it crosses Server callbacks. The TypeScript brand is not its runtime authority. |

`apps/server/test/workspace-model-usage.test.ts:7` also imports normalizer/reader; it is a test consumer, not a reason to retain production exports. Runtime's own uses import the source modules directly and need not become package exports.

Production path:

1. `workspace-runtime-host.ts:43` opens one Host admission service before individual workspace runtimes.
2. `workspace-model-admission.ts:80-98` creates a workspace admission plus a scoped source; `workspace-runtime-host.ts:75` passes it to runtime construction.
3. `local-agent-runtime.ts:117-123` configures native accounting before constructing `ModelRegistry`.
4. `model-accounting-runtime.ts` selects the Host source or opens the standalone source, configures `ModelAccountingRepository`, and performs pending projection.
5. `model-call-admission.ts:100-164` consumes private prepared-call scope, validates capture/source, calls Host admission, and independently waits for physical settlement plus Store projection/ACK.
6. `workspace-model-admission.ts:189-198` records the source observation and changes physical invocation state in one Host transaction; only then does it resolve the pending physical lease.
7. `model-usage-projection.ts:14-20` commits Store reconciliation before invoking source ACK.
8. `workspace-model-admission.ts:225-235` ACKs and optionally refunds in one Host transaction.
9. Host maintenance/eviction recovery (`workspace-runtime-host.ts:52-59,152-157`) runs `workspace-model-usage-recovery.ts`, opening only `LocalStore.initializeAccounting()`. It does not construct a model registry or execute a Run.

## Boundaries that must survive

### Native authority

- Preparation owner, prepared/entered call, raw-entry status, and undispatched driver proof stay in `model-call-attribution.ts` process-local capabilities. No new public issuer or JSON authority is introduced.
- `model-usage-delivery.ts:16-57` verifies a delivery through a private WeakMap and rereads the durable source. An exported DTO or a copied/branded object is not a delivery.
- `ModelUsageReceiptSpool.record()` validates the original undispatched observation's private authority before its first durable insertion (`model-usage-source.ts:155-184`). The new owner must pass that original object to the private spool. Cloning it before this check would erase authority; treating the clone as valid would bypass authority.
- `ModelAccountingRepository.reconcile()` retains native workspace/source/root/attribution validation and an exact immutable claim (`model-accounting-repository.ts:175-199,233-238`). Source persistence alone is not a Store claim.
- `model-call-recovery.ts:29-36,65-74` continues to observe the existing complete physical-accounting promise. Neither a Host-source commit nor a receipt read may substitute for completion after Store projection and source ACK.

### Transaction and release order

Physical terminal:

`normalize once -> BEGIN Host DB -> source.record(exact observation) + Host charge/state update -> COMMIT -> physical capacity/pending release -> Store claim/projection -> BEGIN Host DB -> source ACK + permitted refund -> COMMIT`.

Host source and Host charges must stay on the same DB connection. Splitting the source into a convenient standalone DB makes the middle commit non-atomic and is not an acceptable simplification.

Known positive overruns become Host debt during physical settlement. Unknown/partial final observations retain conservative reservations and cannot later be replaced with a more favorable observation. Refund requires complete observation plus successful Store projection and ACK. Source/Store/ACK failures remain retryable with the original immutable observation; they do not authorize redispatch.

Undispatched closure remains a distinct, privately authorized path. Admission rejection may occur before a Host invocation row exists; that case still needs its exact zero observation, Store claim and ACK without inventing a physical invocation or capacity release. If a Host row exists, its update and source insertion must remain atomic.

### Independent lifetime

The Host object must outlive a workspace registry and work without one. Accounting-only recovery is needed after workspace eviction/restart. Moving source ownership onto an individual `ModelRegistry`, `AgentRuntime`, or workspace `LocalStore` would create the wrong lifetime and require executing unrelated services merely to settle usage.

## Proposed interface and ownership

Illustrative API, not source-ready code or approved names:

```ts
// One new named internal class. Its complete members/hook contract need review.
export class HostModelAccounting {
  static attach(input: {
    database: DatabaseSync;             // caller-owned existing Host DB
    policy: HostAccountingPolicy;       // synchronous trusted Host policy adapter
  }): HostModelAccounting;

  forWorkspace(workspaceId: string): ModelCallAdmission;
  hasPendingUsage(workspaceId: string): boolean;
  hasPendingPhysical(workspaceId: string): boolean;
  drainWorkspace(workspaceId: string): Promise<void>;

  // Caller already verified the Host catalog's workspace identity.
  // Uses the concrete native Store repository, not a caller-supplied reconcile callback.
  reconcileWorkspace(input: {
    workspaceId: string;
    store: LocalStore;                  // initialized with initializeAccounting()
    maxBatches?: number;                // bounded; retain current 10 x 128 defaults
    batchSize?: number;
  }): Promise<void>;

  // Refuses unresolved physical operations/failures; invalidates attached owner.
  // Does not close the caller-owned DatabaseSync.
  close(): void;
}
```

`HostAccountingPolicy` above denotes a declared method-signature contract, not five helpers repackaged under a namespace. Its essential hooks are:

- Validate lifecycle/open state and zero-cost declarations.
- Check capacity/budget and insert a Host reservation row synchronously; return the Host's immutable per-lease allowance/context.
- Given a detached validated normal observation and that frozen allowance, update the Host row's physical state, observed amount and conservative debit synchronously.
- Given a privately validated undispatched observation, update an existing reservation if present; reject conflicting owner/state transitions.
- After successful Store claim, apply any permitted known refund using the exact attribution/receipt identity. This hook never receives a native delivery or a function that can ACK arbitrary deliveries.

The class owns `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` around the hooks and its private spool mutations; hooks execute **inside** that transaction, contain no `await`, and do not open/commit another transaction. Throwing any hook rolls back both sides. Service-owned post-commit code resolves pending physical calls. Host retains policy epochs, capacities, limits, allowance calculation, amount calculation, owner reconciliation, and Host snapshot SQL. Legacy unattributed calls retain their current accounting path; they do not gain native proof through this interface.

There are two reasonable engineering scopes:

1. **Minimal adapter extraction:** keep Host policy/table SQL in Server, move source/normalization/delivery/replay/physical-pending lifecycle into Runtime with the synchronous policy hooks above. This changes both the owner and package boundary without relocating budget policy. Recommended first slice.
2. **Larger domain extraction:** move the complete `WorkspaceModelAdmission` state machine and budget calculations into Runtime and expose one fully owned service. This further reduces transactional hooks but is broader than required to settle the present API debt. It needs separate policy-ownership review.

### Admission binding must become opaque

The existing `ModelCallAdmission.usageSource` leaks the low-level source even if its type name disappears from `internal.ts`. The minimal redesign must replace the Host-native path with a Runtime-issued accounting binding whose source can only be resolved by private Runtime code. `forWorkspace()` returns an ordinary supported admission object plus that opaque binding; `initializeModelAccountingRuntime()` and the admitted wrapper resolve it privately.

Standalone Runtime creates the same private binding around its owned SQLite source. Capacity-only legacy admissions remain supported through their existing path. JSON/copied admission fields cannot create a binding, select another source, record a zero observation, or close a receipt.

This is not a request to export the new private binding/type or to add a public binding issuer. It is also not permission to route all former raw source operations through a differently named public port. The new Host boundary must not expose `reserveAttribution`, `recordObservation`, `pendingDeliveries`, `readDelivery`, or `acknowledgeDelivery`.

## Consumer migration

| Current consumer | Proposed final responsibility |
| --- | --- |
| `workspace-model-admission.ts` | Own/open Host DB and budget policy; attach `HostModelAccounting`; provide synchronous policy SQL hooks; delegate workspace admission, physical drain and pending checks. Remove spool, normalizer, delivery reader and raw source/opaque-delivery imports. Preserve Host row schema/IDs/epochs. |
| `workspace-model-usage-source.ts` | Its workspace/source guard and undispatched/ACK forwarding move inside the owner. Delete this Server adapter only after all production callers are migrated; no replacement source DTO adapter. |
| `workspace-model-usage-recovery.ts` | Keep `verifyWorkspaceRuntimeIdentity`, opening/closing `LocalStore.initializeAccounting()`, and call `accounting.reconcileWorkspace()`. Remove delivery inspection, pending iteration, direct `configureSource`, and direct ACK from Server. Preserve batch limits, entire-target identity preflight, sibling attempts and aggregated failures. |
| `workspace-runtime-host.ts` | Keep catalog, lifetime, eviction/maintenance scheduling and public Host status. Its usage/pending/drain calls delegate through the Host admission owner; no model registry is created for accounting replay. |
| `model-accounting-runtime.ts` | Resolve only the private native binding, configure repository, retain standalone-owned source lifecycle, and project existing receipts. |
| `model-call-admission.ts` | Keep capture/owner checks and independent physical result observation. Resolve private source/binding internally. Its completion promise still includes Store projection and source ACK. |
| `model-accounting-repository.ts` | Keep private authority and exact native persistence semantics. No exported low-level replacement and no new generic "accept receipt DTO" path. |
| Server usage tests | Exercise the new composition and real source/Store/ACK fault windows; stop importing low-level production helper exports. Runtime source-specific tests can continue direct relative imports. |

## Minimal viable implementation sequence

1. Freeze the five-symbol production consumer map and current failed gate report. Keep source/DB formats unchanged.
2. Introduce the cohesive owner in a Runtime module with direct relative imports; initially do not alter the barrel or remove the old path. Preserve observation caching and exact transaction ordering through integration tests.
3. Move scoped-source, undispatched handling, opaque-delivery replay and ACK/refund orchestration into that owner. Migrate all three Server consumers together, with the opaque admission binding as part of the same coherent slice.
4. Verify standalone, Host live calls, and accounting-only recovery all use the intended owner and retain their lifetimes. Remove the five obsolete internal exports only when their external low-level capabilities are no longer needed. Export the one reviewed class through `internal.ts`; do not add package subpaths or root/facade exports incidentally.
5. Measure API and architecture gates without changing budgets. Report remaining root debt and expected new internal surface/digest mismatch honestly. Review the exact class and transitive signature contract before any later explicit baseline decision.

No unrelated alias deletion, `export * as` bag, declaration erasure, or `ReturnType`/`ConstructorParameters` trick counts as reducing these capabilities. Type inference may be convenient for consumers, but it does not remove an actual public contract.

## Invariant test plan

Use existing physical-accounting fixtures and real SQLite with fault injection; zero paid model calls. Avoid tests that only compare the wrapper's implementation details.

| Boundary | Required evidence |
| --- | --- |
| Reserve | Capacity/budget rejection prevents raw dispatch; attributed reservation source and Host row bind exact workspace/source/physical ID. No proof is minted for an arbitrary copied attribution. |
| Physical settlement atomicity | Force source insert failure and Host row update failure independently. Neither commits the other half or releases the physical pending lease. Retry uses the exact cached observation even if provider-owned fields change. |
| Store/ACK order | Fail Store claim: source remains pending, Host conservative reserve retained, no ACK/refund. Fail ACK or refund SQL: Host transaction rolls back both; replay sees exact duplicate Store claim and completes once. |
| Host positive debt | Overrun is visible before projection/ACK; partial/unknown preserves conservative reserve plus higher observed amount. A later favorable observation cannot replace an immutable final receipt. |
| Undispatched | Private pre-entry proof closes exactly zero; copied DTO/serialized marker/fake binding cannot. Exercise both no-Host-row and existing-active-row paths, including rollback and duplicate retry. |
| Native delivery | Forged/copy/closed-source/stale-reread/source-ID-swapped deliveries remain rejected through Runtime internals. New Server-facing methods cannot ACK a supplied receipt DTO. |
| Workspace/ledger identity | Wrong workspace, recreated ledger, changed source and changed root binding block the destination before any refund. An identity-valid batch still tries valid siblings when another receipt conflicts with sealed execution evidence. |
| Host lifetime/restart | Live provider ignoring cancellation retains capacity until physical terminal source commit. Eviction waits for physical work; recovery after process death/reopen uses initializeAccounting only and performs zero model calls or execution recovery. |
| Concurrent replay | Two real replayers/Store instances converge on one immutable Store claim; ACK/refund is idempotent and never releases another workspace's debt. Retain source->Store->ACK kill windows. |
| G03 recovery | Native main/child THINKING retry readiness waits for both physical receipt and Store projection/ACK through the existing private completion handle. Source-only success, unknown/partial, failed ACK, expired owner/deadline and copied receipts never authorize a retry. |
| Execution immutability | Late accounting changes only usage/accounting revisions. Task/execution revisions, status, terminal/output/checkpoint/candidate proofs remain unchanged; no late text/tool execution. |
| Compatibility | Standalone source ownership, capacity-only legacy admission, evaluation operation attribution, child compactor and normal main/child paths retain behavior. No new root/facade/package export leaks; all old five external production imports are gone for ownership reasons. |

Run the focused changed suites first, then the existing physical-accounting and native-thinking packs once the source is stable, followed by Runtime/Server strict type checks and read-only architecture/API checks. Preserve failed attempts and retained gates; do not reissue historical release manifests or budget receipts to make the change appear accepted.

## Conclusion and limits

There is a legitimate 5-to-1 ownership improvement available. It requires moving behavior, transactions and authority boundaries, not changing export syntax. It is optional follow-on engineering, not a prerequisite to honestly documenting the current 21/16 failure. If the present five-symbol integration is intentionally retained instead, accepting it requires its own explicit reviewed-surface/baseline decision with the same invariants; it cannot be declared acceptable merely because all five are used.

No implementation, migration, runtime fault-window test or compatibility approval was performed in this design audit. The only executed check was the current read-only API audit above. G03 functional acceptance and its retained API/release limitations remain as previously recorded.
