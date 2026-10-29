# Workspace Runtime Registry

Status: the production `index.ts` and Web client now use the registry. Current
HTTP/Runtime and browser evidence covers independent A/B execution, navigation,
background automation, preview resources, and reopening completed histories in a
new production process. **G05-B remains incomplete: global resource/budget
coordination and broader operation/review isolation still need acceptance.**

## Identity and ownership

`WorkspaceRuntimeIdentity` hashes the canonical workspace directory and canonical
data directory together. The machine-local SQLite catalog preserves both paths;
opening a registered workspace must not replace a custom `NAPIER_HOME` with
`<root>/.napier`. Symlink aliases resolve to the same identity. Registration rejects
a different ledger for an already registered root and reuse of a ledger by another
root. Cold activation verifies that both stored canonical paths still exist and
have not become aliases of other locations.

The catalog uses SQLite transactions, WAL and FULL synchronous writes. New catalog
files are private (0600), and the catalog holds up to 256 registrations. Runtime
ownership is claimed before preparation. Another live process using the same
catalog cannot initialize that workspace. A dead PID can be reclaimed; an unknown
process state or reused PID fails closed. Ownership is released only after the
graph is successfully disposed. A partial disposal quarantines the entry and
retains ownership. Closing the catalog itself does not release live graphs.

This is coordination among servers using the same catalog. It is not a lock against
other programs, old servers, or separately configured state directories.

## Runtime lifetime

The registry has no selected-workspace field. `acquire(workspaceId)` returns a
lease, and concurrent cold acquisitions share one preparation. Loading entries
count toward the resident bound. The default policy permits 12 residents, keeps
up to 3 idle graphs, and expires idle graphs after 5 minutes. The production host
reclaims every 30 seconds; capacity pressure can reclaim an idle graph earlier. If every
resident is pinned or has background obligations, new acquisition fails with
backpressure instead of stopping existing work.

`canDispose` is an injected, synchronous policy. The production adapter retains
queued/running Runs, active browser tasks, active/claimed schedules, active inbound
channels and pending deliveries, recovery attempts and unassessed interruptions,
and active directory/checkpoint subscriptions. Rotation subscriptions and approval
policy baselines conservatively retain their graph even while paused, because a
complete pending-apply index is not exposed. Request leases also cover execution
preparation before a Run exists. Reclamation
checks the policy again after every awaited disposal. New requests for a retiring
workspace wait until disposal completes. Shutdown rejects new admission, drains
request leases, and disposes all remaining graphs. Each service's disposal must
wait for its own background executions.

`restore()` activates registered identities independently and returns per-workspace
failures. The host exposes these at `/api/workspace/runtimes` and retries them on
maintenance ticks; it does not silently discard registrations. Recent navigation
and the catalog use the same configured state home. Workers are stopped together
and drained before the local runtime and ledger are closed.

## Request and response binding

The transport adapter accepts `/api/workspaces/<workspaceId>/<endpoint>` and an
explicit `X-Napier-Workspace-Id` header. If both are provided they must agree.
Unscoped legacy requests remain pinned to the launch identity; there is no mutable
global routing target. The outer adapter rejects non-loopback hosts before
acquiring a graph and binds the graph before interpreting thread, Run, control,
or artifact IDs. Existing endpoint paths and payload bytes are preserved inside
the immutable graph application. Responses carry the addressed workspace header,
without rewriting their evidence hashes.

Requests retain a graph through response consumption. Observer streams and
downloads release their transport pin on cancellation. POST execution SSE keeps
its pin after disconnection and drains the producer without accumulating its
output, until the finite execution stream settles. This closes the interval
between request acceptance and persistent Run creation, and lets the underlying
SSE writer progress after a page has disconnected. Background work also requires
the lifetime policy described above.

Each Web document binds once to its `?workspace=<id>` address or the first server
response. Fetches verify the response identity and retain existing content-hash
validation. Selecting another workspace opens it and navigates to a new same-origin
document. Outstanding asynchronous work from A cannot acquire B's address. The
latest selection wins if earlier opens settle later. Text/mode drafts keep their
existing synchronous localStorage persistence; image attachments retain their
existing in-memory lifetime.

Preview URLs, HTML subresource CSP, local Markdown images, browser screenshots,
and generated webhook addresses carry the workspace prefix. Explicit deep links
never scan other ledgers after a 404. Legacy thread-only links still begin in the
launch workspace; if that lookup fails, recent-workspace recovery rejects multiple
matches rather than choosing the first copied ledger. Legacy addresses cannot
disambiguate a thread already present in the launch ledger.

## Verified evidence

Run the four test files from the repository root:

```sh
npm exec -w @napier/server -- vitest run test/workspace-runtime-registry.test.ts test/workspace-runtime-http.test.ts test/workspace-runtime-owner-process.test.ts test/workspace-runtime-live-http.test.ts --maxWorkers=1
```

The 19 distinct tests cover real SQLite and filesystem identity persistence,
aliases, registration conflicts, deduplicated preparation, capacity protection,
idle eviction, disposal races/failure, shutdown draining, explicit HTTP binding,
contradictory addresses, independent SSE streams, and execution disconnection
before Run creation. An independent child process owns a workspace; the parent
cannot acquire it until the child is killed with SIGKILL, after which its custom
identity remains available.

The live integration opens an actual loopback HTTP server and two current
Napier service graphs. A deterministic hook holds A at its persisted `run.started`
event. After A's client cancels its stream, B completes through the existing
HTTP/SSE path, a stop addressed to B cannot stop A, and the same filename resolves
to distinct A/B file bytes. A's actual automation timer claims and completes a
scheduled Run while A remains held. Idle reclamation removes B while retaining A.
After A completes, both real ledgers reopen with their completed Run history and
A's settled schedule intact.

The live test uses the built-in demo model and the existing readiness-only sandbox
fixture: zero external model requests, no new OS-sandbox enforcement claim. The
timer/Runtime/SQLite/HTTP interactions are real; it is not a browser navigation
acceptance test. Its disposal predicate covers its Runs and schedules only.
Process death tests cover registry ownership, not general interrupted execution
recovery. The source-bound receipt is
[workspace-runtime-registry-2026-10-29.json](artifacts/workspace-runtime-registry-2026-10-29.json).

## Remaining G05-B integration

- Add shared admission and budget/resource coordination across all execution
  entry points, including automation/recovery and experiments.
- Extend active execution recovery evidence beyond pre-dispatch interruptions,
  including blocked/unsafe operations and the unmodified production entry.
- Replace conservative rotation retention with a complete pending-work index.
- Extend actual browser acceptance for approval/review isolation. G01–G07 remain active.

## Production and browser evidence

The additional host tests cover startup cleanup on invalid policy, explicit
state-home isolation, future automation retention, pause/reclaim/reopen, and
production HTML asset scoping. Together with registry, transport, process owner,
live HTTP, recent-workspaces and legacy root tests: 33 tests in 7 files passed.
Web API/binding/navigation tests: 157 tests in 17 files; Markdown/automation
rendering: 7 tests in 2 files. Server/Web builds and Web design contract passed.
Architecture retains 10 existing failures and public API retains its two baseline
failures; no budgets were increased or historical receipts rewritten.

Run `node scripts/check-workspace-runtime-ui.mjs <new-output-path>` after building
Server/Web. At 1440px and 320px the browser starts A, uses the sidebar to navigate
to B with an intentionally copied thread ID, submits B, rejects B's attempt to
stop A, and confirms A's automation finishes. B's HTML preview loads relative JS
under its scoped CSP; B's same-name Markdown image decodes from B. Both viewports
have zero page errors, identity mismatches, and horizontal overflow. A then
finishes, and an independent production `index.ts` process reopens both completed
ledgers with their custom data roots. HTML interaction uses a DOM button click.

The source/build-bound receipt is
[workspace-runtime-integration-2026-10-29.json](artifacts/workspace-runtime-integration-2026-10-29.json).
It includes retained user Web changes, so it is worktree evidence rather than a
clean-commit release receipt. Fixture models make zero external model requests.
The earlier foundational receipt remains unchanged and accurately describes its
then-unwired boundary.

## Multi-workspace process recovery

`node scripts/check-workspace-runtime-recovery.mjs <new-output-path>` runs a
source/build-bound SIGKILL scenario. Three custom ledgers deliberately share the
same thread ID. All three actual Runs reach persisted `run.started` in one host
process before it is killed. On restart A and B each retain the interrupted parent
and complete exactly one automatic recovery; C keeps its manual recovery policy
and creates no attempt. A second restart preserves those counts. The test verifies
each response identity, restored custom data root, workspace-specific answer, and
persisted assessment/attempt records.

The receipt is
[workspace-runtime-recovery-2026-10-29.json](artifacts/workspace-runtime-recovery-2026-10-29.json).
It records three independent child PIDs and an observed 3209 ms from SIGKILL to A/B
completion (one observation). This uses the production host and real recovery
workers with a locally injected faux provider and readiness-only sandbox. The
interruption precedes model dispatch and tool effects. It does not prove arbitrary
side-effect recovery, actual `index.ts` active recovery, Workflow or approval UI
isolation, or live-model quality. External model requests: zero.
