# Pi Durable Alignment for Napier

Reviewed against Napier Runtime evidence-ledger architecture and Earendil Pi
Durable (`@earendil-works/pi-durable`, experimental). This document owns the
upgrade boundary: **borrow orchestration primitives; do not replace the Napier
ledger or adopt the experimental Durable package as Runtime.**

## Product boundary

| Keep in Napier | Borrow from Pi Durable | Do not adopt |
| --- | --- | --- |
| SQLite evidence ledger, `synchronous=FULL` | Total-state program counter (`op.state`) | `@earendil-works/pi-durable` dependency |
| Chat as projection of the ledger | Intent → effect → settlement around side effects | Weaker crash durability as the default |
| Effect uncertainty (`effect_indeterminate`) | Explicit tool replay class | Blind `replay: "safe"` for writes |
| Thread process lock, private capsules | Submission / steer / follow-up / cancel-as-control | Single-writer storage as the only concurrency model |
| Workflow, budgets, glass-box UI | Task ownership tree for child work | Replacing Conversation/Task/Trajectory projections |

Napier already states persist-before-present and unknown-effects-remain-unknown.
The gap is fragmented recovery: patch, move, workflow approval, control messages,
and child checkpoints each invent part of the Durable story. Alignment unifies
them behind one readable orchestration register.

## Terminology map

| Pi Durable | Napier |
| --- | --- |
| Harness + Storage | Local Runtime + `LocalStore` / SQLite ledger |
| Conversation | Thread (execution identity); conversation UI is a projection |
| Entry | Immutable `RunEvent` / message evidence |
| Document | Domain snapshots (Run, Plan, decision, agent revision) |
| Commit | SQLite transaction that publishes events + domain changes together |
| Task checkpoint / `op.state` | `RunOrchestrationStateV1` (Phase 1+) |
| Submission `requestId` | Control `clientMessageId`; prompt admission IDs (Phase 3) |
| `replay: safe \| unsafe` | `ToolReplayClassV1` over existing `idempotency.resultReplay` |
| ExecutionEnv | Workspace sandbox / process / remote worker adapters (Phase 5) |
| Fork / lane | Branch-at-seq and subagent child Runs with ownership (Phase 4) |

## Truth sources (invariant)

1. **Events and settled receipts** are evidence. They never disappear when
   orchestration ends.
2. **`RunOrchestrationStateV1`** is the program counter for an open Run. Recovery
   reads this total state; it does not infer phase by folding an ambiguous event
   prefix in multiple places.
3. **Domain snapshots** hold business state (plans, decisions, artifacts).
4. When a Run reaches a terminal fence, orchestration state is archived or
   cleared; the ledger and usage remain.

Phase 1 may *project* the register from existing events. Later phases may
*persist* it as a domain register overwritten on each durable fence. Projection
and persistence must agree on the same schema.

## Tool replay classification

Existing wire policy stays compatible:

```ts
idempotency.resultReplay: "never" | "exact_result_only"
```

Alignment adds a recovery-facing class (see
`packages/contracts/src/tool-replay-class.ts`):

| `ToolReplayClassV1` | Meaning | Typical Napier tools |
| --- | --- | --- |
| `never` | Do not auto-replay; interrupt or stop | bash, browser, deploy-like, most writes without adapter |
| `exact_result` | Reuse a settled exact result capsule; do not re-execute | Stateless reads with `exact_result_only` |
| `reconcile` | Intent/settlement + postcondition adapter; may continue after check | `apply_patch`, native file move (G04 adapters) |
| `safe_rerun` | Entire execute is repeatable or externally idempotent | Rare; only when declared and proven |

Mapping from today's definition (no silent upgrade of writes to `safe_rerun`):

| `sideEffect` / evidence | `resultReplay` | Class |
| --- | --- | --- |
| read / none | `exact_result_only` | `exact_result` |
| read / none | `never` | `never` (treat as non-replayable read) |
| write with reconciliation adapter | any | `reconcile` |
| write / unknown without adapter | any | `never` |
| explicit host declaration only | — | `safe_rerun` |

Automatic recovery eligibility still fail-closes on unresolved or unknown
effects. Replay class does not authorize re-running an indeterminate write.

## Intent → effect → settlement

Every side-effecting tool operation should cross three durable fences:

```text
intent commit     → reserved ids + effect_pending / proposed|admitted
effect            → external I/O (filesystem, network, process)
settlement commit → result capsule + settled events + next orchestration state
```

The only uncertain window is intent durable and settlement absent. Policies for
that window are stored on the operation (not reconstructed):

| Observation | Policy |
| --- | --- |
| Effect boundary not crossed | Confirm not executed, then continue when allowed |
| Effect crossed, settlement missing | Reconcile or mark `effect_indeterminate`; never invent success |
| Settled, client response lost | Reuse exact result; do not re-execute |
| Environment drifted after checkpoint | Re-verify or stop with an explicit reason |

This matches existing patch/move recovery evidence and generalizes it.

## Admission, steer, abort (Phase 3)

| Durable concept | Napier target |
| --- | --- |
| Submission with stable `requestId` | Prompt and control admissions share durable client identity |
| Busy inbox: follow-up / steer / reject | Existing control modes; document and enforce inbox placement rules |
| Abort as control | Persist `cancel_requested` before signalling AbortSignal |

Cancelling a waiter must not silently cancel durable work; abort APIs must.

## Subagent ownership (Phase 4)

A delegating tool owns its child Run/conversation. On recovery of a
`safe_rerun`/`reconcile` delegate:

1. Look up an existing child by owner task/call identity.
2. Reuse the stable child `requestId`.
3. Wait; do not create a second child for the same call.

Napier keeps private capsules, mailbox fences, and budget isolation that Durable
does not provide.

## Explicit non-goals

- Replacing Runtime with Pi Durable or Chord Documents.
- Claiming exactly-once external side effects.
- Auto-replaying unsettled writes without an adapter.
- Weakening local SQLite durability to Durable's default `NORMAL` backend notes.
- Treating UI streaming chunks as durable evidence before commit.

## Implementation phases

| Phase | Deliverable | Status |
| --- | --- | --- |
| 0 | This alignment + replay class map | Done — `tool-replay-class.ts` |
| 1 | `RunOrchestrationStateV1` + recovery read path | Done — projected register; checkpoint adapts from it |
| 2 | Promote write tools onto intent/settlement + eligibility table | Done for projection — `tool-operation-recovery-eligibility` reads `tool.operation.*` fences into the orchestration register; `assessAutomaticRecovery` still observation-based (fail-closed preserved) |
| 3 | Admission / steer / abort control alignment | Done — Composer/HTTP `requestId`, Runtime exactly-once admission by `run.started.requestId`, `run.cancel.requested` before abort |
| 4 | Child ownership + stable requestId resume | Done for delegate intent lookup — `findOwnedSubagentByDelegationIntent` owns reuse before create; broader child resume matrix remains G03 |
| UI | Recovery operations panel reads orchestration register | Done — phase + replay class in `RecoveryOperations` |

## Sources

- Napier: [architecture.md](architecture.md), [operation-recovery.md](operation-recovery.md),
  [manual-run-recovery.ts](../packages/contracts/src/manual-run-recovery.ts)
- Pi Durable: Earendil announcement (2026-10-01), `packages/durable/README.md`,
  AgentHarness three-store / `op.state` design notes
