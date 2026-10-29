# Workspace resource admission

The production workspace host shares a model admission ledger across all its
workspace graphs and other hosts using the same state home. Model invocations
have durable quotas and physical-call concurrency limits. Runtime reclamation
also retains unsettled model calls, workspace process sessions, and browser-task
preparation/settlement. Owned execution and browser resources now have a separate durable capacity
ledger. This remains a G05-B slice: cross-restart cleanup reconciliation and
broader review acceptance remain pending. Workflow approval and extension trust
review isolation have separate browser evidence in goal.md; the associated
overlapping overlays were fixed in
[workbench overlay coordination](workspace-overlay-coordination.md).

## Model admission and accounting

`model-admission.sqlite` uses atomic SQLite transactions, WAL, FULL synchronous
writes, and private new files. The default capacity is eight physical model
invocations. Concurrent hosts obey the smallest live host capacity. Admission is
synchronous: capacity or budget exhaustion fails before provider dispatch, without
a local queue or provider fallback. It does not hold a permit for an entire Run;
a parent releases its model slot before delegating, so a parent and child can
complete with capacity one.

All four raw ModelRegistry methods are wrapped: stream, streamSimple, complete,
and completeSimple. Internal stream calls made by complete are not counted twice.
The physical provider result determines settlement, independently of consumer
iteration or synthetic cancellation terminals. A provider ignoring abort retains
its slot and workspace graph until its physical result settles. Successful
terminal output waits for durable accounting. A settlement failure is surfaced,
retains the pending slot, and rejects draining/closing rather than silently
releasing capacity. Restart or explicit reconciliation is required after a
quarantined failure; automatic accounting retry is not implemented.

The reservation uses a detached, frozen model tariff, the whole context window,
and capped output. USD reservation includes the highest tier rates and the SDK's
long-cache write rule. Complete, positive, consistent usage settles the larger of
reported cost and the frozen SDK tariff calculation. Missing, zero, inconsistent,
error, or aborted usage retains the full allowance and any higher observed tokens
or nominal cost. Valid individual token counters survive other missing counters,
including reasoning/output and long-cache/cache-write subset relationships.
Missing cost reporting still contributes the frozen-tariff estimate but never
makes the usage complete. Partial cost components and unclassified excess total
tokens retain debt, using the highest frozen tariff for unclassified counts.
Overruns remain debt and block further admission.
Unknown tariffs produce unknown charged USD, not zero. A finite USD budget rejects
unknown/all-zero tariffs unless a free model is explicitly declared.

A dead owner frees local model concurrency but retains uncertain budget charges;
client death does not establish that remote provider computation stopped. PID
reuse or an unknown process state conservatively retains the owner; PID-only
ownership is not proof against reuse across a reboot. Policy and usage survive
runtime eviction and host restart. An epoch's budget policy is immutable; changing
a budget requires an explicit new epoch. Capacity changes alone are allowed.

These are **logical model invocations and nominal usage estimates**, not provider
HTTP requests or invoices. SDK-internal retries are not individually counted.
Built-in ModelRegistry paths include main agents, children, compaction, review,
evaluation and experiments. External BrowserUse backends and extensions that make
their own network requests bypass ModelRegistry and are outside this budget.
There is no default monetary or token limit and no live billing guarantee.

## Configuration and observation

The production entry reads these optional variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `NAPIER_MODEL_MAX_CONCURRENT` | `8` | Physical model invocation slots, 1–256 |
| `NAPIER_MODEL_BUDGET_EPOCH` | `default` | Explicit persistent allowance identity |
| `NAPIER_MODEL_BUDGET_INVOCATIONS` | Unbounded | Invocation count; never refunded |
| `NAPIER_MODEL_BUDGET_TOKENS` | Unbounded | Reserved/settled token allowance |
| `NAPIER_MODEL_BUDGET_USD` | Unbounded | Reserved/settled nominal USD allowance |
| `NAPIER_MODEL_ZERO_COST_MODELS` | `[]` | JSON array of explicit `provider/model` free declarations |

`GET /api/workspaces/<workspaceId>/workspace/resources` exposes the shared policy,
effective capacity, active calls, uncertain calls, charged totals and observations.
`chargedCostUsd` is null if any charged amount is unknown;
`knownChargedCostUsd` is only the known subtotal. This is a read-only host endpoint.
Budget/capacity failures are currently execution errors; a unified pause/retry UX
is part of the remaining G06-B work. The ledger aggregates invocation history on
admission; its large-history performance has not been measured.

## Process and browser lifetime

Workspace process ownership now spans admission, awaited preparation, actual OS
execution, terminal persistence, compensation and lock cleanup. Shutdown rejects
new starts, drains admitted preparation, terminates late registered children and
waits for settlement before closing the ledger. Sessions that outlive their
parent Run keep their workspace resident.

BrowserTask creation reserves its local admission before the first awaited
initialization/credential operation. Shutdown drains preparation and persistence,
prevents backend launch after cancellation during the initial journal write, and
persists cancellation while waking waiters. The local BrowserUse backend checks
abort after asynchronous preparation and again around listener registration;
terminal listeners are installed before cancellation can terminate the child.
These changes protect lifecycle obligations. The execution-resource ledger below
adds host-shared execution/session/task counts, but does not impose host-wide
CPU, RSS or all-descendant subprocess limits.

## Owned execution resource admission

`execution-resources.sqlite` shares capacity across production workspace graphs
and hosts using the same state home. WAL, FULL synchronous writes, atomic
transactions and private new files preserve ownership. Concurrent cold-open
schema initialization has bounded retries for SQLite lock contention; resource
launches and settlement mutations are never automatically replayed.

| Variable | Default | Capacity unit |
| --- | --- | --- |
| `NAPIER_SANDBOX_MAX_CONCURRENT` | `32` | Owned Sandbox execution handle |
| `NAPIER_BROWSER_SESSION_MAX_CONCURRENT` | `4` | Native Playwright-owned session |
| `NAPIER_BROWSER_TASK_MAX_CONCURRENT` | `4` | BrowserUse local/cloud task |

Each limit is an integer from 1 to 256. Hosts sharing state home obey the
smallest live-host limit for each kind. A synchronous reservation precedes
asynchronous preparation and physical dispatch; exhaustion rejects before the
adapter/backend starts. No waiting queue is introduced. The existing resources
endpoint retains its model fields and adds `executionResources`, including
configured/effective capacity and preparing/active/quarantined counts.

The durable path is `reserved → dispatching → active → released | quarantined`.
Every state except `released` consumes capacity. A validated `not_started` or
`released` proof releases it; absent, malformed or unknown proof never does.
Binding a resource identity is immutable. Repeating the same settlement is
idempotent, and a live lease may replace unknown cleanup with affirmative
cleanup evidence. Dead owners release only reservations that never reached
dispatch. Dispatched ownership is quarantined even if the PID has disappeared.
PID-only liveness cannot prove identity across reboot and errs toward retaining
capacity. Cross-restart reconciliation is not implemented; do not manually reset
this ledger to turn unknown ownership into success.

Switchable Sandbox captures the adapter at launch, keeps admission on adapter
replacement, and waits for both child exit and owned cleanup before settling.
Guardian cleanup uses a private acknowledgement; PTY receipts are nonce-bound;
plain process cleanup checks the owned process group. Scratch/projection cleanup
and OCI compensation participate in the proof. A custom spawner exception is
unknown unless it carries affirmative no-start evidence. This counts handles and
observed owned cleanup, **not every escaped descendant**. The retained baseline
counterexample below remains relevant.

Native browser sessions retain a slot through URL/runtime preparation, launch,
reuse, shutdown and cleanup persistence. Queued starts/operations drain before
shutdown finishes; failed cleanup retains the session and its slot. Local
BrowserUse requires its bridge's nonce-bound acknowledgement after `agent.close()`
and child close. Cloud BrowserUse requires an independent matching task GET to
confirm terminal state; accepting a stop PATCH alone is insufficient. Lost create
responses, mismatched identities and unconfirmed stops remain unknown. These
local/cloud behaviors have deterministic fixtures, not live provider acceptance.

Shutdown attempts each resource owner, then drains admission before closing the
workspace store. Unknown cleanup or accounting failure rejects shutdown while
leaving the event database available for inspection; compatibility projections
are still flushed. BrowserTask shutdown also attempts Runtime cleanup after a
task-drain failure. Invalid task cleanup proof is converted to scoped unknown
proof so the durable drain rejects instead of hanging; validation and persistence
errors are retained together if both fail.

## Reproduction and evidence

After compiling Runtime and Server, with the current Web build present:

```sh
node scripts/check-workspace-resource-coordination.mjs \
  docs/artifacts/<new-receipt>.json --browser \
  --runtime-test test/browser-use-local-abort.test.ts \
  --runtime-test test/browser-use-local-backend.test.ts
```

The verifier binds source trees and consumed build trees independently, records
actual assertion names/counts and observed timings, rejects skipped or missing
tests, and verifies unchanged hashes after execution. Failure diagnostics and
before/after bindings remain in its temporary directory. Browser evidence covers
existing A/B navigation, scoped preview assets, background automation and
completed-history production restart; it does not verify quota UX. Recovery
faults occur before model dispatch/tool effects with faux providers and a
readiness-only sandbox. No external model requests are made. Historical receipts
remain unchanged; current worktree evidence includes retained user Web changes
and is not a clean release receipt.

The current [receipt](artifacts/workspace-resource-coordination-current-2026-10-29.json)
records **170 passed tests across 19 files** (110 Runtime and 60 Server), plus
1440px/320px browser verification with no page errors, response-identity mismatch
or horizontal overflow. Runtime/Server compilation and strict admission-test
typechecking passed. Architecture retains its ten existing failures and public
API its two existing root-surface failures; no budgets or compatibility baselines
were raised.

The [first receipt](artifacts/workspace-resource-coordination-2026-10-29.json)
preserves the earlier 167-test snapshot before long-cache/reasoning/cost-component
partial-observation handling was completed. A subsequent capture exposed a test
race: Run completion preceded the scheduler's persisted `lastRunId`. The fixture
now waits for both durable outcomes; production scheduling was unchanged. The
[failed capture record](artifacts/workspace-resource-coordination-capture-failure-2026-10-29.json)
preserves the assertion and source bindings, and points to retained raw diagnostics.

## Execution resource verification

The [unit snapshot](artifacts/execution-resource-unit-regression-2026-10-29.json)
records 296 passed tests across 42 files (237 Runtime, 59 Server) before the final
malformed-proof fixes. It is preserved unchanged. The
[final targeted regression](artifacts/execution-resource-final-regression-2026-10-29.json)
records 44 passed tests across four Server files after those fixes, including
real SQLite shutdown, two-process capacity contention and malformed evidence.
Three added cases failed on the earlier source: regular-expression coercion
accepted numeric, missing or object-valued cleanup reasons. Explicit string
validation now rejects them without freeing the resource. The first full snapshot
is not described as a rerun on this final source.

Runtime compilation, Server build and strict TypeScript checks passed. The
architecture audit has nine existing failures after removing the old browser
session violation; its model coupling budget was lowered from 180 to 135. The
public API audit retains the two existing root-export/digest failures. No budget
or historical compatibility receipt was raised or rewritten.

The physical verifier uses two actual production hosts sharing state home, real
HostDirect Guardian targets and installed native Chromium. It checks capacity one
before dispatch, release after cleanup, reuse, active-resource LRU retention,
host shutdown, and SIGKILL followed by independent target observation and durable
quarantine after reopen. HostDirect supplies no OS isolation. BrowserUse local
and cloud tasks have no live physical/provider acceptance in this capture.

The [final physical v2 receipt](artifacts/execution-resource-physical-coordination-2026-10-29-v2.json)
records 11 passed assertions and three inspected A/B/A preview screenshots, with
six source/build trees bound independently and unchanged. It observes 22 Chromium
background attempts at the local proxy, all 22 rejected. After all three proxies
close, the final destination count, successful CONNECT count and transferred
bytes are zero; model invocations are zero. This is production proxy evidence,
not a system-wide packet trace. Targets were Chromium time/account/search
background endpoints; they were not workspace asset requests.

The [first failed capture](artifacts/execution-resource-physical-coordination-2026-10-29.json.failure-ed910cc3-9893-479e-85f2-d66d075dd8fc.json)
used an incorrect total-proxy-request-equals-zero assertion; the exact attempted
targets were not returned before that helper failure. The
[first successful capture](artifacts/execution-resource-physical-coordination-2026-10-29.json)
passed the physical resource assertions but sampled network counters before
close. V2 adds final post-close accounting of every passively recorded request;
all prior receipts and raw diagnostics remain unchanged.

Run it after compiling Runtime and Server; output paths must be new:

```sh
node scripts/check-execution-resource-coordination.mjs \
  docs/artifacts/<new-physical-receipt>.json
```

## Controlled idle reclamation and rotation obligations

Rotation subscriptions now expose an internal count of active polling, persisted
refresh claims and pending approval/apply queues. Public projections continue to
omit private queue and claim state. Paused, settled subscriptions and historical
approval baselines alone no longer keep a graph resident. Pending or expired
unsettled claims and queued applies still do; pausing does not silently clear an
obligation or change apply eligibility.

The subscription worker owns manual and scheduled refresh work before claim
preparation, and keeps ownership through discovery, settlement and audit writes.
Stop rejects new refresh admission, waits for every started sibling, and preserves
persistence errors. A failed writer prevents Runtime/store disposal even after its
other siblings finish. Ordinary discovery errors still follow existing persisted
outcome semantics. A rejected manual claim that created no owned work does not
permanently pin the graph.

The [regression receipt](artifacts/rotation-reclamation-regression-2026-10-29.json)
records 38 unique passed tests in seven files. Two delayed-sibling cases fail on
the fixed earlier source because stop finishes before the sibling; the exact
same tests pass after the change. The raw red/green reports, old/restored source
hashes and unchanged fixture hashes are retained. Runtime/Server builds and strict
test TypeScript pass. Architecture retains nine failures, with the old server
subscription line allowance lowered from 919 to 909; public API retains its two
existing failures.

The [physical reclaim receipt](artifacts/workspace-resource-reclaim-2026-10-29.json)
passes ten checks using a real guarded process and native Chromium. After their
affirmative cleanup, `maxIdle: 0` retires A and the old SQLite store rejects reads.
Scoped loopback TCP HTTP then creates a new graph for A at the same custom data
root, preserving the exact seeded events. B stays in its original graph with an
active future automation schedule and queryable store. The future schedule does
not execute in this capture; due automation behavior has separate earlier
workspace evidence. Model invocations remain zero. Seven Chromium proxy attempts
are all rejected, with final zero outbound counters. All source/build/script and
screenshot hashes remain bound, and owned process cleanup completes.

```sh
node scripts/check-workspace-resource-reclaim.mjs \
  docs/artifacts/<new-reclaim-receipt>.json
```

This closes the resource-release-to-idle-reclaim boundary. It does not reconcile
quarantined execution resources after an owner restart; that requires durable
backend identity/cleanup evidence and remains unfinished.

## Retained Sandbox lifetime baseline

`node scripts/check-sandbox-execution-lifetime.mjs <new-output-path>` captures an
existing POSIX Guardian boundary. The direct target exits with code zero while
its quickly detached child remains alive. The fixture subsequently verifies the
owned child's exact script/nonce/birth identity, kills only that PID and confirms
its absence, then removes the temporary directory. The final
[source/build-bound receipt](artifacts/sandbox-execution-lifetime-final-2026-10-29.json)
records that counterexample and completed cleanup. The initial
[baseline receipt](artifacts/sandbox-execution-lifetime-baseline-2026-10-29.json)
is preserved before the verifier's exceptional cleanup was strengthened. The
final verifier was also checked with an injected post-observation assertion
failure and an existing output path; both cleaned up the owned descendant.

This is evidence about existing direct Guardian behavior, not a new regression
or an implementation of global process admission. The current Sandbox execution-slot
pool distinguishes returned handle lifetime from all descendant processes.
Launch failures need typed no-start/cleanup evidence; unknown cleanup cannot
release physical capacity merely because an owner PID died. Cross-process
capacity recovery still needs independently verifiable target/container identity
and cleanup receipts. The new handle identity and cleanup protocol is not an
automatic recovery implementation. Browser,
container and OS containment were not exercised by this baseline; network/model
requests were zero.
