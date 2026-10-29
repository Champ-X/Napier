# Main and child execution boundaries

This G03 design follows the current production paths. The tool boundaries and a
shared model invocation mechanism, durable child Runs, private working sets and
shared compaction are implemented. Safe restart continuation remains unfinished.
Ownership/accounting are described in [subagent-child-runs.md](subagent-child-runs.md),
and checkpoint/compaction boundaries in [subagent-working-set.md](subagent-working-set.md). External
model requests are excluded from the local regression work.

## Capabilities already shared

`ModelRegistry` constructs the admitted model adapters at the provider boundary.
Both main and child model calls use that registry. A second admission wrapper
would double-reserve capacity; cancellation must continue retaining the original
lease until the physical provider operation settles.

Child tools already use `executeAdmittedToolCall`, durable execution authority
and the shared concurrency gate. Child usage is persisted in `SubagentTask` and
rolled into the parent budget. Supervisor owns roles, dependencies, write scope,
typed outcomes, review, revival and result acceptance. Candidate workspaces own
their read/write dependencies, diagnostics and merge checks. Those are existing
responsibilities to preserve, not functionality a new engine needs to replace.

## Current differences and migration dependencies

| Capability | Current boundary | Required change |
| --- | --- | --- |
| Model lifecycle | Main turns, child turns, repairs and child compaction use `ModelSession.open`; child response and usage commit atomically under its lease. Main retains overflow/thinking-loop policy. | Complete child context-compiler parity and safe continuation; a captured request alone is not restartable execution. |
| Context and compaction | Child keeps an append-only private source and projects provider requests through the shared RunContextCompactor using its selected route candidate. Role prompt remains unchanged. | Revalidate private source, tool schema and workspace before restart; passing the parent Run unchanged would import the wrong history and scope. |
| Usage | Child canonical responses settle its Run and Task subtotal once. `aggregateRunUsage` combines only parent-scoped responses and Task roll-up. Benchmark totals exclude child Runs. | Reconcile late physical usage and shared concurrent parent budget reservations. Incomplete usage cannot establish a known zero cost. |
| Controls | Acceptance is atomic; delivery remains enqueue evidence. A sparse consumed-ID set and contiguous accepted cursor commit with the exact private transcript. | Replay only unconsumed messages after validated recovery admission. Consumption does not mean the provider has already received the request. |
| Run lineage | An opaque internal grant creates and leases a child Run after the queue slot is acquired. Task.runId remains the parent; Task.childRunId names execution. Private checkpoint identity and counters are fenced together. | Establish safe recovered-parent authority; child Runs never own Thread controls or generic recovery. |
| Recovery | Lost child execution is explicitly interrupted with continuation unavailable; unresolved effects retain blocked_safety and durable fencing. Private checkpoint CAS and consumption exist, but revival remains a new task. | Reconcile post-checkpoint invocation/review/delivery tails and restore authority before claiming continuation from previous progress. |
| Resources | Inherited factories, journal records, candidate debugger and cleanup now use the child Run. Explicit bounded network-source copies retain read continuity without borrowing live parent resources. | A terminal task/result is not proof that all OS descendants or unknown provider resources were reclaimed. |

Relevant production entry points are `agent-model-stream-lifecycle.ts`,
`agent-invocation-context.ts`, `run-context-compaction.ts`,
`subagent-model-stream.ts`, `subagent-typed-output-runtime.ts`,
`subagent-execution-control.ts`, `run-replay.ts`,
`run-interruption-recovery.ts` and `store.ts` under `packages/runtime/src`.

## First bounded changes (historical stage before child Runs)

The child's tool surface must remain within the effective parent profile and
its role. Recreating baseline read tools cannot restore a parent-disabled tool;
an inherited callback cannot bypass the same filter. Candidate tools retain
their isolated implementation and write-path checks. Two existing derived
capabilities require explicit mapping: `skill_resource` comes from enabled
`skill_load` plus an available snapshot, and `candidate_file` belongs to an
authorized coder worktree. Neither mapping creates a new capability by itself.

Provider tool call IDs are local to an execution. The common admission gate,
operation journal, raw tool and terminal receipt need one stable infrastructure
ID bound to the parent Run, task, optional execution ID and provider call ID.
The provider ID remains separate for transcript correlation; ordinary parent
call IDs keep their existing meaning. Repeating the same child invocation must
remain fenced across a store reopen, including changed arguments or definitions.
Historical child records without the new identity protocol remain conservatively
fenced, rather than becoming newly executable because the identifier changed.
The legacy scan is a wrapper-lifetime snapshot. It does not promise coordination
with an older binary concurrently executing that same child; current task start
already requires its pending-to-running transition. Parent and child still share
a ledger: a parent deliberately choosing another child's derived infrastructure
ID can cause a closed claim conflict. Full identity-domain separation belongs to
the later child-Run migration; the present change isolates ordinary identical
provider IDs without weakening execution fencing.

Transparent candidate read tracking is a decorator: it adds dependency evidence
while preserving the underlying tool's identity and protocol metadata. It must
not make a valid self-described tool fail admission, and must not become an
independent raw execution path.

The tool-boundary changes above do not create child Runs, change usage roll-up,
resume an interrupted child or expand tool permissions.

## Proposed minimal shared session

An internal `ExecutionSession` can expose six narrow responsibilities without
replacing `AgentRuntime` or supervisor policy:

- **Identity:** actual ledger Run, stable execution identity, optional task and
  role. Child Run lineage is present only after a real child Run exists.
- **Authority:** effective parent capabilities intersected with the role, with
  explicit candidate/derived-tool adapters.
- **Model session:** shared preparation, deadline/cancellation, compaction and
  capture, with injected role prompt, context source and event owner.
- **Budget:** remaining limits and invocation-keyed primary/auxiliary usage,
  with one parent roll-up path.
- **Evidence:** common capture content/validation and distinct main/child event
  ownership; no synthetic child responses in the parent stream.
- **Control and checkpoint:** stable messages, consumed cursor, context hash,
  settled-tool boundary, usage cursor and cancellation state.

Migration should first share the model-session mechanisms for child main loops
and output repair, then add durable child Runs and scheduling/ownership, then
checkpoint/mailbox recovery. Unknown external effects remain fenced by existing
operation recovery. Restart reconciliation must not infer a full transcript
from the public subagent step projection.

Acceptance requires a long child to finish after compaction while retaining its
latest steering; parent, child, repair and compactor usage counted once; isolated
concurrent checkpoints; and cancellation that cannot turn a late model result
into completed work. Crash coverage must include accepted-before-delivery,
delivery-before-checkpoint, response-before-usage-commit, result delivery and
candidate merge. Tests of these future stages are still required.

## Verification of the first boundary fixes

The [current regression receipt](artifacts/child-execution-boundaries-regression-2026-10-29.json)
contains 10 files / 78 passing tests with exact source/test hashes. It includes
real SQLite claim/reopen checks, fixture-provider tool catalogs, forbidden-call
rejection, candidate patch/read/merge and the common admission structure audit.
Old source reproduced nine permission assertion failures, five of six initial
call-ownership cases failing, and two read-tracking identity failures. The latter
also blocked two permission fixtures before they could reach their assertions;
the receipt keeps that distinction.

The final Runtime compile and strict test TypeScript checks pass. Extracting the
shared test fixture and moving the authority cases into a separate file removes
the new test-size overage; direct optional execution-ID forwarding restores the
runner's prior complexity. No architecture budget was raised. The nine existing
architecture failures and two existing public-API failures remain. These fixes
are local mechanism evidence, not live-model quality evidence or complete G03
acceptance.

## Shared model invocation mechanism

`ModelSession.open` is the actual common entrance for main Agent turns and the
child's normal, typed-repair and ordinary-repair calls. It uses the registry's
already admitted model adapters, checks lifetime before and after asynchronous
capture, and delegates to the same deadline/abort transport. Main context
preparation, prompt compilation, extension order, thinking-loop recovery and
overflow compaction remain outside this narrow mechanism.

Request data is detached before asynchronous capture. Tools retain only their
provider-visible definition, not executable callbacks. Trusted process-local
message provenance preserves the main Agent's ownership of runtime context
tails across snapshots; text markers and another Run's messages do not acquire
that ownership. Capture and provider receive the same detached context. This
adds copying work; its latency and allocation cost have not been measured.

Child supervisor receipts use `subagent.model.*` with explicit parent, child,
task and execution identity. The invocation index is durably reserved on the
child Run. Cache observations remain scoped to session and phase. Canonical
child `model.response` and context envelope/adapter receipts commit together on
the child Run; parent aggregation still consumes Task usage once. Capsules now
name the actual child Run. No child `context.model_invocation` is added to the
main experiment candidate stream. A captured request alone does not establish
a restartable transcript.

Both repairs consume one response with an empty tool catalog. Any tool call is
rejected, even if a later scripted response would be valid JSON. Route retry and
fallback are capped at one `models.streamSimple` invocation, with SDK retries
disabled. This is a provider-call boundary, not a guarantee about a third-party
provider's internal HTTP behavior. Selected route credentials, response hooks,
headers and environment options reach the invocation. The original defect lost
the selected key and hook; endpoint headers were already restored by the adapter.

A child has one absolute deadline spanning setup, turns, repair and settlement.
Checks after awaited capture/request/response/repair boundaries prevent new
dispatch or completion after cancellation. Response usage is recorded once
before rejecting a canceled result, and a final assertion runs inside the
serialized task mutation. Completion that has already committed wins a later
cancellation. An ignored abort ends logical execution while the original
physical admission remains held until the provider actually settles. Late
physical usage is still host-accounted; exact late attribution to the canceled
child is not implemented here.

Normal child usage continues to come solely from `SubagentTask.usage`. The
new response receipts are diagnostic and do not add a second parent roll-up.
This does not make usage crash-atomic with responses, persist a child transcript,
checkpoint mailbox consumption, or enable child restart recovery.

Candidate delivery is guarded until the serialized completion commits. A newly
stored candidate whose task is interrupted receives a durable `revoked` state
under its existing apply lock. It remains inspectable and follows the existing
retention period, but cannot be applied. A task mismatch is rejected; applying
and settled states are never overwritten by cancellation cleanup. Publication
and worktree-removal failures retract the candidate even if the outer caller
has not received its ID. If cleanup cannot confirm revocation, the original
interruption and unresolved cleanup are reported together and evidence is kept.
This does not establish that every associated execution resource was reclaimed.

The [shared-session regression receipt](artifacts/shared-model-session-regression-2026-10-29.json)
binds 27 test files / 250 passing tests, no skips, and 1,971 unchanged source,
test and configuration files across the final run. An independent 13-case
actual main/child integration run binds another complete 2,246-file manifest.
The frozen old-HEAD 11-case failures, later startup and normal-turn failures,
candidate cancellation failures, and intermediate implementation failures are
kept as distinct evidence. Tests include actual queued SQLite settlement,
retained candidate apply/reopen checks, inherited tool authority, ignored-abort
physical admission, main runtime-tail overflow recovery, and normal parent plus
child plus repair usage roll-up.

Contracts build, Runtime compile, Server build and strict new-test TypeScript
pass. The complete Runtime release build still fails its historical source
manifest comparison. The nine existing architecture failures and two existing
public-API failures remain; only stale allowances were lowered. No release
manifest, compatibility digest or historical evidence was rewritten. These
results establish the bounded local mechanism, not complete G03 acceptance.
