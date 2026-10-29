# Safe child continuation and durable completion

This G03 slice extends [private working sets](subagent-working-set.md) with a
bounded native continuation path. A recovered parent can resume an eligible
read-only child from its exact private source, or finish a settled final answer
without another ordinary model call. Coder reconstruction, uncovered execution
tails and full main/child compiler parity remain unfinished.

## Recovery identity and authority

Continuation creates a new Task, execution ID and child Run under the explicit
recovered parent. Old Runs, Tasks and events remain unchanged. A fresh user retry
keeps its existing semantics and starts a new logical task. A durable predecessor
can have only one successor; competing claims return the existing identity
without another token or dispatch authority.

Preparation reads and validates the native capsule, invocation/tool frontier,
mailbox and workspace dependencies. An opaque capability binds that assessment.
The claim transaction rechecks current source revisions, ledger heads, checkpoint,
parent lease, direct recovery lineage, frozen target configuration and current
configured profile. A durable `run.recovery.started` event is required. Inspection
does not restart a child. Removed roles, tools and skills cannot be recovered
from an older frozen profile.

Automatic read-only recovery retains its empty ordinary delegation tool/role
surface. The child receives a task-specific grant for the previously accepted
role and exact tool schema. That grant does not enable new parent delegation.
The provider claims only after semaphore admission, then uses normal send,
cancel, inspect and collect operations for the new handle.

Only local read-only continuation is currently supported. A source with no
successful workspace dependency can proceed; successful `read_file` dependencies
must match the private SDK result's path, hash and size. Successful list/search,
semantic/LSP and skill dependencies lack equivalent attestations and are refused.
No dependency is reconstructed from public step text. Changed tool definitions,
missing/corrupt capsules, imported private state, unknown usage/effects and
uncovered model/tool/review tails remain unavailable. Continuation-bearing replay
imports are rejected before persistence because rekeying their recovery lineage
and private authority is not implemented; exporting a valid public replay still
works.

## Restore and crash boundaries

The successor restores the exact private SDK source, including signatures,
tool-result details and consumed message provenance. User/tool-result tails use
`Agent.continue()`. Only a settled assistant with `stopReason: stop` and no tool
calls can take the finalization path. Truncated/error or otherwise unsafe tails
are rejected before claim. Defensive postclaim initialization failure terminates
the new child through its fenced lifecycle and disposes its heartbeat.

The first successor checkpoint must be durable. The ordinary unsupported-platform
checkpoint fallback cannot silently remove the recovery guarantee from a claimed
continuation. A crash between claim and that first checkpoint retains a persisted
source alias: a later recovered parent may reuse it only while the successor
has no uncovered execution. A native successor checkpoint becomes the new source
when present. A pending reservation is unknown usage; a settled response beyond
the checkpoint is an uncovered tail. Neither permits replay from an older source.

Inherited provider tool-call IDs cannot gain new physical tool authority under
the successor execution. Already consumed mailbox entries retain origin Task,
parent Run, message identity and source position. Only unconsumed entries are
queued again. The public mailbox projection follows the continuation lineage
and deduplicates acceptance/delivery identities; consuming a later message still
cannot consume a missing earlier one.

## Logical budgets and physical accounting

The continuation receipt keeps the logical task root, original start/deadline,
prior turns/steps and inherited usage. Each successor Run and Task records only
its own physical usage. Parent canonical aggregation still consumes each current
Task once; inherited amounts constrain admission without being written again as
new usage.

The recovered parent's live budget projection includes prior attempts and refreshes
current child subtotals before each physical call, including typed/outcome repair,
compaction and routed attempts. The gate runs before capture and immediately before
provider dispatch. A known host denial after reservation/capture settles a known-zero
response without inventing a provider turn. A valid inherited final answer may
finish at the token/cost/turn ceiling without any new model call; a repair may not.
The original absolute child deadline still governs setup and finalization.

These checks do not reserve shared parent token/cost amounts atomically across
concurrent in-flight calls. Unknown future response sizes can still overshoot a
ceiling. Exact late physical usage attribution after ignored cancellation also
remains unfinished.

## Completion and candidate ownership

A durable completion reservation binds the exact Task/execution, result identity
and candidate identity before staging. The completion receipt commits with the
Task/Run terminal state. Candidate publication/application checks that receipt;
an uncommitted preview cannot become deliverable merely because a file exists.
Retries reuse stable identities and reject conflicting content. Revoked/applying
states retain their existing fences.

After a crash following completion but before publication, collection reconstructs
the committed result from durable state and can publish the same receipt without
another model/tool invocation or another candidate. Imported Task completion
metadata does not authorize candidate delivery. This is a local durable protocol;
it is not a claim of universal external exactly-once effects or resource cleanup.

Historical native candidates without a completion binding were initially
inspection-only. The subsequent [legacy reconciliation extension](subagent-legacy-candidate-reconciliation.md)
admits eligible native outcome/typed results through an independent migration
receipt and conservative full-source constraint. Missing historical proof remains
unavailable; imported copies do not inherit write authority.

## Evidence and remaining work

Run `node scripts/check-subagent-child-runs.mjs OUTPUT.json` from the repository
root. The runner records the complete required compilation, strict-test checks,
local regression suites, source/emitted hashes and the 28 preserved user files.
Historical architecture, public API and release-manifest failures remain separate
and are not regenerated as acceptance evidence.

The [final combined receipt](artifacts/subagent-safe-continuation-regression-final-2026-10-30.json)
records 566 passing tests across 80 files, no failures/skips, passing required
compilation/strict checks, 4,158 stable source/test/config hashes, 65 stable emitted
module hashes and all 28 preserved user files. The
[evidence index](artifacts/subagent-safe-continuation-evidence-index-2026-10-30.json)
retains independent handoffs, review counterexamples and earlier failed attempts;
overlapping focused counts are not added together.

The first combined attempt also passed all 566 behavioral tests, but strict
checking exposed an unsupported fixture usage argument. That test had silently
used zero usage. The final test explicitly sets and asserts 10 tokens and
USD 0.03 before verifying that continuation inherits them exactly once. Earlier
process results do not prove that nonzero assertion. Two final empty lines were
removed after the frozen run; the evidence index records their exact byte-only
normalization and the unchanged emitted modules separately.

The fault matrix includes actual child processes terminated with SIGKILL before
claim, before/after the first native checkpoint, after reservation and after an
uncheckpointed response; two processes also race the same prepared claim. Completion
tests kill processes after candidate staging and after completion commit, exercise
two-process stage/complete races and reopen publication state. Local SQLite reopen
and injected lease/capability/schema faults supplement those process cases; they
are not all labeled as process crashes.

All model responses use local fixture providers. These results establish bounded
mechanism behavior, not live-model quality, performance, Windows durability or
power-loss acceptance. G03 and the overall G01–G07 roadmap remain active. Remaining
work includes coder/worktree restoration, safe handling of uncovered tails,
complete shared context compilation/overflow/thinking behavior, late usage,
atomic concurrent parent quotas and the other roadmap targets.
