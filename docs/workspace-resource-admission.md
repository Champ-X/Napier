# Workspace resource admission

The production workspace host shares a model admission ledger across all its
workspace graphs and other hosts using the same state home. Model invocations
have durable quotas and physical-call concurrency limits. Runtime reclamation
also retains unsettled model calls, workspace process sessions, and browser-task
preparation/settlement. This is a G05-B slice: global process/browser capacity and
approval/review browser acceptance remain pending.

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
These changes protect lifecycle obligations. They do not impose host-wide CPU,
RSS, subprocess, browser-session or browser-task concurrency limits.

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

## Sandbox lifetime baseline for the next capacity slice

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
or an implementation of global process admission. A future Sandbox execution-slot
pool must distinguish returned handle lifetime from all descendant processes.
Launch failures need typed no-start/cleanup evidence; unknown cleanup cannot
release physical capacity merely because an owner PID died. Cross-process
capacity recovery also needs durable target/container identities and cleanup
receipts, which generic `SandboxedProcess` does not currently expose. Browser,
container and OS containment were not exercised by this baseline; network/model
requests were zero.
