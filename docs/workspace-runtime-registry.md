# Workspace Runtime Registry

Status: G05-B infrastructure implemented and exercised with real HTTP/Runtime
integration. **The production `index.ts` and Web client still use the previous
workspace swap implementation. This is not completed multi-workspace delivery.**

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
up to 3 idle graphs, and expires idle graphs after 5 minutes; callers explicitly
invoke reclamation. Capacity pressure can reclaim an idle graph earlier. If every
resident is pinned or has background obligations, new acquisition fails with
backpressure instead of stopping existing work.

`canDispose` is an injected, synchronous policy. A production adapter must protect
Runs, scheduled work, channel delivery, recovery, workflows, browser operations,
subscription work, and execution preparation before a Run exists. Reclamation
checks the policy again after every awaited disposal. New requests for a retiring
workspace wait until disposal completes. Shutdown rejects new admission, drains
request leases, and disposes all remaining graphs. Each service's disposal must
wait for its own background executions.

`restore()` activates registered identities independently and returns per-workspace
failures. It does not silently discard registrations. A host still needs to expose
and retry unavailable/capacity-blocked background workspaces.

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

The Web client still needs explicit binding for all fetches, stream consumers,
control requests, preview URLs and HTML subresources. Frontend asynchronous work
must retain its original binding across view changes. Those changes are required
before replacing the production swap path.

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

- Replace the production swap/cache path with the registry and a complete service
  activity/obligation policy; persist startup workspace registrations and retry
  unavailable background workspaces.
- Add shared admission and budget/resource coordination across all execution
  entry points, including automation/recovery and experiments.
- Bind the Web client and generated preview/subresource addresses; verify stale
  completions, copied ledger IDs, permissions, and review state across switching.
- Run the full A/B browser scenario, process restart/recovery, and idle-resource
  acceptance before checking off G05-B. G01–G07 remain active.
