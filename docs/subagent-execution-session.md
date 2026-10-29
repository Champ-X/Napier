# Main and child execution boundaries

This G03 design follows the current production paths. It is not a claim that a
shared execution session or restartable child Run has already been delivered.
The first implementation work closes tool-authority and call-identity gaps
before sharing more lifecycle machinery. External model requests are excluded
from the local regression work.

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
| Model lifecycle | Child `createSubagentStream` calls the admitted registry directly; the main stream also owns deadlines, overflow/thinking-loop handling and invocation capture. Typed-output repair creates another child Agent. | Share lifecycle mechanisms across child execution and repair with explicit execution identity and purpose. |
| Context and compaction | Main preparation, prompt compilation and compaction use a ledger Run. Child starts from role instructions and a task prompt. | Give child-local context, compaction and capture an explicit owner; passing the parent Run unchanged would import the wrong history and checkpoint scope. |
| Usage | `aggregateRunUsage` combines parent `model.response` events and `SubagentTask.usage`. | Use one authoritative accounting source per invocation. Adding child responses to the parent model stream without changing aggregation would count twice. |
| Controls | Accepted/delivered mailbox events persist; pending `Agent.steer` work is in memory. Delivered is enqueue evidence, not a durable context-consumption checkpoint. | Persist message consumption with the child context/checkpoint identity, and replay only unconsumed messages. |
| Run lineage | Tasks retain the parent Run ID and an optional provider execution ID. Ordinary threads permit one active Run; workflow children have a separate limited exception. | Add an internal child Run creation path and lineage/scheduling rules. Merely filling `parentRunId` cannot create concurrent child executions. |
| Recovery | Restart marks active tasks failed/orphaned. Revival starts a new task from the old prompt. Step records can be truncated or redacted. | Persist a validated private working set and settled-tool boundary before claiming continuation from previous progress. |
| Resources | Some inherited capabilities are owned by the parent Run, and worktree cleanup errors are currently swallowed at runner exit. | Address child-scoped cancellation and cleanup obligations separately; a terminal task/result is not proof that its resources were reclaimed. |

Relevant production entry points are `agent-model-stream-lifecycle.ts`,
`agent-invocation-context.ts`, `run-context-compaction.ts`,
`subagent-model-stream.ts`, `subagent-typed-output-runtime.ts`,
`subagent-execution-control.ts`, `run-replay.ts`,
`run-interruption-recovery.ts` and `store.ts` under `packages/runtime/src`.

## First bounded changes

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

These changes do not create child Runs, add model capture, change usage roll-up,
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
