# Durable child Run foundation

This document records the G03 foundation at `139fc062`: an actual execution Run
for the existing supervised child runner. The subsequent
[private working-set extension](subagent-working-set.md) adds transcript and
mailbox checkpoints plus shared compaction. The
[safe continuation extension](subagent-safe-continuation.md) adds bounded native
read-only recovery and durable completion. All regression providers are local fixtures.

## Ownership and authority

A pending Task remains the queue entry. After the existing semaphore admits it,
one SQLite transaction creates a running, leased child Run and starts/links the
Task. `Task.runId` stays the supervisor's parent; `Task.childRunId` names the
execution owner. The child uses `source: subagent` and the internal `subagent`
execution mode, including the existing 1-second child timeout minimum. Ordinary
Run creation rejects this source/mode; filling `parentRunId` is not authority.

The host grant is an opaque process-local capability bound to the Task,
execution and parent's frozen effective profile/configuration. Temporary parent
presets are retained; mutable current Agent settings are not reloaded. Role
tools are a subset of the parent grant, recursion is disabled, and coder writes
still use the isolated candidate implementation. Durable Task order and active
child count enforce the frozen total/concurrency limits at child start.

Inherited tool callbacks, model route receipts, tool journal/admission IDs,
candidate debugger/process ownership and cleanup use the child Run. The authority
origin remains the parent. A child does not borrow live parent browser/process
resources. Explicit immediate-parent network-source requests may copy bounded,
immutable source capsules after permission, same-thread/Agent, configuration and
Task association checks. Sibling/imported/forged sources are rejected.

## Invocation and accounting

Every physical candidate invocation receives a durable child reservation before
capture/dispatch. Its index survives store reopen and differs from the separate
execution revision and heartbeat revision. Main turns, child turns and repairs
continue using `ModelSession.open` and the already admitted model registry.

One settlement transaction records the canonical child response, context
envelope/adapter, and matching Run/Task usage. An identical retry does not add
usage or events; conflicting retries fail. Parent totals consume the Task
subtotal only. Child records stay inspectable, while benchmark primary totals
exclude their already rolled-up usage. Legacy receipts without a source remain
compatible. Unknown/incomplete usage disqualifies cost comparisons even when the
known subtotal reconciles numerically.

Private capture and the parent supervisor receipt precede dispatch. Canonical
context receipts publish atomically with the response. A reservation without a
capture can therefore leave a gap in envelope indices. Only validated child
lineage and its durable reservation/response bindings permit that gap; ordinary
Run evidence validation is unchanged. No transcript is inferred from public step
summaries or redacted tool results.

Repairs still consume the Task turn budget and at most one response. Individual
child token/cost limits reuse `RunBudgetTracker` with canonical usage before a
new invocation; a host-denied call adds no synthetic turn or usage. This is a
check before subsequent calls, not a bound on the tokens a request already in
flight can consume. It does not provide an atomic shared-parent token/cost
reservation across concurrent children. Parent usage roll-up remains unchanged.

Ignored-abort responses remain incomplete/unknown, retain physical admission
until the provider settles, and cannot complete a cancelled Task. Late physical
usage attribution remains unfinished. A failed capture may conservatively leave
an unresolved reservation; it never authorizes a new unknown-cost invocation.

## Lease, completion and restart

Dispatch checks child identity, token, execution revision and live parent
authority. Heartbeats renew the child lease separately. Parent lease expiry or a
durable parent terminal prevents new model/tool work. Known response usage and
cancellation evidence may still settle after parent loss.

Successful completion checks the lease/cancellation fence within the terminal
transaction, then commits Task and child Run together. Generic Task/Run terminal
or progress methods cannot bypass child fencing. Live tool-effect authority
prevents early terminal settlement. The existing candidate ownership transfer
continues to revoke an unpublished/cancelled preview and retain a committed one.

Restart preserves live leases and interrupts lost child execution with an
explicit continuation-unavailable reason. An uncertain tool effect is fenced
and remains `blocked_safety`; it is not replayed. If the parent is lost while the
child lease is still live, the SQLite marker proof checks prior durable child,
Task, configuration and parent lineage plus the normalized parent lease under
the writer transaction. Proposed next-snapshot data cannot manufacture authority
loss. Terminal parent usage also retains an incomplete descendant marker.

## Primary task projections and live events

Shared selectors exclude child Runs from primary task outcomes, latest
interactive recovery, artifact/plan currency and benchmark totals. Ordinary
manual/automatic recovery cannot target a child. Child lifecycle and canonical
responses publish after commit; completion publication follows candidate
ownership transfer. The workbench retains child trace events without replacing
the attached parent, its pending text or `thread.currentRunId`. Detailed Run
records still arrive through the ordinary final snapshot/inspection API; this
slice adds no per-event copy of the full Run history.

Native Chrome inspection of the actual TaskNarrativeBar and production stream
reducer confirmed parent → child receipts preserve the parent owner and text.
That isolated browser harness used simulated events and no backend. Narrow,
theme and terminal stages were not browser-verified; automated tests cover those
state transitions. It is not full application or usability acceptance.

## Verification and remaining work

Run `npm run test -w @napier/runtime -- test/subagent-child-execution-integration.test.ts` for the current regression. The October [capture script](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/scripts/check-subagent-child-runs.mjs) also recorded source and build hashes against a temporary manifest of 28 working files.

The [final receipt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/subagent-child-runs-foundation-final-2026-10-29.json)
records 381 passing tests across 57 files, zero failed/skipped tests, all required
compilation/strict checks passing, 4,100 unchanged source/test/config files,
67 unchanged emitted modules and all 28 preserved user files. The
[first attempt](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/subagent-child-runs-foundation-2026-10-29.json) retains
its strict-check command failure: it omitted the repository's exact optional
property compiler semantics. The corrected command uses the project checking
flags. The accidental helper reexport was removed; the two historical API
failures remain (1,897 root symbols against 1,896 and the digest mismatch).
Eight existing architecture failures and the release source-manifest mismatch
remain; no budgets were raised or manifests regenerated.

Independent baseline and browser/effect evidence are linked in the
[evidence index](https://github.com/Champ-X/Napier/blob/b18a1d7fef48161f0aba4815c7685b38bf09660b/docs/artifacts/subagent-child-runs-evidence-index-2026-10-29.json).
These overlapping reports are not additive. Local `/tmp` raw evidence is
ephemeral; embedded handoffs preserve its paths, hashes and interpretation. Failed
intermediate attempts remain distinct from behavior failures on frozen
`f65fc47b`; they are not merged into one claimed baseline test matrix.

At this foundation stage, private working-set/checkpoint persistence, mailbox
consumption and compaction remained subsequent work; their current implementation
is documented in the extensions above. G03 still requires broader restart
coverage and full shared execution parity. Parent/child accounting and cancellation retain the
unknown-effect and late-usage limits above. G01–G07 remain active; this foundation
does not establish live-model quality, end-to-end performance or release acceptance.
