# Private child working sets and shared compaction

This extends the [child Run foundation](subagent-child-runs.md). A supervised
child now records its full private source transcript, consumed mailbox entries
and settled execution frontier. Long child contexts use the same compaction
policy and model-session boundary as main execution. Safe restart continuation
is still unavailable; a stored checkpoint does not grant execution authority.

## Source and checkpoint binding

The awaited Agent context boundary records the initial prompt and steering
before a model call. A completed turn records the assistant and complete tool
batch, including the final answer before supervisor review. The source remains
append-only even when the provider request uses a compacted projection.

Private capsules preserve model signatures, tool arguments, images, exact tool
content/details, tool usage and deferred-tool metadata. Public events contain
identities and hashes. No child `message.user` or `message.assistant` is appended
to the ordinary conversation. Public steps cannot reconstruct the transcript.
Their exact SDK-result hashes validate the private tool source, including a
schema-rejected request that the model may correct on the next turn. Physical
tool settlement and uncertain effects are checked independently.

The capsule binds thread, parent/child Run, Task, execution, frozen configuration,
role system prompt, actual tool schema, source-message set, prior capsule and
prior source prefix. Successful normal assistant messages must match canonical
child response hashes in order. Auxiliary/repair responses and failed route
candidates are not manufactured as ordinary source messages. Repeated provider
tool IDs retain distinct SDK result occurrences while the physical execution
gate continues preventing repeated effects.

An immutable private file is written and synced before the host can mint the
opaque prepared-checkpoint capability. The repository rereads it, then checks
the child lease, live parent authority, execution revision, prior pointer,
ledger head, invocation cursor, usage hash and Task counters in its serialized
transaction. Unresolved model usage, incomplete tool exchanges and live or
indeterminate effects prevent a new pointer. Pointer, mailbox counters and
checkpoint event commit together. A lost CAS can leave an unreferenced private
file; it cannot replace the current pointer.

Export retains public receipts. Import marks private storage `not_imported`;
it does not transfer capsules or grant a restart. Missing, altered or foreign
capsules cannot supply a local working set.

## Mailbox consumption

Acceptance is an atomic, idempotent message-ID/content operation. Delivery
continues to mean enqueue into `Agent.steer`. Consumption is recorded only when
the actual enqueued message object appears in the private source. The accepted
payload deterministically binds its rendered user message and timestamp;
equal-text substitutes do not inherit that identity.

The capsule retains a cumulative sparse set of consumed IDs and their exact
source-message positions. The public cursor advances only through the
contiguous accepted prefix. If B reaches the child before an earlier accepted
A, consuming B cannot mark A consumed. A successful pointer cannot drop or
rewrite previously consumed entries.

## Compaction and accounting

Before a normal physical reservation, the selected route candidate and options
are measured against the unchanged role system prompt and full source.
`RunContextCompactor` selects complete units, preserves pinned user intent,
validates the summary and checks actual reduction. A child adapter invokes its
summary through `ModelSession.open` with `context_compaction`, one physical
attempt, exact capture and the existing deadline/abort transport.

The adapter owns the one canonical child response settlement. Summary and
ordinary usage enter the same child Run/Task subtotal and parent roll-up.
Auxiliary calls do not consume ordinary Task turns. A fresh local compaction
tracker starts from canonical child usage; its accounting is separate from
durable settlement. Malformed/error summaries do not create a checkpoint or
trigger an auxiliary retry. Cancellation after a settled summary retains known
usage without counting an undispatched synthetic primary response as a turn.

Compaction hydrates its own child-owned summary checkpoint. The private source
capsule still contains the original tool evidence. This shares invocation,
measurement and compaction policy; it does not claim complete child parity with
main prompt compilation, overflow/thinking recovery or all extension policies.

## Filesystem and platform boundary

`LocalPrivateCapsuleStore` reads through bounded descriptors, rejects invalid
UTF-8, verifies file/root identity and semantic hash, installs immutable files
without retracting visible final paths, and syncs supported directory entries.
Actual installed bytes are returned on duplicate writes and reads. Ordinary
concurrent writers use the existing workspace lock and quota checks.

Child checkpoints require supported no-follow/directory/nonblocking flags and
successful file/directory sync. A typed unsupported-capability result disables
checkpoint writes for that execution and records
`subagent.child.checkpoint_unavailable`; ordinary execution can continue without
a restart guarantee. Corruption, permissions, EIO, ENOSPC and file-sync errors
remain failures. Other capsule consumers retain their existing compatibility
mode, which does not promise directory durability on unsupported platforms.

Real filesystem/process tests run on Darwin. Capability fault injection is not
Windows acceptance, ACL equivalence, network-filesystem certification or a
power-loss experiment. Data-root ancestors remain trusted. Existing stale-lock
takeover/release races are not a hard quota guarantee; visible final capsules
are never removed to repair a later quota/sync failure.

## Verification and remaining work

`node scripts/check-subagent-child-runs.mjs OUTPUT.json` records compilation,
strict types, local fixture regressions, before/after source and emitted hashes,
the preserved user files, and separate historical release/API/architecture
failures. Independent receipts retain failed fixture setup separately from
behavioral failures and do not add overlapping test counts.

The [combined receipt](artifacts/subagent-working-set-regression-final-v2-2026-10-29.json)
and [independent evidence index](artifacts/subagent-working-set-evidence-index-2026-10-29.json)
bind the implementation and test snapshots. The first combined attempt retained
an invalid supervisor-tool fixture and a real main-session cancellation race.
The fixture now extracts Task/execution IDs instead of spreading a handle's
discriminator into a mailbox message. Main capture now binds its durable envelope
before the session's post-capture cancellation check. Tests cancel at envelope
and invocation persistence, verify zero provider calls and a unique terminal
binding, and export a valid replay. That terminal closes a captured request; it
does not prove the provider received it. Partial ledger-write failures and
cross-route-attempt settlement are separate boundaries.

The next combined attempt passed all 473 behavioral tests but failed strict
types on the new cancellation test's JSON payload access. That attempt is also
retained; the final test uses the existing envelope validator to narrow the
payload. Historical release-manifest, architecture and API failures remain
separate from this slice's required checks.

Restart admission, revalidation of workspace/tool schema, unconsumed mailbox
replay, safe parent recovery/rebinding, supervisor review/repair continuation,
and once-only result/candidate delivery remain to implement. A checkpoint can
precede a later known invocation or supervisor action; that tail cannot be
silently discarded. Late physical usage after ignored abort and shared-parent
concurrent token/cost reservations also remain unfinished. All model results
in this slice are local fixtures; no live-model quality or performance gain is
claimed.
