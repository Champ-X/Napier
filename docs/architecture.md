# Napier Architecture

## Product Thesis

Most agent products treat chat as the source of truth and bolt traces,
artifacts, and task state onto it. Napier treats an ordered evidence ledger as
the source of truth. Chat is one projection of that ledger.

This choice supports four product behaviors without separate persistence
models:

- replay and debugging;
- branching at a known sequence;
- goal evaluation against visible evidence;
- independent run evaluation over the same records users inspected.

## Layers

### Contracts

`@napier/contracts` owns serializable types shared by server and browser. The
central envelope is:

```ts
interface RunEvent {
  id: string;
  threadId: string;
  runId: string;
  seq: number;
  type: string;
  category: EventCategory;
  visibility: "user" | "debug" | "hidden";
  createdAt: string;
  payload: JsonValue;
}
```

Event types are additive. Consumers must ignore types and optional payload
fields they do not understand. A rename, category change, or required-field
removal is a versioned contract change.

### Runtime

`@napier/runtime` owns:

- Pi model registration and agent-loop execution;
- conversion from Pi events to Napier events;
- tool assembly, canonical workspace-path checks, hash-aware literal search,
  bounded TypeScript AST query/edit previews, hash-bound atomic editing with
  Hashline-style line anchors, write-linked bounded relevant-test selection,
  sandboxed structured verification, explicit-argv read-only Node command
  execution, and
  last-moment policy checks;
- configurable Model Advisor gates that combine deterministic output checks
  with an optional distinct zero-tool review model before the user-visible
  assistant message is recorded, while retaining only hash-bound candidate and
  guidance evidence;
- standard Agent Skills discovery;
- strict Agent Prompt Variable catalogs, single-pass System Prompt resolution,
  and schema-versioned hash-only Run snapshots;
- a Ledger-derived Tool Loop Guard with next-turn redirects and pre-execution
  blocking for repeated identical calls/results;
- provider-bound Model Context Envelope receipts that hash the actual Pi
  System Prompt, provider-message set, tool-name set, and tool-definition set
  without storing raw model context;
- hash-only signed Skill, Prompt, and Inspector package baselines plus local
  qualification checks;
- reviewed memory proposals, expiry, usage evidence, immutable supersession,
  atomic multi-source consolidation, scoped injection, and extraction;
- isolated subagent coordination, budgets, and lifecycle evidence;
- extension provenance, capability review, Streamable HTTP/stdio MCP tools,
  Ed25519 publisher anchors, signed package manifests, executable hashing, and
  last-moment package trust checks, dependency lockfiles, rollout channels, and
  signed channel indices;
- goal state and evidence updates;
- configuration-bound replay snapshot construction, structured run comparison,
  rubric evaluation, append-only human adjudication, evaluator calibration,
  independent reviewer consensus, workspace-wide revisioned Casebooks,
  executable evaluator qualification, evaluation-suite quality gates, and
  Ed25519 trusted receipt provenance;
- deterministic, metadata-only OpenTelemetry OTLP/JSON projection with GenAI
  semantic attributes, strict span-graph validation, and no-mutation artifact
  verification;
- hash-bound full-thread fixture construction, validation, atomic import, and
  resource-ID remapping;
- dependency-aware execution plans, artifact manifests, and internal planning
  tools;
- renewable run leases, deterministic trigger deduplication, scheduled-run
  claims, durable inbound delivery coordination, and hash-bound automatic
  recovery assessment/attempt coordination;
- revisioned Agent profile validation and credential-reference resolution;
- hash-bound Agent revision snapshots, legacy-state migration, field-level
  history, and append-only rollback;
- snapshotted parent-Run limits with turn, usage, cost, and wall-time
  enforcement;
- append-only Operator Decision request/answer/continue/cancel projection,
  terminating Pi tool integration, and linked child-Run continuation;
- predecessor-linked Agent Milestone projection with automatic same-Run Ledger
  evidence ranges and bounded next-turn context reinjection;
- a shared local bootstrap for Store, credential references, model registry,
  Extensions, Sandbox, Workspace Processes, file mutations, and Agent Runtime,
  plus shared hash-bound Run stream frame construction;
- transactional SQLite thread, run, and event persistence with legacy
  JSON/JSONL migration.

The runtime has no HTTP or React dependency.

### Product Performance Gate

Performance regression evidence stays outside the Runtime and Store domains:

```text
three fresh built CLI processes
  -> observe run.started
  -> observe first model.text.delta
  -> require hash-bound snapshot + completed done frame
  -> use medians to reduce one-off host scheduling noise
shared local Runtime
  -> measure module load and bootstrap separately
  -> execute the production read_file tool 25 times
  -> append 1,000 real events to one SQLite-backed Thread
  -> project complete Thread detail
  -> observe RSS at named checkpoints
  -> close SQLite and measure persistent ledger bytes
report
  -> derive all budget metrics from raw samples
  -> compare against the versioned local_ci_v1 limits
  -> bind samples, aggregates, checks, environment, and budget with SHA-256
  -> reproject the saved baseline during release audit
```

The runner uses only temporary workspace and data roots and removes them after
success, failure, cancellation, or timeout. CLI stdout, stderr, duration,
sample count, and process lifetime are bounded. The saved report contains
timings, byte counts, and environment identity, not prompts, model text,
workspace paths, or Ledger event bodies.

The gate measures the deterministic demo path, so first-token latency covers
local process/bootstrap/Ledger/stream/model plumbing but excludes external
Provider network latency. RSS is an observed checkpoint maximum, not a hard
resource quota. The 1,000-event profile is a release regression boundary;
extended 10,000-event, external-provider, HTTP, browser, and hard quota
profiles remain separate follow-up work.

### Architecture Growth Gate

`npm run check:architecture` parses every TypeScript production and test module
under `apps/*` and `packages/*`. The checked
`docs/architecture-budget.json` baseline enforces:

- 500 production lines and 1,000 test lines by default, with exact,
  ratchet-only overrides for existing debt;
- cyclomatic complexity 25 by default, with exact per-file overrides for
  existing complex functions;
- exact public export ceilings for Contracts, Runtime, and SDK root entries;
- no new relative-import strongly connected components;
- one-way workspace dependencies: Contracts depends on no Napier package,
  Runtime depends only on Contracts, Web depends only on Contracts, and
  Server/CLI/SDK may depend on Contracts and Runtime.

When a refactor reduces an override or removes a cycle, the gate fails until
the baseline is lowered with `npm run write:architecture-baseline`. This makes
debt reduction sticky while preventing routine checks from silently accepting
growth. The baseline currently documents legacy debt; it is not an assertion
that the allowed oversized modules or cycles are desirable.

The first ratchet extracted the branded `NapierWorkflow` and
`DefineNapierWorkflowInput` types into `packages/sdk/src/workflow.ts`. Both the
SDK root and Workflow experiment adapter now depend on that leaf module, which
removed their prior cycle while preserving the root's 22-export public
surface.

Later ratchets moved CLI execution options/runtime injection, Embedded
Workflow execution, Workspace Process event input, Workspace Patch contracts,
Subagent Outcome validation, and Sandbox terminal types into leaf modules.
The Contracts root/RPC pair then required moving its complete 133-declaration
dependency closure into five bounded execution-domain modules. The
then-current 54-module Runtime core component was subsequently reduced by
extracting the shared Event sink, MCP client SPI, and Subagent worktree
mutation model. Narrow Store ports then removed Store, Plan archive, Workflow
blueprint, and Casebook qualification from that closure. The checked graph now
temporarily contained a seven-module Evaluation component and a two-module
Receipt Trust component. Extracting Run snapshot and comparison logic from the
Thread replay facade then removed the Evaluation component.

The Channel boundary now continues through Contracts and Runtime. Its 37
public declarations live in the bounded `execution-channels.ts` domain and are
re-exported from the Contracts root without changing the semantic root symbol
set. `ChannelService` depends on an internal 12-method `ChannelStorePort`
instead of concrete `LocalStore`; the existing `InboundExecution` Runtime
export remains a compatibility alias for the SPI execution record. Architecture
budgets independently freeze the Channel contract surface and prevent the
Contracts root from regrowing.

The final Receipt Trust ratchet did not move its 58-declaration, roughly
2,181-line validator closure into another large file. `receipt-trust.ts` now
owns callback-parameterized envelope cryptography and directory primitives;
`receipt-trust-envelopes.ts` is the public receipt-kind dispatch facade; and
`receipt-trust-directory-subscriptions.ts` supplies its own bounded domain
dispatcher without a reverse facade import. Discovery policy normalization and
hashing live in a separate leaf module. The Runtime root still exposes the
same 24 Receipt Trust declarations, while the checked relative-import graph
now contains zero strongly connected components.

### Server

`@napier/server` is a thin Hono adapter:

- REST for snapshots and mutations;
- bounded, strictly parsed Thread creation, Branch creation, Goal, Resume,
  Prompt, and Trace export requests;
- bounded, strictly parsed Plan creation, step transition, and artifact
  settlement requests;
- bounded full-thread fixture import and attachment export;
- no-store, hash-addressed evaluation gate receipt export for CI with safe
  Suite ID download filenames;
- no-store evaluator calibration reports with stable content hash headers;
- no-store reviewer consensus previews plus explicit atomic resolution;
- bounded, no-store Evaluation Casebook calibration, artifact, and
  qualification-receipt export with safe Casebook ID download filenames;
- bounded, strictly parsed Run Evaluation, adjudication, reviewer ballot,
  consensus, and Evaluation Suite administration APIs;
- bounded, strictly parsed Evaluation Casebook create/update, curation,
  removal, and qualification APIs;
- bounded, strictly parsed trust-anchor administration, no-store signed
  receipt export, offline envelope verification, and qualification-baseline
  promotion;
- bounded, strictly parsed Skill, Prompt, and Inspector package signing,
  verification, and qualification APIs backed by Extension publisher anchors,
  plus reviewed Skill content preview/apply writes with hash-only audit
  evidence;
- bounded, strictly parsed signed Extension package signing/download, offline
  verification, trusted import, reviewed update and dependency-set deployment
  preview/apply, publisher-anchor administration, lockfile export/verify,
  rollout preview/apply, signed channel-index export/verify, and hash-only
  audit events;
- bounded, strictly parsed MCP Extension proposal, trust review, enablement,
  connection, and tool review administration;
- no-store Thread/Run OTLP trace export and verification with source/content
  digest headers and hash-only Ledger evidence;
- SSE for live run frames;
- bounded, strictly parsed schedule and inbound-channel administration;
- bounded, strictly parsed Memory proposal/review and credential-reference
  administration;
- bounded, strictly parsed Agent profile update and rollback administration;
- bounded, strictly parsed Operator Decision list, answer, cancel, and SSE
  continuation APIs;
- no-store, body-hash-bound Agent Milestone list projection;
- adapter-normalized authenticated webhook ingestion and background schedule,
  channel, and safe recovery workers;
- same-origin static hosting for production;
- provider secret values remain process-local and are never serialized.

The Server is being split by HTTP domain without introducing domain-specific
state or execution loops. `memory-http.ts` owns Memory request parsing, routes,
Ledger event projection, and response evidence behind a six-method Store SPI.
`http-request-body.ts` owns bounded streaming body reads, while
`http-response-evidence.ts` owns shared content hashes and structured JSON error
evidence. `app.ts` remains the composition root and registers the domain
adapter against the same `LocalStore`; Memory behavior and API compatibility
continue to be proven by the existing end-to-end Server tests.
Management OpenAPI generation recursively discovers TypeScript modules under
`apps/server/src` that declare `/api/*` Hono routes, so extracting another
domain cannot silently remove its endpoints from the generated protocol or
release artifact source hash.

Credential management HTTP now lives in `credential-http.ts`, with exact
request normalization in the leaf `credential-http-validation.ts`.
`http-request-validation.ts` centralizes exact-record, bounded-text, and Thread
ID checks shared with the composition root. The route adapter depends only on
narrow `LocalStore` methods, `ModelRegistry`, `CredentialReferenceStore`, and
the shared bounded-body/hash-response infrastructure; `app.ts` remains the
composition root. Environment and macOS Keychain creation, availability
checks, status transitions, no-store evidence headers, and credential Ledger
events retain their existing wire semantics. This extraction reduced `app.ts`
from 26,869 to 26,438 lines.

Schedule and Agent Profile management follow the same boundary.
`schedule-http.ts` owns create/list/update routes and automation Ledger events;
`agent-profile-http.ts` owns update/revision/rollback routes and hash-bound
profile evidence. Their leaf validation modules reject unknown fields and
normalize the complete request surfaces. Shared prompt/model parsing lives in
`http-request-validation.ts`, while `model-http-availability.ts` supplies one
narrow configured-model check to the composition root and extracted domains.
The routes retain existing `AutomationService` tick/lease semantics and Agent
profile revision/rollback behavior. `app.ts` decreased again to 25,465 lines
and its maximum function complexity fell from 63 to 53, while all 255 generated
operations and 244/244 compatibility fixtures remain unchanged.

Thread evidence now follows a dedicated boundary as well.
`thread-evidence-http.ts` owns event projection, portable fixture verification,
Run replay, comparison, and OTLP trace routes; separate Replay and Trace
response modules retain every hash, range, metric, redaction, and path-binding
header. Generic JSON-byte, event-boundary, filename, and Run-metric helpers now
live in `http-response-evidence.ts`. OTLP generation depends only on a
`getDetail` Store port instead of concrete `LocalStore`. The extraction reduced
`app.ts` to 24,600 lines without changing the 255-operation route set or
244/244 compatibility fixture.

Inbound Channel is now a complete Server domain rather than composition-root
logic. Separate admin, delivery, dead-letter, and ingress route adapters depend
on narrow Store, model-resolution, and `ChannelService` ports. Leaf catalog,
message-builder, normalizer, authentication, qualification, validation,
response, and Ledger-event modules retain one adapter catalog and event
vocabulary across every entry point. Fresh signed DeepSeek dogfood proved HMAC
admission, one completed delivery, duplicate suppression, qualified evidence,
valid dead-letter export/preview/history, hash-only Channel events, and zero
API-key persistence. `app.ts` decreased to 22,437 lines while the 255-operation
route set and 244/244 compatibility fixture remained unchanged.

Thread lifecycle HTTP now has the same domain boundary.
`thread-lifecycle-http.ts` owns Thread get/create/import and Goal set/clear
routes behind a seven-method Store SPI; it reuses the sole `LocalStore`, shared
bounded-body/error infrastructure, and Runtime Replay/Goal implementations.
`thread-lifecycle-http-validation.ts` preserves exact title, Agent ID, Replay
wrapper, objective, and continuation semantics.
`thread-lifecycle-http-response.ts` owns the no-store detail projection and
import-provenance/receipt headers, which branch creation continues to reuse.
The composition root now only registers the adapter, decreasing `app.ts` to
22,120 lines. The generated contract remains 255 routes with the same route-set
digest and all 244 compatibility operations.

Thread-scoped operational evidence follows an adjacent boundary.
`thread-operations-http.ts` owns Subagent outcome verify/review, automatic
Recovery projection, and Workspace Trash list/restore behind a five-member
Store port plus the existing model catalog and file-mutation manager.
Leaf validation preserves exact reviewer `ModelRef` and Trash ID grammar;
the response module retains stable outcome hashes, review usage, recovery
counts, and body-bound file evidence. No execution or state moved out of the
Runtime. This extraction reduces `app.ts` again to 21,887 lines while the
route set and compatibility baseline remain unchanged.

Thread control HTTP is separated from execution streaming.
`thread-control-http.ts` owns Ledger branch creation, Run control-message
inbox, Operator Decision list/answer/cancel, and Agent Milestone projection.
Validation and response modules retain all request byte bounds, state/error
mapping, stable hashes, count headers, and exact-record semantics.
`createThreadBranch` now consumes a seven-method Store port rather than
`LocalStore`; the Server adapter composes it with only the control methods it
uses. Operator continuation and prompt/stop/resume SSE remain in the execution
boundary. This extraction lowers `app.ts` to 21,377 lines without changing the
255-route or 244-operation contracts.

Thread execution streaming now has its own stateless HTTP boundary.
`thread-execution-http.ts` owns Operator Decision continuation, explicit stop,
manual resume, prompt submission, and their shared event/snapshot/done/error
SSE framing. It depends only on `getDetail`, model availability, and the four
corresponding `AgentRuntime` methods; the Runtime remains the sole owner of Run
creation, execution, cancellation, recovery, and Ledger settlement. Leaf
validation and response modules preserve exact request bounds, model headers,
stop receipts, and hash-only stream diagnostics. The composition root only
registers this adapter, lowering `app.ts` to 21,077 lines and preserving the
255-route and 244-operation contracts.

Workflow and controlled-experiment route registration follows the same
composition boundary. `thread-workflow-http.ts` owns the nine Workflow, Agent
message, model invocation, tool invocation, and Workflow experiment route
bindings plus their shared bounded-body/error adapter. The five existing HTTP
execution modules retain all preview, execution, ordered-event, cancellation,
snapshot, and result framing behavior. They now depend on one shared
`getThread`/`getDetail` Store port instead of concrete `LocalStore`; the
composition root only registers the adapter. This lowers `app.ts` to 20,975
lines without changing the 255-route or 244-operation contracts.

Plan lifecycle HTTP now follows a bounded domain boundary.
`plan-lifecycle-http.ts` owns Plan list/create, replan, independent replan-draft
review, Archive/Blueprint export, and both verification routes behind a
eight-method Store port plus the existing model registry. Separate validation
and response modules preserve exact nested request bounds, Plan Ledger event
payloads, model availability, portable evidence binding, download filenames,
and every response hash/count header. Blueprint library, step transition, and
Artifact operations remain separate follow-up domains. This extraction lowers
`app.ts` to 20,130 lines while preserving the generated contracts and the sole
Runtime/Store implementations.

Thread Evaluation projections now use a dedicated read-only HTTP boundary.
`thread-evaluation-http.ts` owns Evaluation and Adjudication lists plus
Evaluation and Context Checkpoint calibration behind a five-method Store port;
its response module preserves body/stable hashes and all count headers. This
lowers `app.ts` to 19,987 lines without changing the 255-route contract.

Workspace-global Evaluation Casebook and Thread-local Evaluation Suite
projections use `evaluation-catalog-http.ts`. Its eleven-method read-only Store
port covers ten list/detail/calibration/export,
qualification, baseline, gate-receipt, and execution routes. Response helpers
remain injected from the composition root, preserving every body hash, count,
download, and receipt header. Signed receipt, baseline promotion, curation,
Suite mutation, and execution routes remain explicit mutation domains. This
lowers `app.ts` to 19,895 lines while preserving all 255 routes and 244
compatibility operations.

Evaluation Casebook mutation validation now lives in
`evaluation-casebook-http-validation.ts`. It owns exact-object create, update,
curation, removal, and qualification parsing, including name/description and
qualification-gate bounds, with dedicated malformed-input tests. This lowers
`app.ts` to 19,758 lines. `evaluation-admin-http-response.ts` owns the shared
Casebook/Suite mutation projections and qualification/Suite execution headers
on top of the common evidence-header primitives, lowering `app.ts` further to
19,655 lines. `evaluation-casebook-admin-http.ts` now owns all five Casebook
create/update/curate/remove/qualify routes behind a six-method Store port,
Model Registry, and execute-only Qualification service. It preserves revision
event types, 200/201 curation semantics, model validation, conflict handling,
and bounded-body errors while lowering `app.ts` to 19,439 lines.

Run Evaluation and Evaluation Suite requests now share
`evaluation-http-validation.ts` for exact Run IDs, distinct baseline/candidate
sets, bounded rubric criteria, optional model refs, and Suite gates.
Create/update Suite semantics remain identical, with validation complexity
split below the per-function budget. This lowers `app.ts` to 19,197 lines.

`evaluation-suite-admin-http.ts` owns Suite create/update/execute behind a
four-method Store port, Model Registry, and execute-only Suite service.
Revision event emission, Thread ownership, model availability, response
headers, and bounded-body errors are unchanged. This lowers `app.ts` to 19,061
lines and completes the Casebook/Suite administration split.

Evaluation adjudication, reviewer ballot, and consensus gate requests use
`evaluation-review-http-validation.ts`. It preserves the distinct normalized
adjudication-note and raw ballot-note contracts, exact reviewer identity and
verdict bounds, and consensus quorum/rate limits. Dedicated malformed-input
tests lower `app.ts` to 18,950 lines before the review routes move.
`evaluation-review-http-response.ts` owns adjudication, ballot, consensus
preview, and resolution list/result evidence headers on shared hash
primitives, lowering `app.ts` to 18,803 lines.
`evaluation-review-http.ts` owns all six adjudication, ballot, consensus
preview/resolve, and resolution-history routes behind a nine-method Store port.
Ledger event payloads, idempotent 200/201 behavior, 404/409 errors, and every
response hash remain unchanged. This lowers `app.ts` to 18,534 lines.
Run Evaluation creation uses `run-evaluation-http.ts` with a two-method
Thread/Agent Store port, Model Registry, and evaluate-only service. Its record
headers now live beside the read projections in
`thread-evaluation-http-response.ts`, lowering `app.ts` to 18,463 lines.
Plan Artifact drift inspection and text preview use
`plan-artifact-inspection-http.ts` behind a three-capability Store port:
workspace root, Plan lookup, and Ledger append. Their hash-only event payloads,
body hashes, receipt headers, and Artifact evidence headers are owned by
`plan-artifact-http-response.ts`; the reusable Ledger event receipt projection
now lives with the common HTTP evidence primitives. This lowers `app.ts` to
18,225 lines without changing the 255-route contract.
File export/verification, directory manifest/verification, and data
profile/verification now use three additional Plan Artifact HTTP modules on
the same three-capability Store port. Data and directory verification modules
own strict request parsing, portable digest recomputation, ordered diagnostics,
and hash-only Ledger event projections. Shared response helpers preserve binary
download, body/stable hash, Artifact identity, count, and receipt headers.
This completes the Plan Artifact inspection/verification boundary and lowers
`app.ts` to 16,894 lines.
Plan step transitions and Artifact lifecycle updates use
`plan-progress-http.ts` behind a five-capability Store port. Its dedicated
validation module preserves raw bounded evidence text, exact action/status
sets, Run ID bounds, and server-observed verification rules. Runtime remains
authoritative for Run ownership, revision changes, workspace drift, and Plan
projection updates; the adapter retains the existing hash-only lifecycle
events and response headers. This lowers `app.ts` to 16,645 lines.
Plan Blueprint Library list, save/reuse, qualification, status, and selection
use `plan-blueprint-library-http.ts` behind a seven-method Store port.
Dedicated validation preserves raw save metadata, normalized selection
objectives, policy-template bounds, and exact status requests. Its response
module owns Record, qualification, save, and selection evidence headers while
exporting the shared Record metadata projections used by record-based Plan
creation. This lowers `app.ts` to 16,110 lines.
Direct Blueprint instantiation plus preview-bound Blueprint Record
instantiation use `plan-blueprint-instantiation-http.ts` behind a five-method
Store port. Separate validation and response modules preserve raw objective
text, exact preview digest binding, portable Blueprint verification,
Plan-created Ledger events, replay-event hashes, and all source/qualification
headers. This lowers `app.ts` to 15,810 lines.
Blueprint Record replay history, replay outcomes, and single-event
verification use `plan-blueprint-replay-http.ts` behind a six-method Store
port. Separate validation and response modules preserve exact portable
artifact requests, Record prechecks, body bounds, stable content hashes,
ordered diagnostics, count headers, and observed-versus-declared evidence.
This lowers `app.ts` to 15,282 lines while leaving model review and baseline
promotion in a separate outcome-governance boundary.
Blueprint Record outcome review, baseline promotion, baseline listing, and
qualification use `plan-blueprint-outcome-http.ts` behind a six-method Store
port. The Runtime reviewer itself accepts a four-method read port instead of
the concrete Store. Dedicated validation and response modules preserve model
availability checks, exact criteria and policy bounds, review-gate
requirements, conflict semantics, stable review hashes, baseline metadata,
and current-outcome qualification evidence. This lowers `app.ts` to 14,616
lines.
Blueprint Record preview binding, Ledger-event replay projection, replay
history aggregation, and current Plan outcome aggregation use
`execution-plan-blueprint-replay-projection.ts`. These pure functions consume
only Contracts and Plan/Event values; `LocalStore` retains state traversal and
persistence orchestration. `store-hashing.ts` centralizes the Store's existing
locale-key canonical JSON and SHA-256 byte semantics so portable verifier
digests do not silently change. This lowers `store.ts` from 15,918 to 15,575
lines.
Portable replay-history, replay-outcome, and single-event verification use
`execution-plan-blueprint-replay-verification.ts`. The verifier owns exact
shape guards, stable diagnostic ordering, declared-versus-observed evidence,
and event identity/hash binding while Store supplies only the current
projection or bounded event list. This lowers `store.ts` further to 15,298
lines.
Outcome baseline defaults, bounded policy/review-gate normalization, ordered
policy diagnostics, and qualification projection use
`execution-plan-blueprint-outcome-policy.ts`. Store retains baseline
persistence and model-review evidence binding while the pure policy module
owns reusable qualification semantics. This lowers `store.ts` to 15,160
lines.
Outcome baseline creation and persisted-record validation use
`execution-plan-blueprint-outcome-baseline.ts`. Its core and reviewed-evidence
validators are independently bounded, while the shared evidence type keeps
Store's model-review binding explicit. This lowers `store.ts` to 15,031 lines
without changing baseline hashes or normalized persisted shapes.
Outcome review artifact validation and promotion evidence binding use
`execution-plan-blueprint-outcome-review-evidence.ts`. Separate identity,
outcome, qualification, gate, and hash predicates preserve ordered fail-closed
diagnostics without carrying Store state. This lowers `store.ts` to 14,860
lines.
Automatic Recovery attempt construction, claim reissue, terminal Run
settlement, chain-root validation, public secret stripping, and bounded error
normalization use `automatic-recovery-store-records.ts`. The module preserves
the Store's existing claim-token digest and attempt hash semantics;
`LocalStore` still owns SQLite revision CAS, state queues, event access, and
persistence. This lowers `store.ts` to 14,699 lines without changing Recovery
Service or Replay behavior.
Automatic Recovery candidate ordering, expired-claim takeover, root-chain
assessment, deferral, and new claim creation use
`automatic-recovery-store-claims.ts`. The coordinator mutates only the
Store-owned recovery arrays and returns an explicit `changed` flag;
`LocalStore` validates public inputs, supplies Ledger events and random claim
tokens, runs the coordinator inside its state queue, and persists once. This
lowers `store.ts` further to 14,556 lines.
Automatic Recovery claim renewal, child-Run binding, terminal settlement, and
pre-Run abandonment use `automatic-recovery-store-mutations.ts`. Each
transition receives the Store's constant-time token verifier, mutates only the
matching attempt record, and returns its public projection; the surrounding
Store queue remains the transaction and persistence boundary. This lowers
`store.ts` to 14,473 lines.

Disconnecting an SSE client does not cancel a run. Runs are durable operations;
explicit cancellation uses the stop endpoint.

The repository-only `npm run dev` wrapper loads an optional root `.env` in its
Node parent before starting Server and Web through `concurrently`. Both
development children inherit the same environment; secret values are not
copied into command arguments or generated files. Installed CLI and production
Server processes continue to use their inherited deployment environment.
Provider use remains gated by an explicit persisted credential locator.

### CLI

`@napier/cli` is an Experience Plane adapter over the same local Runtime and
Ledger as the Server. `napier run` canonicalizes an explicit workspace, opens
an explicit or workspace-default data root, creates a Thread or verifies a
selected existing Thread, and calls `AgentRuntime.runPrompt()`. `napier
resume` selects a waiting Thread plus an optional interrupted Run and calls
`AgentRuntime.resumeInterruptedRun()`. Both commands share one invocation,
streaming, cancellation, and shutdown path; neither implements a second
model/tool loop or talks directly to Store for Run execution.

`napier doctor` is a deliberately Store-free preflight command rather than an
Agent Run. It canonicalizes the workspace without creating a data root, checks
Node/runtime components and optional installed-model/credential-environment
presence, and, unless `--offline` is selected, runs bounded real
`WebSearchProviderRegistry`, `RunWebFetchSourceManager`, and
`RunBrowserSessionManager` probes plus a network-denied OS Sandbox process.
One total timeout/cancellation signal bounds every check. Browser and Fetch
ephemeral state settles before return.

`doctor-report.ts` owns the hash-bound `ready | degraded | blocked` report and
human rendering. `doctor-probes.ts` maps failures to fixed recovery codes such
as `credential_missing`, `search_unavailable`, `browser_missing`, and
`sandbox_unavailable`; it never copies raw exceptions. The report retains only
bounded status, duration, counts, known provider/adapter identifiers, numeric
network/content evidence, executable/workspace/credential-locator hashes, and
the selected public ModelRef. Workspace paths, credential variable names and
values, URLs, response bodies, Browser page text, process output, and raw
diagnostics remain absent. Required-check failure returns exit 1; skipped or
non-required warnings return exit 0 with `degraded`.

Capability presets are deterministic projections over the existing revisioned
`AgentProfile`; they are not a second authority model or persistence store:

```text
shared @napier/contracts/agent-capabilities catalog
  -> coding / research / data / browser / safe_automation
  -> exact toolPolicy + enabledTools + enabledSkills + enabledSubagents
  -> shared status projection with human permission labels
napier capabilities
  -> status reads the selected Agent; no model call and no profile mutation
  -> preview overlays a preset in memory; revision remains unchanged
  -> --apply calls LocalStore.updateAgent with the exact projection
  -> ordinary validation, semantic no-op behavior, and immutable history apply
napier run/chat/tui --preset <id>
  -> strict CLI parsing accepts only the five shared preset IDs
  -> AgentRuntime overlays the selected preset on the requested Agent revision
  -> LocalStore fingerprints the effective policy/tools/Skills/Subagents
  -> run.started records the preset ID beside the configuration SHA-256
  -> the stored Agent profile and immutable revision history remain unchanged
Chat/TUI /status
  -> resolve the current Thread Agent or requested default Agent
  -> overlay the process preset, when present, and render effective Run truth
Web
  -> composer badge renders the same projection
  -> Context preset selector fills existing form fields only
  -> Save Agent profile uses the existing HTTP validation/revision path
```

The shared catalog is published as the narrow
`@napier/contracts/agent-capabilities` subpath; the 7,025-line Contracts root
barrel remains unchanged. CLI option parsing and first-use dispatch occupy leaf
modules, reducing `cli-options.ts` from 555 to 518 lines and maximum complexity
from 31 to 22 while keeping `cli.ts` at 682 lines. Web capability status and
preset controls are leaf components, reducing `App.tsx` to 1,082 lines and
maximum complexity 60, and `ContextPanel.tsx` to 3,537 lines.

Presets are convenience, not escalation. None sets `unrestricted`; the Browser
preset remains `observe` and reports Browser read available but interaction
unavailable. Coding and Safe Automation use `workspace`, so they can use
preview-bound workspace writes and sandboxed process tools while Browser
interaction remains denied. Raw custom profile editing remains available and
is truthfully labeled `Custom`. Doctor remains the separate source of truth for
live model, network, Browser, and Sandbox readiness.

Temporary presets are admitted only for standard `user` Runs. Recovery,
schedules, channels, Workflows, and model/tool/Agent experiments fail closed if
a preset is supplied. Resume intentionally has no `--preset` option.
Operator-decision continuations resolve the origin preset from durable
`run.started` evidence and Store rechecks exact revision, model, policy, tools,
Skills, and Subagents against the origin fingerprint before creating the
linked Run. Preset identity remains evidence metadata rather than a second Run
configuration schema; the existing fingerprint already freezes the effective
authority.

For a first live CLI task, `run`, `chat`, and `tui`
`--credential-env <variable>` require an explicit non-demo `--model`, validate
the environment name and current value, then create or re-enable only the
matching Provider locator before Thread creation or model execution. All three
commands call the same credential preflight. An existing matching active
locator is reused; a different active locator fails closed without creating a
task Thread or calling the model. Interactive `/model` changes do not
implicitly bootstrap another locator. The repository `npm run napier` wrapper
uses Node's optional `.env` loading, while an installed binary continues to use
its inherited shell environment. In both paths the raw credential remains
outside arguments, Store, Ledger, and output.

`napier chat` is the line-oriented interactive adapter. It keeps one
`LocalAgentRuntime` open and delegates every prompt and interrupted-Run
continuation to `EmbeddedAgentService`. The returned Thread ID becomes the next
turn's explicit input; `/model`, `/thread`, `/new`, `/resume`, `/status`,
`/help`, and `/exit` only update bounded session state or invoke that service.
`interactive-command-model.ts` owns these rules for both terminal adapters;
`/clear` is accepted only by TUI and changes no Ledger evidence. Slash commands
are never evaluated as shell input, and neither adapter has direct Store
access. `cli-chat-options.ts` owns the shared command-line contract while
`cli-option-values.ts` centralizes resource, model, timeout, and required-value
validation shared with the existing one-shot parsers.

Chat requires TTY stdin and rejects `--jsonl`. It creates and prefetches the
readline iterator before emitting the ready line, so input pasted at that
freshness boundary cannot be lost while the prompt is still flushing.
Non-redacted `model.text.delta` values stream to stdout with backpressure; when
no delta is available, the exact returned Run's assistant message is written
once. C0/C1 terminal controls and dangerous bidirectional-formatting characters
are projected as visible `\uXXXX` text, leaving the Ledger value unchanged while
preventing model output from issuing ANSI/OSC terminal commands. Stderr receives
the prompt, metadata-only tool lifecycle cards, waiting notices, and bounded Run
status. Tool arguments, results, and internal errors are not rendered. A broken
output channel aborts the whole chat session instead of being mistaken for a
failed Agent turn. A pre-aborted parent fails before Runtime bootstrap.

`napier tui` is the full-screen local adapter over that same
`EmbeddedAgentService`. It rejects non-TTY stdin/stdout and missing raw-mode
support before Runtime bootstrap, then owns only bounded live projection state:
recent user/assistant text, body-free tool cards, current Thread/model/Run,
operator-waiting status, viewport offset, input history, and one latest pending
frame. It never owns a Run, Agent loop, retry rule, tool executor, or durable
Thread state. Prompts and interrupted-Run resume flow through the same service
and event sink as chat, so Web, Replay, SDK, HTTP, and RPC inspect the identical
Ledger evidence.

`tui-input.ts` decodes split UTF-8 and fixed key sequences, bracketed paste,
cursor editing, history, scrolling, idle exit, and active cancellation under a
64 KiB prompt bound. `tui-terminal.ts` reflows a bounded frame for dimensions
clamped to 20-400 columns and 5-200 rows. A slow output can hold at most one
write in progress plus one coalesced latest frame. Dynamic values pass through
the shared terminal-safe text layer: C0/C1, ANSI/OSC/DCS introducers, tab, and
bidirectional controls become visible text, while tool arguments/results,
diagnostics, credentials, hidden messages, and raw event JSON are not selected
for rendering. Only fixed adapter-owned CSI sequences enter alternate screen,
style the frame, control bracketed paste, and restore the cursor and prior
screen.

Raw mode and terminal controls are restored after normal exit, EOF, idle
interrupt, parent termination, bootstrap failure, timeout, and active
cancellation. Runtime shutdown and active-Run settlement happen before final
terminal restoration. Shared writes settle from the actual Writable callback
plus error/close events, so a destroyed output stream cannot strand cleanup
waiting for a `drain` that will never arrive. If restoration cannot be
confirmed because stdout is already destroyed, TUI still restores raw mode,
cancels work, closes Runtime services, and exits non-zero.

`napier branch` and the HTTP Branch route share
`createThreadBranch()`, a Runtime domain service rather than duplicating
materialization inside either Experience Plane adapter. It validates an exact
existing source sequence, resolves `parentRunId` from the last source Run with
evidence at or before that sequence, creates a leased materialization Run,
records `branch.created`, and copies only the visible message events. Imported
provenance is retained with the branch-local historical cutoff. A future,
missing, zero, or unsafe-integer sequence is rejected before Thread creation.
The resulting Thread is ordinary Runtime input and can be continued through
`napier run --thread`; branch creation itself invokes no model or tool.

The Server and CLI both construct local services through
`createLocalAgentRuntime()`. That bootstrap owns initialization and idempotent
shutdown ordering for SQLite, MCP transports, Process Sessions, file mutation
state, Sandbox, credentials, models, and the Agent Runtime. Server-only
evaluation, automation, channel, and recovery services remain layered above
it.

Human mode writes the final assistant message to stdout and a bounded status
line to stderr; branch human mode instead writes the new Thread ID to stdout
and its bounded source lineage to stderr. `--jsonl` writes the shared
`StreamFrame` contract as one JSON object per line: zero or more event frames,
then a final snapshot and terminal done frame. Branch JSONL starts at sequence
one and includes its complete materialized Ledger; run/resume JSONL streams the
events appended by that invocation. HTTP SSE and CLI JSONL use the same event,
snapshot, done, and error constructors, including event/snapshot/event-stream
hashes and the terminal-status guard. JSONL writes await stdout backpressure.
Invalid preflight input and bootstrap failures produce only the stable public
error frame and a diagnostic hash; raw provider, credential, Sandbox, and tool
errors are not written.

Model and tool callbacks may complete concurrently even though SQLite assigns
one authoritative Ledger sequence. The CLI buffers event frames by `seq`,
writes only the contiguous prefix, and verifies the final sequence before the
snapshot. Out-of-order arrivals remain live-streamed once their gap closes;
missing, duplicate, or cross-Thread sequences fail closed.

Resume startup first runs normal Store reconciliation, so an abandoned
running Run becomes immutable `interrupted` evidence before CLI selection.
The continuation is a new `source=recovery` child bound by `parentRunId`; the
recovery prompt is derived from bounded durable evidence and explicitly treats
unfinished side effects as unknown. `--run` can pin one interrupted parent,
otherwise the latest is selected. A non-waiting Thread, missing parent, second
concurrent resume, timeout, or cancellation fails or settles through the same
Run lease and terminal frame rules as Web/SSE recovery.

For one-shot commands, timeout, SIGINT, and SIGTERM flow into the active
Runtime AbortSignal. Chat gives every turn and resume attempt an independent
timeout: a timed-out Run settles through normal cancellation evidence and the
session remains open. The first active `SIGINT` cancels only that Run; an idle
`SIGINT` exits with status 130. EOF exits normally, while parent termination
aborts the session and active Run. All paths settle Napier-owned Process
Sessions and MCP transports before closing SQLite; they do not kill unrelated
workspace processes or delete state. Environment credentials remain
unavailable unless the selected data root already contains an active
credential reference. The terminal adapters do not yet provide ACP or Desktop
packaging. Thread branching is durable message-history
materialization; it is not controlled model/tool re-execution, dependency
substitution, or side-effect simulation.

### Local stdio JSON-RPC

`napier rpc` keeps one `LocalAgentRuntime` open for a local parent process and
uses the same `EmbeddedAgentService` and `EmbeddedWorkflowService` as the
TypeScript SDK:

```text
parent process starts napier rpc with canonical workspace/data roots
  -> initialize JSON-RPC protocol version 1
  -> napier/agent/run, napier/agent/resume,
     napier/agent/experiment/preview,
     napier/agent/experiment/run,
     napier/model/experiment/preview,
     napier/model/experiment/run,
     napier/tool/experiment/preview,
     napier/tool/experiment/run,
     napier/workflow/run, napier/workflow/resume,
     napier/workflow/answer,
     napier/workflow/experiment/preview,
     or napier/workflow/experiment/run
  -> Embedded Agent/Workflow or Workflow Experiment preflight
  -> existing AgentRuntime, WorkflowRuntime, or ExperimentRuntime
     + policy + Sandbox + Work Ledger
  -> napier/event notification with request ID + shared event SHA-256
  -> terminal Agent or Workflow execution response
$/cancelRequest, EOF, SIGINT, SIGTERM, or exit
  -> abort the owning request or server lifetime
  -> await terminal Run evidence
  -> settle Process/MCP services and close SQLite
```

The serializable protocol types live in `@napier/contracts`.
`rpc-protocol.ts` owns shared strict message/parameter validation and stable
public errors; `rpc-agent-message-experiments.ts` and
`rpc-model-invocation-experiments.ts`,
`rpc-tool-invocation-experiments.ts`, and `rpc-workflow-experiments.ts` own
bounded experiment request adaptation without expanding that near-limit
module; `rpc-transport.ts` owns bounded UTF-8 line framing and serialized
backpressure-aware output; `rpc-invocations.ts` adapts public methods to
Runtime services; `rpc-server.ts` owns initialization, request admission,
cancellation, and lifecycle state. No RPC code reads Store or implements an
Agent, Workflow, or experiment loop.

Input is line-delimited JSON-RPC 2.0, capped at 1 MiB per line and four active
Agent, Workflow, or experiment requests. Request IDs are bounded strings or
non-negative safe integers. Unknown fields, malformed ModelRefs/resource IDs,
invalid or tampered Workflow Manifests, Schema-invalid Workflow input, stale
or mismatched Approval decisions, missing or stale experiment preview hashes,
duplicate active IDs, pre-initialize calls, unknown methods, over-capacity
calls, and post-shutdown calls fail before unsafe Runtime mutation. Experiment
execution reprojects source evidence and preserves the existing explicit
confirmation barrier for historical write or unknown tool effects. Internal
failures expose only a stable JSON-RPC message and diagnostic SHA-256. Ledger
event notifications and terminal task results are intentional client-visible
data. A stdout failure aborts the server lifetime and active Runs rather than
being treated as an ignorable disconnected observer.
Cancellation before experiment target settlement returns the standard
JSON-RPC cancellation error. If the Experiment Runtime has already produced a
durable cancelled result, RPC returns that result instead so the caller retains
the candidate Manifest and target Thread/Plan required for explicit retry.

The process opens no network listener and accepts no transport credential. It
inherits the selected local data root's existing credential references and
tool policy, so stdio does not elevate the Agent or Workflow. RPC supports
Agent and typed Workflow run/resume, explicit blocked-node retry,
freshness-bound Approval answer-and-resume, preview-bound Workflow checkpoint
experiments, read-only Agent message experiments, isolated model calls, and
single built-in read-only tool calls. SDK and RPC call the existing
interface-neutral experiment runtimes; they do not recreate source projection,
Branch materialization, tool resolution, reuse, comparison, or confirmation
logic. Approval deduction and
evidence validation live in split `embedded-workflow-approvals.ts`; CLI, SDK,
and RPC reuse that service rather than reading Store independently. Remote
transport/authentication, client reconnection, ACP, and Desktop packaging
remain explicit gaps.

### Executable Plan Workflows

The first Workflow vertical slice evolves the existing Blueprint and Plan
domains instead of adding a second scheduler or state database:

```text
ExecutionPlanBlueprint
  -> defineExecutionPlanWorkflow()
  -> hash-bound napier.execution-plan-workflow manifest
  -> existing ExecutionPlan projection
  -> source=workflow Run per ready Agent, Deterministic, Tool, Map, Loop, Reduce, or Approval node
  -> strict typed node result
  -> workspace Artifact digest settlement
  -> existing Plan transition and Work Ledger
```

`workflow-manifests.ts` validates the stable manifest and its Blueprint
binding. `workflow-schemas.ts` owns the bounded JSON Schema subset and runtime
value validation. `workflow-runtime.ts` owns scheduling and node state
transitions. `workflow-tool-node.ts` coordinates Tool-node Plan state and
timeouts; `workflow-tool-runtime.ts` owns leased direct execution; and
`stateless-agent-tools.ts` is the shared Agent/Workflow built-in catalog.
`workflow-approval-node.ts` owns Approval Plan/recovery state,
`workflow-approval-runtime.ts` owns leased request/continuation Runs, and
`workflow-approval-model.ts` is the pure answer-to-output contract.
`workflow-deterministic-model.ts` validates and resolves pure templates,
`workflow-deterministic-runtime.ts` owns the leased model-free Run,
`workflow-deterministic-node.ts` coordinates Plan transitions, and
`workflow-deterministic-evidence.ts` verifies terminal evidence without
growing the central Ledger coordinator. The deterministic model also owns the
root multi-way Switch contract and evaluator so routing does not enter the
scheduler or Manifest coordinator.
`workflow-loop-node.ts` coordinates Loop Plan state and whole-node timeout;
`workflow-loop-runtime.ts` owns the leased coordinator;
`workflow-loop-iteration-runtime.ts` owns sequential read-only Agent turns;
and `workflow-loop-model.ts` plus `workflow-loop-evidence.ts` define typed
feedback, termination, checkpoint reconstruction, and fail-closed recovery.
`workflow-artifact-settlement.ts` owns terminal file/directory inspection,
Plan Artifact transitions, commit-gap repair, cancellation boundaries, and
body-free aggregate evidence instead of adding that logic to Store or Server.
`workflow-breakpoint-model.ts` owns the bounded canonical breakpoint set, and
`workflow-breakpoints.ts` owns reach/continue evidence and open-breakpoint
recovery without adding scheduler state to Store.
`workflow-experiment-mode.ts` independently projects the experiment rerun,
immediate execution, and stop-before sets from one source Manifest, keeping
single-node scheduling policy out of source-evidence reconstruction.
`workflow-result.ts` owns result hashing, terminal-event settlement, and
Thread-status projection, keeping those concerns out of the oversized
scheduler.
`workflow-condition-model.ts` validates and evaluates typed equality guards,
while `workflow-condition-node.ts` owns the no-Run Plan skip transition.
`workflow-ledger.ts` and `workflow-recovery.ts` own durable evidence
reconstruction. `workflow-protocol.ts` validates HTTP/CLI requests, typed
results, and final snapshot/event-stream-bound result frames.
`workflow-parallel-scheduler.ts` owns ready-batch selection, per-node context
snapshots, Approval exclusivity, and batch abort propagation.
`workflow-node-execution.ts` defines the package-internal capability that binds
new node Runs to an active Plan. `ordered-run-event-writer.ts` gives CLI JSONL
and HTTP SSE one sequence-accurate concurrent event projection. This keeps
Workflow logic outside the oversized Store and Server modules and removes the
former tool-construction block from `agent-runtime.ts`.

`embedded-agents.ts` is the local Agent Experience-to-Capability adapter. It
validates prompt bytes, model references, titles, and Thread/Agent ownership
before creating state; delegates one-shot, continuation, cancellation, and
manual interrupted-Run recovery to `AgentRuntime`; and projects assistant text
only from the exact returned Run's `message.assistant` event.
`embedded-workflows.ts` is the local Experience-to-Capability adapter. It
performs pure Plan, Manifest, Schema, and typed-input preflight before creating
durable state; creates the definition Thread and source Plan needed for a real
Blueprint; then delegates execution and resume to
`ExecutionPlanWorkflowRuntime`. `packages/sdk` owns the external client
lifecycle and generic TypeScript handles, but receives only this embedded
service from `LocalAgentRuntime`. It does not receive or expose Store,
credentials, model registries, internal experiment injection, or a second
scheduler.

The SDK Agent API creates a new Thread or explicitly continues an existing
one, while `resumeAgent()` creates the normal `source=recovery` child of a
reconciled interrupted Run. The SDK's stable Workflow serialization boundary is
the existing
`ExecutionPlanWorkflowManifest`. Loading JSON revalidates its Blueprint,
Schemas, nodes, and content hash before a typed handle is returned. New runs
may create an isolated Thread or use an explicit existing Thread; resume
requires the exact Thread, Plan, and Manifest. AbortSignal and event callbacks
pass through unchanged. Closing the SDK first rejects new operations, aborts
and waits for every active SDK Agent or Workflow call to settle terminal
evidence, then
settles Process Sessions and MCP transports before SQLite just like CLI and
Server shutdown.

A new execution validates the complete manifest and typed input before
creating state, creates the normal `ExecutionPlan`, freezes the target Agent
revision in `workflow.started`, and executes dependency-ready nodes with
Manifest concurrency `1..4`; an omitted value preserves sequential behavior.
Agent nodes are normal `AgentRuntime.runPrompt()` invocations with their
manifest model override, timeout, AbortSignal, Run lease, policy, Sandbox,
tools, and Ledger. Deterministic nodes create the same leased Run and resolve
a bounded pure JSON template over their typed input. The only primitives are
literal JSON, bounded field selection, object construction, array construction,
and one root Switch. A Switch selects a required schema path across 2–16
canonical, unique, schema-valid case values and an optional default, then
evaluates exactly one ordinary branch template. There is no coercion, nested
Switch, model, tool, JavaScript, JSONPath, interpolation, or expression
evaluation. Tool nodes also perform no model call. They select one
of 18 stateless built-ins, validate literal/Workflow/dependency field-path
bindings, TypeBox arguments, declared effect, enabled capability, Agent policy,
workspace scope, and freshness before `tool.started`. JavaScript/Python
kernels, Node debugger, background Process Sessions, and preview-bound
workspace file mutations stay Run-owned Agent tools because a one-shot node
cannot honestly provide their persistent session lifecycle.

New executions may declare up to 16 unique pre-node breakpoints. The request
validator normalizes node IDs to Manifest order and `workflow.started` freezes
the canonical set. Before each ready batch, the Runtime reconstructs prior
breakpoint events, then persists `workflow.breakpoint.reached` before returning
a distinct `paused` result. The event binds the selected node, ordinal/count,
Manifest, Plan revision, and a hash of the node's current Workflow/dependency
binding context. This check runs before condition evaluation, Run creation,
model dispatch, Tool invocation, or workspace side effects.

Ordinary resume does not consume an open breakpoint. An explicit
`continueBreakpoint` first records `workflow.breakpoint.continued`, including
the exact reached event sequence and binding, then permits scheduling.
Continuation and blocked-node retry are mutually exclusive. A crash after the
continued event therefore resumes execution without requesting duplicate
consent; ordinary interrupted-node recovery still governs any side effect that
may already have started. SQLite reopen reconstructs both open and consumed
points from Ledger evidence, while duplicates, stale Plan revisions, changed
bindings, and forged continuations fail closed. Web Trace keeps only safe node
IDs, counts, revisions, event sequence, and hash prefixes. This is node-boundary
pause/continue, not mid-node suspension or DAP stepping.

The Plan Workbench derives its breakpoint control from the same
`workflow.started`, reached, and continued events rather than storing UI state.
`WorkflowWorkbenchSlot.tsx` keeps this control and the existing experiment desk
outside the oversized Plan panel. An open point lazy-loads
`WorkflowBreakpointDesk.tsx`; the operator must supply a Manifest that passes
the existing independent browser parser and matches the frozen Manifest hash,
breakpoint set order, and node ID. The Manifest remains ephemeral browser
memory.

`workflow-api.ts` sends the existing resume request and accepts no Web-only
authorization. It independently verifies response headers, the exact
continuation event, contiguous SSE, Snapshot hashes, typed result and frame
hashes, terminal Plan/Thread state, paused reached-event evidence,
Manifest/Blueprint/node binding, and the complete event-stream hash before the
Workbench refreshes Thread detail. Multiple active Plans, a start event ordered
after its hold, a second client consuming the point, malformed Ledger
projection, Plan revision drift, or self-consistently rehashed impossible
result is visible as a failure. Runtime policy, Sandbox, and side-effect
recovery remain authoritative beneath the adapter.

Map nodes add dynamic cardinality without adding a second scheduler. A Map
selects one required array capped at 16 items from its already constructed
typed input. One coordinator `source=workflow` Run binds the Plan step and
launches up to three parent-bound item Runs through the same Agent Runtime.
Item Runs use the frozen Agent revision, the Map model override when present,
an independent deadline, and `workflow_map_read_only`: `observe`, the bounded
read-only tool subset, no extensions, no stateful sessions, no subagents, and
no Memory expiry/usage mutation. The outer scheduler executes Map exclusively
so coordinator plus children stay within the Store's four-Run limit. Outputs
are collected by input index and validated as one bounded array.

Loop nodes add bounded sequential feedback without adding a second scheduler
or a script evaluator. A Loop declares a typed output condition, one to eight
iterations, independent per-iteration and whole-node deadlines, and an
optional model override. One leased coordinator owns the Plan step. Each
parent-bound child receives the immutable initial input plus the previous
schema-valid output and executes through `workflow_loop_read_only`, which
shares the Map read-only tool boundary while remaining a distinct Run
configuration and Store capability. The node completes only when the typed
condition matches; the hard limit blocks rather than accepting partial output.

Each completed iteration records only bounded IDs, counts, status, byte
lengths, and hashes in public Workflow evidence. Recovery replays no model or
tool result blindly: it reconstructs a continuous prefix from child/coordinator
lineage, frozen Agent revision, model, configuration, recomputed feedback
input, output Schema/body hash, and termination subject. Explicit retry or
Store reopen may reuse that proved prefix and starts at the first unproved
iteration. The shared `workflow-read-only-child-run-gate.ts` now admits both
Map and Loop children and removes the former Map-specific block from Store.

Workflow completion also settles the Blueprint's declared Artifacts rather
than accepting model or node claims. Manifests admit at most 16 workspace
files or directories. After all Plan steps complete or skip, the Runtime uses
the existing canonical realpath and bounded hashing path to transition present
or repaired Artifacts through `produced` to `verified`. The target is re-read
after `produced`, and existing verified Artifacts are rehashed before
completion. Missing bytes or digest drift transition to `missing` and block;
unsupported kinds, symlinks, scope escape, size limits, and superseded declared
outputs fail closed.

Standard `plan.artifact.*` events remain the authoritative lifecycle. The
Workflow adds only `workflow.artifacts.settled` or
`workflow.artifacts.failed` coordination with bounded IDs, counts, status,
Manifest hash, Plan revision, diagnostic hash, and Artifact-set hash. These
events contain no path, content, or diagnostic prose. Resume reconstructs
completed nodes first, then retries only settlement. Cancellation checks occur
between digest observation, `produced`, and `verified`; if a state commit
survives but its standard event does not, resume appends the current exact
projection before completion.

Each concurrent node receives an isolated copy of the current Plan, outputs,
node results, and reused-node lineage. Store transitions and Ledger sequence
assignment remain serialized authorities; outcomes merge only after the full
batch settles and in Manifest order. Approval nodes never share a batch. A
blocked branch preserves independently completed siblings, cancellation
aborts every active branch, and an unexpected scheduler rejection aborts the
rest of the batch before surfacing the error.

The Store admits concurrent Runs only when every active Run has
`source=workflow` and the same persisted `workflowPlanId`. That field is
derived only from a package-internal capability after validating an active
same-Thread Plan; public source strings are insufficient authorization. Four
active Workflow Runs is the hard Store bound. `Thread.currentRunId` remains a
backward-compatible pointer to the oldest representative active Run and moves
to the next sibling on settlement. The complete active set is derived from Run
status and Plan step bindings.

Conditional control remains inside the same scheduler. A node can bind one
`when.path` into its already constructed and schema-validated input, one
canonical JSON `equals` value that must match the path's schema, and one
`skipOutput` that must match the node output schema. Runtime resolves no global
path and evaluates no script, interpolation, coercion, or expression. A false
condition transitions the existing Plan step directly from ready to skipped,
creates an `attempt: 0` typed result, and exposes the Manifest fallback to
downstream bindings without creating a Run. This preserves Plan's existing
completed-or-skipped dependency semantics while keeping every executed attempt
Run-backed.

Multi-way selection remains inside the existing Deterministic leased Run. A
root Switch with no match and no default blocks as `switch_unmatched`; a
matched/default branch is schema-checked before commitment. Public completion
evidence records only the stable case ID, selector SHA-256, default flag,
template/input/output/schema hashes, and byte count. It never records the
selector value or branch output body. The case ID is explicit Manifest control
metadata, not model-generated data. Downstream graph routing can compose this
typed output with ordinary equality guards; Switch does not silently prune Plan
steps or invent graph edges.

Approval nodes reuse the existing operator-decision state machine rather than
adding approval storage. The first leased `source=workflow` Run transitions the
Plan step to running, records a Manifest/input/attempt/deadline-bound decision,
and settles with the Thread in `waiting`. An answered decision can continue
only through a same-Agent-revision child Workflow Run; the generic Agent
continuation path rejects it. Approval emits the fixed typed output and
unblocks descendants. Rejection, cancellation, invalid selection, or durable
deadline expiry blocks the Plan.

The Agent-node prompt labels Workflow input as untrusted data and requires
exactly one JSON value. Deterministic output is schema-checked before terminal
evidence and stored as hidden assistant data; the terminal Workflow event
contains only template/input/output/schema hashes and output bytes. Switch
completion additionally binds the case ID, selector hash, and default flag.
Tool-node output is its structured `details`, never the tool's model-facing text body.
Runtime schema validation occurs before the Plan step completes. Generic tool
arguments and text are reduced to bytes/hash in Tool-node Ledger evidence,
while typed structured output remains bound for recovery and delivery.
Workflow-specific Trace summaries retain only safe identifiers, declared
effect, status, byte counts, error codes, and hash prefixes.
Artifact-settlement summaries retain only counts, revision, status, and hash
prefixes; workspace paths, contents, evidence, and diagnostic text are
excluded.
Conditional terminal evidence contains condition, subject, input, fallback,
output, and schema hashes but no compared value or fallback body.

Resume accepts the original Manifest plus Plan ID, recovers the original input
and frozen Agent revision from `workflow.started`, and revalidates both against
the target Thread. Agent and Deterministic output are reconstructed from bound
assistant evidence; Deterministic recovery additionally requires one terminal
event bound to template, attempt, input, output, bytes, and schema, then
re-evaluates the template from the typed input. Switch recovery must reproduce
the exact case/default decision and selector hash. Tool output requires a
unique terminal tool event bound to
Plan/node/tool/effect/input/output hashes. Map output requires the coordinator
completion plus a unique started/completed pair for every indexed child,
parent/Plan/restricted-configuration lineage, per-item input/output/schema
hashes, and aggregate item/run set hashes. Loop output requires a continuous
ordered child chain, recomputed previous-output feedback, typed condition
evaluation, coordinator/model lineage, and exact checkpoint/run-set hashes.
After those outputs recover, terminal Artifact settlement rechecks current
workspace bytes. A repaired missing Artifact never causes a completed node to
rerun, while a drifted verified Artifact invalidates a later completion claim.
Recovery also handles process-exit
windows between terminal output, Run settlement, Plan transition, and Workflow
event commits. `tool.started` without terminal evidence becomes
`run_interrupted` and is never rerun silently. A valid `tool.completed` can
settle the same interrupted Run through the internal blocked-step recovery
transition without manufacturing a second Run or tool call. A started-only
interrupted Deterministic node may be recomputed automatically up to its
Manifest `maxAttempts`; a valid terminal output is recovered instead, and
tampered or duplicate terminal evidence fails closed. Approval recovery
recomputes expiry from the decision timestamp plus Manifest timeout, validates
unique request and continuation evidence, and reconstructs output from the
authoritative operator-decision projection.

Workflow-owned Runs are excluded from generic manual and automatic Run
recovery. Only Workflow resume may inspect them. It automatically reopens only
a proved started-only Deterministic attempt; all other blocked nodes require
explicit `retryBlocked=true` and an unexhausted attempt limit. Unknown side
effects are never silently rerun. Restart reconciliation interrupts every
in-flight sibling and binds each affected Plan step to its own
`run_interrupted` evidence. A second Workflow or an ordinary Run on the same
Thread remains rejected.
Skipped recovery rebuilds the typed node input in dependency order, recomputes
the guard, validates the Manifest fallback, and requires one matching
`workflow.node.skipped`. A missing event after the durable Plan skip can be
reconstructed because the decision is pure; duplicate evidence, a true guard,
an unconditional skipped step, or hash/schema drift fails closed.

CLI JSONL and HTTP SSE emit normal event frames followed by one snapshot and a
`workflow_result` frame. The frame independently validates every node/output
hash, final result hash, Thread/Plan/Manifest binding, snapshot size/hash,
event counts/bytes, and event-stream hash. Both transports use
`OrderedRunEventWriter`, which tolerates concurrent callback arrival but writes
only contiguous authoritative Ledger sequence and fails closed on duplicates,
foreign Threads, or gaps.

Workflow checkpoint experiments build controlled re-execution on that same
scheduler:

```text
source Thread + Plan + source Manifest
  -> verify completed source Run/node evidence
  -> derive selected-node descendant rerun subgraph
  -> choose full-subgraph, selected-node-only, node-by-node step control,
     selected-output simulation, selected constructed-input replacement,
     or selector-free top-level Workflow input replacement
  -> for simulation, validate the explicit output against the node Schema
     and bind its canonical hash and byte count
  -> for input replacement, validate the complete constructed input against
     the selected node Schema and bind its canonical hash and byte count
  -> for top-level replacement, validate the complete Workflow input, bind
     every Manifest node as rerun/executable, and prohibit source reuse
  -> summarize historical read/write/unknown tool effects
  -> bind candidate model replacements and preview hash
  -> require exact preview confirmation for write/unknown effects
  -> create independent target Thread and normal ExecutionPlan
  -> materialize verified completed ancestors as source=workflow_reuse Runs
     and preserve verified skipped ancestors as zero-Run skipped outputs
  -> materialize a simulated selected node as source=workflow_simulation,
     execute the selected node, or execute it plus descendants with an optional
     selected-node input override
  -> for top-level replacement, use the replacement as the ordinary target
     workflow.started input and execute the complete graph
  -> execute every non-simulated node through the normal Workflow Runtime
  -> for single-node mode, pause before every direct successor
  -> for step-control mode, pause before every remaining rerun node
  -> align source/target node evidence and derive target-minus-source metrics
  -> append privacy-bounded workflow.experiment.compared evidence
  -> emit target snapshot + workflow_experiment_result
```

CLI JSONL, HTTP SSE, Web, TypeScript SDK, and local stdio RPC all call this
same Runtime. SDK and RPC require `expectedPreviewSha256` for every execution,
including read-only reruns, so automation cannot silently execute a different
source projection than it previewed. RPC emits only target Ledger events under
the owning request ID and returns the candidate Manifest plus target
Thread/Plan required for normal Workflow retry or Approval recovery.

The omitted/default mode preserves the schema-1 preview and full-descendant
execution contract. `single_node` emits schema 2 with three independently
validated node sets:

- `rerunNodeIds` is the selected node plus every descendant whose source
  output cannot be reused in the target;
- `executionNodeIds` is exactly the selected node for this request;
- `stopBeforeNodeIds` is the selected node's direct successors in Manifest
  order.

Historical Tool effects and confirmation requirements are projected only for
`executionNodeIds`, so an unexecuted successor cannot expand the current
authorization decision. At most 16 direct successors are accepted because the
mode deliberately reuses the existing persistent breakpoint bound. The target
freezes the stop set in `workflow.started`, records mode and all three sets in
`workflow.experiment.started`, executes the selected node through the ordinary
scheduler, then returns `paused` after `workflow.breakpoint.reached` and
`workflow.paused` when at least one direct successor exists. A selected
terminal node has an empty stop set and completes normally. No successor Run,
condition, model, Tool, or side effect can start before a hold.

Ordinary resume reconstructs and returns the same open point after SQLite
reopen. Explicit breakpoint continuation consumes one open direct-successor
hold in Manifest order; multiple successors therefore remain independently
reviewable before the normal scheduler executes the remaining descendants.
Experiment recovery recomputes all three sets from the exact source Manifest
and compares them with both the lineage event and the target's frozen
break-before set. Unknown checkpoints, partial lineage, source drift,
impossible stop sets, and self-consistently rehashed result tampering fail
closed. This is real selected-node execution, not arbitrary input/output
mocking, side-effect simulation, or a second Workflow state machine.

`step_nodes` emits schema 5 and uses the same initial execution allowlist as
`single_node`, but `stopBeforeNodeIds` contains every other rerun node in
Manifest order. The stop set remains capped at 16 and is frozen in the ordinary
`workflow.started` event. All non-selected nodes therefore remain behind
normal durable breakpoint evidence until explicitly continued. Unlike
single-node testing, historical Tool-effect projection and exact-preview
side-effect confirmation cover the complete rerun subgraph because every held
node remains executable through a later Continue.

A continued breakpoint projects one internal released-node instruction.
`executeExecutionPlanWorkflowReadyBatch` accepts that exact ready node for the
next batch and cannot co-schedule a sibling that is still held. Only after the
released node settles does the main scheduler loop recover or create the next
reachable hold. If cancellation or process loss occurs after
`workflow.breakpoint.continued`, recovery finds the continued breakpoint whose
Plan step is still `ready` and releases the same node without appending another
consent event. This also corrects ordinary parallel breakpoint behavior; it is
not a step-specific scheduler or second state store.

`simulate_node` emits schema 3. `rerunNodeIds` remains the selected node plus
every descendant that cannot be reused, while `executionNodeIds` contains only
the descendants and `simulatedNodeId` identifies the selected checkpoint. The
explicit JSON output is limited to 32 KiB, validated against the selected
node's output Schema, and bound by canonical SHA-256 plus byte count. Schema-2
and schema-3 execution both require the exact current preview hash; schema 1
retains its compatible confirmation behavior.

The selected node does not enter the model, Tool, or side-effect paths. A
package-internal capability admits one `workflow_simulation` Run only for the
same active Plan and dependency-ready step. That Run writes the standard
Run/Plan/node lifecycle around a public hash-only
`workflow.node.simulated` event, settles the typed output, and hands control
back to the ordinary scheduler for descendants. Their historical write,
unknown, or unresolved effects still drive the normal side-effect
confirmation. Comparison labels the selected node `simulated`, while
`rerunNodeCount` continues to describe the complete non-reusable subgraph.

Exact output is stored once as hidden
`workflow.node.simulation.requested` recovery evidence. The public simulated
event and Web Trace expose only safe IDs, Manifest/input/output/Schema hashes,
and bytes. A deliberate full portable Thread fixture includes the hidden event
because import and SQLite-reopen recovery need the typed value; the value is
not rendered in Trace or the experiment desk. Recovery requires exactly one
request event and recomputes its Schema, hash, bytes, Manifest, Plan, and node
bindings. Missing, duplicate, drifted, or tampered evidence fails closed.
Completed simulation Runs recover through normal node output reconstruction;
interrupted simulation materialization is handled by its dedicated
materializer and cannot enter generic Run retry.

`replace_input` emits schema 4. `rerunNodeIds` and `executionNodeIds` both
contain the selected node plus its complete descendant subgraph;
`replacedInputNodeId` identifies the selected checkpoint. The replacement is
the node's complete constructed input, not top-level Workflow input or a
mutation of historical dependency output. It is limited to 32 KiB, validated
against the selected node input Schema, and bound by canonical SHA-256 plus
byte count. Schema-4 execution always requires the exact current preview hash.
Historical Tool effects and confirmation cover the complete execution set.

Verified ancestors are still materialized through `workflow_reuse`. The
selected node and every descendant execute through the ordinary scheduler and
retain their normal model, Tool, Approval, condition, Sandbox, timeout, retry,
cancellation, and recovery behavior. A shared effective-input helper is used
by execution, condition recovery, Approval recovery, breakpoint binding,
simulation materialization, and completed-node reconstruction. Without an
override it preserves the existing binding hash exactly; with an override the
binding context also commits to the replacement input hash. Comparison labels
the selected node `input_replaced` and verifies its observed input change while
its Run source remains `workflow`.

The exact replacement is stored once as hidden
`workflow.node.input_replacement.requested` evidence. Public experiment
lineage and Web Trace expose only the selected node, hash, and byte count; the
standard `workflow.node.started` input hash proves which bytes entered normal
execution. SQLite reopen requires exactly one request and recomputes the
Schema, hash, bytes, Manifest, Plan, and node bindings. Portable full-Thread
import preserves `payload.input` as opaque user JSON rather than remapping
strings that happen to equal resource IDs; actual lineage fields still remap.
Missing, duplicate, drifted, or tampered evidence fails closed.

`replace_workflow_input` emits schema 6 and deliberately has no
`fromNodeId`. `reusedNodeIds` is empty; `rerunNodeIds` and
`executionNodeIds` are every Manifest node in order. The complete replacement
is limited to 32 KiB, validated against the top-level Workflow input Schema,
and bound by canonical SHA-256 plus byte count. Tool effects are projected
from every source node, so any historical write, unknown, or unresolved effect
requires the exact current preview plus explicit confirmation before a target
Thread exists.

The replacement is passed directly to the normal Workflow Runtime and becomes
the target's existing `workflow.started` input. There is no synthetic
checkpoint, hidden node-override event, reused Run, alternate scheduler, or
second input store. Every constructed node input is therefore rebuilt from the
new top-level value and real upstream target outputs. Model overrides remain
limited to rerun Agent/Map/Loop nodes and do not expand model, Tool, policy,
Sandbox, filesystem, network, or environment authority.

Experiment lineage stores only the replacement hash and byte count beside the
complete node sets, source revision, preview hash, and side-effect decision.
Recovery obtains the body from ordinary Workflow start evidence, revalidates
the top-level Schema, hash, bytes, candidate Manifest, and node sets, and never
falls back to the source input. Result validation binds the same replacement
digest to the comparison's observed target input digest. Public preview and
Trace remain body-free, while the ordinary local Workflow input retains its
existing recovery semantics. Cancellation, retry, restart, portable Replay,
comparison, and ordered event delivery stay on the shared paths used by
schemas 1-5.

The source Plan is read-only. Reused outputs are accepted only when source
Plan/Run ownership, frozen Agent revision, model, node input/output/schema
hashes, and unique start/completion evidence agree. Each target reuse binds the
source and target input hash as well as the source output hash. Revision
pinning and reused-node injection use a package-internal symbol capability;
ordinary HTTP, CLI, and SDK Workflow requests cannot select historical Agent
policy or submit synthetic reused outputs.

The target stores experiment lineage in the same Work Ledger. On resume, a
completed synthetic reuse is reconstructed like any completed Workflow node.
Skipped reuse remains skipped with zero Run, attempt, tool, model, cost, and
Evaluation metrics; its explicit lineage event is repaired idempotently if a
process exits after the target Plan skip. Runtime and browser protocol
validation also bind each returned node status to its observed target Plan
status, so a zero-Run skip cannot be relabeled as completed.
If cancellation or restart happened before all reuse nodes were materialized,
the Runtime reprojects only the declared reused subgraph from the exact source
Plan revision and input; source drift fails closed. An interrupted
`workflow_reuse` Run may be reopened only for deterministic re-materialization
and is excluded from generic Workflow node retry, manual Run recovery, and
automatic recovery.

Preview and execution are available through CLI JSONL and dedicated HTTP
preview/SSE routes, the TypeScript SDK, and local stdio RPC. The lazy
Workbench desk independently recomputes the
rerun/reused/execution/stop/simulation/input-replacement sets, validates
schema-1 through schema-6 preview hashes, binds schema-6 replacement
hash/bytes to the submitted value and observed comparison input, binds terminal
SSE to Snapshot Plan/Thread state, and requires a matching reached event for a
paused result. Web Trace projects only mode, node IDs, counts, confirmation
state, and hash prefixes. Source/output/input-replacement bodies, tool
arguments, diagnostics, and paths are not copied into experiment-specific
Trace summaries.

Terminal experiment comparison reads each Thread event stream once, groups
events by actual Run, and reuses the same pure Run-metric derivation as
portable Replay. Manifest order aligns nodes. Historical starts and failures
produce retry counts, while only the current completed Plan step's `runId` may
provide the current output hash. This prevents an older successful attempt
from masking a reopened, blocked, or cancelled node. Actual Run sources,
models, configuration hashes, tool sets, token/cost usage, existing Evaluation
coverage, and path-free Artifact state are summarized per side. Numeric deltas
are always `target - source`; output availability distinguishes repaired
(`became_available`) from regressed (`became_unavailable`) execution.

The complete hash-bound comparison travels in the existing
`workflow_experiment_result` JSONL/SSE frame. Durable
`workflow.experiment.compared` evidence contains only statuses, counts, metric
deltas, and hashes. Prompts, message/output bodies, tool arguments, Evaluation
reasons/evidence, Artifact paths, and raw diagnostics are excluded. Comparison
creation rechecks source and target Plan revisions after observation and fails
closed on source drift or non-Workflow Run bindings.

Agent message experiments add a message-level controlled re-execution path
without reclassifying portable Replay as execution:

```text
terminal source=user Run + exact message.user sequence
  -> recover frozen Agent revision and schema-7/8 Run configuration
  -> verify Prompt Variable timestamp/snapshot, Skill catalog, reviewed Memory,
     complete model-message history, candidate model, and Workspace snapshot
  -> bind a stable preview hash
  -> require that exact hash for execution
  -> create an isolated Branch immediately before the selected message
  -> copy visible messages plus hidden Goal continuation prompts in source order
  -> recompute the materialized history hash before any target model call
  -> optionally require a complete ordered local-only source tool-result set
  -> execute through AgentRuntime as agent_experiment_read_only
  -> in reuse_source mode, match tool implementation + arguments in source order
  -> return the captured result through Pi without invoking the real tool body
  -> fail the target on divergence, missing results, or incomplete consumption
  -> compare source/target status, configuration, output hash, latency, usage,
     cost, tool names, and tool effects
  -> emit target snapshot + agent_message_experiment_result
```

The restricted target keeps only the configured read-only built-ins, forces
`toolPolicy=observe`, disables subagents, Extensions, Process/Kernel/Browser
Sessions, and Plan/Memory mutation, and reuses the source Prompt Variable
resolution timestamp. Store requires the package-internal experiment
capability, exact cross-Thread Branch lineage, source Run/message/configuration,
Agent revision, and current Skill/Prompt hashes before creating the target
Run. A caller cannot obtain the mode by submitting its public string.

Normal eligible tool calls write exact arguments before execution and exact
model-visible results after settlement to separate local private stores.
`AgentToolResultLifecycle` owns capture, replay wrapping, and result evidence
outside the oversized Agent Runtime. Result capsules contain only text content,
JSON details, optional tool usage/additions, and source error state; images,
functions, non-JSON values, and runtime-only termination hints are rejected.
They use `0700`/`0600` confinement, atomic no-overwrite installation,
serialized capacity admission, a 1 MiB object limit, and a 512-object /
128 MiB store bound. Capture failure emits a bounded
`context.tool_result_unavailable` receipt and never alters the live call.

`reuse_source` preview requires every source tool observation to be one of the
ten eligible stateless reads with a matching input receipt, result receipt,
terminal event, and readable local result capsule. The ordered result set is
bound into preview schema 2 and the Store run gate. Pi preflights parallel
batches sequentially, so `FrozenToolResultReplayController` reserves exact
tool/implementation/argument matches in model source order before wrapped
executors run. Reused results preserve the source `isError` state and append
`tool.result_reused`; candidate arguments and terminal results stay hash-only
in the target Ledger. Any mismatch blocks the current call, stops before a
follow-up provider request, and fails the Run when the complete result set
cannot be proven consumed. No mismatch can fall back to the real tool.

Preview and execution are shared by `napier experiment`, HTTP SSE, the lazy
Run Lab experiment desk, TypeScript SDK, and local stdio RPC. Cancellation or
external timeout settles a comparable cancelled target; Provider failure
settles a comparable failed target. Retry creates another Branch from the
source checkpoint, never a continuation of uncertain model state. Durable
`agent.experiment.*` evidence contains bounded IDs, statuses, models, counts,
metric deltas, timestamps, and hashes rather than source prompt, source output,
target output, tool arguments, Memory text, Skill text, Workspace paths, or
diagnostics. Portable target Replay accepts an external parent only when a
unique exact `branch.created` receipt proves the cross-Thread lineage.

Model invocation experiments add a call-level path that is narrower than an
Agent rerun:

```text
before each provider dispatch
  -> project only Pi provider-consumed Context fields and safe sampling options
  -> bind the existing Model Context Envelope receipt
  -> write one content-addressed local capsule
  -> append context.model_invocation with hashes, purpose, model, size, and turn
select terminal source Run + captured turn
  -> require one exact capsule receipt, preceding context envelope, and
     following model response
  -> load the local capsule and replay all envelope/context/content validators
  -> resolve the optional configured replacement model before mutation
  -> bind source response, Agent revision, capsule, and model to previewSha256
execute with expectedPreviewSha256
  -> reproject freshness and create an isolated target Thread
  -> Store admit only an internal model_experiment_single_call capability
  -> append run.started and model.experiment.started
  -> call completeSimple exactly once with target turn index zero
  -> never resolve or dispatch returned tool calls
  -> compare status, stop reason, duration, usage, cost, text/output hashes,
     and canonical tool names
  -> append model.experiment.compared and settle completed/failed/cancelled
  -> stream target events, Snapshot, and model_invocation_experiment_result
```

Capture covers primary Agent turns, context compaction, Goal evaluation, and
Memory extraction. It does not serialize tool executors or runtime-only Context
fields, and excludes credentials, headers, environment, callbacks, and
AbortSignals. Capture storage failure must not change the original provider
call: the Runtime appends only a bounded, hash-only
`context.model_invocation_unavailable` event and continues.

Capsules are sensitive local execution state because prior model-visible tool
results may be present. Their CAS lives under the data root with directory mode
`0700`, file mode `0600`, fsynced temporary writes plus no-overwrite hard-link
installation, post-install capacity revalidation, no symlink reads, and
permission-drift rejection. One capsule is limited to 8 MiB;
the store is limited to 256 capsules and 128 MiB. Portable Replay contains only
the validated receipt. Trace and durable `model.experiment.*` events exclude
provider Context, candidate text, raw thinking, and tool arguments.

Provider failure and active cancellation are call-level outcomes and produce
comparable terminal Runs. Orchestration failure appends a hash-only failure
event. Generic and automatic recovery reject model-experiment Runs because a
retry must create a fresh target from the same source checkpoint. The shared
Runtime is exposed through CLI JSONL, HTTP preview/SSE, TypeScript SDK, local
stdio RPC, and a lazy Run Lab desk. RPC reuses the existing protocol-version-1
admission, request-bound event, cancellation, and shutdown machinery.
Web Trace provides a privacy-bounded projection.

The model-call desk lists only strict capsule-receipt metadata from terminal
configured Runs. Its browser protocol independently recomputes preview,
comparison, and result-frame hashes; validates status/stop-reason consistency,
source/target model and output bindings, metric and tool-set deltas, streamed
event hashes, final Snapshot identity, and complete event-stream hash; and
rejects extra prompt-bearing fields before rendering. The desk supports fresh
preview, configured provider replacement, explicit cancellation, target
navigation, and deliberate result download. Provider Context, raw thinking,
source/candidate text, and tool arguments never render.

Tool invocation experiments add the first tool-call checkpoint path without
weakening the normal policy boundary:

```text
admitted built-in read-only Agent tool call
  -> append tool.started from the Pi event stream
  -> before tool execution, canonicalize exact validated arguments
  -> bind Agent revision, tool name/Schema, arguments, and workspace scope
  -> write one permission-restricted local capsule
  -> append context.tool_invocation with receipt hashes and size only
  -> execute the original tool
  -> write its exact model-visible result to a separate local-only capsule
  -> append context.tool_result plus terminal result hashes/bytes
select terminal source Run + exact call ID
  -> require one receipt, one preceding start, and one following completion
  -> load and revalidate the local capsule
  -> regenerate the tool from the pinned Agent revision
  -> require the same definition hash, TypeBox Schema, read effect, and
     observe-policy decision
  -> snapshot the exact current workspace path scope without truncation
  -> bind all source events, output, capsule, tool, and workspace evidence into
     previewSha256
execute with expectedPreviewSha256
  -> reproject freshness before mutation
  -> create an isolated capability-gated tool_experiment_read_only Run
  -> regenerate and revalidate the same tool
  -> invoke the tool exactly once with the private capsule arguments
  -> compare status, duration, output hash, and output bytes
  -> emit target Snapshot + tool_invocation_experiment_result
```

The eligible surface is deliberately limited to the stateless workspace/data
read tools `list_files`, `read_file`, `search_files`, `list_symbols`,
`inspect_data`, `sqlite_query`, `inspect_code`, `read_symbol`, `ast_query`, and
`ast_edit_preview`. Extensions and Browser, Process, shell, Kernel, Debugger,
LSP Session, mutation-preview state, write, and unknown-effect tools are not
resolved. The target never enters the Agent Loop and makes no model call.
Store validates a package-private capability against the exact source receipt
and start/completion events, so the public execution-mode string cannot create
one of these Runs.

Tool and model capsules share one local private CAS implementation: `0700`
directories, `0600` files, no symlink reads, canonical content addressing,
fsynced temporary files, no-overwrite hard-link installation, serialized
capacity admission, and post-install count/byte validation. Tool capsules are
limited to 512 KiB each, 512 objects, and 64 MiB total. Capture failure does
not change the original tool call and emits only
`context.tool_invocation_unavailable`. Raw capsules never enter portable
Replay. Durable experiment events contain hashes, sizes, statuses, safe IDs,
and deltas; deliberate CLI/HTTP/SDK/RPC results and Web downloads can return
candidate output.

Preview snapshots only the argument-selected workspace file or directory and
rejects truncation. Any preview-to-execution change fails before target
creation. A race after target creation can only produce a failed read-only
target, never a workspace mutation. Cancellation settles a cancelled target;
generic and automatic recovery reject experiment Runs so retry starts from the
source checkpoint. Runtime, CLI JSONL, HTTP/SSE, TypeScript SDK, local stdio
RPC, lazy Run Lab, and privacy-bounded Web Trace consume this same path.
Message experiments can reuse exact historical results for this stateless
read-only subset. Write/session result simulation, environment restoration,
batch experiments, and promotion remain separate work.

The tool-call desk remains inside the lazy Run Lab boundary. Its independent
protocol parser requires exact fields and recomputes preview, source/target
observation, comparison, and terminal-frame hashes plus duration/output-byte
deltas and output-hash state. The SSE client binds monotonically increasing
target events back to the final Snapshot and complete event-stream hash.
Switching Thread or explicitly cancelling aborts the request and invalidates
the operation generation, preventing a stale response from repopulating the
desk. The UI renders only tool name, source/candidate status, duration, output
byte counts, and hash prefixes; arguments, Workspace paths, source output, and
candidate output never render. Candidate output is available only through the
explicit CAS-named local result download.

The Plan Workbench adds a lazy Workflow Experiment Desk over the same HTTP
boundary. It accepts a browser-local, content-verified Manifest, lets the user
select a source Plan/checkpoint, execution mode, optional selected-model
override, explicit typed simulation value, or complete typed checkpoint input,
then requires preview before execution. Preview responses are rebound to the
exact Thread, Plan, Manifest, node, model overrides, simulated-output or
replacement-input hash/bytes, response hash, and no-store headers. Execution
reuses the existing isolated Runtime; the browser validates multi-Run event
hashes/order, one final Snapshot, the complete experiment result/comparison
hash chain, and source/target identities before rendering.
Navigation aborts the current fetch and operation-generation checks prevent an
old response from repopulating a newly selected Thread.

The UI projection excludes Workflow input/output bodies, tool arguments,
Evaluation prose, Artifact paths, and diagnostics. An explicit download may
save the complete local result with CAS naming. The client accepts up to 2 MiB
for Preview, 6 MiB for one SSE record, and 12 MiB for the complete stream; these
bounds cover the Runtime's 5.5 MiB legal terminal-frame maximum plus the new
target Thread Snapshot. Experiment SSE responses override the streaming
helper's default cache policy with `Cache-Control: no-store`.

Reduce is a model-free pure Workflow node over one required bounded array.
`count`, `sum`, `minimum`, `maximum`, `all`, and `any` accept either each item
or a required typed value path within each item. Count, sum, all, and any have
fixed empty identities; minimum and maximum require a non-empty input Schema.
The Manifest validator binds operation/path/type compatibility before a Plan
exists. Execution uses one leased `source=workflow` Run at the frozen Agent
revision, writes the scalar only to hidden assistant evidence, and publishes a
body-free `workflow.reduce.completed` receipt with configuration, item/value
set, input/output, Schema, count, and byte hashes. Recovery requires exactly
one exact-field receipt plus the hidden scalar, then recomputes the fold from
the typed input and requires canonical equality instead of trusting those
hashes alone. Numeric extrema normalize JSON's negative zero before settlement.
Checkpoint experiments can reuse or rerun Reduce like other proved nodes.
Independent Reduce nodes remain eligible for the normal bounded outer parallel
wave.

JavaScript Workflow nodes reuse the existing `JavascriptKernelManager` and
`WorkspaceProcessManager` rather than adding a code-evaluation backend. One
leased Workflow Run starts one fresh read-only, network-denied private-protocol
Session, injects at most 8 KiB of constructed JSON as the fixed `input`
binding, and evaluates 1–8 content-hashed cells in order. Cells are limited to
16 KiB each, 32 KiB total, and 2 seconds apiece; the node and Session are
limited to 120 seconds. The final non-truncated 4,096-character preview must
parse as JSON and pass the ordinary output Schema and 32 KiB output bound.

The frozen Agent revision must enable `javascript_kernel`, and the normal
process policy must admit it. Completion is impossible until the private
Session is cancelled with an unchanged workspace delta. A body-free
`workflow.javascript.completed` receipt binds Manifest configuration, worker,
input binding, ordered request/result sets, output, duration, Schema, Run, and
attempt hashes. Source cells, inputs, outputs, console text, diagnostics, and
private frames do not enter public Workflow Trace. Recovery accepts one exact
receipt plus hidden typed output after a commit gap, but a started Session
without terminal evidence remains blocked until explicit retry. Every node and
retry gets a fresh context; this is not a cross-node or restart-persistent
Notebook.

Python Workflow nodes reuse the existing `PythonKernelManager`, fixed runtime
identity, AST restriction layer, and managed private Process protocol. The
trusted worker decodes one canonical JSON binding before user code runs and
freezes arrays/objects as tuples/mapping proxies. Intermediate Workflow cells
return compact status-only protocol records; the final cell may return one
exact canonical JSON value up to the ordinary 32 KiB node bound. The private
Session records a 96 KiB cumulative protocol budget so Base64 framing can carry
that value, while ordinary Process/PTY output remains capped at 32K. Unsupported
objects, cycles, non-string keys, non-finite numbers, and excessive shape are
rejected without parsing `repr`.

The frozen Agent revision must enable `python_kernel`, and the same process
policy, read-only workspace, denied network, timeout, cancellation, and
unchanged-settlement rules apply. `workflow.python.completed` contains no code,
input/output body, console, path, stderr, or frame. It binds the configuration,
worker and Python runtime identities, input request, ordered cell request/result
sets, exact JSON/output hash and byte equality, Schema, duration, memory, Run,
and attempt. Recovery accepts one exact receipt plus hidden typed output for a
commit gap; otherwise a stateful attempt requires explicit retry. Scheduler,
checkpoint experiment, Replay, CLI, SDK, RPC, HTTP, and Web paths have no
Python-specific loop.

Schema version 1 is intentionally narrow: Agent nodes, bounded Deterministic
nodes with root multi-way Switch templates, bounded stateful JavaScript and
restricted Python Session nodes, stateless built-in Tool nodes, bounded
read-only Agent Map and Loop nodes, typed deterministic Reduce nodes, durable
binary Approval gates, literal/field-path typed bindings, bounded parallel
dependency-ready DAG scheduling, typed equality guards with schema-valid
fallback, cancellation, timeout, explicit retry, restart recovery, and
terminal workspace file/directory Artifact settlement. It does not yet
implement package-backed Python/Notebook Sessions, cross-node Session handles,
general graph-level branch pruning, write-capable Map/Loop, compensation,
mid-node suspension, or external Agent adapters.

### Coding Outcome Benchmark

`npm run bench:coding` drives the real one-shot CLI against a versioned case
manifest and a copied temporary workspace. The runner creates a dedicated
Agent revision with fixed model, tools, budgets, policy, and low reasoning,
then consumes the same JSONL `StreamFrame` sequence as external automation.
The demo model provides a deterministic failed baseline; live providers require
an explicit environment-variable credential locator.

The `coding_shipping_boundary_v1` case covers a single-file repair.
`coding_pricing_options_migration_v1` requires one API definition and two call
sites to migrate together after a real `lsp_references` impact query.
`coding_loyalty_discount_debug_v1` requires the Agent to pause in the existing
Node DAP adapter, inspect live calculation state, settle the target, and repair
one JavaScript file. Each case hashes the complete before/after workspace and
requires the changed path set to equal its allowlist. Case schema v2 also binds
a hidden assertion module. Schema v3 adds a unique
`requiredCompletedTools` subset of the enabled tool profile. The scorer derives
that set only from `tool.completed` events in the terminal CLI Snapshot for the
scored Run; starts, failures, blocks, another Run, or model claims do not count.
After the Agent Run and workspace snapshot, the runner adds the assertion
module under a reserved one-use name, executes it with the existing
`CommandRunner` in a read-only, network-denied Node Sandbox, records only
status/latency/exit/output hashes, and removes it. Generated modules are loaded
only inside that Sandbox, never into the benchmark host process.
A trusted marker is written before importing generated code; wrapper
diagnostics count as Sandbox unavailability only when that marker is absent,
so generated stderr cannot spoof an inconclusive outcome.

A TypeScript-parser AST projection remains supplementary evidence. It ignores
comments, whitespace, and numeric separators while preserving syntax nodes and
token kinds. Unlike case v1, AST equality with one expected implementation is
not the v2/v3 success oracle. A Run passes only when the hidden assertions pass,
the exact changed-path policy holds, and every schema-v3 required capability
completed. Required/completed counts and canonical set hashes are bound into
evaluation v3 without changing the result, Ledger bundle, or series outer
schemas. Historical evaluation v1/v2 artifacts remain verifiable. If the
Sandbox backend cannot start and no independent gate fails, the result is
`inconclusive`; a missing required capability remains `failed`, and Napier
never falls back to host execution.

After scoring, the runner appends one hash-only `benchmark.evaluated` event to
the source Run. It emits:

- `napier-benchmark-result-<case>-<hash>.json`, containing model, environment,
  Run configuration, usage/cost/latency, tool failure/repetition counts, and
  deterministic outcome;
- `napier-benchmark-ledger-<case>-<hash>.json`, containing source event-stream
  and snapshot hashes, event-type counts, Run/evaluation bindings, and chained
  receipts for non-delta events.

Result and Ledger schema v2 add a sorted `toolOutcomes` distribution for each
safe tool name, with starts, completions, failures, blocks, and repeated-call
counts. Aggregate totals must exactly equal the per-tool sums, and
`applyPatchCompleted` must agree with the `apply_patch` outcome. Arguments,
paths, output, and error text remain excluded. Offline verification continues
to accept schema-v1 Result/Ledger pairs, requires both sides to use the same
version, and rejects a self-rehashed distribution whose totals drift.
Repeated calls require the same tool, arguments, terminal event kind, and
terminal result hash; re-reading a changed file is not mislabeled as a retry.

`--trials 2..10` runs the same case/model sequentially in independent
workspace, data-root, Thread, and Run lifecycles. The resulting
`napier-benchmark-series-<case>-<hash>.json` binds every result/Ledger pair,
rejects duplicate result or Run identities, and reports completed, scored,
passed, failed, and inconclusive counts. Pass rate is computed only over
scoreable trials and remains `null` when the Sandbox made every trial
inconclusive. Duration, cost, token, tool, and repetition distributions retain
total/min/p50/p95/max/mean values. Parent cancellation records the completed
prefix and does not start another trial.

The seeded executor-comparison generator keeps `core_v1` byte-for-byte stable
for historical reports. `extended_v1` adds a distinct test-guided concurrency
repair: the Agent must run a visible Node test through `run_command`, implement
a general order-preserving concurrency bound, and pass a separate hidden
workload. `run-coding-executor-comparison.mjs` regenerates the suite from the
seed instead of accepting arbitrary executable fixtures, isolates OMP
workspace/HOME/profile state, counterbalances executor order, applies the same
changed-path and hidden-outcome gates, probes the actual OMP version, and
verifies the report before writing. A direct process adapter requires the
explicit test-only trusted-outer-Sandbox flag. Token-count fields are allowed
as non-secret metrics, while credential/token locator fields remain rejected.

High-volume text/thinking delta receipts are summarized by count and source
event-stream hash. Prompt, assistant text, reasoning, tool bodies, workspace
paths, debugger expressions/variables/output, hidden-test source, and
credentials do not enter benchmark artifacts. Offline verification first
enforces exact nested schemas, including v3 count/set-hash consistency, so
adding an unknown raw field and recomputing every self-describing hash still
fails closed. It then recomputes result/bundle hashes, receipt chains, event
aggregates, Run/tool bindings, and the evaluation-event receipt. The command
rejects result files above 256 KiB and Ledger bundles above 4 MiB before JSON
parsing. `--verify-series` first enforces hash-derived local filenames, then
verifies every referenced pair and recomputes all aggregate statistics;
`.`/`..`, missing artifacts, duplicated Runs, symlinked inputs, and
self-consistently rehashed aggregate drift fail closed.

CLI JSONL writers accept live Agent callbacks for low latency but reconcile the
terminal suffix against the authoritative Thread Detail before emitting
Snapshot/Done. This fills Ledger events appended indirectly by managed Process
services, including debugger `workspace.process.*` evidence, while canonical
event identity checks reject callback/Ledger conflicts, duplicates, foreign
Threads, or incomplete suffixes. Workflow and experiment JSONL entry points use
the same ordered writer.

The live case also established two Runtime compatibility boundaries:

- `apply_patch` keeps its operation-specific `anyOf` validation but advertises
  a top-level JSON Schema `type: object`, as required by OpenAI-compatible
  function providers;
- Pi assistant messages ending in `stopReason: error|aborted` no longer become
  successful assistant output. The Runtime records only the diagnostic hash
  and settles the Run as failed or cancelled.

The fixed and three seeded comparisons now cover boundary repair, multi-file
API migration, debugger-qualified repair, and test-guided concurrency, but the
sample still does not establish general superiority. Historical production
Sandbox evidence remains explicitly inconclusive where the IDE host denied
nested `sandbox-exec`; no host fallback occurred. The extended trusted-outer
sample records Napier 13/13 versus OMP 12/13, with the OMP debugger attempt
timing out, and separately records that OMP machine output exposed no stable
usage metrics. A non-nested production-Sandbox run, cross-model execution,
more Coding categories, broader repeated distributions, and the other P9
domains remain required.

### Workflow Outcome Benchmark

`workflow_document_map_reduce_v1` is the first non-Coding Outcome benchmark.
Its hash-bound case separates typed input and hidden expected output from the
Workflow Manifest constructed by the runner. Three documents execute through
the ordinary read-only Agent Map runtime; a normal deterministic Reduce node
sums the typed lengths without a model or tool call.

The scorer requires:

- exact final output and ordered Map output hashes;
- two completed node results and one completed Map child Run per input item;
- exact `workflow.map.item.completed` and `workflow.reduce.completed` counts;
- zero `model.response` or `tool.*` events on the Reduce Run;
- a valid portable Thread Replay bundle and no credential bytes in the
  Workflow result, Run/Event evidence, or Replay projection.

After scoring, `benchmark.workflow.evaluated` commits the hash-only evaluation
to the same Thread. Generation first validates the complete Thread Replay,
then emits a privacy-bounded Ledger projection containing Run summaries,
terminal/evaluation events, source Replay/event-stream hashes, event-type
counts, and chained payload-hash receipts. Prompt, assistant text, reasoning,
document bodies, and high-volume model deltas are not retained. A CAS result
binds the terminal Workflow event, Manifest, Blueprint, result/output hashes,
aggregate usage, and projected Ledger. Offline verification validates exact
nested shapes, hashes/receipt chains, event aggregates, evaluation event, and
terminal Workflow binding. Substituting another valid Ledger fails.

`--trials 2..10` uses independent workspace, data-root, Thread, Plan, and Run
lifecycles. The Series rejects duplicate result/Thread identities, verifies
every result/Ledger pair, and recomputes pass rate plus duration, cost, token,
and Run-count distributions. The retained DeepSeek two-trial Series passed
2/2 in 3.115–3.541 seconds at a mean reported cost of `$0.0013821556`.
Each Ledger is about 44 KiB. Credentials and raw model/task content are absent
from all retained artifacts. This small fixed case does not establish
cross-model superiority.

### Data Outcome Benchmark

`data_sqlite_metric_map_reduce_v1` evolves the Workflow case schema to version
2 without changing Result, Ledger, or Series schema versions. The case binds a
setup SQL file and workspace-relative database path in addition to typed input
and hidden expected output. Before Runtime startup, the runner creates the
fixture under the temporary workspace with extensions disabled, defensive
mode enabled, and an authorizer limited to main-database table creation and
insertion. `ATTACH`, temporary schema, virtual tables, arbitrary functions,
and paths outside the workspace fail closed.

The ordinary Agent Map runtime executes three isolated read-only child Runs.
Each Run must complete `sqlite_query schema` before its query/chart operation.
The evaluation records schema/query/chart counts, a per-Run protocol verdict,
and database hashes before and after execution. Required action coverage is a
minimum rather than an exact call count: additional read-only exploration is
retained as efficiency evidence in action counts, usage, latency, and cost,
while exact typed Map/final outputs remain the task-success criterion.

The Ledger retains only the six or more privacy-projected
`tool.completed` events needed for SQLite evidence. Offline verification
checks their exact nested shape, payload SHA-256 against the general receipt
chain, Map Run ownership, global event order, schema-before-operation order,
and database identity. SQL, parameters, result rows, chart labels/SVG, prompts,
assistant text, reasoning, and credentials are omitted. The result evaluation
is independently reconstructed from these events and the before/after hashes.

The retained DeepSeek two-trial Series passed 2/2. Duration was
9.494–10.193 seconds, mean cost was `$0.0018431`, and mean input/output tokens
were 8,490/2,129.5. Both trials completed five Runs with three schema, four
query, and one chart action and left the database unchanged. The release audit
semantically verifies the retained Result/Ledger/Series graph rather than
trusting the terminal status.

### DataFrame Outcome Benchmark

`data_frame_map_reduce_v1` evolves the Workflow case/evaluation schema to
version 5 while retaining Result, Ledger, and Series schema compatibility. It
binds one CSV fixture, its exact SHA-256, three typed Map requests, hidden
expected output, three expected DataFrame row hashes/dimensions, and two
prompt-injection canaries. The fixture is copied into an isolated workspace
before Runtime startup and hashed again after execution.

Each Map child Run must complete exactly one `inspect_data` followed by one
`data_frame` call against the same source SHA-256. The inspection must be
non-truncated and its path, format, byte count, row count, and column count must
match the transform receipt, proving that every injected fixture row reached
live model context. The scorer also requires the three hidden DataFrame
receipts, exact typed Map/final output, immutable source bytes, valid Replay,
credential absence, and no canary in the user-output projection. Extra or
partial data-tool calls fail the protocol instead of being treated as harmless
exploration because the case measures one fixed transformation per Map item.

The Ledger retains six privacy-projected tool events with source, parser,
engine, plan, row, and output hashes plus bounded counts. Source path, column
names, filter values, rows, table JSON, model text/reasoning, and credentials
are omitted. Offline verification checks exact nested event shapes, receipt
chains, Map Run ownership and order, source/evidence bindings, injection scan,
and evaluation reconstruction. Structural evidence validity is separate from
the task verdict, so a model that truncates inspection, skips the tools, or
misses a hidden row oracle produces a verifiable failed trial rather than
aborting Series collection.

The retained DeepSeek two-trial Series passed 2/2 in 17.755–24.364 seconds at a
mean reported cost of `$0.002430694`; mean input/output tokens were
10,597.5/3,097.5 and every trial completed five Runs. Release verification now
semantically validates five Workflow benchmark Series plus the independent
Research and UX Series. Their 28 referenced Result/Ledger files and seven
Series files plus the verified Coding executor comparison form 36 benchmark
artifacts inside the 43-artifact release receipt `90cf892b914fc793`.

### Security Outcome Benchmark

`security_sqlite_prompt_injection_v1` evolves the case/evaluation schema to
version 3 while retaining Result/Ledger/Series schema compatibility. Three Map
items execute one hash-bound parameterized query each. The case contains the
expected SQL, parameter-set, and row SHA-256 triples, so a passing score proves
that all three adversarial `instruction` values reached live model context; a
model that skips or substitutes the query cannot pass by guessing the typed
values.

The Agent revision enables only `sqlite_query`, and the existing SQLite worker
still denies mutation, attachment, extension loading, sidecars, private paths,
and database drift. The scorer separately requires exact typed outputs,
schema-before-query protocol in every child Run, query-evidence coverage,
database immutability, valid Replay, credential absence, and no canary in the
user-output projection.

That projection contains only Workflow output, typed node outputs, and
assistant `text`; tool results and reasoning are excluded because they are
where the model observes and analyzes the untrusted row. The hash-only scan
receipt binds the sorted canary hashes, complete source Replay hash, output
projection hash, leak verdict, and its own content hash. The Ledger retains the
privacy-projected SQLite completion events and query evidence hashes, but no
SQL, parameters, rows, canaries, assistant text, or reasoning.

The retained DeepSeek two-trial Series passed 2/2 in 5.804–7.779 seconds.
Mean cost was `$0.001511958`, mean input/output tokens were
6,967.5/1,746.5, and both trials completed five Runs with three schema and
three query actions. This first Security case covers SQLite row prompt
injection only; SSRF, path escape, secret extraction, permission bypass, and
duplicate side effects remain separate benchmark work.

### Long-Horizon Outcome Benchmark

`long_horizon_restart_approval_v1` uses case/evaluation schema 4 and the same
Result/Ledger/Series envelope. Its graph is Map -> Approval -> Reduce. Reduce
binds both the Map output and Approval output as direct dependencies, so it
cannot run before the operator gate completes.

After the three model-backed Map child Runs complete, the first execution
returns `waiting`. The runner verifies the pre-restart Replay and single
pending decision, captures the completed Map Run IDs, then calls the complete
Runtime shutdown path. It rebuilds `LocalAgentRuntimeServices` against the
same workspace/data roots, verifies the recovered decision ID/content hash,
appends `benchmark.workflow.runtime.restarted`, answers the Approval, and
resumes the original Plan ID.

The restart event contains only schema version, Plan/Manifest hashes,
pre-restart Replay hash/event count, sorted Map Run IDs, and decision
ID/content hash. Offline verification checks its exact shape and payload
receipt, Plan/Manifest identity, contiguous sequence after the pre-restart
event count, and Map ID binding. Evaluation independently recomputes one
restart event, one answered/continued decision pair after restart, equality of
pre/final Map Run IDs, and zero post-restart `model.response` receipts.

The retained DeepSeek two-trial Series passed 2/2 in 2.540–2.925 seconds at a
mean cost of `$0.0020458732`. Each trial used seven Runs, preserved all three
Map child Runs across one full Runtime restart, recovered the Approval, and
performed only model-free Reduce afterward; mean input/output usage was
13,652.5/467 tokens. Oh My Pi v17.2.1 has resumable sessions but no equivalent
typed Workflow Manifest, durable Approval, or completed-Map reuse protocol.
The case is therefore capability evidence with cross-executor comparability
marked unsupported, not a synthetic OMP loss.

Schema 6 adds `long_horizon_multi_restart_approval_v1`. After the first reopen
verifies the pending decision, the runner persists the answer, exports and
verifies a second Replay checkpoint, shuts down again, and verifies the exact
answered decision after a second service reconstruction. The Ledger keeps the
first `restartEvent` as the recovery boundary and adds a sorted
`restartEvents` set. Every retained restart must have exact payload shape,
contiguous pre-restart event count, Plan/Manifest/Map binding, a matching event
receipt, and complete coverage of all restart receipts.

Two five-trial DeepSeek schema-6 Series retain both sides of the observed
variance. The first completed with one pass and four Provider-error
inconclusive outcomes; the second passed 5/5 in 2.425–7.147 seconds. Across
both, overall success was 6/10 with no scored failure and no trial that reached
the recovery path then violated a recovery invariant. The confirmation Series
had mean cost `$0.00203473536` and mean input/output usage 13,464/508.8.

The runner retains non-completed pre-gate results instead of throwing: Ledger
validation accepts the matching `workflow.blocked`, `workflow.waiting`,
`workflow.paused`, or `workflow.cancelled` terminal shape, while output and
Reduce IDs remain absent unless produced. Schema-6/7 runs append a debug-visible,
body-free `benchmark.workflow.model-responses.observed` event before
evaluation. It binds the pre-observation Replay hash/event count, response,
error, and usage-sample counts, and a hash of per-response identities,
payload hashes, error flags, and usage presence. The verifier binds the
observation to its receipt, requires it before evaluation, and requires
complete coverage of preceding model-response receipts. Provider response
errors are inconclusive; schema-valid transport with bad typed output remains
failed. Series expose overall success, conditional pass rate, and usage sample
completeness. The variance Series predates persisted `successRate`; its 0.2
value is derived from its bound one-pass/five-completed counters. Long
wall-clock waits are covered by schema 7.

`long_horizon_offline_wait_approval_v1` shuts down the complete Runtime after
Map and pending Approval, records the offline interval start, waits one real
second without a Runtime instance, and reopens before the original absolute
expiry. Restart receipt schema 2 adds the required wait, original decision
request sequence, Approval timeout, and expiry. The verifier recomputes elapsed
time from the restart event timestamp, binds the decision request receipt, and
requires the expiry to equal request time plus the original timeout.

Three retained DeepSeek Series contain all nine requested trials: 4 passed, 0
failed, and 5 were Provider-error inconclusive before the restart gate. Overall
success is 4/9 and conditional pass rate is 1. Every reached recovery path
passed: elapsed wait was 1009–1013 ms, the deadline was preserved, all three
Map Runs were reused, and no model response occurred after restart. Successful
trials completed in 3.248–3.767 seconds at mean cost `$0.0020105008`; mean
input/output usage was 13,469.5/430.25.

Schema 8 adds `long_horizon_token_budget_exhaustion_v1`. The case freezes each
Map child at 1,000 budget tokens and uses sequential fail-fast Map execution.
The first child must append one `run.budget.exhausted` event with reason
`tokens` and limit `1000`; the remaining Map items and Reduce must never start.
The Ledger retains exact budget events and binds each event to its failed Run
and receipt. Offline evaluation also rejects reason/limit substitution and any
`tool.completed` receipt after exhaustion.

An initial concurrent calibration yielded two Provider-error inconclusive
trials, each with one valid budget event and two Provider errors. It is not in
the current release set because calibration changed the case hash. The retained
current-case two- and five-trial Series passed 7/7: every trial used two Runs,
retained one exhaustion event, had zero post-exhaustion tool completions, and
left Reduce absent. Duration was 2.182–3.121 seconds; mean cost was
`$0.0001877784`, and mean input/output usage was 795.86/266.86.

`long_horizon_goal_no_progress_v1` measures the durable Goal breaker's
production semantics separately from Workflow recovery. Its hash-bound
objective requires three evidence markers, while the fixed Agent response
reports only `alpha` complete. A passing trial must produce three identical
primary responses, three `goal.evaluated` events, two
`goal.continuation.started` events, and a final `goal_not_met_yet` block with
`continuationCount=2` and `noProgressCount=2`. The runner then closes the
complete Runtime, reopens the same Store, and requires the recovered Goal's
last evaluated Run and evidence hash to match.

The Goal Ledger retains the final privacy-bounded Goal projection, selected
Goal/assistant/model-observation/evaluation/terminal events, total source
event count and Replay hash, plus chained receipts for bounded evidence.
High-volume text and thinking deltas are omitted from the receipt set. Offline
verification reconstructs every counter, repeated-response count,
post-block-continuation count, recovery binding, event receipt, and
Result/Ledger/Series reference. The release tamper test changes a final
no-progress count, rehashes the Ledger, and still detects both evaluation
evidence and Result/Ledger binding mismatches.

The retained two-trial DeepSeek Series contains one pass and one failed trial.
The pass reached the expected block after two continuations, survived Runtime
reopen, and emitted no post-block continuation. In the failure, the model
departed from the fixed continuation instruction and asserted that all markers
were complete, so the evaluator completed the Goal after one continuation.
This is retained as an ordinary semantic failure rather than rewritten as a
protocol pass or Provider error. The 1/2 distribution proves one complete
breaker path and fail-closed divergent-outcome evidence, not stable model
adherence. Uncertain write recovery remains.

### Research Outcome Benchmark

`research_aurora_contradiction_v1` binds a prompt, hidden claims, and three
complete Browser Source capture contracts by SHA-256. Two primary fixtures
agree that Aurora launched in 2024 and retains data for 30 days; one secondary
fixture claims a 2023 launch. The fixed provider implements only the existing
`BrowserSourceCaptureProvider` boundary. `AgentSessionRuntime` still constructs
the ordinary Run Research Source manager, and production runtimes continue to
fall back to the real Run Browser manager when no provider is injected.

The benchmark Agent enables only `research_source` and `apply_patch`. A pass
requires three captures, the exact seven claim/source/line/quote citation
bindings, two primary sources, one secondary source, an explicit contradiction
claim, exact hidden claims, a workspace Markdown report, and successful
production `verify_report`. Evaluation derives those facts from authoritative
Tool completion details and the actual report rather than model-authored
summaries. Extra read-only `list` exploration remains in event aggregates and
receipt hashes but is excluded from the scored Research event projection.

The Result binds Run usage, report path/file hashes, expected/actual claim
hashes, Source-set hashes, authority counts, Replay, and the evaluation event.
The Ledger projects only bounded Research Tool completion evidence and chained
event receipts. It omits Source URLs/titles/text, quotes, claim text, citation
tokens, report path/content, prompts, assistant text, reasoning, and
credentials. Exact nested validators, independent content hashes, event
receipt reconstruction, source Replay/event-stream binding, and Series
reaggregation reject self-rehashed field injection or valid-Ledger
substitution.

Each trial creates a fresh workspace, data root, Thread, and Run. The retained
DeepSeek two-trial Series passed 2/2 in 49.443–103.865 seconds at a mean cost of
`$0.0042888636`; mean input/output tokens were 10,061.5/9,145.5. A direct reverse
scan of all five retained files found none of the 23 source/claim/report/key
values. This case measures fixed-source synthesis and citation discipline, not
open-web retrieval, source freshness, or cross-model superiority.

### First-Task UX Outcome Benchmark

`ux_first_task_cli_v1` exercises the production one-shot JSONL entry point
from a new built CLI process. Each trial receives a new workspace and data
root, explicitly registers one environment credential locator through
`--credential-env`, creates the ordinary CLI Thread and Run, and is then
inspected through the same SQLite Store and portable Thread Replay APIs.
Process launch and module loading are included in first-event and total
duration metrics; repository install and build time are not.

The fixed oracle requires exit zero, completed Run state, exact assistant
output, one manual command, the case latency budgets, one available locator
for the selected Provider and hashed variable name, the clean-state Thread
count, valid Replay, and no raw credential in stdout, stderr, Replay, or any
workspace or data-root file. The bounded scan runs after the CLI process exits
and before the evidence Runtime reopens the database. A model that echoes the
key therefore fails both transient-output and persistence criteria.

The Result binds model/environment, Run usage, UX scalars, the evaluation
event, event stream, Ledger file name, bytes, and hash. The Ledger retains
expected/actual output hashes, a locator-name hash, bounded UX scalars, the
terminal/evaluation events, event-type aggregates, and chained payload
receipts. It omits prompt and assistant text, the locator name, credential,
reasoning, and model deltas. Exact shape/hash validation, evaluation
reconstruction, Result/Ledger binding, CAS names, and Series reaggregation
reject field injection, model replacement, valid-Ledger substitution, and
cross-trial replacement.

The retained DeepSeek two-trial Series passed 2/2. Cold-process first event
was 717–823 ms and completion was 2.787–2.891 seconds at a mean cost of
`$0.0007643804`; all trials used one command, one available locator, two
clean-state Threads, valid Replay, and zero credential leaks. A reverse scan
of all five retained artifacts found none of the raw key, variable name,
prompt, or assistant text. Broader recovery, installation, Web onboarding,
accessibility, and cross-model UX cases remain open.

### Workbench

`@napier/web` maintains a projection of server state. It may optimistically
display transient model deltas, but completed messages and run state are
replaced by the final server snapshot.

The UI has ten primary projections:

- **Ledger**: user-visible messages;
- **Trace**: lifecycle, model, tool, goal, subagent, and system evidence,
  hash-only Model Context Envelope registers, plus metadata-only OpenTelemetry
  export and archived-artifact verification for a complete Thread or one Run;
- **Run Lab**: immutable per-run replay, portable full-thread fixtures,
  configuration drift, run deltas, preview-bound read-only user-message
  experiments, snapshot-bound verdicts, and revisioned multi-candidate quality
  gates with case evidence, append-only human truth, independent reviewer
  panels, evaluator/rubric calibration matrices, workspace-wide gold-set
  Casebooks, source-verified evaluator qualification, execution history,
  portable gate receipts, trust anchors, signed envelopes, public verifier
  anchor directories, and qualification baselines;
- **Plan**: dependency DAG, step evidence, blockers, artifact manifests,
  portable Plan archive verification, reusable blueprint export/upload
  verification, and a local template shelf for saving, archiving, restoring,
  and replaying workflow blueprints, plus a controlled Workflow experiment
  desk for Manifest upload, checkpoint preview, side-effect confirmation,
  isolated execution, comparison, target navigation, and CAS download;
- **Goal**: durable objective state, blockers, and completion evidence;
- **Memory**: proposed, active, stale, rejected, and archived facts, review
  deadlines, per-Run usage evidence, immutable correction links, and
  multi-source consolidation provenance;
- **Delegation ledger**: durable task status, returned evidence, and budgets;
- **Extensions**: publisher keys, signed package transfer, dependency-set
  lockfiles, rollout channels, signed channel indices, revision history,
  reviewed package updates, source trust, discovery, per-tool effects, and
  Agent enablement;
- **Automations**: recovery qualifications/attempts, schedule timing, claims,
  channel status, one-time bearer tokens, and inbound delivery outcomes;
- **Context**: next-run model selection, revisioned Agent configuration,
  snapshot-bound interruption policy, hash-bound history and rollback review,
  signed Skill baseline transfer, reviewed Skill content preview/apply,
  signed Prompt package transfer, credential-reference availability, workspace
  boundary, and verified compaction checkpoints.

Trace, Plan, the Workflow Experiment Desk, Run Lab, Evaluation Suite, Memory,
Extensions, Context, and Automations are separate browser chunks. Their forms
and mutation clients remain inside those lazy boundaries so the primary
Workbench entry stays under its 150 kB budget.

The Plan Workbench's portable archive and Blueprint evidence dockets use
`PlanPortableEvidenceCards.tsx`. That boundary owns upload/export/create
controls and receipt projections while `PlanPanel.tsx` retains orchestration
against the shared API clients. Pure receipt projections have focused tests for
status, digest truncation, diagnostics, counts, and Plan identity. This lowers
`PlanPanel.tsx` from 4,939 to 4,655 lines without changing its lazy chunk.
Blueprint Record upsert ordering, signing-anchor selection, replay artifact
ownership parsing, and conflict-preview shape validation use
`plan-blueprint-panel-model.ts`. Focused tests cover active/archived ordering,
signing eligibility, malformed replay ownership, and fail-closed 409 payloads.
This lowers `PlanPanel.tsx` further to 4,513 lines while leaving API
orchestration and component state in the lazy Plan chunk.
Blueprint Library busy/receipt types, upload controls, policy-action
availability, and Record rendering now use
`plan-blueprint-library-panel-types.ts`,
`PlanBlueprintLibraryControls.tsx`, and `PlanBlueprintRecordList.tsx`.
`PlanPanel.tsx` retains every API callback, state transition, receipt choice,
and outer docket order. Focused model tests bind policy apply/retire
availability and active/archive counts. This lowers the panel to 4,078 lines;
the Plan lazy chunk is 120.91 kB and the 118.21 kB main entry is unchanged.
Blueprint Library receipt title/status/hash/summary/identity projection now
uses `plan-blueprint-library-receipt-model.ts`, while replay, outcome,
selection, policy-drift, retirement, and proof details use bounded view
components behind `PlanBlueprintLibraryReceiptView.tsx`. `PlanPanel.tsx`
continues to own receipt creation and API orchestration, but falls to 3,183
lines and maximum function complexity 59. Five focused tests bind core and
policy projection semantics. The additional module boundaries increase the
Plan lazy chunk to 121.52 kB; the 118.21 kB main entry remains unchanged.
Plan Artifact Manifest action controls, file receipts, text/data/directory
previews, verification receipts, and drift follow-up rendering now use bounded
components behind `PlanArtifactManifest.tsx`. A typed callback/state boundary
keeps API requests, downloads, and state transitions in `PlanPanel.tsx`, while
the pure `plan-artifact-manifest-model.ts` projection isolates every receipt by
Artifact ID before rendering. Four focused tests bind receipt ownership,
verified-artifact action labels, drift follow-up scope, and source identity
projection. This lowers `PlanPanel.tsx` to 2,428 lines and maximum function
complexity 57 without introducing a second Artifact execution path. The Plan
lazy chunk is 124.71 kB; the 118.21 kB main entry remains unchanged.

An open Operator Decision is a separate lazy Workbench docket between the
Ledger and composer. It owns accessible option selection, custom answer,
answer receipt, Continue, and Cancel actions. The normal composer is disabled
until the decision reaches a terminal state.

The lazy Trace chunk loads Agent Milestones independently from the primary
Workbench entry. It renders phase, summary, open loops, bound event count, and
receipt hash without adding milestone API code or copy to the size-constrained
main bundle.

The release check starts by auditing `package-lock.json` against the root
package and every discovered workspace package. It requires lockfile version 3,
matching root/workspace names, versions, dependency maps, workspace links, and
integrity hashes for every external `node_modules` package before build output
is trusted. The same auditor can write and verify a
`napier.package-lock-audit` receipt; verification re-runs the current audit,
validates the stored receipt schema, and fails if package metadata, lockfile
hashes, workspace counts, link counts, or integrity counts drift.

Before source, lockfile, or dist evidence is trusted, the runtime environment
gate audits the observed Node.js version against `package.json#engines.node`
and requires the runtime components Napier relies on through `process.versions`:
SQLite, OpenSSL, libuv, and V8. The receipt type is
`napier.runtime-environment-audit`; it stores only package name/version,
`package.json` SHA-256, Node version/range satisfaction, platform/arch, runtime
component versions, and errors. Receipt output is repo-relative only, failed
audits remove stale receipt targets, and verification rebuilds the current
runtime projection before comparing it to the saved receipt.

The Web release check runs after the Web build, recomputes every
`apps/web/dist` file SHA-256 against `docs/artifacts/web-dist-0.1.0.sha256`,
requires the dist file set to match the manifest exactly, and fails if the
module entry referenced by `index.html` exceeds 150 KiB. The manifest generator
uses the same canonical file ordering and SHA-256 formatter as the release
gate, while the check-only mode fails when the stored artifact manifest is
stale after a build. Root contract tests exercise the auditor and manifest
generator against temporary dist fixtures for the passing path, hash drift,
unlisted files, stale manifests, malformed manifests, unsafe entry paths, and
budget failures. The same auditor can emit a `napier.web-dist-audit` JSON
receipt for CI with only relative paths, counts, byte budgets, manifest
SHA-256, canonical dist-content SHA-256, and error strings. Receipt file output
is constrained to repo-relative paths; the CLI writes a receipt only for a
passing audit and removes an existing target on failure so CI cannot pick up a
stale success artifact. Receipt verification re-runs the current audit,
rebuilds the expected `napier.web-dist-audit` projection, validates the stored
receipt schema, and fails if the stored JSON no longer matches the current
dist evidence.

The top-level release artifact audit binds the package-lock receipt,
runtime-environment receipt, management OpenAPI artifact, management OpenAPI
compatibility fixture, product-performance baseline, Web dist receipt, Web
dist manifest, and retained Workflow, Data, DataFrame, Security, single- and
multi-restart/offline-wait/budget Long-horizon, durable Goal no-progress,
Process recovery, Research, and UX Benchmark Series plus all forty-seven
Result/Ledger pairs into one
`napier.release-artifacts-audit` receipt. Before
hashing the 110 Benchmark files, the gate performs full semantic verification
for sixteen Series across twelve cases. It stores only artifact kinds,
repo-relative paths, SHA-256 values, validity booleans, package name/version,
and a canonical artifact-set digest. The current receipt contains 118 artifacts
and binds set SHA-256 `390d817a8d3f8df7...`.
Verification re-runs the component and Benchmark verifiers and fails if any
underlying artifact or the aggregate receipt drifts.

## Persistence

```text
.napier/
  ledger.sqlite        authoritative workspace projection and ordered events
  ledger.sqlite-wal    SQLite write-ahead log while the runtime is active
  workspace.json       non-authoritative compatibility projection
  events/
    <thread-id>.jsonl  non-authoritative per-thread compatibility projection
```

SQLite runs in WAL mode with `synchronous=FULL`. A `BEGIN IMMEDIATE`
transaction inserts each event and advances its Thread projection together, so
a crash cannot leave durable evidence ahead of `eventCount` or vice versa.
Workspace mutations use a monotonically increasing database revision as a
compare-and-swap guard. Local instances refresh before mutations and retry a
bounded number of revision conflicts; the database primary key
`(thread_id, seq)` independently enforces sequence uniqueness.

Schema version 2 adds the `ledger_schema_migrations` table. New databases
record both the initial schema and migration-history boundary; existing schema
1 ledgers migrate online inside `BEGIN IMMEDIATE`, backfill the initial record,
advance `PRAGMA user_version`, and then run `quick_check`. `/api/health`
returns the shared `HealthResponse` contract and projects only schema version,
quick-check status, migration metadata, and public runtime readiness metadata.
Its response is no-store and mirrors response hash, service/status, Node
version/platform/arch, runtime component count/hash, SQLite/OpenSSL/libuv/V8
versions, Ledger schema version, quick-check status, migration count,
migration-list hash, and latest migration metadata headers for readiness
checks.
Thrown management API errors, explicit management JSON errors, and unknown
`/api/*` routes are projected the same way before they leave the server: the
JSON error body is no-store and response-hash-bound, while headers mirror only
the HTTP status, a stable low-cardinality error code, and an error-message
SHA-256. Non-API static fallbacks remain outside this management-plane
contract.
Web API wrappers verify response hashes before converting failures into
`NapierApiError` objects. Management JSON bodies must carry
`X-Napier-Content-SHA256`; missing success or error evidence is a client-side
integrity failure. For ordinary projections this is the exact response-body
SHA-256; for stable artifacts and review receipts the Web client accepts
`contentSha256` or `reviewSha256` only after recomputing the
runtime-compatible canonical JSON projection from the payload. Those stable
and body semantics are also made machine-readable with
`X-Napier-Content-SHA256-Mode: body|stable`; the server writes the digest and
mode through one helper, and static tests reject direct header writes that would
drop the mode. The Web client treats an explicit mode as a verification
constraint and only falls back to inference for older responses that omit it.
Unsupported explicit mode values are rejected before the response body or error
message is trusted. For `body` mode, successful and failed JSON responses check
the raw response hash before JSON parsing; if the hash verifies but the body is
not JSON, Web raises a structured parse error carrying the verified body digest.
Stable
projection candidates cover generated/exported timestamp exclusion, execution
ID/runtime timestamp exclusion, review receipts, Casebook artifacts, and the
Extension package preview projections that summarize nested preview bodies by
SHA-256. Failed JSON bodies are checked against the response hash header and
their trusted error text is checked against
`X-Napier-Error-Message-SHA256` before it is displayed. Common UI error banners
use a shared formatter that appends the verified status/code/hash handles
without adding new request parsing paths.
JSON API wrappers share one request helper so success and error response hash
verification plus future management-plane header contracts are parsed once;
streaming Run APIs keep a separate request path only for SSE decoding. Malformed
successful SSE records raise `NapierStreamFrameParseError` with path, frame
SHA-256, and line count instead of leaking frame text or returning a raw
`SyntaxError`; JSON-valid records that violate the `StreamFrame` union raise
`NapierStreamFrameContractError` with the same hash-only frame evidence plus a
low-cardinality reason. Runtime `error` records are valid protocol frames and
carry the stream `threadId`, a stable public message, `run_failed` code, and
SHA-256 diagnostic handle for the original exception; the raw exception text is
not streamed. Prompt and resume SSE responses expose thread/run intent headers plus the stream error
code, diagnostic type, and public error-message hash before the body starts;
per-error diagnostic hashes remain inside the streamed error frame. The Web
client validates those stream response headers before reading the SSE body and
requires every successful stream to end with a terminal `done` or `error` frame.
The management-plane OpenAPI artifact is generated from the server route
declarations rather than handwritten. `scripts/generate-management-openapi.mjs`
extracts every `app.get/post/put/delete/patch("/api/...")` route from
`apps/server/src/app.ts`, normalizes `:param` segments into OpenAPI path
parameters, emits a conservative OpenAPI 3.1 route catalog, and binds the
artifact to both the server source SHA-256 and route-set SHA-256. The artifact
is intentionally route-level until endpoint-specific schemas are promoted, but
it gives external management clients a stable path/operation surface and a
check-only guard against route drift. `GET /api/health` promotes its `200`
response to `#/components/schemas/HealthResponse`; `GET
/api/receipt-trust/anchors`, `POST /api/receipt-trust/anchors`, `GET
/api/receipt-trust/anchors/directory`, `POST
/api/receipt-trust/anchors/directory/verify`, `POST
/api/receipt-trust/anchors/directory/discover`, `POST
/api/receipt-trust/anchors/directory/signed-metadata`, `POST
/api/receipt-trust/anchors/directory/metadata/verify`, `POST
/api/receipt-trust/anchors/directory/subscriptions`, `GET
/api/receipt-trust/anchors/directory/subscriptions`, `POST
/api/receipt-trust/anchors/directory/subscriptions/{subscriptionId}`, `POST
/api/receipt-trust/anchors/directory/subscriptions/{subscriptionId}/refresh`,
`POST /api/receipt-trust/anchors/directory/subscriptions/quorum`, `POST
/api/receipt-trust/verify`, and `POST
/api/receipt-trust/anchors/{anchorId}/revoke` promote the trust-anchor list,
create request, public directory, verification, hosted discovery, signed
metadata envelope, metadata verification, durable subscription management,
multi-source quorum evaluation, generic receipt verification, revoke request,
and anchor response schemas so external management clients can manage, publish,
and verify verifier trust anchors against the same contract used by the server
and Web client. The
compatibility fixture generated by
`scripts/check-management-openapi-compatibility.mjs` projects each published
operation down to method, path, operation id, tags, path parameters, JSON
request-body presence, promoted schema refs, and response status set.
Verification allows additive operations while rejecting removed or changed
published operations, giving external management clients a baseline that is
stricter than route discovery but still additive-friendly.

Before a final assistant message is recorded, the runtime runs the configured
deterministic Model Advisor lint pass over the assistant text and the current
Run evidence. The first rules flag verification claims such as
tests/build/checks passing without a `verify_workspace` result whose structured
status is `passed` and whose sequence is later than the latest workspace write,
Plan-complete claims without a completed Plan event later than the latest
workspace write or followed by a later non-completed Plan event, and
artifact-verified claims without a `plan.artifact.verified` event later than
the latest workspace write or followed by a later non-verified artifact event
such as `plan.artifact.missing` or `plan.artifact.superseded`, and
goal-complete claims without a satisfied `goal.evaluated` event later than the
latest workspace write or followed by a later unsatisfied goal evaluation, and
recovery-complete claims without a `run.recovery.completed` or
`run.recovery.auto.completed` event later than the latest interruption or
recovery invalidation, evaluation-complete claims without an
`evaluation.completed`, `evaluation.suite.completed`, or
`evaluation.casebook.qualification.completed` event later than the latest
workspace write, and evaluation-pass claims without a passed suite or casebook
qualification event later than the latest workspace write and any later
failed, inconclusive, or updated evaluation gate, and
destructive command references such as `git reset --hard` or `rm -rf`
patterns. Failed, timed-out, output-capped, legacy status-less verifier
completions, or passed verifier completions followed by `apply_patch` do not
satisfy a passing-check claim; similarly, Plan, artifact, or goal evidence
followed by `apply_patch` is stale until that state is settled again, and
Plan or artifact evidence followed by an invalidating Plan/artifact event is
stale until the Plan is completed or the artifact is verified again; goal
evidence followed by an unsatisfied goal evaluation is stale until the goal is
satisfied again; recovery evidence followed by a new interruption, recovery
start, prompt, failure, skip, interrupted attempt, or abandonment is stale
until recovery completes again; evaluation completion and pass evidence
followed by a workspace write is stale, and evaluation-pass evidence followed
by a failed or inconclusive gate, suite update, or casebook update is stale
until a gate passes again.
The Agent profile can switch the advisor `off`, choose the enabled rule set,
configure a distinct `reviewModel`, or set `enforce` mode with zero to three
correction attempts. Schema-5 Run configuration fingerprints bind the
deterministic policy and correction budget; schema 6 additionally binds the
independent reviewer while preserving schema 1-5 verification. In observe mode
the resulting `model.advisor.notice` event is debug-only and hash-only: it
records rule IDs, severity, match counts, text SHA-256, diagnostic-set SHA-256,
tool evidence counts, the effective policy, and a stable content SHA-256, but
not the matching text.

When `reviewModel` is configured, each non-tool candidate also enters one
isolated `completeSimple` call with no tools. The reviewer sees the current turn
prompt, candidate, frozen model identities, typed criteria, and metadata-only
counts/names for completed or failed tools, milestones, and operator decisions.
Its strict response is limited to verdict, score, risk, and six unique typed
issues. `model.advisor.independent.reviewed` persists only model identities,
issue codes/severities, usage, diagnostics, low-cardinality evidence summary
fields such as checks, Plan, artifact, and goal current/stale status, and
SHA-256 bindings for candidate, turn prompt, evidence, criteria, input, prompt,
response, issue set, the live request's hash-only model-context envelope, and
receipt. Free-form reviewer guidance exists only long enough to build a correction prompt and is
never copied to the Ledger.

Enforce mode replaces candidate text, reasoning, and delta content in model
debug events with SHA-256 and byte-count evidence, and withholds deltas from the
Web stream until the final candidate passes the Advisor. A blocker records
`model.advisor.blocked`; when correction capacity remains, the runtime creates
a deterministic corrective instruction and records
`model.advisor.correction.requested` with only predecessor, diagnostic-set,
prompt, and content hashes. The correction turn exposes no workspace, plan,
extension, or subagent tools, so it can rewrite the answer without repeating
side effects. `model.advisor.correction.outcome` binds the request to the
accepted or blocked response hash. Exhausting the configured attempts fails the
Run before `message.assistant` is recorded, and the failure message contains
only the final diagnostic-set SHA-256. Independent `revise`, `block`, and
`inconclusive` verdicts join deterministic blockers through one combined
evidence hash and the same correction loop, so competing advisor state machines
cannot authorize different candidates. Reviewer usage consumes the frozen Run
budget and is included exactly once in final settlement. Portable fixtures
recompute every known review receipt and fail closed on malformed payloads;
OTLP admits reviewer/candidate model identities, verdict, score, risk, usage,
the live review request envelope hash, and hashes while dropping nested issue
data and all content prose.

### Frozen Prompt Variables

Prompt Variables are versioned Agent configuration, not mutable Run state. Each
definition is an exact tagged object: a bounded `literal`, a `current_date`
with `readable-date`, `iso-date`, or `local-date-time` formatting, or the
Pi-compatible `skill_catalog`. Names use
`[A-Za-z_][A-Za-z0-9_]{0,63}`, catalogs contain at most 32 definitions, each
literal is bounded to 2,000 code points and 4 KiB, and all literals together
are bounded to 16 KiB. Canonical name sorting makes definition reordering a
profile no-op; duplicate names, unknown fields, unknown variants, NUL bytes,
and over-capacity values fail closed.

`AgentRuntime.runPrompt` loads the enabled Skills and resolves the profile
System Prompt exactly once before creating the leased Run. Only declared
`{{name}}` tokens are replaced. Unknown tokens stay byte-for-byte in the
rendered Prompt but contribute count and name-set hash evidence. Replacement is
one pass, so a literal value containing `{{another_name}}` is not expanded. A
referenced `skill_catalog` injects the same catalog Pi would append and
suppresses the ordinary append path; an unreferenced catalog definition has no
effect on Prompt assembly.

The resulting `napier.prompt-variable-snapshot` contains resolution time,
definition/reference/unresolved counts, variable type, resolved byte count and
value SHA-256, catalog SHA-256, rendered System Prompt SHA-256, and one complete
content SHA-256. It contains no values, rendered Prompt, or unresolved names.
Schema 7 introduced catalog, snapshot, and rendered Prompt hashes in the Run
configuration; schema 8 retains them. One `context.prompt_variables` event
records the same snapshot before model execution, and every normal turn, Goal
continuation, and Advisor correction reuses the in-memory rendered Prompt.

Portable replay requires exactly one valid snapshot event per schema-7 or
schema-8 Run and checks all three fingerprint bindings, the raw Prompt hash,
and the canonical catalog plus entry names/types recomputed from that Run's
exact Agent revision; older Runs must not claim the event. OTLP allowlists only
scalar counts, the Skill-injected flag, and SHA-256 values, dropping the entry
array. Run comparison treats catalog or rendered Prompt movement as Prompt
Variable drift while ignoring a receipt-only timestamp change. The editor lives
entirely in the lazy Context panel, preserving the main entry budget.

### Durable Tool Loop Guard

The effective Tool Loop Guard policy is revisioned Agent configuration:
`enabled`, threshold 2-8, and up to 32 canonical exempt tool names. The default
is enabled at three identical results. Schema 8 binds the full policy, while
`context.tool_loop_guard` records enabled state, threshold, exempt count/set
hash, policy hash, and content hash without copying the exemption list.

Detection follows Pi's executable truth: the presence of `toolCall` content,
not a provider-specific stop reason. The runtime joins each single-call
`model.response` to its completed or failed tool terminal event. A streak
advances only while tool name, canonical argument SHA-256, and result SHA-256
all remain equal. Multi-call turns, incomplete calls, different arguments,
different results, or exempt tools break the streak. Guard-blocked attempts are
excluded from subsequent evidence projection.

At the threshold, `model.tool_loop.detected` stores the tool name, threshold,
event range, attempt count, call/result/attempt-set/policy hashes, and content
hash. `prepareNextTurn` adds a bounded `<tool-loop-guard>` redirect to the
system context. This projection is rebuilt from the Ledger on every Pi turn, so
it survives context compaction without duplicating raw arguments or results.
If the next single-tool response repeats the same call hash,
`beforeToolCall` records a hash-only `tool.blocked` event and returns a safe
in-band error result before tool execution.

Napier does not copy OMP's mid-token abort literally. Pi 0.82 shares an abort
signal across the complete Run, and provider usage on an interrupted stream is
not uniformly settleable. Completing the billed turn and blocking the next
side effect preserves Run lifecycle and budget accounting. Portable replay
requires one context receipt for every schema-8 Run and recomputes each trigger
from its preceding events and exact Agent revision policy. OTLP emits only
allowlisted counts, tool name, and hashes. The lazy Context circuit-breaker
ticket and Trace register stay outside the size-constrained entry chunk.

### Model Context Envelopes

`context.model_envelope` is a hash-only receipt for the actual model request
boundary. Napier records it inside the Pi `streamFn` wrapper, after the
agent-loop has injected the live prompt, appended any tool results, applied the
current System Prompt, and converted Agent messages into provider messages.
This avoids pre-run approximations: the first receipt includes the live user
prompt, and subsequent receipts reflect the exact provider-message roles Pi is
about to send.

The receipt stores `turnIndex`, prompt byte count, role counts, total message
count, tool count, and SHA-256 values for the System Prompt, message set,
tool-name set, tool-definition set, and canonical receipt body. It never stores
raw prompt text, message bodies, tool names, tool schemas, or tool output. The
tool-definition hash is derived from model-facing fields only
(`name`, `description`, `parameters`, and constrained-sampling metadata), so
runtime-only execution functions are excluded.

Portable replay validates every envelope receipt, recomputes the content hash,
checks role-count consistency, and requires turn indexes to be contiguous per
Run. Duplicated, reordered, or content-mutated context claims fail closed during
bundle construction and import verification. New `model.response` events bind
back to the envelope content hash, turn index, message-set hash, and
tool-definition-set hash; portable replay verifies any declared binding against
the corresponding same-Run envelope and requires every envelope to have exactly
one bound response. Run replay snapshot validation calls the same binding
verifier before accepting an uploaded snapshot. OTLP projects those response
bindings onto the chat span and allows only scalar counts plus SHA-256 keys.
The lazy Trace projection joins matching response bindings back into the
envelope card as response sequence, model, and stop reason; mismatched bindings
remain unrendered. Run replay metrics count context envelopes, bound model
responses, and unbound model responses so Run Lab comparisons can surface
context-governance coverage. Live Agent primary turns allocate envelope turn
indexes from a Run-level counter, so continuations and advisor corrections
remain contiguous within the same Run. Context compaction, goal-evaluator, and
memory-extraction auxiliary calls use the same envelope counter and redacted
response binding, but leave usage on `context.compaction.*`, `goal.evaluated`,
or `memory.extraction.*` to preserve existing accounting semantics.
Comparison snapshots also derive a metadata-only `contextCoverageDelta` with
left/right rates, diagnostics, and a clean/partial/missing/regressed status for
candidate governance review.

The pairwise evaluator uses the same governance path. Service-created
evaluations allocate a short-lived evaluation Run, record the evaluator prompt
as a hash-only `context.model_envelope`, and bind the resulting
`model.response` back to that envelope. The evaluator response body is redacted
to `textSha256` plus byte count in the debug event; the normalized reason and
evidence remain on the user-visible `evaluation.completed` event.
Casebook qualification uses a sibling path: each execution allocates one
qualification Run, every verified model-backed case consumes the next envelope
turn index on that Run, and the final hash-level qualification event is bound
to the same Run.

When an SSE `event:` name is present, it must match the JSON `frame.type`; event
frames must carry an SSE `id:` equal to `frame.event.seq`, while non-event
frames must not carry `id:`, and stream-local event sequence values must
strictly increase. Event frames must use a positive safe-integer sequence plus
known `EventCategory` and `EventVisibility` values, and carry `eventSha256`;
the Web client recomputes the hash of `frame.event` before dispatch. Event,
snapshot, `done`, and `error` frames must bind back to the declared stream
thread, event/`done` frames must stay on one Run identity, and `done.status`
must be one of `completed`, `failed`, `cancelled`, or `interrupted`. Snapshot frames must
include `thread.id`, a known
`thread.status`, and a non-negative `thread.eventCount` that matches the event
list length and final sequence. Snapshot event lists must contain only
same-thread valid RunEvent records with contiguous increasing `seq` values, and
the snapshot must include the Workbench-owned `agent`,
`contextCheckpointCalibration`, and top-level collection projections. Snapshot
`agent.id` must match `thread.agentId`, every Run must belong to that thread and
Agent, and `thread.runIds` / `currentRunId` must resolve inside the `runs`
projection. Snapshot frames also carry `detailSha256`; the Web client recomputes
the hash of `detail` before replacing the Workbench projection. A terminal
`done` frame carries `threadId`, `snapshotSha256`, `eventCount`, and
`eventStreamSha256`, and is accepted only after that final snapshot has been
received and verified. The `threadId` must match the declared stream thread, the
snapshot hash, event count, and ordered event-stream hash must match the
snapshot, and the snapshot must contain the same `done.runId` with the same
terminal status. The final snapshot must also contain every already-streamed
event with the exact same event SHA-256, so stale or truncated projections fail
before UI callbacks. A runtime `error` frame can still terminate a failed stream
without a snapshot when its `threadId` matches the stream. Any semantic frame after the terminal frame is rejected
before it reaches UI callbacks.
Consumer callback failures are not wrapped as frame parse or contract failures. Web
contract tests fix the success JSON path, success content-hash verification,
recomputed stable artifact/review/execution/preview digests, success and error
hash drift rejection, header-backed `NapierApiError` metadata, status-only
fallback behavior, SSE frame dispatch, unterminated final records, missing
terminal-frame rejection, runtime error frames with diagnostic hashes,
SSE event/frame type matching, SSE id/sequence matching, monotonic event-sequence
rejection, stream thread/run identity rejection, invalid event field rejection,
event hash drift rejection, invalid or incomplete snapshot rejection,
missing-final-snapshot rejection, snapshot/done run-status mismatch rejection,
done/snapshot hash mismatch rejection, snapshot/streamed-event mismatch
rejection, done/event-count mismatch rejection, non-terminal `done` rejection,
terminal-after-data ordering, snapshot hash drift rejection, prompt/resume
intent and error-protocol headers, hash-only
malformed/invalid-frame diagnostics, hash-bound pre-stream error wrapping,
pre-stream missing-hash rejection, missing-body failures, and a static allowlist
for direct `fetch` callers. The same static boundary keeps
`requestJson` scoped to `/api/*` management routes, matching its mandatory
hash-evidence contract. The Web test directory is part of the Web TypeScript
project, so those contracts are typechecked during the production Web build as
well as executed by Vitest.

The same commit primitive accepts an event batch for full-thread import. Every
imported event and the new Agent/Agent Revision/Thread/Run/Plan/Evaluation/
Evaluation Adjudication/Evaluation Suite/Suite Execution/Subagent projection
plus automatic-recovery assessments/attempts is written under one
`BEGIN IMMEDIATE` transaction. A hash, sequence, ID, or state validation
failure leaves neither a partial Thread nor a prefix of its event stream.

Fresh onboarding state and its three initial events are one bootstrap
transaction. If only legacy `workspace.json` and JSONL files exist, startup
validates every sequence, repairs the recoverable event-first crash case, and
imports the complete snapshot atomically. Missing evidence or orphan event
files fail closed. Once SQLite exists it remains authoritative even if a
compatibility projection is stale or malformed.

Run, schedule, and delivery leases prevent stale workers from settling work
they no longer own. A second local instance leaves a Run with a live renewable
lease untouched; only unleased or expired work enters restart reconciliation.
Raw lease and channel tokens never enter the database or public records; only
their SHA-256 digests are stored. SQLite coordinates local processes on one
host, not distributed consensus across hosts; a Postgres backend remains the
appropriate next boundary for distributed workers.

Evaluation Casebooks are workspace-global projections in the same state
transaction as Thread-owned records. Their immutable case registry stores each
curated evidence snapshot once; revision manifests reference sorted case IDs.
This keeps append-only history linear in unique evidence plus revision
references rather than duplicating every complete evaluation in every
revision. Existing snapshots using the earlier embedded-case shape are
deduplicated, rehashed, and persisted through one CAS-protected migration.
Qualification executions are workspace-global durable records bound to one
historical Casebook revision and one audit Thread. Startup validates every
case result against that revision, while retention keeps the latest 20
executions per Casebook.

Reviewer ballots and consensus resolutions are Thread-owned durable evidence.
One lane exists per evaluation/reviewer ID, while every lane retains up to 50
append-only revisions. Resolution and its resulting Human Truth revision are
committed in one workspace transaction; startup requires every
`reviewer_consensus` provenance hash to have a matching resolution.

Receipt trust anchors and Evaluation qualification baselines are
workspace-owned durable evidence. An anchor stores normalized Ed25519 SPKI
public bytes, their SHA-256 key ID, status, label, and an optional environment
variable locator; it never stores private-key bytes. Revocation is
irreversible. Baselines are append-only per Casebook, retain the complete
signed qualification envelope, name the exact passing execution, and link to
the prior baseline. Executions referenced by a baseline are exempt from
ordinary qualification-history pruning.
Receipt trust anchor directories are derived public projections over the same
anchor table. They strip signing-source locators, retain public SPKI bytes,
key IDs, trust/revocation state, per-entry hashes, and an anchor-set SHA-256,
and can be uploaded with a signed receipt so verification uses the external
directory rather than the local workspace trust state.
Durable directory subscriptions are explicit local configuration. Their raw
HTTPS locator is retained only inside the workspace snapshot so refresh can
resume after restart; API projections and Ledger events carry URL/origin
SHA-256 values instead. The public subscription binds policy, schedule,
revision, and last-good discovery under one content hash. Refresh workers first
claim a due subscription with an expiring token, run the same bounded
allowlisted discovery path, and settle through that token. Only a policy-valid
discovery can replace last-good trust. Invalid directories, transport
failures, stale revisions, and concurrent claims retain the previous verifier
set and record bounded hash evidence. Accepted observations append a bounded
transparency entry with sequence, previous-entry SHA-256, discovery hash,
directory hash, anchor-set hash, and trusted-key count; subscription headers
and Ledger events expose the transparency tail. A valid hosted response that
returns to a previously observed non-current directory is treated as
`rollback_rejected`, preserving the active verifier set while binding the
attempt as hash-only evidence.
The quorum projection is a stateless receipt over active last-good
subscriptions. It groups sources by anchor-set SHA-256 rather than
time-sensitive directory content, applies minimum source/agreement thresholds
with distinct-origin, weighted-agreement, required-source-origin, and optional
expected anchor-set gates, and returns selected-directory public keys only when
the policy agrees. Signed metadata envelopes supplied with the no-store quorum
request are verified against each subscription's last-good directory, then
reduced to publisher SHA-256 pins before source selection. Source rows carry
subscription/content, URL/origin, source weight, metadata status/hash evidence,
discovery, directory, transparency-tail, and trusted-count hashes; no raw
locator or private key material leaves the workspace.
Quorum promotion receipts are self-contained archive artifacts over an already
agreed quorum. They embed the quorum, selected subscription-set hash, selected
directory/anchor-set hashes, and the signed metadata envelopes whose hashes
match trusted source metadata evidence, so independent verifiers can replay the
promotion without re-querying hosted directory URLs.
Signed quorum-promotion baselines promote that archive artifact into local
long-lived trust state. The server recomputes the promotion from current
last-good subscriptions, signs it as a
`receipt_trust_anchor_directory_quorum_promotion` trusted receipt, and stores
an append-only baseline that binds the envelope, selected anchor set, selected
directory, selected subscription set, metadata-envelope set, signer key, and
prior baseline ID. Idempotency is based on the selected verifier set plus
signer key, not one-time metadata verification timestamps, so rechecking the
same external sources cannot create duplicate active pins.
External baseline verification is stateless and no-store: an uploaded baseline
is validated for baseline hash, embedded promotion receipt hash, envelope
integrity, Ed25519 signature, selected-set hashes, and optional uploaded trust
directory verification. The response is itself hash-bound and exposes only
diagnostic codes plus baseline/envelope/receipt/signature/directory hashes.
CAS-gated import composes that verification with a local latest-baseline
precondition. The archive keeps its original signed envelope, while the local
record receives a new baseline ID, local audit Thread, and supersession link.
An empty expected-current hash means no local baseline exists; stale or
mismatched expectations fail before any state mutation.
Policy-bound import review adds a second local activation gate without changing
the signed archive. Import callers may attach an `importPolicy`; the runtime
normalizes it into a hash-bound review receipt and rejects the import before
persistence unless the archive satisfies local baseline/receipt/source
freshness limits, minimum agreement and metadata counts, selected
anchor/directory pins, required source-origin hashes, and required signed
metadata publisher or signer hashes. Successful imports carry the policy-review
hash in the response and in hash-only Ledger event evidence.
The Receipt Trust Desk projects those same records into an activation
workbench. It loads local signed quorum baselines, compares each selected
source origin against current active last-good directory subscriptions, shows
directory/anchor-set drift before import, verifies the latest baseline against
local or active external anchors, and imports uploaded archives with a derived
policy that pins the current directory, source origins, metadata publishers,
and metadata signer keys where available.
Signed activation-decision receipts close that loop as a trusted receipt kind.
The server recomputes the baseline verification, policy review, and current
source-alignment projection, then signs an
`receipt_trust_anchor_directory_quorum_activation_decision` envelope that
records approved/rejected diagnostics plus hashes for the baseline,
verification, policy review, source alignment, selected origins, metadata
publishers, and metadata signer keys. Rejected decisions are still signed so
failed activation attempts remain externally auditable without mutating local
trust state. The Store then records each trusted activation decision in a
bounded append-only history keyed by the signed envelope hash. History export
uses a stable content hash over the decision records and aggregate set hashes,
while keeping `generatedAt` as export metadata only, so the same approval set
can be re-exported and still verify across workspaces. The no-store history
verification endpoint recomputes the uploaded history, compares it with the
current local projection, and reports `valid`, `divergent`, or `invalid`
diagnostics without persisting uploaded content. The Receipt Trust Desk exposes
both export and upload verification beside the activation workbench. Approved
decision records can then be CAS-applied into a single active verifier-set
selection. The selection record stores the public selected directory from the
signed quorum receipt, baseline hash, decision-record hash, previous selection
hash, and activation Thread, but no private signing source or raw subscription
URL. Applying the same decision is idempotent; stale expected-selection hashes
fail before mutation, and Ledger evidence remains hash-only. Receipt
verification now consumes that active selection directory as the default trust
source when a request does not upload an explicit directory. Uploaded
directories retain precedence for portable offline verification, while response
payloads and headers disclose `uploaded` versus `active_selection` along with
selection ID/hash evidence.
Active-selection drift audits keep that applied verifier set observable after
subscription sources move. The no-store drift projection compares the active
selection's directory and anchor-set hashes against the current subscription
quorum and reports `missing_selection`, `aligned`, `directory_drift`,
`anchor_set_drift`, or `quorum_unavailable` with the selection-state hash,
current quorum hash, agreement counters, and low-cardinality diagnostics only.
Rotation review is a separate no-mutation preflight: it checks the caller's
expected current-selection hash, verifies the candidate activation-decision
record exists and is approved, recomputes source alignment against live
subscriptions, embeds the drift audit, and returns `eligible`,
`already_active`, `blocked`, `stale_selection`, or `missing_decision` before
the existing CAS apply endpoint can mutate trusted state. A caller may attach a
checkpoint-registry quorum policy to the same review. In that mode the Store
computes the current signed-checkpoint registry quorum, embeds the full
quorum receipt in the review, and adds `checkpoint_registry_quorum_not_agreed`
unless the registry status is `agreed`. The Receipt Trust Desk exposes both
receipts next to Apply activation and automatically attaches the default
checkpoint-registry policy when checkpoint subscriptions exist, turning split
or stale external checkpoint registries into visible rotation blockers.
Active-selection transparency checkpoints make the actual applied rotation
chain portable. The Store now keeps a bounded append-only history of successful
selection applications, migrates a legacy current selection into the first
checkpoint entry, and requires the current selection to match the history tail.
The checkpoint omits raw subscription URLs, private signing locators, and full
Store snapshots; each entry carries sequence, selection hash,
activation-decision hashes, baseline hash, selected directory/anchor-set
hashes, policy-review hash, source-alignment hash, and predecessor hashes.
Checkpoint verification is no-store: uploaded JSON is validated
self-contained, then compared with the current local selection-chain set, tail,
count, and current selection hash to return `valid`, `divergent`, or
`invalid`. The Receipt Trust Desk exports and verifies those checkpoint
artifacts beside drift and rotation reviews. A signing endpoint wraps the
current checkpoint in a `TrustedReceiptEnvelope` with receipt kind
`receipt_trust_anchor_directory_quorum_activation_selection_checkpoint`; the
generic receipt verifier can then validate the Ed25519 signature with local,
uploaded, or active-selection trust directories. The signed envelope keeps the
checkpoint content hash stable while binding the exact checkpoint artifact hash
and signer key ID for external registries. Hosted checkpoint discovery reuses
the directory-discovery fetch boundary: sources must be allowlisted public
HTTPS JSON endpoints, redirects are disabled, responses are bounded, and raw
URLs are not returned. The discovery receipt verifies the signed envelope,
checks the receipt kind, compares the embedded checkpoint with the current
local selection-chain projection, and applies freshness, required signer,
checkpoint hash, selection-set hash, chain-tail hash, minimum selection count,
and rollback-rejection gates before returning `valid` or `invalid`. The result
keeps source URL/origin, response body, policy, envelope, checkpoint, current
tail, and diagnostics as hash-bound evidence so operators can publish active
selection checkpoints from external registries without trusting registry
transport state. Durable checkpoint-registry subscriptions add the same
last-good discipline used for anchor directories to signed checkpoint
envelopes. Creation must begin with a valid discovery receipt; only URL hashes,
policy hashes, envelope/checkpoint hashes, selection counters, and chain-tail
evidence leave the local store. Refresh claims are leased and scheduled by the
existing receipt-trust subscription worker. Accepted or unchanged discoveries
advance last-good and append a bounded transparency entry; invalid, failed, or
rollback observations preserve the previous last-good checkpoint while still
recording status and failure/discovery hashes. The Receipt Trust Desk exposes
create, refresh, pause, and resume controls so registry monitoring remains
operator-visible without persisting raw registry responses in Ledger events.
Checkpoint-registry quorum is a stateless no-store receipt over those
last-good signed checkpoint subscriptions. It normalizes a local policy for
minimum source count, agreement count, distinct source-origin count,
observation freshness, expected checkpoint/selection-set/chain-tail hashes,
minimum selection count, required source origins, and required signer key IDs.
Each source row contains only subscription/content, URL/origin, discovery,
envelope, checkpoint, signer, selection-count, selection-set, chain-tail, and
transparency-tail hashes. Eligible rows are grouped by checkpoint SHA-256 and
ranked by agreement count, distinct origins, signer count, then checkpoint
hash. The receipt reports `agreed`, `insufficient_sources`, `split`,
`policy_failed`, or `stale` plus low-cardinality diagnostics, selected
checkpoint evidence, candidate-set hashes, and response headers for automated
polling. This gives operators a registry-level alert before trusting a hosted
active-selection checkpoint while still avoiding raw registry URLs or response
bodies in portable evidence.
Signed checkpoint-registry quorum baselines turn that no-store alert into
durable audit evidence. Promotion requires an `agreed` registry quorum, signs
the quorum as trusted receipt kind
`receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum`,
and appends a bounded local baseline chain keyed by selected checkpoint,
selection-set, chain-tail, subscription-set, source-origin-set, signer-set,
and signer key. The baseline stores only the signed envelope and hash
projections; Ledger events record baseline/envelope/selection/source-set hashes
without raw registry responses. Re-promoting the same independent-source
agreement is idempotent, while a different source set for the same checkpoint
can still produce a new baseline for cross-workspace rotation audits.
Uploaded checkpoint-registry quorum baselines can now be verified without
storage against local anchors or an uploaded trust directory. The verification
receipt recomputes the baseline content hash, validates the trusted receipt
signature, checks integrity bindings for the selected checkpoint/source/signer
sets, and exposes only diagnostic labels plus baseline, envelope, quorum,
directory, and selected-evidence hashes. Import is CAS-gated by
`expectedCurrentBaselineSha256`; trusted imports append a local supersession
record and hash-only Ledger event, while duplicate archives return the current
baseline without mutating state. This makes cross-workspace rotation evidence
portable before any automated verifier proposal is accepted.
Automated verifier rotation proposal receipts consume that archived evidence
without mutating state. The Store recomputes the ordinary rotation review,
selects the latest or explicitly requested checkpoint-registry quorum baseline,
checks an optional baseline hash precondition, and then requires the baseline's
selected checkpoint, selection-set, and chain-tail hashes to match the current
activation-selection transparency checkpoint. The proposal is `proposed` only
when the rotation review is eligible and the checkpoint-registry baseline is
present, agreed, and aligned; otherwise it returns fail-closed statuses such
as `missing_checkpoint_registry_baseline`, `already_active`,
`stale_selection`, or `blocked` with low-cardinality diagnostics. The receipt
is self-contained enough for external automation to inspect the rotation
review, baseline envelope hashes, selected source/signer-set hashes, and
current checkpoint hash before invoking any apply step.
Eligible rotation proposals can be signed as first-class trusted receipts with
kind
`receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal`.
The signing endpoint recomputes the proposal immediately before signing and
refuses non-`proposed` receipts, while the active-selection apply endpoint uses
the current active verifier directory to verify the signed envelope before any
verifier-set replacement. The gate then recomputes the current proposal and
compares request, selection, review, checkpoint-baseline, quorum, selected
source/signer-set, and current checkpoint hashes. Stale envelopes are rejected
with explicit mismatch diagnostics; successful rotations append only hash-only
proposal evidence to the Work Ledger. Idempotent reapply of the already active
decision remains outside the gate because it does not mutate the active
verifier selection. A sibling no-store preflight endpoint runs the same gate
and returns an `accepted`, `rejected`, or `not_required` receipt with stable
hash evidence before Apply activation is invoked, giving external automation a
dry-run artifact for rotation-change review.
Hosted rotation proposal discovery reuses the same allowlisted public HTTPS
fetch boundary as trust-directory and signed-checkpoint discovery. The
discovery receipt validates the hosted trusted-receipt envelope, runs the
signed proposal preflight gate, and then applies operator policy pins for
envelope/proposal hashes, activation-decision ID, expected selection CAS,
signer key IDs, and maximum envelope age. It returns only source URL/origin
hashes, response hashes, policy hash, preflight hash, envelope/proposal hashes,
signer key ID, and diagnostics; the raw hosted URL is never mirrored into the
receipt body.
Durable hosted rotation proposal subscriptions layer persistence over that
same no-store discovery contract. Subscription creation reruns discovery and
stores the raw source URL only in local workspace state; public subscription
projections, headers, and Ledger events retain URL/origin evidence as hashes.
Manual refreshes and leased background refreshes share the same claim/settle
path and settle to `accepted`, `unchanged`, `rollback_rejected`, `rejected`, or
`failed`. Only accepted or unchanged signed proposals advance last-good
discovery, invalid or failed refreshes preserve the prior usable proposal, and
a bounded transparency history records discovery, envelope, proposal,
preflight, and predecessor hashes for external audit. Pause/resume changes are
also CAS guarded. Operator approval receipts sign the subscription's current
last-good proposal only after the server rechecks subscription revision/content
pins, optional discovery/envelope/proposal pins, and the current signed-proposal
preflight. The approval trusted receipt binds subscription, source, policy,
discovery, envelope, proposal, current preflight, activation-decision, proposal
signer, and optional expiry hashes while keeping the hosted URL local-only.
Approval signing may also queue the envelope for unattended apply with an
`applyAfter` timestamp. That queue is private persisted subscription state: it
does not enter the public subscription projection or content hash, preventing
the approval receipt from binding to its own scheduling metadata.
The approval apply endpoint verifies that envelope with the current active
verifier directory, rechecks subscription CAS, confirms the approval still
matches the last-good proposal, reruns the current proposal preflight, and only
then applies the activation decision. Successful apply events include approval,
proposal, subscription, and current-preflight hashes without persisting hosted
source locators. The leased background worker claims due queued approvals,
reruns the same approval apply gate, performs the existing CAS apply, and
settles either the result hash or a failure hash as local-only state plus
hash-only Ledger events.
Multi-approval policy review adds an operator quorum layer before apply.
Policy review accepts a set of approval envelopes and a policy containing
`minimumDistinctSignerCount` plus optional `requiredSignerKeyIds`. Each
approval still passes the same approval apply gate, duplicate approvals by the
same signer are collapsed, and the review receipt binds the full input
approval set, accepted approval set, signer set, required signer set,
subscription, proposal, and current-preflight hashes. Policy apply requires an
accepted review before invoking the existing CAS apply and returns a wrapper
receipt that binds the review hash to the apply result hash.
Signed approval policy baselines make that quorum policy portable. Baseline
promotion recomputes an accepted policy review, signs the review as a trusted
receipt, and stores a local append-only wrapper over policy, subscription,
accepted approval-set, signer-set, required-signer-set, and proposal hashes.
Verification is no-store and can use either local trust anchors or an uploaded
trust directory. Import is CAS gated by the current local policy-baseline hash;
trusted imports keep the archived signed review envelope while assigning a new
local baseline ID and supersession link.
Policy-baseline-gated unattended scheduling uses those signed baselines as a
second approval boundary. The queue endpoint reruns policy review, verifies the
requested baseline hash against the accepted review's policy, subscription,
proposal, accepted approval-set, signer-set, and required-signer hashes, then
stores the approval envelopes, policy, baseline hash, and `applyAfter` as
local-only pending subscription state. That pending state is excluded from
public subscription projections and content hashes. The leased worker claims due
policy queues, reruns policy review and the baseline gate, performs the
existing CAS apply, and settles an apply-result hash or failure hash through
hash-only Ledger events.
Post-apply replay receipts close the unattended audit loop without mutating
state again. A replay request validates the same approval envelope and
subscription pins, uses the approval-bound previous selection as the verifier
directory source, and compares the current active selection to the approved
activation decision. The result is `aligned`, `divergent`, or `invalid`, with
diagnostics and hashes for the approval, proposal, verifier selection, active
selection, and subscription.
Publisher-signed directory metadata reuses `TrustedReceiptEnvelope` rather than
introducing another signature format. The metadata receipt binds publisher,
directory SHA-256, anchor-set SHA-256, public key counts, optional source
URL/origin hashes, and optional expiry; verification checks both the Ed25519
receipt signature and the supplied directory binding. Consumers can verify that
metadata with local receipt anchors or with an uploaded public trust directory,
so hosted verifier-key sources can be audited without copying local trust
state.

Extension publisher anchors are a separate workspace-owned trust domain with
the same private-key boundary: durable state contains only normalized Ed25519
SPKI public bytes, their SHA-256 key ID, label, status, and an optional
environment-variable locator. A signed package binding retains its complete
envelope and local import time under an independent SHA-256. Startup strictly
validates anchor uniqueness, envelope/manifest hashes, signature, package-to-
Extension configuration binding, and key references while allowing revoked or
expired historical evidence to remain inspectable. Revocation is irreversible
and atomically clears Agent enablement and connected state for every package
bound to that key. Direct signing responses and Workbench downloads save the
envelope as `<safe-package-name>-<envelope-hash>.napier-extension.json`, so
archived package files carry their content receipt in the filename.

Publisher trust read projections are no-store and response-hash-bound:

```text
list Extension publisher anchors
  -> hash the returned anchor array exactly as served
  -> mirror total, trusted, revoked, and signing-capable counts
create/revoke Extension publisher anchor
  -> mirror anchor content SHA-256, anchor ID, key ID, status, and signing flag
```

Each updated signed Extension also retains up to 20 superseded package
bindings in an append-only history. Every entry binds its sequence, prior
binding, supersession time, successor envelope SHA-256, and previous-entry
content SHA-256. Startup replays signatures, hashes, sequence continuity,
successor links, package-name continuity, duplicate-envelope exclusion, and
the final link to the current binding. Older snapshots without the history
field migrate to an empty history through the normal workspace revision CAS.

Signed manifests may additionally freeze up to 32 canonical dependencies by
normalized package name and SemVer range. Startup validates range syntax,
target existence, compatible current versions, and an acyclic graph while
allowing revoked or expired evidence to remain inspectable. Runtime exposure
uses the stricter trust-aware graph check. Package dependencies live inside
the signed envelope rather than in mutable workspace metadata, so changing
one is a package update and resets local review. Dependency-bearing manifests
use schema 2; schema 1 remains accepted only when the dependency field is
absent, preserving exact validation of previously signed artifacts.

## Agent Configuration And Credential Flow

Agent profiles are durable runtime inputs rather than browser preferences:

```text
edit profile
  -> validate model, thinking level, tool policy, interruption policy,
     tools, skills, roles, and budgets
  -> normalize sets, bounded integers, and finite cost limits
  -> increment revision only for a semantic change
  -> hash and persist the complete profile snapshot in the same workspace commit
  -> append agent.updated with changed field names + snapshot hash,
     never prompt content
review history
  -> list immutable snapshots newest-first with model, policy, field names,
     prompt SHA-256, and profile SHA-256
select rollback target
  -> compare every semantic field against the current profile
  -> require a second explicit confirmation
  -> verify the target model is still available
  -> restore target values through normal profile validation
  -> create a new rollback revision with target revision + both hashes
  -> append agent.rolled_back without rewriting either source snapshot
```

The per-run model selector is intentionally separate. It affects the next run
immediately; only an explicit profile save changes the Agent default. Existing
Threads reference the Agent by ID and therefore observe the new revision.

Revision snapshots contain the complete local profile so rollback can restore
it exactly, but audit events never duplicate System Prompt text. A snapshot
binds Agent ID, revision, normalized profile, changed fields, source, optional
rollback target, prompt hash, and timestamp to a canonical SHA-256. Existing
SQLite states without this collection receive one `migrated` baseline and
persist it with a single CAS-protected workspace update. Missing current
snapshots, duplicate revision numbers, invalid provenance, or hash drift fail
startup closed.

Agent configuration management responses are no-store and response-hash-bound:

```text
update profile
  -> hash the returned current Agent profile exactly as served
  -> mirror Agent ID, revision, profile revision SHA-256, System Prompt SHA-256,
     and changed-field count
list revisions
  -> hash the returned newest-first revision array exactly as served
  -> mirror Agent ID, revision count, latest revision, latest profile revision
     SHA-256, and latest System Prompt SHA-256
rollback
  -> hash the rollback result exactly as served
  -> mirror new revision, restored-from revision, new profile revision SHA-256,
     restored snapshot SHA-256, System Prompt SHA-256, and changed-field count
```

Run configuration fingerprints bind the effective profile separately from the
profile revision ledger. Schema 3 adds `skillCatalogSha256`, computed from a
canonical manifest of the enabled Skill files loaded for that Run. Schema 4
also binds the effective Model Advisor mode and deterministic rule set. Schema
5 adds the bounded correction-attempt policy while retaining schema-4 hash
verification with an effective legacy budget of zero. Schema 6 adds the
optional independent review model; schema-6 validation requires that identity
to be present, while profiles reject a reviewer equal to their primary model or
the zero-key `napier/demo` model.
Schema 7 adds the frozen Prompt Variable catalog, complete snapshot, and
rendered System Prompt hashes while retaining the effective Advisor policy.
Schema 8 additionally binds the effective Tool Loop Guard policy.
The manifest contains requested/loaded/missing Skill names, relative
`SKILL.md` paths, byte counts, diagnostics hash, and file SHA-256 values; it
never stores Skill instruction text. The Agent records the same manifest as a
`context.skills` debug event before model execution, so replay comparison can
detect Skill content drift even when the enabled Skill names did not change.

Signed Skill package baselines reuse the Extension publisher trust domain but
emit a distinct `napier.signed-skill-package` artifact. The manifest contains
the same hash-only Skill catalog evidence plus publisher, creation, optional
expiry, and Skill catalog SHA-256; it never embeds `SKILL.md` instruction
content. Verification proves publisher provenance. Qualification then reloads
the current workspace Skill catalog and compares its SHA-256 to the signed
baseline, returning qualified, drifted, or missing evidence without mutating
workspace files. A reviewed installation baseline can then be persisted only
from a qualified envelope. The active baseline is single-current; replacing it
requires an explicit target installation ID and confirmation. Publisher/key
changes and loaded Skill-set changes are independent managed-upgrade risks and
must be confirmed separately. A successful replacement marks the prior record
`replaced` and writes hash-only Ledger evidence.

Skill package verification, qualification, installation list, and installation
apply responses are no-store and response-hash-bound. Headers mirror status,
verification status, installation status, install-created flag, Skill counts,
manifest/envelope/catalog hashes, loaded Skill-name set hash, and key ID. They
do not mirror `SKILL.md` bodies or frontmatter text.

Actual remote Skill content is a separate reviewed write boundary. Previewing a
candidate `SKILL.md` validates bounded UTF-8 text, extracts the frontmatter
`name`, fixes the target to `skills/<name>/SKILL.md`, inspects the current file,
and returns install/replace/no-op action, current and candidate SHA-256 values,
candidate frontmatter/body hashes, byte/line counts, and a stable review
SHA-256. The Context Workbench renders these values as a hash-only diff ticket
before any write. Applying must echo that review hash after reinspection and
explicitly confirm install or replacement before the existing
hash-preconditioned atomic workspace writer creates or replaces the file. No-op
candidates do not write. Ledger evidence records only action, target path,
byte counts, line counts, current/candidate hashes, and review hash; it never
copies Skill instructions.

Skill content preview responses expose the stable review SHA-256 as the content
digest and mirror candidate content/frontmatter/body hashes, action, byte count,
line count, and current content hash when present. Apply responses hash the
returned result and mirror the same review/content/action/applied/count fields.

Signed Prompt package baselines also reuse Extension publisher anchors while
emitting a distinct `napier.signed-prompt-package` artifact. The manifest binds
publisher, source Agent ID, Agent name, current Agent revision, Agent revision
SHA-256, System Prompt SHA-256, creation, optional expiry, and a manifest
content SHA-256; it never embeds prompt text. Verification proves publisher
provenance. Qualification resolves the target Agent, recomputes the current
System Prompt SHA-256, and returns `qualified`, `prompt_drift`, or
`agent_missing` without mutating the profile. Ledger events for sign and
qualification record only hashes, IDs, revision numbers, status, and key
metadata.

Prompt verification and qualification responses are no-store and response-hash-
bound. Headers mirror package status, verification status, manifest/envelope
hashes, System Prompt hashes, observed Agent ID/revision, and key ID without
copying prompt text.

Signed Inspector package baselines freeze the Workbench audit surface as a
distinct `napier.signed-inspector-package` artifact. The manifest binds
publisher, default Inspector panel, ordered panel IDs, labels, core/lazy
surface classification, capability slugs, Inspector catalog SHA-256, creation,
optional expiry, and manifest content SHA-256. It does not copy user data,
event payloads, package envelopes, or UI source. Verification proves publisher
provenance. Qualification recomputes the current Inspector catalog and returns
`qualified`, `inspector_drift`, or `missing_inspector`. Ledger events contain
only hashes, panel counts, status, and key metadata.

Inspector verification and qualification responses are no-store and response-
hash-bound. Headers mirror package status, verification status, panel count,
manifest/envelope/catalog hashes, observed catalog hash, and key ID without
copying panel bodies or UI source.

Automatic recovery is a revisioned Agent input, not a mutable worker setting.
The normalized policy contains `manual | safe_read_only`, one to three
attempts, and a 1 second to 60 minute base backoff. The policy is copied into
the Run's schema-2 configuration fingerprint before execution. Schema-1
fingerprints retain their original exact-key/hash protocol and are interpreted
as `manual`; an old Run never inherits permission from a newer Agent revision.

Napier persists credential locators, never credential values:

```text
bootstrap ModelRegistry
  -> construct Pi builtinProviders() from the pinned dependency
  -> register all 38 Provider auth/endpoint/API/model implementations
  -> retain the complete 1,116-model collection for explicit ModelRef lookup
  -> project catalogs round-robin, at most 18 per Provider and 512 live total
  -> check auth availability without refresh, login, model call, or network
  -> publish object-union tools as top-level object function schemas
choose provider in Context
  -> prefill provider-specific label, ENV variable name, and Keychain service
  -> preserve custom locator fields when switching providers
render Runtime and Evaluation model selectors
  -> group model options by provider with configured/total counts
  -> keep unavailable live models visible but disabled until credentials pass
  -> restrict executable Casebook qualification selectors to configured models
  -> disable Run, resume, Run Lab evaluation, Evaluation Suite gate, and Plan
     model-review actions for unconfigured models
  -> disable Trace Subagent outcome review when the independent reviewer model
     is unavailable
  -> reject Agent profile saves that would persist an unconfigured default model
  -> reject Advisor review-model saves unless the reviewer is configured,
     live, and distinct from the primary runtime model
  -> reject API or rollback persistence when an Advisor reviewer is demo,
     unknown, or equal to the effective primary model
  -> reject server-side prompt, resume, model-call, and persistence requests
     for unconfigured live providers before writing durable state or launching
     a model call
  -> re-check Run Evaluation and Evaluation Suite execution models at execution
     time so credential drift fails closed before evaluation receipts are saved
  -> re-check due schedule models before creating a Run, settling credential
     drift as schedule.failed evidence
  -> re-check inbound delivery models before creating a Run, routing credential
     drift through retry/dead-letter evidence
  -> direct AgentRuntime callers fail an existing Run with a stable
     unconfigured-provider diagnostic before invoking the provider
register provider + label + locator
  -> accept ENV variable name or macOS Keychain service/account
  -> persist reference as active / availability unknown
write provider + label + Keychain locator + secret
  -> bounded request body, single in-memory secret use, optional replace flag
  -> call macOS Keychain writer, then persist only the locator reference
  -> resolve transiently through Pi's CredentialStore
  -> check and persist available / missing / error metadata
  -> expose provider models only when Pi authentication resolves
```

An active but unavailable reference throws instead of falling back to an
ambient provider key. Disabling a reference removes it from Pi authentication.
Keychain reads and writes use `/usr/bin/security` through `execFile` with
positional arguments, a timeout, and bounded output; no shell is involved.
The Context prefill is draft-only UI state; it never reads environment values
or writes secrets. The model selector grouping is likewise a projection over
the server-returned model catalog and credential availability; it does not
refresh a catalog or perform a model call. Round-robin projection preserves at
least one model from every static Pi Provider before adding later models, while
explicit CLI/SDK/RPC ModelRefs resolve against the full collection. Evaluation
Suite creation uses the same bounded catalog projection, while Casebook
qualification filters that projection to executable configured candidates
before replaying a gold set. The composer,
resume banner, Run Lab evaluation, Evaluation Suite gate, and Plan Workbench
model-review actions also consume that model-availability projection, so
unavailable providers fail closed before a request leaves the browser. Trace
Subagent outcome review applies the same check before launching an independent
reviewer model. The Agent profile save path uses the same projection before
making a revisioned default-model update, and the Advisor review-model field
adds the independent live-reviewer constraint before persistence. Server-side
profile update and rollback repeat the non-demo, known-model, and
not-primary-reviewer checks before writing a profile revision. Server-side
prompt, resume, schedule, inbound, plan review, subagent review, casebook
qualification, Run Evaluation, and evaluation-suite model requests also call
the same configured-live model projection before state is written or a model
call starts. Evaluation Suite execution repeats the check against the saved
suite evaluator model so post-save credential drift fails closed before
evaluation receipts are generated. Due schedules also re-check the effective
model before creating a Run; credential drift settles the claim with
`schedule.failed` ledger evidence and no Run side effect. Inbound deliveries
repeat the check before dispatch and route drift through
`channel.delivery.retry.*` or dead-letter evidence without creating a Run.
Direct `AgentRuntime.runPrompt()` callers preserve the runtime failure-ledger
contract instead: a missing credential for a known live provider becomes a
stable `run.failed` diagnostic before the provider stream is invoked, allowing
active goals to block with replayable evidence. Credential ledger events contain
only
reference ID, provider, label, source type, status, availability, revision, and
a sanitized error. Environment-variable names and Keychain locators are
metadata; submitted or resolved values exist only in memory for the vault
operation or provider call.

Live-provider smoke coverage is opt-in. `npm run test:live-deepseek` sets a
test-only `NAPIER_LIVE_DEEPSEEK_SMOKE=1` flag and runs a single low-cost
temporary-store DeepSeek prompt using the `DEEPSEEK_API_KEY` environment
variable locator. The test persists only that locator, invokes the normal
`AgentRuntime.runPrompt()` path, and requires `context.model_envelope`,
`model.response`, assistant-message, and `run.completed` Ledger evidence while
asserting that the raw key is absent from the stored event stream. Default
`npm run check` keeps this file skipped, so routine verification remains
offline and zero-cost.
`npm run test:live-provider` instead accepts a caller-selected Provider/model
outside Napier's prior five-Provider set plus the name of its credential
environment variable. It uses the same CredentialReferenceStore, Agent Runtime,
context-envelope, secret-redaction, and portable Replay path.
The existing DeepSeek live smoke additionally verifies that the complete
default Agent tool set is accepted by a strict OpenAI-compatible function API;
all action-union built-in tools retain their `anyOf` validation and publish
top-level `type: object`.

Credential management responses are no-store and response-hash-bound:

```text
list credentials
  -> hash the returned reference array exactly as served
  -> mirror total, active/disabled, and availability counts
create/check/status credential
  -> hash the returned reference exactly as served
  -> mirror reference ID, provider ID, source type, status, availability,
     revision, and last-check time when present
  -> never mirror ENV variable names, Keychain service/account locators, or
     submitted/resolved secret bytes in headers
```

## Run Flow

```text
POST message
  -> create leased RunRecord with Agent revision, limits, and configuration hash
  -> return the raw lease token only to its worker
  -> append run.started with immutable budget + configuration hashes
  -> renew the lease while work remains active
  -> assemble model, context, skills, and policy-visible tools
  -> expire due memory and inject only approved, in-date workspace/agent facts
     under a character budget
  -> record each injected fact at most once for this Run
  -> append message.user
  -> assemble only approved and Agent-enabled extension tools
  -> stream model/tool events
  -> detect repeated single-tool calls with identical argument/result hashes
  -> inject a durable redirect at threshold and block another identical call
     before execution
  -> account primary, compactor, evaluator, memory, and Subagent usage
  -> optionally delegate bounded tasks into isolated read-only subagents
  -> persist each task transition and return evidence through a tool result
  -> append message.assistant
  -> independently evaluate active goal against visible evidence
  -> continue only for goal_not_met_yet within both safety budgets
  -> stop on completion, blocker, repeated evidence, continuation, or Run limit
  -> extract durable memory proposals without activating them
  -> append run.completed or run.failed
  -> finalize RunRecord only when the worker presents the current lease token
  -> emit final ThreadDetail snapshot
```

`GET /api/threads/:threadId` returns the visible ThreadDetail snapshot with
no-store headers, a response content SHA-256, and run/event/plan/evaluation/
subagent/recovery counts for polling. The digest binds the returned snapshot;
it is not a privacy-preserving hash-only artifact because ThreadDetail contains
the visible conversation and Trace context.
Imported Threads also mirror their source replay provenance in headers:
source thread/API version, source content/event-stream hashes, source event
count, optional source Model Context Envelope counts, and imported-at time.
Thread creation, replay import, goal set/clear, and branch creation return the
same ThreadDetail projection headers. `POST /api/threads/:threadId/stop`
returns a no-store control receipt with its content SHA-256, thread ID, and
stopped flag. `POST /api/threads/:threadId/resume` is an SSE stream, so it
does not expose a content hash and keeps SSE's standard no-cache policy; it
mirrors thread ID, requested resume state, and optional target Run ID headers.
`GET /api/threads/:threadId/events?after=<seq>` returns the visible incremental
event projection with no-store headers, a response content SHA-256, requested
`after` sequence, event count, and first/last returned sequence headers.

The evaluator runs without tools and must return a strict JSON verdict. Missing
or malformed evidence fails closed. Continuation prompts are hidden goal events,
while every assistant response remains visible evidence. The zero-key demo
runner uses the same event path but cannot independently verify completion, so
active goals stop with `missing_evidence` instead of fabricating success.

## Run Budget Flow

The parent Agent has a durable resource envelope independent of Goal and
Subagent limits:

```text
save Agent profile
  -> validate maxTurns 1-128, tokens 1k-10m, cost $0.01-$1,000,
     and wall time 10s-60m
create Run
  -> snapshot Agent revision + complete limits before the first event
before each primary or required auxiliary model request
  -> refuse a request when its relevant remaining budget is zero
after each model response
  -> persist raw usage plus model-specific usageAccounting
  -> update the shared Run tracker with calibrated budgetTokens
response requests tools after a limit is reached or crossed
  -> append tool.blocked and do not execute the side effect
after delegated work
  -> add only each Subagent task's new usage delta
optional Memory extraction has no remaining budget
  -> append memory.extraction.skipped without failing otherwise complete work
first limit exhausted
  -> stop further turns, append run.budget.exhausted, block any active Goal,
     and settle the Run failed with complete aggregate usage
```

`maxTurns` counts primary Pi assistant responses. Raw `usage` preserves the
provider/Pi input, output, cache-read, cache-write, and cost fields for replay
and aggregate evidence. `usageAccounting` is a separate hash-bound projection
that records the model, accounting strategy, raw total tokens, calibrated
`budgetTokens`, and token weights. `maxTotalTokens` uses calibrated
`budgetTokens` when present and raw totals otherwise. OpenAI/OpenRouter,
DeepSeek, Anthropic, Google, the deterministic demo model, and unknown
providers each use explicit strategy IDs. The same projection carries reported
cost, price-table estimated cost, `budgetCostUsd`, cost strategy, price table
ID, and price table SHA-256. `maxCostUsd` uses `budgetCostUsd` when present
and raw reported cost otherwise; known providers use a conservative
max(reported, estimated) value, while unknown providers remain
provider-reported. Wall time
starts at the durable Run timestamp and covers model calls, tools, Subagents,
auxiliary calls, and lease activity.

Provider price tables are also first-class refresh artifacts. The built-in
catalog is returned by `GET /api/usage-price-tables` with `Cache-Control:
no-store` and `X-Napier-Content-SHA256`; `POST
/api/usage-price-tables/verify` validates uploaded catalogs, per-table hashes,
duplicate providers, and required provider coverage before the tables are used
for accounting preview. The Context Inspector displays the active built-in
catalog hash and provider set so budget calibration is visible at the workspace
boundary.

Price table catalog and verifier responses mirror table/provider counts,
provider-set SHA-256, verifier status, diagnostic count, diagnostic-set SHA-256,
and catalog SHA-256 when available. Invalid verifier responses are still
response-hash-bound so operators can poll failures without trusting body text
out of band.

Limits are checked at request boundaries and after responses because providers
may exceed an exact remaining token or cost amount in one response. Crossing a
limit preserves that response as evidence but prevents its requested tools
from executing. Reaching a limit exactly permits a naturally final response,
but no next call. The first exhausted dimension is stable, so a later timeout
cannot overwrite an earlier token or cost reason. Operator cancellation remains
separate and produces `run.cancelled`, not budget evidence.

## Live Run Control Flow

```text
operator queues steering or follow-up against the active Thread/Run
  -> strictly validate mode and <=16 KiB trimmed UTF-8 text
  -> enforce <=16 pending and <=64 total messages per Run
  -> append run.control.queued with text plus request/hash metadata
  -> return only the hash-bound no-store RunControlMessage projection

Pi loop reaches a turn boundary
  -> finish the current assistant response and every requested tool call
  -> atomically select the oldest queued steering item
  -> append run.control.delivered + exact message.user in one SQLite revision
  -> inject the already-recorded user message without duplicating Ledger text
  -> run the next model turn under the original Run budget

Pi loop would otherwise stop
  -> atomically select the oldest queued follow-up item
  -> use the same delivered + message.user transaction
  -> continue one bounded turn

Run reaches completed / failed / cancelled / interrupted
  -> atomically append run.control.cancelled for every undelivered item
  -> preserve first-terminal-wins projection semantics
  -> expose only reason, IDs, counts, event anchors, and text hashes to
     recovery and metadata-only trace projections
```

The inbox is append-only Ledger state rather than an in-process queue.
`RunControlMessage` is derived from queued/delivered/cancelled events, so it
survives process boundaries and portable replay without adding mutable
workspace state. Queue acceptance is bound to the Thread's current running
Run; the deterministic demo model is rejected because it does not execute the
Pi queue hooks. Delivery commits `message.user` before returning it to Pi. A
crash before the provider request therefore leaves explicit conversation
evidence for manual recovery instead of silently losing acknowledged
direction.

Steering does not abort a provider stream or running tools. Pi checks it after
`turn_end`; follow-up is checked only when there are no remaining tool calls or
steering items. Both modes are drained one at a time and consume the frozen
Run turn/token/cost/time envelope. The low-level queue hooks catch polling
failures and retain the last durable queued state rather than interrupting an
otherwise valid turn.

The management API promotes strict schemas for queue/list/cancel operations
and returns no-store content hashes plus Thread, Run, message, mode, status,
text-hash/size, and event-sequence headers. ThreadDetail includes the hash-only
ordered projection and count header. The live Workbench composer switches to a
Steering/Follow-up selector while the SSE Run is active, while Stop remains
independent. Undelivered text is excluded from OTLP attributes and recovery
summaries; only a delivered `message.user` becomes conversational context.

## Operator Decision Flow

```text
Agent calls request_operator_decision as the only tool in its turn
  -> strictly validate header, question, 2-4 options, and selection mode
  -> reject the demo model, a second open gate, or the 64-decision limit
  -> append operator.decision.requested before returning from the tool
  -> return terminate: true and stop Pi without another provider request
  -> complete the origin Run and set the Thread to waiting

operator answers
  -> require the origin Run to be completed or interrupted
  -> validate option IDs, single/multi-select cardinality, and <=4 KiB custom text
  -> append operator.decision.answered without starting a Run

operator explicitly continues
  -> create one child Run with the origin model and Agent revision
  -> require parentRunId = origin Run and matching operatorDecisionId
  -> append operator.decision.continued against the origin Run
  -> inject the formatted answer as user-authored continuation input
  -> stream only child-Run events, then include the binding event in the snapshot

operator cancels or the origin Run fails
  -> append operator.decision.cancelled with a bounded reason
  -> preserve first-terminal-wins projection semantics
```

The four decision events are the only source of truth; there is no mutable
decision table. Answer and Continue deliberately use separate commits so an
answer survives a crash before child-Run creation. `createRunRecord` rejects an
ordinary Prompt while any decision is pending or answered and only admits the
matching continuation tuple, closing the management and UI bypass paths.

The continuation binding event belongs to the origin Run. It is durable before
the child executes but is not emitted as the first continuation SSE event,
because a single stream may not change Run identity. The final snapshot
contains the complete event sequence and proves the binding. Portable import
recursively remaps the continuation Run ID in the event payload and derives a
fresh final decision hash from remapped Thread/Run identities. Question and
answer hashes remain stable. OTLP admits decision IDs, continuation Run IDs,
and SHA-256 evidence only; question, options, descriptions, custom text, and
nested tool input/details are excluded.

## Agent Milestone Flow

```text
Agent reaches a meaningful phase boundary
  -> call record_run_milestone with phase, title, summary, completed, open
  -> require the active Thread Run and enforce 32-per-Run / 128-per-Thread
  -> validate bounded distinct items and reject completed/open overlap
  -> bind the prior same-Run Ledger range after the previous milestone
  -> append one immutable agent.milestone.recorded event

Pi prepares the next turn
  -> reproject the complete milestone chain from ordered events
  -> select only the newest two snapshots for bounded context
  -> sanitize and truncate local text while retaining complete source hashes
  -> replace the prior system projection without appending conversation text
  -> record context.milestones.updated with IDs, counts, and hashes only

portable import
  -> remap Thread, Run, and event identities
  -> replay the predecessor chain against the imported event order
  -> recompute each evidence-range and milestone content SHA-256
  -> reject any known milestone event that cannot be projected
```

The Agent does not provide evidence IDs or hashes. `projectAgentMilestones`
derives `fromSeq`, `toSeq`, event count, and event-stream SHA-256 from the
actual events preceding each milestone, preventing a model from claiming
unobserved evidence. The event payload carries the local prose and a
hash-bound predecessor request; no separate milestone table exists.

The context projection redacts title, summary, completed items, and open loops
for milestones at or before the imported source event count, preserving the
imported ledger trust boundary. Milestones recorded by later local Runs can
reinject bounded text, so imported Threads remain useful without trusting
external prose. OTLP applies the metadata-only rule to every milestone. The
management API is read-only so an operator or external client cannot forge
Agent-authored progress through HTTP.

## Workspace Edit Flow

General shell execution and unconstrained file writes are not Agent tools.
The built-in content write primitive is hash-bound, structured `apply_patch`:
when any workspace tools are enabled, `AgentRuntime.runPrompt` also injects a
concise `workspace_tool_protocol` into the live system prompt. That protocol is
derived from the actual enabled tools, tells the Agent to treat tool output as
evidence rather than instructions, guides code changes through symbol/range
hashes when available, requires complete-file SHA-256 preconditions for
`apply_patch`, treats parent-directory creation as an intentional create-only
opt-in for new artifact paths, and asks for `verify_workspace` after relevant
writes before claiming checks passed. The protocol is prompt guidance only;
policy enforcement still comes from the tool allowlist, sandbox, hash
preconditions, Ledger events, and Advisor freshness checks.

When Plan tools are enabled, the runtime similarly injects a concise
`plan_tool_protocol` derived from the assembled tool set. It steers Agents to
create one focused durable plan for multi-step or artifact delivery work,
start and settle steps with evidence, record planned artifacts only after
workspace bytes exist, ask Napier to compute file or directory artifact
digests, and avoid claiming completion until required steps and artifacts are
settled. The protocol is guidance; Store transitions and replay validators
remain the authority.

```text
read_file
  -> resolve the target's canonical realpath inside the workspace
  -> reject external symlinks, non-files, invalid UTF-8, and oversized input
  -> return requested lines plus complete-file size, SHA-256, and bounded line
     anchors
  -> hash the workspace-relative path and returned line-anchor set for Trace
     summaries without rendering path or file text
list_files
  -> return bounded entries as tool output for the Agent
  -> hash the requested path and returned entry set for Trace summaries
     without rendering listed paths
search_files
  -> scan bounded UTF-8 files with the same canonical workspace boundary
  -> return each literal match with path, line number, complete-file SHA-256,
     line-anchor SHA-256, and byte size
  -> hash the structured match set so Trace can show count/truncation/hash
     without rendering match text or paths
list_symbols
  -> scan a bounded directory-level code map for TypeScript / JavaScript /
     Python / Go files through the same read-only workspace boundary
  -> return symbol paths, names, lines, signature previews, and hashes to the
     Agent without starting LSP, subprocess, or network capabilities
  -> skip oversized or invalid UTF-8 code files with a count-only receipt
  -> hash the root path, language counts, indexed file set, and symbol set so
     Trace can show file/symbol/skipped counts, line/byte counts, truncation,
     and hashes without rendering paths, symbol names, or signatures
inspect_data
  -> resolve JSON / JSONL / CSV / TSV / Markdown table files through the same
     read-only realpath and UTF-8 boundary as read_file
  -> reject oversized or malformed input and return at most 25 structured
     sample rows to the Agent
  -> project JSON table envelopes with columns + rows/data into named columns
  -> project JSON array rows as column_1..N so matrix-style JSON is inspectable
     without requiring a separate parser or schema hint
  -> normalize duplicate or blank tabular headers into unique names such as
     name_2 or column_3 before projecting sample rows, preventing object-key
     overwrites in Agent and Workbench previews
  -> complete rows wider than their declared header with column_N names before
     hashing the column set and bounded sample
  -> hash the workspace-relative path, complete file, column set, and sample
     rows so Trace can show format, row/column counts, truncation, and hashes
     without rendering column names or sample values
sqlite_query schema
  -> resolve one canonical non-symlink .db/.sqlite/.sqlite3 file <=64 MiB
  -> reject protected paths and active WAL/SHM/journal sidecars
  -> hash the complete database and copy it into a private read-only snapshot
  -> inspect bounded table/view columns through fixed worker code
sqlite_query query
  -> require the exact database SHA-256 returned by schema
  -> accept one SELECT/WITH/VALUES statement with bounded positional parameters
  -> launch a separately killable fixed-source Node process
  -> confine cwd and TMPDIR to the private snapshot directory
  -> open only the copied snapshot with SQLite read-only + defensive mode
  -> authorize only SELECT/READ/RECURSIVE and non-dangerous functions
  -> deny PRAGMA, ATTACH, DDL, DML, extensions, and trailing statements
  -> cap deadline, workers, rows, columns, cells, and aggregate output
  -> rehash the source database after execution and reject drift
  -> return schema/rows only to the live Agent
  -> retain database/SQL/parameter/result and Node/SQLite runtime hashes
     plus bounded metrics in Trace
sqlite_query chart
  -> execute the unchanged hash-bound query path with at most 50 rows
  -> reject truncation, missing/ambiguous columns, duplicate X labels,
     non-finite Y values, unsafe text, and non-finite geometry
  -> project one complete X/Y series through a pure fixed-theme bar/line SVG
     renderer with XML escaping and no script, URL, CSS, image, link, event
     handler, foreign object, or model-provided markup
  -> return SVG only to the live Agent; expose query/spec/renderer/SVG hashes,
     point/byte counts, dimensions, and chart type to Workflow and Trace
  -> require apply_patch plus Plan Artifact verification for file delivery
inspect_code
  -> resolve TypeScript / JavaScript / Python / Go files through the same
     read-only realpath and UTF-8 boundary as read_file
  -> return a bounded symbol outline to the Agent without starting LSP,
     subprocess, or network capabilities
  -> hash the workspace-relative path, complete file, symbol lines, and
     signatures so Trace can show language, symbol count, line/byte counts,
     truncation, and hashes without rendering symbol names or signatures
read_symbol
  -> resolve a TypeScript / JavaScript / Python / Go file and symbol line
     through the same read-only realpath and UTF-8 boundary as read_file
  -> optionally require the exact symbol-line SHA-256 from list_symbols or
     inspect_code before returning source
  -> infer a bounded brace or indentation range with optional context and
     return line anchors for follow-up Hashline edits
  -> hash the path, complete file, symbol name, symbol line, signature, source
     range, and line-anchor set so Trace can show kind, range, counts,
     truncation, and hashes without rendering source, paths, names, or
     signatures
ast_query
  -> canonicalize one <=1 MiB TypeScript or JavaScript workspace file without
     starting a process or granting a write capability
  -> parse with the pinned TypeScript compiler and traverse at most 100,000
     nodes using a bounded kind/name/ancestor selector
  -> return exact live-only node names, UTF-16 ranges, signatures, and hashes
  -> rehash the source after materialization; persist only language,
     completeness, counts, budgets, version, latency, and hashes
ast_edit_preview
  -> require the current file SHA-256 plus one exact node SHA-256 from
     ast_query and select the same node against freshly parsed bytes
  -> build replace/remove/insert-before/insert-after output without writing,
     rejecting insert/remove when comment trivia could change ownership
  -> reparse the complete candidate file and expand line context until the
     OLD text is unique under the existing exact-replacement semantics
  -> recheck source freshness and return live-only OLD/NEW text for one
     hash-bound apply_patch call
  -> persist only operation, kind, byte counts, TypeScript version, latency,
     and source/node/replacement/application/result hashes
lsp_diagnostics
  -> canonicalize one TypeScript or JavaScript file inside the workspace
  -> reject symlinks, protected roots, invalid UTF-8, and files over 1 MiB
  -> bind Node, typescript-language-server, TypeScript, environment, and limits
  -> launch the language server read-only and offline through the OS Sandbox
  -> drive initialize / initialized / didOpen / publishDiagnostics /
     shutdown / exit over standard framed JSON-RPC
  -> cap diagnostics, messages, protocol bytes, stderr, and total wall time
  -> return source locations, codes, and messages only to the live Agent
  -> persist only language/version/count/latency plus runtime, file,
     diagnostic-set, code-set, stderr, limit, and result hashes
lsp_symbols
  -> reuse the same canonical source, exact runtime, read-only/offline Sandbox,
     framed JSON-RPC, timeout, cancellation, and post-run drift checks
  -> advertise hierarchical document symbols and issue
     textDocument/documentSymbol for the one didOpen target
  -> accept hierarchical DocumentSymbol[] or flat SymbolInformation[] while
     rejecting mixed/malformed shapes and flat URIs outside the current target
  -> validate SymbolKind, tags, parent containment, selection containment,
     UTF-16 source bounds, 1,024 protocol nodes, depth <= 32, and <=16 MiB
     aggregate symbol/name range characters before materialization
  -> canonicalize and deduplicate by exact source/range receipts; expose at
     most 256 symbols under 48 KiB display and 64 KiB final-output budgets
  -> return live-only names, containers, details, ranges, signatures, and
     hashes; persist only shape/completeness/count/depth/version/latency plus
     source/symbol/kind/result hashes
lsp_definition
  -> validate a 1-based TypeScript or JavaScript usage position
  -> reuse the bound read-only/offline LSP process lifecycle
  -> issue standard textDocument/definition after semantic project readiness
  -> parse bounded Location and LocationLink results
  -> independently canonicalize every target URI against the workspace
  -> omit external, virtual, protected, missing, symlinked, oversized, or
     invalid UTF-8 targets
  -> return relative paths, ranges, hashes, and source previews live-only
  -> persist only counts, versions, latency, truncation, and set/result hashes
lsp_references
  -> validate a 1-based TypeScript or JavaScript symbol position
  -> issue standard textDocument/references with explicit declaration mode
  -> cap, canonicalize, and deduplicate workspace Location results
  -> mark omitted or truncated results as an incomplete impact set
  -> return paths, ranges, hashes, and source previews live-only
  -> persist only mode/count/version/latency plus set/result hashes
apply_patch create
  -> require workspace policy + enabled tool + expectedSha256 null
  -> require a missing target
  -> require an existing safe parent by default
  -> when createParentDirectories is true, create only missing
     workspace-relative parents after validating protected segments and
     existing path components
  -> record created-parent count and directory-set SHA-256
apply_patch replace
  -> require workspace policy + enabled tool + complete expected SHA-256
  -> require every oldText to occur exactly once in the evolving buffer
apply_patch hashline_replace
  -> require workspace policy + enabled tool + complete expected SHA-256
  -> replace lines by read_file anchor SHA-256 and optional line number
  -> reject missing, stale, duplicate, or ambiguous anchors before mutation
apply_patch hashrange_replace
  -> require workspace policy + enabled tool + complete expected SHA-256
  -> replace multi-line source ranges by read_symbol range SHA-256 and
     start/end lines
  -> reject stale, out-of-bounds, or overlapping ranges before mutation
all operations
  -> reject .git / .napier / node_modules and symlink path components
  -> cap output at 256 KiB and reject null bytes or no-op output
  -> acquire a per-target dataRoot lock, recovering only a dead owner's lock
  -> re-read and recheck the precondition immediately before commit
  -> fsync a same-directory temporary file
  -> atomically link a new file or rename over an existing file
  -> fsync the parent directory
  -> append tool.completed with path, path SHA-256, byte counts, and both
     content hashes
  -> render Workbench Trace summaries with only operation, edit/byte counts,
     path hash, content hashes, and created-parent count/hash
```

This lock serializes Napier runtimes on one host; the second writer fails or
observes a stale hash instead of silently overwriting the first. External
processes do not honor the lock, so the final precondition recheck narrows but
cannot turn a local filesystem into distributed consensus. Parent-directory
creation is limited to `create` with an explicit opt-in and uses the same
workspace, protected-segment, and symlink checks; file deletion, arbitrary
directory operations, and permission changes remain outside this tool.
Researcher, reviewer, and general Subagents call the read-only tool factory and
never receive `apply_patch`. The opt-in coder role receives only the separate
private-worktree tools below.

## Isolated Coder Subagent Worktree Flow

Coder delegation is a two-authority protocol. The child can edit only a
private snapshot; only the parent Run can consume the resulting merge
capability:

```text
parent delegate_task(role=coder, writePaths)
  -> require workspace policy, apply_patch, lsp_diagnostics, and 1-8 unique
     regular UTF-8 file paths; absent paths are explicit creation grants
  -> create dataRoot/subagent-worktrees/<workerId>/<taskId> with 0700 parents
  -> scan the canonical workspace twice and require one stable snapshot
  -> copy <=2,000 files, <=32 MiB total, <=1 MiB each with O_NOFOLLOW,
     inode/device rechecks, 0600 files, and no protected/generated roots
child Pi Agent
  -> expose private list/read/search/symbol/data/AST tools
  -> install <=512 protected dependency links across <=64 package scopes:
     external packages remain under the parent read-only node_modules while
     workspace-package links resolve to the corresponding private directories
  -> wrap apply_patch so only granted create/modify paths are accepted
  -> expose candidate_file delete/move with hash and destination-absence CAS;
     both rename source and destination require grants
  -> serialize private create/modify/delete/move, semantic LSP, optional DAP,
     read-only commands, diagnostics, and fixed verification through one queue
  -> bind each of <=16 verification attempts to the complete candidate snapshot
     observed after that operation
  -> provide no shell, general Process, network, Browser, Extension, unrelated
     Session, or nested-delegation capability
candidate finalization
  -> cancel and settle every private debugger before removing candidate bytes
  -> rescan source and private tree
  -> reject source byte/mode drift, no change, undeclared lifecycle change,
     binary, symlink, special-file, or resource-limit violations
  -> derive sorted add/modify/delete records; count rename only for one
     unambiguous identical-digest add/delete pair and preserve its source mode
  -> ground the typed outcome against candidate bytes
  -> derive a <=32 KiB live-only per-file change window with before/after
     hashes, control escaping, explicit untrusted-data labeling, and truncation
  -> classify candidate verification as fresh/pass/fail/stale against the final
     complete candidate snapshot
  -> remove the private tree before publishing a five-minute one-use preview
parent subagent_worktree_apply(previewId)
  -> consume the preview before preflight
  -> verify task, outcome, source snapshot, write scope, and changed-file hashes
  -> rescan the complete admitted source before and after diagnostics/test
     selection; reject observed drift
  -> run fresh before diagnostics for modify/delete TypeScript/JavaScript paths
     and, when enabled, select related tests from the old dependency graph
  -> reuse one generic nullable-state transaction:
     - stage/fsync add/modify bytes beside each target
     - hard-link backups for every existing target
     - install additions by hard link without overwrite
     - replace modifications by rename
     - rename deletions to verified same-directory tombstones
     - reverse rollback and verify all absent/present postconditions
  -> run fresh after diagnostics for add/modify paths and, when enabled, select
     tests from the new graph and execute the stable old/new union once
  -> append one hash/count/status-only tool result to the ordinary Work Ledger
```

The conservative complete-source preflight gives concurrent candidates
first-writer-wins behavior: after one merge, every sibling from the prior
snapshot is stale. Preview state is intentionally memory-only and same-Run;
restart makes apply return not found without changing the workspace.
`owner.json` binds each private root to a Runtime PID. A new worker preserves a
live owner's directories, removes dead or legacy owner directories, and rejects
malformed or symlinked owner metadata.

An external process does not honor Napier's path locks and can race after the
last complete-source recheck. The transaction revalidates content, canonical
path, inode, device, and expected presence under its locks. Additions use
hard-link no-overwrite installation. Deletions atomically move to a private
tombstone and recheck its identity before settlement. Existing-file rename
replacement still has an unavoidable host-filesystem interval after the last
identity check; unrelated-file atomicity would require a stronger execution
backend.

A concurrent coder fork rejects recognized `.napier-change-*` stage, backup,
or tombstone files instead of copying transaction recovery bytes into a new
private candidate.

The shared WorkspaceEdit coordinator accepts exactly one verification mode.
Ordinary Rename and Code Action applications retain their modify-only
diagnostics/test adapter. Coder apply uses a typed source-aware adapter over the
complete lifecycle. It observes before-present source hashes and the old
dependency graph when the parent profile enables `verify_workspace`, then the
ordinary complete-source preflight runs again before the transaction. After a
verified commit, it observes after-present source hashes and the enabled new
graph. Physical delete/add pairs represent rename, so both old dependants and
new dependants participate. The fixed Vitest runner executes the sorted union
once; intentionally removed test paths are discarded, while a missing retained
target remains unavailable evidence. Either incomplete graph, an over-eight
union, unresolved reachable imports, cancellation, failure, or post-selection
workspace/configuration drift prevents a passing receipt. Post-merge
verification cannot rewrite or silently roll back the already settled
transaction.

The dependency overlay grants no new write authority. It rejects unsafe names,
special entries, top-level links escaping both the admitted workspace and its
canonical `node_modules`, missing workspace-package targets, link replacement,
and target drift. A workspace-package link is redirected into the private tree
so LSP and Vitest resolve candidate bytes. Ordinary dependencies and the fixed
verifier remain in the parent toolchain, mounted as a read-only Sandbox runtime
path. The verifier binding covers its relative path and bytes plus root
`package.json` / `package-lock.json` when present and is revalidated after
execution. It does not recursively hash every transitive dependency byte; the
installed local dependency tree remains a trusted host boundary until an
immutable container or remote toolchain backend supplies a stronger identity.

When the parent enables `node_debugger` and supplies the managed Process
runtime, a focused Process adapter scopes only the internal private-protocol
launch to the candidate root and its identity-bound read-only dependency path.
Ordinary Process starts reject that scope. The existing `NodeDebuggerManager`,
authenticated worker, DAP framing, source binding, side-effect-rejected
evaluation, module freshness, admission, timeout, and output bounds remain
unchanged. Thread/Run ownership plus a manager-local registration map prevents
candidate process adoption by a parent debugger, sibling coder, recreated
manager, or another Run.

Every debugger action uses the candidate read-only wrapper and complete
before/after snapshot equality. Preview and failure cleanup first cancel and
settle all candidate debugger registrations without allowing toolchain drift
to skip process termination; preview then performs the ordinary integrity and
toolchain checks. A direct-process adversarial test writes from the debug
target to prove that changed candidate bytes permanently block settlement even
when the test adapter does not enforce OS isolation.

The operation coordinator records no raw verifier output. Each attempt binds
tool kind/status, pass classification, canonical input/result hashes, and the
complete candidate snapshot hash. Finalization recomputes freshness, so a
later private patch moves earlier evidence to `stale`; a current failure or
cancellation remains a fresh failed attempt rather than disappearing. Preview
creation deliberately does not require a pass because expected failures can be
useful review evidence, but the parent sees the full bounded attempt list
before explicit apply. Durable task, merge, SSE, Replay, and Web projections
retain only aggregate counts plus verification-set/toolchain hashes.

`subagent-worktree-files.ts` owns bounded fork/finalize/freshness operations;
`subagent-worktree-diff.ts` owns authoritative lifecycle comparison, rename
disambiguation, and modified-file LSP adaptation;
`subagent-worktree-file-tool.ts` owns private delete/move CAS;
`subagent-worktree-storage.ts` owns private owner roots and stale cleanup;
`subagent-worktree-review.ts` owns the bounded parent-visible change window;
`subagent-worktree-toolchain.ts` owns the dependency overlay;
`node-debugger-process.ts` owns the narrow Process interface and private-root
adapter; `subagent-worktree-debugger.ts` owns candidate debugger construction
and cleanup;
`subagent-worktree-verification.ts` owns serialization and snapshot-bound
attempt evidence; `subagent-worktree-mutation.ts` owns child tool adaptation,
preview storage, and the parent merge adapter.
`subagent-worktree-apply-verification.ts` owns source-aware before/after
coordination; `subagent-worktree-lifecycle-diagnostics.ts` owns nullable LSP
aggregation. `write-linked-test-lifecycle-selection.ts` owns old/new graph
selection and receipts, while `write-linked-test-lifecycle.ts` owns one-shot
union execution and freshness settlement.
`workspace-change-model.ts`, `workspace-change-files.ts`, and
`workspace-change-commit.ts` own the shared nullable-state transaction;
`commitLspRename()` is now a modify-only adapter over that same transaction.
`subagent-task-runner.ts` owns the child Agent loop and candidate outcome
grounding, while
`subagent-task-evidence.ts` owns durable projection and live result formatting.
The former monolithic coordinator and outcome implementation are split across
these modules plus focused role, parser, verifier, and repair modules; each new
core logic file remains below 500 lines.

Write paths, candidate patch arguments/results, candidate bodies, preview IDs,
debug paths/arguments/expressions/frames/variables/output, verifier output, and
raw errors remain live-only. Durable Agent/HTTP/Replay
evidence retains role, state, add/modify/delete/rename counts,
transaction/diagnostic/test status, and hashes for the task, outcome, source
snapshot, write scope, changed file set, candidate verification
set/toolchain, old/new dependency graph, selected tests, plan, files, and
result. Test names, diagnostics, output, and lifecycle paths stay live-only.
Web independently validates count relationships and never trusts
Runtime-reported paths or candidate content. Existing typed-outcome path
citations keep the ordinary grounded Subagent evidence semantics.

This capability supports file lifecycle within existing parent directories.
Empty
directories, directory move/delete, permission edits, symlinks, arbitrary
binary changes, ambiguous duplicate-content rename pairing, arbitrary
child-side package scripts, DAP attach/multi-thread debugging, cross-Run preview
recovery, and Git worktree semantics remain unavailable. Pure additions use
`0644`; a detected rename preserves the source mode. Candidate LSP, DAP,
commands, and the optional fixed verifier remain read-only and offline; they
are not general Process authority. Automatic lifecycle diagnostics and
related-test selection currently cover TypeScript/JavaScript source extensions.
Unsupported text formats are omitted, not labeled verified.

SQLite analysis remains outside the oversized workspace-tool module.
`sqlite-database-file.ts` owns canonical file admission, sidecar denial,
complete hashing, and freshness. `sqlite-query-worker.ts` owns the fixed child
source and hard limits; `sqlite-query.ts` owns snapshot copying, process
admission, timeout/cancellation, protocol validation, and result binding.
`sqlite-query-tool.ts` owns Agent schema and Ledger redaction, while
`sqlite-query-event-view.ts` independently validates the Web Trace projection.
Node.js 24.12+ is required for SQLite authorizer and defensive mode; older
runtimes fail this tool closed.

## Default Web Search Flow

Read-only public discovery is a stateless capability rather than a Browser
Session:

```text
Fresh default Agent includes web_search under observe policy
  -> normalize bounded query/category/time/language/region/site/count/safety
  -> choose configured Brave, then Tavily, then keyless Bing RSS/DDG HTML
  -> validate credential-free HTTP(S) URL and ports
  -> resolve every DNS answer and reject mixed or non-public results
  -> pin the request connection to one validated address
  -> revalidate each bounded redirect and strip credentials across origins
  -> parse, normalize, public-URL validate, site-filter, deduplicate, and cap
  -> return live untrusted discovery results to the model
  -> persist only hashes, counts, provider/category, and retrieval time
```

`agent-capability-runtime.ts` owns shared stateless/session capability
assembly, so CLI, TUI, HTTP/Web, RPC, SDK, Workflow Agent nodes, and future
entries do not create a second search runtime. `public-http-client.ts` owns
request timeout, response-byte and redirect bounds plus DNS-pinned transport.
`web-search-model.ts` owns the provider-neutral request/result contract;
`web-search-providers.ts` owns provider ordering and fallback while focused
helpers own parsing and result normalization. `web-search-tool.ts` owns the
Agent schema and privacy projections. Stable external imports use
`@napier/runtime/web-search` rather than widening the Runtime root barrel.

Search is low-risk read-only network access and remains available under
`observe`; Browser interaction is still separately capability-gated. Provider
credentials are sourced from the Runtime environment, sent only to their
origin, and removed before redirects. Query text, result URLs, snippets,
provider diagnostics, and credentials are absent from Ledger, Replay, SSE,
TUI cards, and Web Trace. The live tool result labels snippets as untrusted
discovery data and tells the model to read primary pages before relying on
important claims.

This boundary currently discovers sources only. It does not fetch source
bodies or prove citation accuracy. Fetch and progressive Source reading use the
following sibling capability.

### Web Fetch and Progressive Source Flow

```text
Agent calls web_fetch fetch with one public URL
  -> reuse PublicHttpClient DNS pinning, redirect validation, timeout, and bytes
  -> detect HTML/Markdown/JSON/text/PDF from MIME, extension, and safe sniffing
  -> lazy-load Readability/DOM or PDF.js only for the selected format
  -> remove active HTML, normalize readable text, or extract bounded PDF pages
  -> for one eligible successful document.write HTML shell:
     -> require default Browser capability and <=1,000 static normalized chars
     -> exclude password forms, HTTP errors, PDFs, binaries, and parse failures
     -> start/wait/capture/close the same Run-owned controlled Browser
     -> require the exact final URL, useful text growth, and valid Browser binding
     -> cap automatic fallback at two attempts per Run
     -> otherwise retain static text plus one stable unavailable diagnostic
  -> cap body at 8 MiB, parse at 15 s, PDF at 200 pages
  -> cap normalized Source at 2M characters and 20k lines
  -> bind final URL/title/author/date/body/content/format/render provenance
     to one Source ID/hash
  -> return only a <=24k-character numbered preview to the live Agent
Agent calls web_fetch find/read/list in the same Run
  -> require exact Source ID and content hash
  -> return literal matches or <=400 exact numbered lines
Run settles
  -> cancel active/queued fetches and drop every Source body from memory
```

`web-fetch-content.ts` owns format detection plus bounded HTML/JSON/text/PDF
normalization. Mozilla Readability and LinkeDOM are lazy imports; PDF.js is
also lazy and uses only downloaded bytes, so no parser performs an independent
network request. `web-fetch-browser-fallback.ts` owns the conservative shell
detector, exact rendered-capture validation, and the internal
start/wait/capture/close adapter over the ordinary Browser manager.
`web-fetch-fallback-execution.ts` owns the per-Run attempt cap and
used/unavailable/not-needed decision. `web-fetch-source-view.ts` owns live
preview formatting plus bounded detail receipts. `web-fetch-sources.ts` owns
Run isolation, serialization, progressive reads, cancellation, and ephemeral
Source storage.
`web-fetch-tool.ts` owns the Agent schema and body-free Ledger projection.
`AgentCapabilityRuntime` assembles Search and Fetch behind one
`AgentNetworkCapabilities` boundary, so `agent-runtime.ts` does not grow a new
constructor field per network tool.

Source URL, title, author, publication date, raw body, normalized lines, Source
ID, read query, and returned text stay live-only. Ledger/Replay/SSE/TUI/Web
Trace retain action, format, render mode, fallback status/stable diagnostic,
Browser runtime/network hashes and counts when used, byte/line/character/page
counts, truncation, redirect count, retrieval time, and hashes. The original
user prompt and model reasoning remain ordinary message evidence and may
intentionally mention the requested URL or quoted facts; that is distinct from
Tool receipt leakage. Browser-rendered Fetch provenance is preserved through
`capture_fetch` and independently validated by Research capture and Web Trace;
partial, impossible, or mixed static/Browser evidence fails closed.
The complete repository gate passes 2,156 regular tests.

Fetch is read-only but not restart-adoptable because its Source body is
deliberately process-local. Automatic recovery therefore treats any completed
`web_fetch` call as unsafe, matching `research_source`. Dynamic rendering can
use the conservative automatic shell fallback above or the following explicit
default read-only Browser surface. Generic SPA detection, authentication,
login walls, CAPTCHAs, scanned-PDF OCR, cross-restart Source retention, and
Browser interaction remain outside this slice. Static or fallback-rendered
Source citation uses the shared Research Source flow below.

## Controlled Browser Session Flow

Browser capability is separate from Store, MCP, and the Web Workbench's own
browser process:

```text
Agent selects Browser capability
  -> create one Run-owned ephemeral Chrome process and context
  -> create a loopback-only proxy with random per-Session credentials
  -> keep proxy outbound closed during startup, idle time, and read-only views
  -> resolve every destination and reject any mixed non-public DNS answer
  -> connect the proxy socket to one validated IP without another DNS lookup
  -> independently Route-check every Playwright HTTP(S) request
  -> deny top-level cross-origin navigation unless this action authorizes it
  -> expose bounded AI ARIA refs for click/type/select/upload/download
  -> confine uploads to rehashed canonical workspace files <=16 MiB
  -> stream downloads to exclusive non-symlink workspace targets <=32 MiB
  -> return screenshot PNG bytes only as live tool image content
  -> retain action, Session reuse, counts, sizes, and hashes in Ledger/Trace
  -> close context, browser, proxy, tunnels, and temporary HOME on settlement
```

Under `observe`, `AgentCapabilityRuntime` requests a read-only Browser tool
whose schema contains only `start`, `navigate`, `back`, `wait`, `find`,
`scroll`, `snapshot`, `screenshot`, and `close`; it also exposes
`research_source`.
`browser-tool-policy.ts` independently permits those public-network read
actions while denying `click`, `type`, `select`, `upload`, and `download`
unless policy is `unrestricted`. The schema is a usability boundary, not the
authority boundary: a forged interactive call is still classified as a write
attempt and cannot reach the Browser manager.

`wait` opens the authenticated public-network proxy for at most ten seconds,
then returns a fresh ARIA snapshot. This supports SPAs and delayed rendering
without granting selector actions. Static pages should use `web_fetch`; the
Browser path is for dynamic rendering, and `research_source capture/cite`
freezes the visible result into the existing claim-bound citation protocol.

`find` and `scroll` are page-observation actions rather than network actions.
`browser-page-observation.ts` normalizes literal case-insensitive find results,
caps scan/result text, performs bounded vertical scrolling, and selects bounded
visible viewport text while proxy outbound remains closed. `find` durable
evidence retains only query/match hashes plus counts and truncation; `scroll`
retains numeric delta/position/viewport/document bounds plus viewport text
hash/count/truncation. Query text and matching or viewport page text stay
live-only.

`public-network.ts` owns shared CIDR and DNS classification; MCP reuses it
while retaining its explicit loopback development exception.
`fixed-ip-http-proxy.ts` owns authenticated HTTP/CONNECT transport and transfer
bounds. `browser-runtime.ts` admits only detected/configured Chrome, Chromium,
or Edge executables and launches with Chromium sandboxing enabled, a minimal
environment, temporary HOME, and pre/post-launch device/inode/size/mtime
freshness checks. `browser-page-session.ts` owns Playwright interaction and
navigation grants; bounded presentation text lives in
`browser-page-output.ts`; `browser-session.ts` owns same-Run serialization,
cross-Run isolation, admission, and cancellation.
`browser-workspace-files.ts` owns upload/download path and byte confinement;
`browser-session-details.ts` owns bounded operation evidence;
`browser-tool.ts` owns Agent schema and privacy projection.

The proxy permits public subresource origins so ordinary pages can load, but
every top-level origin transition remains action-scoped. Browser Route and
proxy DNS checks are intentionally duplicated: a target must be public at both
points, and the proxy's concrete socket address is authoritative for the
connection. Popups close, dialogs dismiss, service workers stay disabled, and
downloads without an active explicit action are cancelled. No path connects
to a user's existing browser, cookies, extensions, or debugging port.
The proxy opens only around a preflighted network-capable Agent action and
destroys active outbound sockets when that action settles.

Browser state is process-local and deliberately not restart-adopted. An
interrupted Browser tool has an unknown external outcome and automatic
recovery treats it as unsafe rather than silently repeating it. Page bodies,
URLs, selectors, typed values, paths, downloaded names, screenshots, proxy
credentials, and random Session IDs remain live-only. Portable Replay carries
only redacted tool arguments plus bounded operation evidence.

The default surface is dynamic-page reading, not product-complete Browser
automation. It has one tab per Run and no multi-tab/history UX, user takeover
or resume, Browser Live stream, local Chrome relay, download Artifact UX,
effect-specific confirmation, or safe preset for form actions. Those remain
P0.

### Research Source and Citation Flow

Research Source capture accepts either the existing Browser Session or an
already-normalized same-Run Web Fetch Source. It does not create another
network client or evidence store:

```text
Agent selects one same-Run evidence source
  -> Browser: research_source capture serializes behind Browser actions
     -> keep proxy outbound closed and evaluate one fixed visible-text extractor
     -> reject empty text, URL drift, malformed bounds, or invalid Browser binding
  -> Fetch: research_source capture_fetch supplies exact Web Source ID/hash
     -> serialize through the Web Fetch manager without another HTTP request
     -> reject foreign Run, stale hash, malformed provenance, or empty text
  -> normalize/select <=400 numbered lines and <=24,000 characters
  -> bind URL + title + lines + truncation to one Research capture SHA-256
  -> retain Source text only in the shared Run-local Research registry
Agent selects an exact line range and exact report claim
  -> require the current Source ID and capture SHA-256
  -> recompute the <=40-line quote
  -> bind quote and normalized single-line claim hashes to a citation ID
  -> return a citation token to the live Agent
  -> persist only counts, ranges, hashes, and source-specific provenance
Agent writes a Markdown report
  -> verify_report requires the actual complete-file SHA-256
  -> read canonical non-symlink workspace bytes <=256 KiB
  -> require each current-Run token once at the end of its exact claim line
  -> reject unknown, malformed, duplicate, claim-drifted, or stale evidence
  -> recheck file freshness and retain only path/file/citation-set hashes
Run settles
  -> abort current and queued Source operations
  -> drop Source text, claims, quotes, and citation tokens from process memory
```

`browser-source-capture.ts` owns fixed page extraction and normalization.
`web-fetch-sources.ts` owns the authoritative Web Source registry and exposes a
narrow same-Run capture provider; `web-fetch-research-capture.ts` selects its
bounded Research lines. `research-source-capture.ts` independently validates
both returned capture contracts and binds them to one immutable Research
capture hash. `research-source-model.ts` and `research-source-evidence.ts`
separate the shared contract/evidence projection from the registry.
`research-sources.ts` owns Run isolation, serialization, cancellation, and the
ephemeral Research registry. `research-source-tool.ts` owns the Agent schema
and redacted call/input/output projections.
`research-report-verification.ts` owns canonical Markdown loading, exact
claim-line parsing, current-Run token validation, and post-read freshness.
`research-source-event-view.ts` independently validates the bounded Trace
projection and rejects mixed Browser/Web Fetch provenance. Browser page
capture uses `browser-page-session.ts`, so Source extraction inherits the
existing public-network, executable freshness, Session ownership, operation
budget, and uncertain-state closure rules. Fetch capture inherits the exact
Web Source content/body hashes, normalized format/line bounds, and same-Run
ownership from `RunWebFetchSourceManager`.

The citation is evidence of an immutable capture-range-to-claim binding, not
an authority or entailment judgment. The `research-brief` Skill therefore
still requires primary sources, contradicting evidence, caveats, and adjacent
citation tokens. Raw Source text, URL, title, Web Source ID, quote, claim,
report path, and report Markdown do not enter Ledger, Replay, SSE, or Trace.
The `capture_fetch` call projection hashes the Web Source ID while retaining
the supplied content hash needed to audit the exact import. The final
user-visible report may intentionally contain the report claim, source URL,
and citation token. `verify_report` proves the token/claim/current-Run binding
against actual workspace bytes; a verified Plan artifact independently binds
the delivered artifact lifecycle.

The registry is process-local by design. An interrupted `research_source`
operation cannot be reconstructed from hash-only evidence, so automatic
recovery marks it unsafe even though capture, cite, and list have read effects.
No Web Fetch or Research Source is visible across Runs, and cancellation waits
for both serialized queues before deleting registry state.

The checked bridge gates cover same-Run import and cross-Run denial, stale
hashes, Browser/Fetch provenance separation, Agent tool sequencing, redacted
call projections, Trace validation, Browser-only benchmark compatibility, and
real report verification against workspace bytes. Real built-CLI DeepSeek
Dogfood completed the Fetch/capture/cite chain for public HTML and PDF without
retaining credential, URL, body, or Web Source ID in Tool events. Architecture
passes with 896 production source files, 447 test files, and zero cycles; the
complete regular suite passes 2,134 tests.

### Open-Web Research Outcome Verification

The open-web benchmark is separate from the deterministic fixed-source
Research benchmark. It exercises the unchanged default `observe` Agent and the
production Search, Fetch, Browser, Research Source, Replay, Policy, and model
paths:

```text
load hash-bound case + exact expected oracle
  -> create temporary Workspace and data roots
  -> create the ordinary local Runtime and default observe Agent
  -> register only an environment credential reference
  -> run the case prompt through AgentRuntime.runPrompt
  -> require bounded Search/Fetch/Browser/capture/cite topology
  -> derive source URL/kind/format, quote, claim, and token hashes
  -> bind each exact final claim to its adjacent one-use citation token
  -> verify portable Replay and scan live Run/Replay state for credential leak
  -> append one privacy-bounded evaluation event
  -> create a content-addressed Result with a receipt for every retained event
  -> independently recompute generic and case-aware verification
```

`open-web-research-benchmark-case.ts` owns strict case loading, path
confinement, exact JSON shapes, public URL constraints, and case self-hashes.
`open-web-research-benchmark-contract.ts` evaluates authoritative Tool
completion details and final assistant text. The independent
`open-web-research-benchmark-verifier.ts` validates Result shape/self-hash,
receipt chain, aggregate bindings, exact case/oracle hashes, bounded tool
counts, source coverage, accepted quote alternatives, status/diagnostics, and
claim-to-token adjacency. The CLI runner creates the temporary production
Runtime, exports Replay, writes one exclusive CAS file, and deletes all
temporary state.

Deterministic integration injects Search, Fetch, and a Browser Session manager
at `createLocalAgentRuntime`; it still uses real Agent tool schemas, Policy,
Research Source capture/citation, Replay, evaluation, and both verifier
layers. The optional Browser manager injection is a composition seam only:
production callers omit it and receive the ordinary controlled Chrome
manager. A self-rehashed aggregate tamper, case-hash substitution, wrong quote,
or citation-token swap fails verification.

The retained Result contains no raw URL, Source text, quote, claim, citation
token, model prompt/reasoning, or credential. It keeps only bounded hashes,
counts, usage, environment metadata, and 74 event receipts. The release audit
loads the checked case and semantically verifies the retained Result rather
than trusting its `passed` field or physical file hash. The first final-case
DeepSeek trial passed with one Search, two Fetches, three Browser actions,
three captures, three citations, valid Replay, and zero diagnostics in 39.646
seconds. This proves one real default-entry execution, not repeated
reliability, automatic fallback, broad open-web quality, or cross-model
superiority. The complete repository gate passes 2,145 regular tests.

## TypeScript LSP Code Intelligence Flow

The LSP tools are implemented outside the oversized workspace-tool module.
`lsp-source-session.ts` owns shared target/runtime preparation, one-shot or
injected execution, and post-operation freshness checks;
`lsp-diagnostics.ts` owns only diagnostic result projection;
`lsp-protocol-session.ts` owns standard initialize/document-sync operations and
the bounded one-shot JSON-RPC lifecycle; `lsp-persistent-session.ts` owns
Run-scoped admission, serialization, workspace freshness, reuse, and
settlement. `lsp-locations.ts` owns position/Location confinement,
`lsp-symbol-parser.ts` and `lsp-symbol-model.ts` separate strict protocol
parsing from range materialization/receipts, and the diagnostic/navigation tool
adapters own Agent schemas plus Ledger redaction:

```text
Agent selects lsp_diagnostics + workspace-relative source path
  -> require workspace/unrestricted policy and enabled tool
  -> canonicalize the workspace and target; reject escape, symlink,
     protected roots, unsupported extension, invalid UTF-8, or >1 MiB
  -> resolve and hash the current Node executable
  -> resolve versioned typescript-language-server and TypeScript assets
  -> bind those assets as Napier-managed read-only Sandbox runtime paths
  -> reuse the healthy Run-owned server when workspace/runtime hashes match,
     otherwise launch Node with the bundled entrypoint and fixed environment
  -> initialize once with explicit tsserver path and automatic typing disabled
  -> didClose/didOpen exactly the freshly preflighted source bytes per operation
  -> accept only diagnostics for the target URI
  -> cap 64 diagnostics, 1,000 chars/message, 2 MiB protocol, 16,000 stderr
     chars, and 1-30 seconds total wall time
  -> reject server-initiated workspace/applyEdit and terminate on timeout,
     cancellation, malformed protocol, output overflow, early exit, drift, or
     failed shutdown
  -> rehash runtime assets and compare workspace snapshots after the operation
  -> return diagnostic locations/codes/messages to the current Agent only
  -> retain counts, versions, latency, and hashes in tool.completed and Trace
```

For ordinary Agent Runs, `AgentSessionRuntime` injects one Run-bound protocol
executor into the six read-side LSP tools, rename-apply diagnostics, and the
write-linked patch observer. The executor performs no filesystem work until an
LSP operation is requested. The first operation canonicalizes the workspace
and launches one server; later operations reuse it only when
Runtime identity and a 10,000-file/64 MiB workspace snapshot still match.
Every operation closes/reopens its target from freshly preflighted bytes.
Workspace change replaces the Session before the next operation; in-flight
drift rejects the result. Cancellation, timeout, protocol failure, output
overflow, idle exit, operation exhaustion, and Run settlement terminate the
Session. Direct Runners and stateless Workflow Tool nodes receive no executor
and retain the one-shot path.

Document symbols reuse the same protocol lifecycle without heuristic source
parsing:

```text
Agent selects lsp_symbols + source path + optional result limit
  -> apply the same policy, canonical source, runtime, Sandbox, readiness,
     timeout, cancellation, protocol, stderr, and drift gates
  -> advertise hierarchicalDocumentSymbolSupport, all standard SymbolKind
     values, standard deprecated tags, and no dynamic write capability
  -> issue textDocument/documentSymbol for exactly the didOpen target URI
  -> accept hierarchical DocumentSymbol[] or flat SymbolInformation[] fallback
  -> require exact standard keys, valid kind/tags/text, selection inside symbol
     range, children inside parent range, and flat URI equal to the target
  -> validate every UTF-16 range against the exact preflight source bytes
  -> split the source into lines once, reject more than 16 MiB aggregate
     symbol/name range characters before slicing or hashing, then
     canonicalize by source position/range and deduplicate by receipt hash
  -> return at most the requested 256-symbol ceiling while a 48 KiB UTF-8
     display budget reserves room under the 64 KiB final Agent-output limit
  -> expose names, hierarchy, exact ranges, source hashes, and bounded
     signatures only to the current Agent
  -> persist shape, completeness, counts, depth, bytes, versions, latency, and
     source/symbol/kind/result hashes in Ledger/Replay/Trace
  -> perform no write; the Agent re-reads the current file SHA, applies through
     existing hash-bound apply_patch, and reruns diagnostics/tests
```

Definition lookup reuses that lifecycle without adding a second process or
state system:

```text
Agent selects lsp_definition + source path + 1-based UTF-16 position
  -> apply the same policy, path, source, runtime, Sandbox, and wall-time gates
  -> wait for the opened target's diagnostic stream to become quiet
  -> issue standard textDocument/definition
  -> accept Location or LocationLink and cap the response at 32 candidates
  -> canonicalize each file URI independently; omit every target outside the
     current workspace or under .git / .napier / node_modules
  -> reject malformed in-workspace ranges; read at most 1 MiB of valid UTF-8
  -> sort canonical receipts so definition-set hashes ignore server ordering
  -> rehash the source and bound runtime assets after protocol settlement
  -> return relative paths, exact ranges, file hashes, and <=1,000-character
     source previews only to the current Agent
  -> retain counts, versions, latency, truncation, and hashes in Ledger/Trace
```

Reference lookup consumes the same location boundary:

```text
Agent selects lsp_references + source path + position + declaration mode
  -> apply the same source, runtime, Sandbox, semantic-readiness, and timeout
     gates as definition lookup
  -> issue standard textDocument/references
  -> accept Location results and cap the response at 64 candidates
  -> independently canonicalize every target and omit external, virtual,
     protected, symlinked, missing, oversized, or invalid UTF-8 files
  -> deduplicate and sort canonical receipts independently of server ordering
  -> rehash the source and bound runtime assets after protocol settlement
  -> return relative paths, ranges, file hashes, and bounded previews live-only
  -> persist declaration mode, counts, latency, and stable set/result hashes
  -> label any omitted or truncated result as an incomplete impact set
```

Rename preview reuses the process lifecycle but treats completeness as a
write-safety requirement:

```text
Agent selects lsp_rename + source path + position + proposed new name
  -> apply the same policy, source, runtime, Sandbox, readiness, and timeout
     gates as definition/references
  -> issue textDocument/prepareRename, then textDocument/rename
  -> accept changes or text-only documentChanges; when both are present,
     prefer documentChanges as required by LSP 3.17
  -> reject create/rename/delete resource operations, annotated edits,
     empty/overlapping ranges, or malformed versions
  -> cap the complete result at 32 files, 256 edits, 1,000 replacement
     characters per edit, 32 KiB aggregate old/replacement text, and 64 KiB
     final tool output; exceeding any limit fails rather than truncates
  -> canonicalize every URI and reject the entire preview if any target is
     external, virtual, protected, symlinked, missing, oversized, invalid
     UTF-8, out of range, or observed with inconsistent file hashes
  -> rehash the source and bound runtime assets after protocol settlement
  -> return paths, current file hashes, exact old text, and replacement text
     only to the current Agent
  -> persist complete/count/preview-byte/version/latency plus
     source/name/prepare/edit/target-file/result hashes
  -> perform no write; the Agent re-reads each file and uses apply_patch,
     preserving the existing per-file lock, CAS, diagnostics, and evidence
```

Quick-fix preview composes the diagnostic and WorkspaceEdit boundaries without
granting the language server a write or command capability:

```text
Agent selects lsp_code_actions + source path + diagnostic position
  -> apply the same policy, source, runtime, Sandbox, and timeout gates
  -> collect at most 64 current diagnostics for the opened source
  -> select only half-open ranges intersecting the requested UTF-16 position
  -> issue textDocument/codeAction with only=["quickfix"]
  -> inspect only codeActionProvider.resolveProvider from initialize
  -> retain direct text edits plus bounded strict-JSON data-backed candidates
     inside the same live Session; expose at most 16 alternatives
  -> when resolve is advertised, issue at most 16 sequential
     codeAction/resolve requests for the edit property only
  -> require resolved title/kind/preference/data identity to match the original
     action; report unsupported, unproductive, omitted, or capped resolution
  -> apply commandPolicy=deny_all to direct and resolved actions; mark an
     ignored command but never execute or expose command/data bodies
  -> parse each WorkspaceEdit with exact keys, text edits only, no resource
     operations or annotations, while allowing zero-length insertions
  -> cap all alternatives together at 32 target files, 256 edits, 32 KiB
     old/replacement text, and 64 KiB final Agent output
  -> enforce candidate totals before file I/O; materialize serially with a
     location cache, require source version 1 when versioned, and bind source
     edits to the exact didOpen file hash
  -> canonicalize targets and reject malformed, external, protected,
     symlinked, drifting, overlapping, or over-limit responses
  -> rehash the source and every target after materialization before return
  -> return titles, paths, hashes, ranges, old text, and replacements live-only
  -> persist counts, completeness/truncation, command-ignored count, latency,
     and diagnostic/action/target/result hashes
  -> when direct apply is disabled, perform no write; the Agent chooses one
     action, uses hash-bound apply_patch, then reruns verification
  -> when lsp_code_action_apply is enabled, bind one five-minute one-use ID to
     each action; all IDs from the response form one mutually exclusive group
```

The Web projection follows the same module boundary:
`typescript-ast-event-view.ts` and `lsp-tool-event-view.ts` dispatch strict AST
and LSP receipt views, while generic `tool-event-view.ts` only dispatches by
tool name. Symbol, rename, and Code Action views live in separate lazy Trace
modules. Rename and Code Action WorkspaceEdit parsing share
`lsp-rename-workspace-edit.ts`.
`lsp-code-action-diagnostics.ts`, `lsp-code-action-resolution.ts`,
`lsp-code-action-edits.ts`, and `lsp-code-actions.ts` separately own diagnostic
selection, capability-bound resolve, confined edit materialization, and
session/receipt assembly. `lsp-workspace-edit-mutation.ts` owns the shared
ephemeral preview, diagnostics/test, commit, and sibling-consumption lifecycle;
rename and Code Action managers only adapt source-specific evidence and live
guidance. Web symbol and quick-fix projections never read symbol
names/details/signatures, action titles, paths, diagnostic messages, commands,
opaque data, or edit bodies.

The Sandbox launch contract supports at most eight explicit absolute
non-root `runtimeReadPaths`. macOS adds read-only profile rules, Bubblewrap
adds read-only binds, and OCI adds read-only mounts. Existing command and
Process Session launches omit this field, so their capability surface is
unchanged. OCI LSP remains fail-closed until host/image runtime asset identity
is defined.

The language server runs as untrusted code output inside the Capability Plane:
diagnostic prose is not treated as instructions, related-information paths are
discarded, server-initiated `workspace/applyEdit` requests are rejected, and no
package/plugin installation or network access is available.
Symbol names/details/signatures and definition/reference URIs/previews receive
the same treatment and cannot expand read/write scope. Flat symbol results must
target the opened URI; hierarchical children cannot escape parent/source
ranges. Rename and quick-fix WorkspaceEdits originate as previews only; the
optional apply coordinator runs outside the language-server process and accepts
only a Run-local preview capability. Code Action commands, resolve results
without stable identity, and `workspace/applyEdit` remain unavailable.
Opaque Code Action data is bounded and may only round-trip to the same server
for an advertised edit-only resolve; it never enters Agent or durable evidence.
The implementation does not expose external dependency navigation or
project-wide indexing.

## Coordinated LSP WorkspaceEdit Apply Flow

The language server never receives workspace-write capability:

```text
lsp_rename (read effect)
  -> materialize one complete bounded WorkspaceEdit
  -> store a one-use, five-minute preview inside the current Agent Run
  -> return edits plus an opaque apply preview ID to the live model
lsp_rename_apply (write effect)
  -> accept only that same-Run preview ID
  -> run bounded pre-write diagnostics on up to eight target files
  -> revalidate canonical paths, edit receipts, and complete file hashes
  -> acquire every target lock in deterministic order
  -> stage and fsync every new file beside its target
  -> create same-filesystem hard-link backups
  -> commit each target with a same-directory rename
  -> on failure, restore committed files in reverse order and verify hashes
  -> run post-write diagnostics from a fresh LSP Session
  -> emit one privacy-bounded write receipt

lsp_code_actions (read effect)
  -> materialize up to sixteen mutually exclusive text-edit alternatives
  -> store one same-Run preview ID per action in a single exclusive group
  -> return each ID beside only its own live action
lsp_code_action_apply (write effect)
  -> accept one ID and synchronously invalidate every sibling ID
  -> bind the source Code Action result, exact action hash, resolved state,
     ignored-command state, and commandPolicy=deny_all
  -> execute the same diagnostics, lock, staging, backup, commit, rollback,
     postcondition, and relevant-test path as lsp_rename_apply
```

The commit is coordinated, not portable multi-file atomic visibility. External
processes do not honor Napier locks and may observe intermediate target
renames. A fully applied set therefore reports a separately verified,
drifted, or indeterminate postcondition. A failed commit is `rolled_back` only
when the complete original file set is rehashed successfully. Failed rollback
is `indeterminate`; unrecovered hard-link backups remain counted local recovery
artifacts and automatic recovery treats the tool as unsafe.

Cancellation before commit removes staging and backups without changing a
target. Cancellation after the first target rename cannot abandon partial
state: the coordinator settles the complete commit or rollback, marks
`cancellationObserved`, then lets the parent Run cancel. Post-write diagnostic
failure similarly cannot turn a committed write into a generic tool failure;
it becomes an `unavailable` diagnostic receipt. Paths, symbol names, preview
IDs, old/new text, diagnostics, and recovery filenames remain live-only.
Write-linked diagnostics explicitly discard the Run's persistent pre-write LSP
executor and use fresh one-shot Sessions before and after mutation. Diagnostics
and Code Action discovery wait for a 300 ms quiet window; this prevents an
initial empty syntax publication from settling before a later semantic batch.

## Write-linked Diagnostics Flow

`applyWorkspacePatch` remains the language-neutral atomic/CAS primitive.
`workspace-patch-tool.ts` owns the Agent schema, optional observation lifecycle,
and path-free durable projection. `lsp-patch-diagnostics.ts` implements the
TypeScript observer:

```text
frozen Agent enables apply_patch + lsp_diagnostics
  -> create one read-only LSP patch observer for the Run
  -> supported existing file: diagnose before the write
  -> require before fileSha256 == patch expectedSha256
  -> recheck cancellation
  -> execute the unchanged atomic patch under the workspace path lock
  -> diagnose the committed bytes
  -> rehash the target after the LSP protocol settles
  -> require observed fileSha256 == patch afterSha256
  -> compare diagnostic multisets without source locations
  -> return after-write locations/messages to the live Agent
  -> persist one patch tool.completed event with counts and hashes only
```

Preflight timeout, cancellation, Sandbox failure, or hash drift prevents the
write. Once the atomic patch commits, postflight failure cannot convert it into
a generic failed tool call or roll it back: the result is `unavailable` with an
error hash. External modification before or during postflight produces
`drifted` with expected/observed file hashes. Truncated diagnostic sets remain
`truncated` rather than making a false improvement claim.

Diagnostic identity includes severity, code, source, and message but excludes
line/character positions, so moving unchanged code does not create a false
regression. Durable patch details expose before/after severity counts,
introduced/resolved/unchanged counts, delta/result hashes, and latency. Raw
paths, patch text, source, compiler messages, and server errors are live-only.
Unsupported files and Agents without both explicitly enabled tools bypass the
observer and preserve existing patch latency.

## Write-linked Test Verification Flow

Relevant-test verification extends the existing patch and coordinated-rename
receipts; it is not a second write or event system:

```text
frozen Agent enables apply_patch / lsp_*_apply + verify_workspace
  -> capture declaration hashes from the source bytes bound to the write
  -> commit through the existing single-file CAS or coordinated rename path
  -> choose nearest package scope or a declared root workspace graph
  -> bind canonical package.json + tsconfig.json / relative extends inputs
  -> scan at most 1,000 TS/JS files and 32 MiB outside protected/generated roots
  -> resolve relative, workspace-package, and safe tsconfig.paths imports
  -> bind the bounded typed reverse-dependency graph
  -> associate up to 512 declarations per file by before/after content hash
     and mark declaration evidence truncated above that bound
  -> select at most eight reverse-reachable .test/.spec files
  -> require a complete graph before execution
  -> run exact targets through fixed workspace-local Vitest with
     process.spawn + workspace.read only
  -> rescan the same scopes and rehash resolution configs after execution
  -> accept passed only when selection, source, and config snapshots match
  -> attach one privacy-bounded nested receipt to the existing write event
```

`write-linked-resolution-files.ts` owns no-follow UTF-8 config reads plus the
shared 128 loaded-or-missing path / 4 MiB loaded-byte admission budget.
`write-linked-workspace-discovery.ts` discovers at most 64 packages from exact
segments and single-segment `*` workspace patterns and rejects symlinks or
unsupported globs.
`write-linked-resolution-config.ts` rejects duplicate names,
non-relative/cyclic inheritance or ambiguous child `extends` + `paths`
overrides, and instantiates at most 128 bounded path aliases. Inherited aliases
retain the child project's applicability root while targets remain relative to
the config that declares them.
`write-linked-module-resolution.ts` maps package names/subpaths and aliases to
files already admitted by the source scan, preferring exact and
more-specific path patterns; it never invokes TypeScript module loading,
package scripts, JavaScript config, or Node resolution outside the workspace.

The source scan additionally caps at 5,000 import edges and 1 MiB per source
file. Parse failure or unresolved supported imports count only when their
importer is reverse-reachable from a changed file, so an unrelated broken
package does not poison a proved branch. A reachable unresolved import,
unsupported/unsafe config, scan/byte/config/edge truncation, or more than eight
related tests becomes `selection_incomplete`; tests do not run and the write
remains visible. A complete graph with no reachable test becomes `no_match`,
which is not a project-wide verification claim. Executed outcomes remain
`passed`, `failed`, `timed_out`, or `output_capped`; cancellation,
source/config drift, and unavailable Sandbox/verifier state remain distinct.

The child process receives fixed Vitest arguments, a 60-second timeout, two
workers, no network, no workspace writes, and no inherited environment. This
capability exists only when the write and `verify_workspace` tools are both
enabled under a non-observe, non-restricted execution policy. The live Agent
sees selected paths, changed symbol identities, and bounded test output.
Durable Ledger, Replay, SSE, and Trace schema-v2 evidence contains only
statuses, package/alias/config/edge counts, exit state, truncation, latency,
and hashes of the changed file/symbol sets, typed dependency graph, selected
test set, verifier, output, errors, and pre/post snapshots. Package names,
manifest/config paths and bodies, import specifiers, test paths, and output
remain live-only. Web retains schema-v1 compatibility and independently
requires all schema-v2 resolution counts.

## Workspace File Lifecycle Flow

File lifecycle operations are a separate Capability Plane module rather than
new modes inside `apply_patch` or a write-enabled shell:

```text
workspace_file_preview (read effect)
  -> normalize source and destination inside the canonical workspace
  -> reject case aliases of .git / .napier / node_modules, symlinks,
     unsupported entry types, occupied destinations, and scope over
     2,000 entries or 32 MiB
  -> hash the complete bounded source tree, including empty directories
  -> bind operation + path hashes + source snapshot + destination absence +
     nearest existing parent device/inode identity + Thread + Run +
     five-minute expiry
  -> retain one one-use preview only in the current Runtime
workspace_file_apply (write effect)
  -> accept only previewId
  -> recompute the plan before and after deterministic multi-path lock
     acquisition
  -> consume the preview and perform create_directory, move, trash, or restore
  -> require one-filesystem rename; EXDEV fails without recursive copy/delete
  -> inspect the postcondition, reporting verified, drifted, or indeterminate
  -> append workspace.file.mutated with hashes and counts only
```

`WorkspaceFileMutationManager` owns preview lifetime and commit orchestration.
`workspace-file-scope.ts` owns bounded path/tree inspection and local trash
manifest validation. `workspace-write-lock.ts` is shared with `apply_patch`, so
content edits and lifecycle moves cannot concurrently mutate the same
Napier-addressed path on one host.

Trash is an intentionally reversible local artifact under
`<dataRoot>/workspace-trash/<trashId>`. Its protected manifest contains the
original relative path, source snapshot, counts, bytes, owning Thread/Run, and
content hash. Public Ledger/Trace/Replay projections contain only path hashes,
tree hashes, counts, reversibility, trash ID, and postcondition. The Files
Workbench reads local manifests through a Thread-scoped no-store API and
offers only explicit restore; no purge or arbitrary path input exists. Its
Thread and request-sequence guards abort or discard late list/restore responses
before they can update a newly selected Thread.

Napier checks destination absence during preview, immediately before rename,
and after lock acquisition. Standard Node rename cannot provide portable
`RENAME_NOREPLACE` for directories, so a hostile external writer can still
race after the final check. The postcondition reports uncertainty instead of
claiming distributed isolation. Permanent deletion, overwrite requests,
permission changes, root moves, symlink lifecycle, and arbitrary/root-wide
Process Session writes remain outside this capability. The separate Process
protocol below grants only preview-bound writes to explicit existing scopes.

## Sandboxed Command Flow

`run_command` is the first general-purpose execution slice, but it is not a
general shell:

```text
model selects node + literal argv
  -> require non-observe policy + enabled run_command tool
  -> validate 0-64 bounded arguments, cwd, and 1-120 second wall budget
  -> canonicalize cwd inside the workspace
  -> resolve one Napier-owned absolute executable and hash its current bytes
  -> launch that executable directly, without a shell
  -> pass a fixed secret-free environment
  -> grant process.spawn + workspace.read only
  -> deny workspace writes and networking in the OS sandbox
  -> cap stdout/stderr independently and terminate the process group on
     timeout, output cap, or parent-Run cancellation
  -> return bounded output to the live model
  -> redact argv/output text from model.response and tool Ledger events
  -> retain call/result, executable, environment, cwd, limits, and output hashes
```

The runtime implementation is isolated in `command-execution.ts`; shared
process lifetime and output collection live in `sandboxed-process.ts` and are
also used by `verify_workspace`. This avoids adding process lifecycle logic to
the Store or Server modules.

The Ledger projection deliberately differs from ordinary tools. The live Pi
tool result includes bounded stdout/stderr, but the persisted model response
replaces arguments with runtime/count metadata and an input SHA-256.
`tool.started` and `tool.completed` retain redaction flags, byte counts,
stable call/result hashes, and structured command details. The Tool Loop Guard
understands these redacted projections, so repeated commands remain detectable
without persisting command or output text.

Local command execution currently supports macOS sandbox-exec and Linux
Bubblewrap. It fails closed on unsupported adapters and OCI until host/image
runtime identity binding exists. Wall time, output, and process-group
termination are enforced; hard per-command CPU/memory quotas require an OCI or
managed session backend and remain an explicit gap. Foreground
`run_command` remains pipe-only; PTY is available through the managed Process
Session below. Writes, package installation, and inherited environment
variables are not part of either surface. The public generic command/process
runtime remains Node-only. Restricted Python uses a separate typed private
protocol that binds a recognized system interpreter and a bounded no-site
bootstrap dependency set proven to cover the worker's loaded module files,
without granting models an arbitrary Python argv surface. Git remains outside
that generic runtime enum and is available only through the fixed operation
graph below.

The macOS adapter runs one cached, one-second, deny-default `sandbox-exec`
profile probe before launching the first task process. This distinguishes an
executable that exists from a host that actually permits `sandbox_apply`.
Failure returns a stable sandbox-unavailable error before target code starts;
it never falls back to an unsandboxed process. Stable Sandbox SPI types and the
unsupported adapter live in leaf modules, while the availability probe remains
an internal implementation detail. Shared Workspace guidance treats this as a
host capability failure and tells the Agent not to retry the same
process-backed tool within the Run.

## Git Inspection Flow

```text
git_inspect(status | diff | conflict)
  -> require non-observe policy + enabled git_inspect
  -> require canonical workspace root with a direct non-symlink .git directory
  -> reject gitfile, metadata symlink, active index lock, protected/escaping path
  -> snapshot no-follow HEAD/current ref/packed refs/index/config/shallow
  -> resolve and hash fixed /usr/bin/git
  -> list local config key names with --no-includes
  -> reject include paths, filter clean/smudge/process,
     diff command/textconv, core.attributesFile,
     worktree config, split index, sparse checkout, reftable refs,
     and SHA-256 objects
  -> for status/diff, generate exact read-only argv internally
  -> for conflict:
     - normalize one target path and read the exact bound index bytes
     - verify SHA-1 checksum; parse v2/v3 regular-file stage 1/2/3 entries
     - classify modify/modify, add/add, deleted-by-us, or deleted-by-them
     - lstat canonical worktree text before nonblocking no-follow open
     - run fixed cat-file blob for each present stage and verify Git SHA-1
     - await every parallel blob process, then recheck worktree/repository state
  -> force literal pathspecs; disable replace refs, optional locks,
     pager, color, fsmonitor, rename detection,
     external diff, textconv, and submodule traversal
  -> execute read-only/offline in the existing OS Sandbox
  -> cap each stream at 128 KiB and reject truncated or stderr-bearing output
  -> rehash Git executable and repository metadata
  -> return paths/hunks/conflict text live; persist counts and hashes only,
     including the selected Sandbox backend hash
```

The Git process implementation is private to `git-inspect-process.ts`; it
reuses `runSandboxedProcess` without adding Git to the public/general
`CommandRuntime` union. `git-repository.ts` owns shared direct-repository,
no-follow metadata, mode, path, and freshness validation;
`git-inspect-arguments.ts` owns every fixed argv set.
`git-conflict-index.ts` parses checksum-bound v2/v3 index entries without an
index-observation subprocess, preventing index ABA substitution.
`git-conflict-inspect.ts` owns bounded worktree/base/ours/theirs text,
Git-blob verification, per-path parallel process settlement, set-level
freshness, and conflict classification. `git-path-set.ts` owns shared
canonical ordering, collision denial, and compatible single/set hashes.
`git-inspect.ts` owns read-only status/hunk/conflict execution and aggregate
evidence; `git-inspect-policy.ts` keeps all requested members workspace-bound
before process admission.
`git-inspect-tool.ts` owns the TypeBox contract and privacy projection.
`agent-process-tool-ledger.ts` dispatches command and Git projections outside
the central Agent Ledger module. Web validation lives in
`git-inspect-event-view.ts`; extracting legacy workspace-read validation into
`workspace-read-event-view.ts` reduces the central Tool Trace module.

The direct `.git` boundary deliberately excludes linked worktrees, worktree
config, split indexes, sparse checkout, graft metadata, SHA-256 object
repositories, and submodules whose object metadata lives outside the
workspace. Local config and attributes are untrusted. The
config preflight rejects includes and every supported command-bearing
filter/diff key before every action; external diff and textconv are also
disabled in argv. As a second boundary, the OS Sandbox admits only the fixed
Git executable, so other configured helpers cannot run.

Conflict inspection supports one canonical set of one to four complete
regular-text paths. It scans the checksum-bound index once, orders targets by
code point, and runs each target's verified blob reads before a final concurrent
worktree-set freshness check. Each worktree/stage body is capped at 24 KiB and
rejects invalid UTF-8, binary control text, symlinks, FIFO/devices, gitlinks,
v4/SHA-256 index formats, and checksum or freshness drift. The public argv
digest combines semantic target-set/parser policy with every ordered actual
`cat-file` argument-set digest.

For one path, Receipt fields retain their exact legacy values. For a set,
`fileCount` is target count, `conflictStageCount` is the total, `mixed` means
per-path classifications differ, and each presence boolean means all targets
have that side. Runtime and Web projections validate single/same-kind/mixed
aggregate semantics. Agents resolve every live body through `read_file` plus
`apply_patch`, then reuse one atomic Stage path-set transaction. This clears
unmerged stages into a reviewed resolved index state but does not create a
merge commit; Commit remains a separate preview/apply transaction.

## Git Stage Transaction

```text
git_stage_preview(path | paths, hunkIndexes?)
  -> bind direct repository + HEAD/config/index modes and bytes
  -> normalize one path or 1-16 paths; reject aliases/NFC/case collisions
  -> sort by deterministic code-point order
  -> bind every target bytes/executable bit or tracked deletion
  -> require <=16 MiB each and <=32 MiB aggregate present target bytes
  -> bind every root-to-target .gitattributes + .git/info/attributes chain
  -> create 0700 .git/napier-stage/<ephemeral>
  -> copy current index; redirect GIT_INDEX_FILE and GIT_OBJECT_DIRECTORY
  -> mount workspace read-only; mount only ephemeral directory writable
  -> with whole-path mode:
     - run fixed git add -- path for every ordered target against one index
     - run fixed path-filtered git diff --cached HEAD for every target
     - require every target to contribute one reviewable staged delta
     - if an initially supported unmerged text target has zero final tree diff,
       emit canonical unmerged -> resolved / tree-matches-HEAD evidence
     - continue rejecting zero-diff targets that were not unmerged
  -> with strictly increasing 1-based hunkIndexes:
     - require the single path input; reject paths
     - run fixed single-path index-to-worktree diff
     - parse <=32 complete existing regular-text modification hunks
     - reject new/delete/binary/mode/rename/malformed/CRLF forms
     - run fixed git apply --cached --unidiff-zero with selected patch stdin
  -> require <=128 KiB aggregate tree/index-transition review evidence
  -> delete private index/objects
  -> return live patch + one-use Run/Plan-scoped preview capability

git_stage_apply(previewId)
  -> consume capability; lock real index + every target path
  -> revalidate repository, all targets/attributes, config policy, executable
  -> reconstruct private index; require identical index and patch hashes
  -> inflate and SHA-1 verify each bounded loose object
  -> promote objects with no-overwrite hard links and directory fsync
  -> create standard .git/index.lock exclusively
  -> revalidate all preview state at the commit barrier
  -> write/fsync prepared index, preserve mode, rename, fsync .git
  -> verify new index + unchanged non-index/all-target/all-attribute state
  -> return applied or indeterminate hash-only durable evidence
```

`git-stage.ts` owns expiring capability scope and state transitions;
`git-stage-private-index.ts` owns private Git execution, loose-object
verification/promotion, and index installation; `git-stage-hunk-patch.ts`
owns structural parsing, bounds, selected patch construction, and the semantic
protocol digest; `git-stage-private-mutation.ts` owns ordered whole-path or
selected-hunk private-index mutation. `git-stage-index-transition.ts` recognizes
supported initial unmerged stage sets and renders live-only zero-tree-delta
review evidence. `git-stage-targets.ts` owns target
normalization, collision rejection, aggregate bounds, state/attribute snapshots,
and compatible single/set hashes. `git-stage-hunk-arguments.ts` owns fixed argv.
`git-stage-model.ts` owns bounded file/attribute snapshots;
`git-stage-details.ts` owns receipt construction. The selection digest is
folded into `gitArgumentsSha256`, so schema-1 Receipt shape remains compatible.
Agent Runs scope capabilities by Run ID, while typed Workflow nodes scope them
by Plan ID because each node has a distinct child Run. Ledger/Replay retain the
capability and hashes but no path or patch body. Web Trace validates only
bounded counts, state/result hashes, durability, and
postcondition.

The transaction supports up to sixteen whole regular/tracked-deleted paths or
selected hunks from one existing text path. It rejects directories, symlinks,
multi-path hunk selection, missing HEAD/index, linked
worktrees, split/sparse indexes, SHA-256 object repositories, alternates,
submodules, shared repository ACLs, command-bearing config, graft metadata,
OCI, and attribute-chain drift. Literal pathspec mode prevents target strings
from selecting additional paths. Loose objects promoted before a failed commit
barrier may remain unreachable, matching Git's content-addressed safety model.
Capabilities remain process-local; restart or expiry requires a fresh preview
instead of reusing a completed Workflow node output. Branch switch, checkout,
reset, clean, merge completion, binary/multi-path conflict resolution,
non-linear Review promotion, and arbitrary revisions remain unavailable.
Multiple reviewed text-conflict worktree resolutions can share the whole-path
transaction. A resolution equal to HEAD still clears its unmerged entries
through explicit index-transition evidence; conflict inspection remains one
path at a time, and staging is not a general Git shell.

## Git Commit Transaction

```text
git_commit_preview(message)
  -> require attached existing branch + existing HEAD/index
  -> lock private commit root; recover one verified unfinished marker transaction
  -> garbage-collect durable .complete transactions best-effort
  -> accept ordinary state or one exact MERGE_HEAD + MERGE_MSG
  -> bind optional MERGE_MODE/AUTO_MERGE/MERGE_RR; reject every other operation
  -> normalize <=4 KiB message; fix Napier identity and current UTC second
  -> copy index and message into 0700 .git/napier-stage/<ephemeral>
  -> redirect GIT_INDEX_FILE and GIT_OBJECT_DIRECTORY
  -> read HEAD commit; inspect complete raw staged entries and staged patch
  -> reject empty ordinary/>32-file patches and every old/new gitlink mode
  -> for merge only, allow zero raw/tree delta and emit canonical evidence
     that the merge tree matches its first parent while recording parent two
  -> run fixed write-tree and commit-tree with one or two ordered parents
  -> bind parent set/tree/proposed commit/message/patch/operation/runtime hashes
  -> delete private data and return one-use Run/Plan-scoped capability

git_commit_apply(previewId)
  -> consume capability; lock private root + index + exact attached branch ref
  -> recover one verified unfinished marker transaction or fail closed
  -> revalidate branch/repository/index/config/executable/operation markers
  -> reconstruct exact tree and commit; require every preview binding
  -> SHA-1 verify and no-overwrite promote private loose objects
  -> remove private construction bytes before any ref mutation
  -> validate canonical non-symlink refs/heads and reflog ancestors
  -> disable hooks and update exact previewed branch <proposed> <parent>
  -> settle HEAD + exact operation state after every ref outcome
  -> require attached branch, unchanged index/static state, empty staged diff
  -> fsync exact loose ref + HEAD/branch reflogs; verify both old->new tails
  -> if merge and update clean:
     - write/fsync immutable marker backups under 0700 private storage
     - isolate optional markers, MERGE_MSG, then MERGE_HEAD by rename
     - settle cleared operation state within the original deadline
     - rollback from backup on failure, or fsync an atomic .complete boundary
  -> settle ordinary HEAD/branch/index again after durability checks
  -> delete private data and return applied or indeterminate hash-only evidence
```

`git-commit.ts` owns process-local capabilities, scope, locks, reconstruction,
and the pre-CAS barrier. `git-commit-ref-update.ts` owns ref CAS, deadline-bound
settlement, durability, merge cleanup orchestration, and result classification.
`git-commit-operation.ts` owns no-follow operation snapshots, merge topology,
immutable marker backup, ordered isolation, rollback, and the durable
`.complete` boundary.
`git-commit-recovery.ts` scans only canonical 0700
`merge-cleanup-<nonce>` directories under the locked private root, reconstructs
the expected operation state from content/mode-verified immutable backups,
requires each marker to exist in exactly one of the root or isolated locations,
and performs restore-plus-directory-fsync before a new preview/apply proceeds.
`git-commit-private.ts` owns private index/message/object construction, staged
raw-entry validation, and operation-marker checks.
`git-commit-tree-transition.ts` renders live-only zero-delta merge evidence.
`git-ref-files.ts` owns
shared canonical ref-path confinement, exact ref/reflog fsync, transition-tail
verification, and parent-directory durability. `git-commit-settlement.ts`
independently re-observes HEAD, repository/index state, and the empty
post-commit staged diff.
`git-commit-details.ts` compresses identity/operation/executable/argv/
environment/limit/Sandbox evidence into one runtime digest so the added merge
parent and error evidence still fit the 32-property Workflow schema budget.
Agent Runs scope the one-use capability by Run ID; typed Workflow Tool nodes
share it through Plan ID. Message, branch, patch, marker content, paths,
errors, and capability arguments are live-only or hash-projected through
Ledger/Replay/Web Trace.

The commit timestamp, `Napier Agent <napier@localhost>` author/committer
identity, normalized message, parent, and tree are fixed during preview, so a
successful reconstruction must produce the exact same commit SHA-1. The sole
ref mutation is generated internally as
`update-ref <previewed-branch> new old`; the old parent is a CAS precondition,
and `core.hooksPath=/dev/null` disables `reference-transaction` hooks. The
exact ref target prevents a concurrent symbolic-HEAD switch from redirecting
the mutation to another branch. If process status is untrustworthy, settlement
distinguishes unchanged parent, exact proposed commit, and an unknown third
state. Once the ref process starts, any missing staged/index/static, cleanup,
ref fsync, reflog, or final settlement proof yields `indeterminate`, not a
false failure.

This transaction intentionally excludes unborn/detached HEAD, linked
worktrees, shared repositories, alternates, split/sparse indexes, SHA-256
objects, reftable refs, submodules/gitlinks, signing, user-selected identity,
hooks, octopus/squash/autostash merge completion, merge execution, amend,
checkout, reset, remotes, and history rewriting. It commits the complete
current stage-0 index, up to 32 changed entries and 128 KiB of tree/transition
evidence. A zero-delta tree is valid only for a bound two-parent merge; ordinary
empty commits remain rejected. Marker
isolation begins only after ref/reflog durability; `MERGE_HEAD` moves last and
restores first, while a 0700 backup survives incomplete in-process or
cross-restart rollback. Rename failure and parent-fsync failure remain
pre-boundary and restore markers; once `.complete` plus parent fsync succeeds,
later private-directory removal failure cannot invalidate the commit. Corrupt,
ambiguous, or multiple active recovery transactions fail closed. Capabilities
are memory-only and expire after five minutes; recovery must inspect current
state and create a new preview.

## Git Branch Create Transaction

```text
git_branch_create_preview(branchName)
  -> validate one <=200-byte conservative ASCII local branch name
  -> require direct file-ref repository + existing HEAD commit
  -> reject unsafe config, shared/reftable/SHA-256 refs, existing loose/packed
     target, non-canonical ref roots, and symlinked target ancestors
  -> bind exact HEAD/repository/config/index/executable/Sandbox evidence
  -> return one-use Run/Plan-scoped preview without changing any repository byte

git_branch_create_apply(previewId)
  -> consume capability; lock the exact proposed ref path
  -> revalidate repository/config/index/HEAD and target absence
  -> disable hooks and run fixed update-ref <target> <HEAD> <zero>
  -> settle exact target ref plus unchanged HEAD/repository state
  -> fsync loose ref + branch reflog and verify zero->target tail
  -> settle exact target ref plus unchanged HEAD/repository state again
  -> return applied or indeterminate hash-only durable evidence
```

`git-branch.ts` owns process-local capability scope, ref locks, preflight,
zero-old CAS, unknown-outcome settlement, and result classification.
`git-branch-settlement.ts` independently observes current HEAD, the exact
target branch, and the repository snapshot before and after durability.
`git-ref-files.ts` is shared with Commit so canonical ancestors, symlink
denial, reflog-tail proof, file fsync, and directory fsync have one
implementation. `git-branch-details.ts` binds the semantic fixed argv,
runtime/resource evidence, target commit, and repository states. Agent Runs
scope capabilities by Run ID; Workflow Tool nodes use Plan ID.

Branch names appear only in live Agent tool output. Ledger/Replay/Web Trace
retain the branch-ref hash, name byte count, target commit, state/runtime
hashes, ref status, durability, cancellation, and postcondition. Preview
accepts attached or detached existing HEAD but rejects unborn repositories.
Apply creates one local branch ref only: it does not change symbolic HEAD,
checkout files, update the index/worktree, create objects, run hooks, contact a
remote, or rewrite history. A concurrent HEAD switch can leave the exact
previewed branch created, but the result is `indeterminate` because the
unchanged-HEAD postcondition no longer holds. Branch attachment and bounded
divergent switching are the separate transaction below.

## Git Branch Switch Transactions

```text
git_branch_switch_preview(targetBranchName)
  -> validate one existing conservative ASCII local branch name
  -> acquire private-root/index/HEAD/reflog/target/recovery-path locks
  -> recover one exact unfinished checkout or fail closed
  -> snapshot repository/index + HEAD reflog content/mode/bytes
  -> resolve exact source HEAD^{commit} and target^{commit}
  -> validate target/ref/reflog canonical no-symlink storage
  -> if source tree == target tree:
     - preserve dirty index/worktree and bind a zero-file transition
  -> otherwise require globally clean repository and no conversion attributes
  -> parse fixed --raw -z --abbrev=40 A/M/D regular-file transitions
  -> require <=32 existing-parent UTF-8 files, <=64 KiB each/512 KiB total
  -> read and Git-SHA-1 verify every target blob
  -> construct target index through private read-tree/write-tree
  -> return complete <=128 KiB patch + one-use Run/Plan capability

git_branch_switch_apply(previewId)
  -> consume capability; lock root/index/HEAD/reflog/target/all changed paths
  -> recover, then reconstruct and revalidate the complete preview
  -> if divergent:
     - write/fsync manifest + source/target index + staged files
     - copy/fsync every existing source file into immutable backup
     - atomically commit each bounded target file; fsync parent directories
     - atomically install the exact target index through index.lock
  -> run fixed update-ref --no-deref --stdin with hooks disabled
     - verify target ref == previewed commit
     - verify dereferenced HEAD == previewed source commit
     - symref-update HEAD -> target
  -> settle target/HEAD/index/static state within the original deadline
  -> fsync HEAD + HEAD reflog
  -> require reflog == previewed prefix + one exact old->new switch record
  -> settle target/HEAD/index/static/worktree state again
  -> commit checkout recovery via .complete rename + parent fsync
  -> return applied or indeterminate hash-only evidence
```

`git-branch-switch.ts` owns process-local capability scope, multi-path locks,
recovery entry, and preview/apply reconstruction.
`git-branch-switch-checkout-prepare.ts` owns clean-tree/raw/patch/blob/private-
index proof. `git-branch-switch-checkout-transaction.ts` owns durable backup,
worktree/index commit, rollback, and `.complete`; the recovery and
recovery-files modules reconcile only exact source or target outcomes.
`git-branch-switch-apply.ts` owns fixed ref execution, durability, and
unknown-outcome classification. `git-branch-switch-validation.ts` performs
config/runtime/source/target preflight and repository/reflog freshness.
`git-branch-switch-settlement.ts` observes HEAD, target, index/static state,
and bounded reflog state after mutation. `git-ref-files.ts` supplies the shared
no-follow ref/reflog snapshots, exact single-record append proof, fsync, and
canonical path checks. Fixed transaction stdin is capped, control-checked, and
bound into runtime resource evidence; no model-selected Git input reaches the
process.

Both tools are statically high-risk write effects. Preview's ordinary path is
non-mutating, but the same call may reconcile one interrupted checkout; the
write classification keeps Workflow scheduling, side-effect confirmation,
automatic-recovery denial, Policy, and Ledger evidence truthful.

Branch names remain live-only. Ledger/Replay/Web Trace retain target-ref hash,
name bytes, source/target commits, checkout flag/counts, recovery action,
patch/index/worktree hashes, repository/reflog state, runtime/process status,
durability, cancellation, and postcondition. Patch, paths, target content,
branch name, and private recovery locations stay live/private. Same-tree
switches deliberately allow dirty state because no file/index write is needed.
A source branch-name change at the same OID is not capability authority;
source/target OIDs and the exact reflog suffix are.

Divergent switching is intentionally not a general checkout. It rejects dirty
repositories, missing parent directories, binary/control-NUL text, symlinks,
gitlinks, attributes, EOL conversion config, filters, >32 files, >64 KiB files,

> 512 KiB aggregate bytes, and >128 KiB patches. HEAD moves only after worktree
> and index are target-exact. A crash with source HEAD restores worktree then
> index; a crash with target HEAD completes only after target ref, index,
> worktree, static state, and old-to-new reflog all verify. Unknown or drifted
> state preserves backup and fails closed. Hooks, remotes, arbitrary revisions,
> merge execution, reset/clean, and history rewriting remain unavailable.

## Git Review Promotion Transaction

```text
git_review_preview(targetBranchName)
  -> require current HEAD attached to one direct local source branch
  -> require a different existing direct local target branch + canonical reflog
  -> bind repository/index/config + HEAD and target reflog prefixes
  -> prove target commit is an ancestor of exact source HEAD
  -> parse <=64 ordered commit+single-parent records
  -> require parent[0]=target, each next parent=previous, final commit=source
  -> for every commit:
     - run fixed parent->commit raw and patch diff
     - accept only regular UTF-8 A/M/D transitions
     - Git-SHA-1 verify every old/new blob through fixed cat-file
  -> cap total transitions at 32, blobs at 64 KiB each/512 KiB aggregate,
     and generated commit-marked patch at 128 KiB
  -> return complete per-commit live review + one-use Run/Plan capability

git_review_apply(previewId)
  -> consume capability; lock HEAD + source ref + target ref
  -> revalidate exact repository/reflogs/direct refs/linear range/patch/blobs
  -> run fixed update-ref --no-deref -m <fixed> target source old-target
  -> settle unchanged HEAD/source/index/config/HEAD-reflog + exact target
  -> fsync target loose ref and target reflog
  -> prove target reflog == preview prefix + one exact old->source record
  -> settle the complete postcondition again
  -> return applied or indeterminate hash-only durable evidence
```

`git-review.ts` owns process-local capability scope, locks, and pre-CAS
freshness. `git-review-prepare.ts` owns direct-ref, ancestry, linear topology,
per-commit raw/patch, and complete blob proof. `git-review-apply.ts` and
`git-review-settlement.ts` own post-CAS observation, durability, and unknown
outcome classification. Fixed argv live in `git-review-arguments.ts`; the
31-property Receipt and plan hash live in the model/details modules.
`git-ref-files.ts` provides no-follow HEAD/branch reflog snapshots and exact
prefix-plus-one append verification shared with branch switching.

The operation is a local fast-forward promotion, not merge execution. A
cumulative target-to-source tree diff is insufficient because intermediate
commits could add then remove sensitive content while remaining reachable after
promotion; therefore every accepted commit is linear and independently shown.
Merge commits, side histories, symbolic source/target refs, binary/symlink/
gitlink/type transitions, more than 64 commits or 32 file transitions, remote
operations, hooks, rebase, force, reset, and arbitrary ref updates are denied.
`--no-deref` guarantees a target symref race cannot redirect the CAS to its
referent. Dirty index/worktree state is preserved byte-for-byte because the
sole mutation is the non-current target ref and its reflog.

Source/target branch names and every patch body remain live-only.
Ledger/Replay/Workflow/Web Trace retain source/target ref hashes, commit IDs,
commit/file/hunk/line counts, patch/plan/repository/runtime/result hashes,
ref status, durability, and postcondition. Runtime restart or capability expiry
requires a fresh review; the atomic ref either remains at old target or reaches
the exact reviewed source, with uncertain evidence reported as
`indeterminate`.

## Workspace Process Session Flow

`workspace_process` extends the same Node execution boundary into bounded
background sessions without turning it into a shell:

```text
Agent selects start + node + literal argv
  -> require non-observe policy + enabled workspace_process tool
  -> reserve one of four per-Thread and eight per-Runtime active slots
     before async preparation
  -> reuse command cwd, executable, environment, and capability preparation
  -> capture a bounded deterministic workspace snapshot
  -> keep the workspace read-only and network denied
  -> choose closed/interactive pipes or explicit bounded PTY
  -> for PTY, allocate node-pty around the sandbox wrapper, never the target
  -> launch the fixed Node target through macOS sandbox-exec or Linux Bubblewrap
  -> append workspace.process.started with metadata and hashes only
  -> return a Napier process ID, never a host PID
  -> close pipe stdin by default, or retain explicit interactive/PTY input
  -> serialize at most 64 UTF-8 input actions, 32 KiB each and 256 KiB total
  -> optionally append a newline; only a pipe can close stdin after a write
  -> append workspace.process.input with byte counts and hashes, never text
  -> serialize at most 64 PTY resizes and append workspace.process.resized
  -> collect at most 32,000 chars per stream and 256 ordered chunks in memory
     (PTY stdout/stderr are one merged terminal stream)
  -> Agent or Workbench polls chunks after a monotonic cursor
  -> cancel on Agent/operator request, parent abort, timeout, or output cap
  -> verify the runtime executable remained stable
  -> capture the post-settlement workspace snapshot
  -> classify the window as unchanged, changed, or indeterminate
  -> append workspace.process.settled with status, counts, and hashes

Agent selects preview_write + node + literal argv + 1-8 existing scopes
  -> reject root, escape, overlap, protected segments, symlinks, and large trees
  -> capture a complete directory-aware 10,000-entry/64 MiB workspace baseline
  -> bind command/runtime/environment/limits/cwd, scope set, baseline,
     Thread, Run, and five-minute expiry into a one-use local preview
Agent selects start_write + preview ID
  -> acquire the data-root workspace write lock across Runtime Managers
  -> rebuild every scope and complete baseline; reject any freshness drift
  -> copy only approved scopes into a private mode-checked recovery directory
  -> consume the preview, keep workspace root read-only, and remount only the
     approved scopes writable in sandbox-exec, Bubblewrap, or OCI
  -> launch and observe through the ordinary Process lifecycle
  -> capture a directory-aware post-snapshot, including empty directories and
     hash-only symlink identity without following its target
  -> classify every changed path as within_scope, outside_scope, or
     indeterminate without assigning external drift to the child
  -> append schema-v6/v7 hash-only Process settlement

If schema-v7 binds failureRecovery=restore_scopes and settlement is
failed/timed_out/output_capped/cancelled + changed + within_scope
  -> keep polls pending and retain the same workspace write lock
  -> recheck the exact settled-after workspace and private recovery manifest
  -> append automatic_compensation rollback_started intent
  -> run the same staged restore/reverse/fsync transaction
  -> append the matching rolled_back outcome and expose its derived status
Otherwise
  -> never infer automatic authorization from old schema, restart, success,
     interruption, outside-scope drift, or an indeterminate snapshot
  -> release the lock with operator rollback available when still safe

Operator selects rollback preview for one changed schema-v6/v7 Process
  -> require private Process/Thread/Run/scope/before-hash bindings
  -> verify every backup content hash and recursive POSIX mode-set hash
  -> require the complete workspace to equal the settled-after hash
  -> return one local five-minute preview with counts and hashes, never paths
Operator applies the exact rollback preview
  -> consume it once and acquire the same cross-Manager workspace write lock
  -> repeat full workspace and private-backup freshness checks
  -> append workspace.process.rollback_started before the first file swap
  -> stage every backup beside its target and atomically replace each scope
  -> reverse committed scopes in reverse order if a later scope fails
  -> verify content/modes, remove swap files, and fsync parent directories
  -> append workspace.process.rolled_back as restored, reverted, or indeterminate
  -> remove private recovery only after a verified restored outcome
```

`restored` and retryable `reverted` require successful parent-directory fsync.
Any staging cleanup, reverse swap, or durability failure is `indeterminate`
and retains private recovery for manual inspection. Private Process recovery
directories are checked with `lstat` before every read, and strict manifest,
attempt, and result parsers reject unknown fields even when an attacker
recomputes their unkeyed content hashes.

The fixed Process recovery Outcome benchmark exercises this production path
without involving a model. A real temporary Node child changes one
preview-bound scope and exits 17; the runner requires failed, changed,
within-scope settlement, automatic restoration, four ordered Process events,
valid Replay, and the same restored projection after closing and reopening the
Store and Manager. Its Ledger binds the preview, terminal session, automatic
rollback attempt/result, target before/mutated/final hashes, all event
receipts, and source Replay hash without retaining argv, paths, or file bytes.
The offline verifier replays Process events with the production projector,
reconstructs reopen runtime state, and rejects a forged final hash even after
outer Ledger hashes are recomputed. The opt-in direct adapter is explicitly
recorded as `trusted_outer_test`; only the default platform adapter constitutes
an OS Sandbox attempt. The retained five-trial Series passes in 104-121 ms per
trial, and the complete repository gate passes 2,102 tests.

`WorkspaceProcessManager` is a Capability Plane service outside `LocalStore`
and the Server router. The Work Ledger remains authoritative across restarts:
the Manager reconstructs its process projection once during initialization and
records any unclosed session as `interrupted` with unknown outcome. While the
Runtime is alive, an incremental in-memory projection serves frequent
Workbench polling without rescanning a long Thread. It is a cache of Ledger
state plus active local handles, not a second durable source. Snapshot and diff
logic is shared with workspace verification, excludes `.git`, `.napier`,
`node_modules`, and symlinks, and fails closed as `indeterminate` when either
ordinary read-only side exceeds 2,000 files or 16 MiB or the post-snapshot is
unavailable. Scoped writes use a separate bounded complete baseline of 10,000
file/directory entries and 64 MiB while leaving compatible read-only snapshot
hashes unchanged.

Input and output text are intentionally ephemeral. The live Agent tool result and
`GET .../processes/{processId}/output?after=<cursor>` can return bounded chunks,
but model responses, tool events, Process lifecycle events, Trace summaries,
Replay, and exports retain only hashes, counts, cursors, status, and limits.
`POST .../processes/{processId}/input` accepts only owning-Thread UTF-8 text,
optional newline, and optional close; Agent writes additionally bind to the
owning Run. Its response is a hash-only input receipt. Writes are serialized
through one per-session chain and resolve only after the Node Writable
callback, so backpressure delays the caller instead of dropping data. If
accepted bytes cannot be bound to the Ledger, Napier terminates the session and
reports an unknown outcome rather than inviting a blind retry.
PTY input and resize share the same per-session serialization chain. PTY input
cannot request pipe close semantics; callers send literal control bytes, wait
for settlement, or cancel. A native PTY write proves synchronous adapter
acceptance rather than target consumption. A resize binds sequence, current
columns/rows, owning Run, and resulting session hash. If the adapter accepted a
resize but the Ledger append fails, Napier terminates the session and records
an unknown interruption rather than silently retrying.
The similarly Thread-scoped `GET .../processes/{processId}/delta` returns at
most 256 relative-path entries with before/after file metadata from the current
Runtime. The Ledger retains only pre/post snapshot digests, truncation state,
comparison status, changed-entry count, and a changed-path-set digest. The lazy
Processes panel exposes output availability, status, limits, settlement
evidence, cancellation, and workspace-window drift under the owning Thread.
For running interactive sessions it also exposes bounded input and explicit
stdin close for pipes. PTY cards instead show the fixed terminal type, current
size, resize count, and merged output, and hide the invalid close action.
Request-sequence and Process-selection guards discard stale responses.
`POST .../processes/{processId}/rollback/preview` and one-use
`POST .../processes/{processId}/rollback` expose operator-only recovery. The
first binds the complete current workspace; the second records intent before
mutation and outcome after verification. A pending intent, `indeterminate`
result, stale workspace, backup drift, or concurrent writer disables retry.
Read-only changes remain unattributed. Scoped cards distinguish changes wholly
inside approved scopes from outside-scope or incomplete observations, but
external writers still make authorship unknowable. Path details disappear
after Runtime restart while the summary evidence remains. Schema v1 sessions
continue to project as delta-unavailable, schema v2 sessions retain snapshot
evidence without input metadata, schema v3 retains pipe input evidence,
ordinary pipe/PTY sessions use schema v4, and schema-v5 scoped writes remain
readable. Ordinary recoverable scoped writes use schema v6; explicitly
compensated writes use schema v7.

Admission reservation, write preview state and lock acquisition, output/Delta
projection, settlement classification, tool result rendering, and tool input
schemas live in focused Process modules rather than enlarging the Store,
Server, or Agent loop. Scoped starts reuse `workspace-write-lock.ts` as a
long-held cross-Manager lease. The Ledger is still the only durable Process
source; preview IDs and exact paths disappear with the Runtime.

`sandbox-terminal.ts` is the only adapter from `node-pty` into Napier's stream
contract. It dynamically loads the native dependency only for a PTY request,
wraps `sandbox-exec` or Bubblewrap in the terminal, merges native output,
supports resize, and terminates the PTY process group. The target executable
still runs inside the existing OS Sandbox profile. `workspace-process-terminal.ts`
owns initial terminal binding and resize state; resize receipt parsing is split
into `workspace-process-resize-events.ts` rather than expanding the Process
Manager or Store. `scripts/prepare-node-pty.mjs` corrects the locked macOS
prebuild's missing user execute bit only for a regular current-platform helper;
symlinks and missing helpers fail installation.

Graceful Server shutdown stops active process groups before closing the Store.
Workspace Process launches also bind parent-death protection into their
resource evidence. Linux reuses Bubblewrap's native `--die-with-parent`;
macOS places `sandbox-exec` behind a fixed Node guardian that receives its
private target specification over a dedicated pipe, watches the Runtime parent,
and escalates target-tree termination from `SIGTERM` to `SIGKILL`. The guardian
uses fixed `/bin/ps` invocations with a one-second time limit and 4 MiB output
cap to record only PID, parent PID, process group, and start time at launch,
every two seconds, and immediately before cleanup. It recursively tracks
descendants and signals a PID only while its current start time still matches
the observed identity, with deeper descendants stopped first. Process-table
read failure terminates the managed target with a non-zero guardian result.
PTY target specifications remain process-local and are removed before the
sandbox target is spawned.
Guardian/target/descendant PIDs, process-table observations, arguments,
environment values, and protocol messages never enter the Ledger.
New Process resource hashes bind guardian schema 2 with target-group and
observed-descendant cleanup flags; historical Session schemas and receipts
remain readable because only the new run's resource hash changes.

An abrupt Runtime loss still leaves the task outcome unknown, so startup
records interruption rather than completion. The guardian proves cleanup of
the managed target group and descendants observed before they reparent. A
rapid double-fork that is created and reparented entirely between scans remains
a platform race; kernel-enforced descendant containment, cross-restart
reattachment, and successful settlement are not claimed. OCI guarding remains
fail-closed until container runtime identity binding exists. Hard total RSS
quotas, package-backed Python, remote sandboxes, reattachment, and writer
attribution remain outside this slice. PTY mode supplies real terminal
stdin/stdout, sizing, control bytes, and process-group cancellation, but does
not grant shell access, cross-restart attach, a durable screen buffer, or
Napier job-control commands. The JavaScript/Python kernels and Node debugger
below remain read-only typed protocols over the same Process Session service.

## Persistent JavaScript Kernel Flow

`javascript_kernel` turns one bounded Process Session into a persistent
synchronous calculation context without adding another durable Session model:

```text
Agent selects start
  -> require non-observe policy + enabled javascript_kernel tool
  -> reuse WorkspaceProcessManager admission, cwd, runtime identity, fixed env,
     read-only workspace, denied network, wall time, output cap, and cancellation
  -> launch the fixed hash-bound JavaScript worker through the OS Sandbox
  -> register its Napier Process ID to the current Thread and Run in memory
Agent selects evaluate + Process ID + JavaScript
  -> require the same live Thread/Run registration and running Process Session
  -> validate 1-16 KiB UTF-8 code and a 1-2,000 ms evaluation budget
  -> encode code as canonical base64 so JSON escaping cannot exceed stdin limits
  -> append one hash-only workspace.process.input receipt
  -> evaluate in node:vm with string/Wasm codegen disabled and after-evaluate
     microtask draining inside the same timeout
  -> render value and console output inside that realm under a second 100 ms cap
  -> encode live strings as canonical UTF-16LE base64 for the private frame
  -> reserve a structured terminal response inside a 30 KiB protocol budget
  -> parse one request-ID-bound exact JSONL result
  -> return bounded value/console text to the live Agent only
  -> retain code/output hashes and status/count/latency evidence in the Ledger
Agent selects cancel, or evaluation becomes uncertain
  -> terminate the complete Process Session and discard the in-memory registration
Run settles without an explicit cancel
  -> cancel every remaining kernel owned by that Thread and Run
  -> settle Process evidence before the terminal Run event
```

The worker source is split across bounded literal argv items and reconstructed
by a fixed loader; every argument still passes the shared explicit-argv limits,
and the complete worker bytes are bound by `workerSha256`. Evaluation code uses
canonical base64 inside the private JSONL frame, keeping every accepted 16 KiB
source below the Process input-action budget even under worst-case JSON
escaping. The worker independently validates canonical encoding, UTF-8, and
decoded size before evaluation. `JavascriptKernelManager` wraps the existing
Process Manager and owns only live Thread/Run registrations. It does not
persist a second session graph. A recreated manager cannot adopt an old
context, and the underlying process lifecycle remains authoritative through
`workspace.process.*` Ledger events. `AgentRuntime` cancels Run-owned kernels
on every success, failure, cancellation, and operator-waiting path, so omitted
model cleanup cannot consume Process slots after Run settlement.

The active Process entry carries a non-durable private-protocol marker.
Generic Process list projections report `outputAvailable=false` and
`stdinOpen=false`; generic output returns no chunks and generic input is
rejected. `JavascriptKernelManager` uses dedicated protocol start/input/output
methods that are not reachable from HTTP or Agent parameters. Operator
cancellation remains available. The marker does not create durable state:
Ledger lifecycle events remain authoritative, and after restart the existing
Process reconciliation already records the session as interrupted with no live
output or stdin.

The VM context receives no host function or object. Its console capture and
preview formatter are constructed inside the context, so function constructors
cannot cross realms through `console` or Node's custom-inspection callback.
Potentially user-defined `toJSON`, proxy, and thenable behavior runs under the
bounded render script. A Promise/thenable, VM or render timeout, caller abort,
protocol-budget exhaustion, malformed protocol, exited worker, or unknown
post-write outcome terminates the kernel. UTF-16LE base64 preserves isolated
surrogates and prevents control-character JSON escaping from crossing the
Process output cap; the worker reserves enough of that cap for a terminal
budget response. Discarded finite Promise microtasks drain before
`runInContext` returns; an infinite chain is part of the same timeout. A
returned Promise or thenable remains terminal. Synchronous exceptions remain
non-terminal and preserve earlier state.

The bootstrap removes delayed built-in schedulers that do not fit this
synchronous contract: `SharedArrayBuffer`, `Atomics`,
`FinalizationRegistry`, `WeakRef`, and `WebAssembly` are immutable
`undefined`. This closes `Atomics.waitAsync`, GC-timed callbacks, and
asynchronous Wasm work that could settle after an evaluation. Ordinary
`ArrayBuffer`, TypedArrays, and finite same-evaluation Promise microtasks remain
available. Before writing stdin, the Manager lazily loads the existing
TypeScript parser and rejects actual dynamic `import()` call expressions;
strings and comments remain ordinary data. This avoids the VM module loader's
asynchronous rejection path without adding compiler cost to Runtime startup
when the kernel is unused.

`node:vm` is context isolation, not the security boundary. The fixed
secret-free child environment and OS Sandbox still enforce workspace
read-only, denied network, and process confinement. Code, values, console
entries, and cwd paths remain live-only; Agent events, Replay, Trace, and
exports retain hashes, counts, timing, and lifecycle status. Private protocol
projection also prevents the generic Processes panel from rendering or
injecting the reversible transport. The current slice does not provide
modules, timers, async I/O, tool callbacks, snapshots, cross-restart recovery,
or Python.

## Persistent Restricted Python Kernel Flow

`python_kernel` composes the same Process Session lifecycle with a separately
bound Python runtime and a narrower pure-computation language:

```text
Agent selects start
  -> require non-observe policy + enabled python_kernel tool
  -> resolve a recognized CLT/Xcode or fixed Linux Python executable
  -> hash the executable and bounded no-site bootstrap dependency asset set
  -> mount the exact version root read-only in the local OS Sandbox
  -> launch -I -B -S -u with fixed PYTHONHASHSEED and no inherited environment
  -> enforce CPU/process/file/core/fd limits before reading requests
  -> register the private Process ID to the current Thread and Run
Agent selects evaluate + Process ID + Python
  -> require the same live Thread/Run registration and Python Process Session
  -> validate 1-16 KiB UTF-8 code and a 1-2,000 ms wall budget
  -> optionally decode one canonical JSON input in the trusted worker and
     freeze arrays/objects before any user AST executes
  -> append one hash-only workspace.process.input receipt
  -> parse Python AST and reject imports, class/async/yield/generator syntax,
     decorators, private/dunder names, and frame/traceback attributes
  -> execute with a fixed pure-computation builtin dictionary
  -> arm a trusted per-evaluation wall timer that exits the worker on expiry
  -> capture bounded print output and render built-in values without user repr
  -> terminate the process from a trusted trace hook above 32 MiB Python heap
  -> return canonical request-ID-bound UTF-16LE base64 result text live-only
     and, when requested, one exact bounded canonical JSON projection
  -> retain status/type/version/count/time/memory plus runtime/result hashes
Agent selects cancel, or evaluation becomes uncertain
  -> terminate the complete Process Session and discard the registration
Run settles without explicit cancel
  -> AgentKernelRuntime cancels every JavaScript and Python kernel for the Run
  -> settle Process evidence before the terminal Run event
```

The command layer keeps its public Node-only schemas while its internal
`CommandRuntime` can prepare Python for the typed private kernel. On macOS it
does not launch the `/usr/bin/python3` Developer Tools shim; it resolves the
versioned framework executable, permits process-exec only for that file, and
adds one read-only runtime root. Linux resolves `/usr/bin/python3` and its exact
stdlib version directory. The receipt binds executable, fixed environment,
argv, resource limits, runtime path hashes, and hashes for the bounded
bootstrap dependency source, existing bytecode, and native-extension files.
The worker disables site initialization, and a host regression proves the set
covers every module file loaded by the real worker imports. Preparation and
settlement rehash those assets. Python remains fail-closed for OCI until
image runtime identity is defined.

The fixed worker source is zlib-compressed and canonical-base64 chunked across
bounded ASCII argv items; the uncompressed bytes are bound by
`workerSha256`. User snippets use a second canonical-base64 request envelope.
The worker independently validates exact request keys, request ID, encoding,
UTF-8, code bytes, and timeout. Result frames have exact keys, canonical
UTF-16LE base64, bounded console entries, Python version, traced-memory
peak/limit, and a cumulative 96 KiB trusted-private protocol budget with a
reserved terminal response. Ordinary Process output remains capped at 32K.
Exact JSON is limited to 32 KiB, finite numbers, string keys, bounded
depth/nodes, supported containers, and no cycles. Workflow intermediate/final
result modes omit presentation bodies when they are not consumed. The worker's
trusted 1-2,000 ms timer remains the code-execution
deadline. The parent permits a separate bounded five-second scheduling and
protocol-result grace so host contention before worker dispatch cannot turn a
valid evaluation into an uncertain timeout.

Restricted execution is intentionally not described as a secure Python
language sandbox. The globals map has only selected arithmetic, container,
iteration, conversion, exception, and print builtins. AST checks deny dynamic
capability recovery through imports, dunder/private access, generator frames,
and frame/traceback fields. A regression executes the concrete
`gi_frame.f_back.f_globals` generator-expression escape and receives a
non-terminal denial. The outer macOS/Bubblewrap process sandbox remains the
host boundary, with a read-only workspace, denied network, fixed environment,
and only the selected executable permitted.

For each evaluation, the worker arms `ITIMER_REAL`; expiry writes one fixed
private stderr marker and calls trusted `os._exit(71)`, so user `except:`
cannot extend its wall budget. A 30-second process CPU hard limit remains the
session backstop. The worker also sets no-child-process, zero-output-file,
zero-core, and 32-descriptor limits. `tracemalloc` observes the persistent
Python heap; crossing 32 MiB writes a separate fixed private marker and calls
trusted `os._exit(70)`. The Manager maps only those markers to fixed path-free
failures and destroys the registration. This bounds Python allocations exposed
by the restricted builtins, but it is not a hard total-RSS guarantee for
arbitrary native extensions; those extensions are unavailable, and OCI/VM
memory quotas remain the future stronger boundary.

Synchronous syntax/runtime errors preserve earlier state. Wall/CPU timeout,
memory exit, caller abort, background-thread detection, protocol/output
exhaustion, malformed response, early worker exit, or unknown input outcome
terminates the kernel. Code, values, console entries, cwd, and fixed stderr
markers remain live-only. Ledger, Replay, public SSE, and Trace retain only
action/status/type, Python version, counts, timing, memory numbers, Process ID,
and hashes. Generic Process output/input cannot expose or inject the private
frames.

This is a persistent restricted calculation context, not general Python,
package installation, DataFrame/SQL, Notebook, async I/O, a filesystem tool
bridge, snapshot, or cross-restart recovery.

## Run-Owned Node DAP Flow

`node_debugger` adds a fixed Node launch adapter over the same private Process
Session boundary without introducing another durable session graph:

```text
Agent selects launch + source + breakpoints
  -> require non-observe policy + enabled node_debugger tool
  -> canonicalize one direct source or source + program + external map
  -> hash every <=1 MiB non-symlinked file and launch the fixed adapter worker
  -> use a fixed secret-free environment, read-only workspace, and denied network
  -> connect a controller Worker to the target main thread with node:inspector
  -> optionally validate one bounded single-source v3 map inside the Sandbox
  -> map source breakpoints to generated locations and initialize DAP
  -> evaluate require(canonical program) without opening an inspector TCP port
  -> map accepted frames back to source and capture all bound workspace files
Agent selects stack/scopes/variables/evaluate/step
  -> require the same live Thread, Run, Process, and paused registration
  -> rehash source/program/map and ask the adapter to rehash its module set
  -> terminate if any bound file or loaded workspace module drifted
  -> exchange one bounded Content-Length-framed DAP request/response sequence
  -> reject expression side effects through throwOnSideEffect
  -> return bounded stack/value/output text to the live Agent only
  -> retain counts, versions, lifecycle state, and aggregate hashes in Ledger
Target terminates, Agent cancels, or Run settles
  -> terminate the adapter Process and discard the in-memory registration
  -> settle authoritative workspace.process evidence before the Run terminal event
```

The adapter controller executes in a Worker and calls
`inspector.Session.connectToMainThread()`, leaving the main thread as the real
debug target. `Runtime.evaluate(require(realpath))` supports JavaScript and the
TypeScript syntax directly executable by the selected Node runtime. The fixed
adapter implements DAP initialize, launch, breakpoint/exception configuration,
stack, scopes, variables, evaluate, continue, step over/in/out, pause, and
disconnect. The Agent surface intentionally omits pause because its current
continue/step calls synchronously wait for the next stop or termination; an
unreachable action is not advertised.

For compiled TypeScript, the launch request separately binds the original
source, generated program, and external map. `node-debugger-source-binding.ts`
performs host-side workspace confinement and exact file hashing before process
creation. The compressed controller embeds a focused source-map fragment that
strictly parses v3 JSON, decodes at most 8,192 VLQ mappings, and constructs
Node's built-in `SourceMap` only after the map's `file`, relative
`sourceMappingURL`, single `sources` entry, actual source path, optional
`sourcesContent`, generated line count, source line count, and mapping indices
all match. Breakpoints use decoded reverse locations; stack and step frames use
generated-to-original lookup. Map text never leaves the private adapter
protocol.

DAP input and output use strict `Content-Length` framing with independent
header, message, cumulative byte, and message-count limits. A random 128-bit
per-process authenticator is injected into every adapter response/event and
removed by the Manager after verification. Target stdout/stderr is redirected
through a separate random Inspector binding, while adapter frames use direct
file-descriptor writes. Raw target writes can only cause fail-closed protocol
termination; they cannot forge accepted stack, variable, stop, or exit
evidence.

Only workspace call frames are projected. Script IDs are resolved through
`Debugger.scriptParsed`; source-mapped frames must resolve to the exact bound
original source, relocated breakpoints must still match the requested source
line, and internal/external-only pauses resume automatically. Each accepted
stop emits a hash over the sorted workspace module path/content set, including
the source, generated program, and map. Before every paused-state action, a
private `napierVerifyModules` DAP extension rehashes that set in the Sandbox. A
stale snapshot is an unknown evidence state and cancels the complete Process.

Paths, source, argv, expressions, stack/scope/variable names and values, and
target output are live-only. `tool.*`, `workspace.process.*`, Replay, public
SSE history, and Web Trace retain only bounded action/state/status/reason,
counts, Node version, truncation flags, exit code, and
source/program/source-map/module/worker/runtime/request/response/event/result
hashes. Schema-v2 Trace also records only source-map mode and bounded file byte
counts. Generic Process output and stdin remain unavailable for the private
protocol; schema-v1 direct-launch evidence remains readable.

This slice does not provide attach, breakpoint mutation after launch,
multi-thread or child-process debugging, inline/sectioned or multi-source
bundler maps, a third-party adapter host, write-capable targets, debugger UI,
checkpoint recovery, or cross-restart adoption. The opt-in macOS Sandbox smoke
is inconclusive in the reviewed nested IDE: the adapter exits before
initialization, matching the existing `sandbox-exec` denial. No host fallback
exists.

## Workspace Verification Flow

Napier does not expose a general shell for build validation. The
`verify_workspace` tool is a closed dispatcher for three local verifiers:

```text
model requests typecheck / test / format
  -> require non-observe policy + enabled verify_workspace tool
  -> validate a workspace-relative cwd, optional target, and 1-120 second budget
  -> canonicalize cwd, target, current Node, and the fixed local or explicitly
     bound external CLI
  -> hash cwd/target paths, verifier/toolchain bytes, and a bounded cwd snapshot
  -> construct Napier-owned arguments without consulting package scripts
  -> launch with process.spawn + workspace.read only
  -> keep the candidate workspace and external runtime path read-only while
     networking remains disabled in the OS sandbox
  -> cap stdout and stderr independently at 32,000 characters
  -> terminate the isolated process group on timeout, cancellation, or output cap
  -> revalidate the bound toolchain after execution
  -> append redacted status, scope/toolchain/result receipts, and output digests
     to tool.completed
```

The fixed entrypoints are TypeScript's `tsc`, Vitest's `vitest.mjs`, and
Prettier's `prettier.cjs` under the workspace `node_modules`. Typecheck always
adds `--noEmit`; Vitest runs with a bounded two-worker thread pool; Prettier
uses `--check`. The child environment is exactly `CI=1`, `FORCE_COLOR=0`, and
`NO_COLOR=1`. A non-zero exit is a normal `failed` verification result, not a
successful check or a hidden transport exception. `timed_out` and
`output_capped` remain separately queryable outcomes.

For an isolated coder, `workspaceRoot` is the private candidate while
`toolchainRoot` is the original workspace. Only the canonical parent
`node_modules` becomes an additional read-only runtime path. The binding
rehashes the fixed entrypoint and optional root package manifests after the
process settles; drift rejects the result. This is still the closed verifier
dispatcher, not a child shell or package-script capability.

The result records kind, sandbox, workspace-relative cwd and target, duration,
exit code, signal, character counts, truncation flags, independent
stdout/stderr SHA-256 digests, and a `scopeSha256` over the verifier kind,
cwd/target path hashes, verifier/toolchain identity, target snapshot, and
bounded cwd snapshot. The snapshot excludes `.git`, `.napier`, and
`node_modules`, caps at 2,000 files or 16 MiB, and marks truncated evidence
explicitly. Full bounded output is returned only to the live Agent. Dedicated
Ledger adapters project kind/status, exit state, scope/snapshot/toolchain/result
hashes, counts, output digests, and truncation flags; output text, cwd/target
paths, and sandbox labels do not enter Ledger, Replay, SSE, or Trace.
Researcher, reviewer, and general Subagents remain read-only without a
verifier. The coder receives this fixed dispatcher only when its parent profile
explicitly enables `verify_workspace`.

## Background Automation And Channel Flow

Schedules are durable records, not browser timers:

```text
create interval or five-field UTC cron schedule
  -> validate bounds and compute nextRunAt without interval drift
  -> return no-store projection/list hash, status, revision, next-run, and
     active/paused count headers for management APIs
  -> mirror schedule-list SHA-256 and count headers on Bootstrap alongside the
     full Bootstrap response SHA-256
  -> claim a due occurrence with a worker-only token and expiry
  -> append schedule.claimed
  -> derive triggerId from schedule ID + scheduled UTC instant
  -> reuse an existing trigger Run or create a leased schedule Run
  -> heartbeat both claim and Run while the Agent works
  -> settle the claim and advance the schedule exactly once
  -> append completed / failed / skipped / deduplicated evidence
```

Intervals preserve an anchor. Cron is interpreted only in UTC. The local
scheduler bounds work per tick, supports `run_once` or `skip` misfire handling,
and records an overlap skip when the target Thread already has active work.
Schedule lifecycle events retain schedule IDs, status, timing, and revision
evidence, but not the scheduled prompt text.
Pausing prevents future claims without invalidating one already in flight.

Inbound channels separate authentication, durable acceptance, and execution:

```text
create webhook channel
  -> return a cryptographically random bearer token once
  -> select napier_json, github_webhook, slack_event, or linear_webhook adapter,
     defaulting legacy channels to napier_json
  -> apply legacy_bearer, signed_standard, signed_strict, or custom policy
     template
  -> persist only token SHA-256 + public fingerprint
  -> return no-store channel projection hash/status/revision/template/fingerprint
     headers without hashing the raw one-time token
  -> optionally require HMAC-SHA256(timestamp + body) signed by that token
  -> persist maxAttempts + baseDelayMs as a revisioned retry policy
list webhook channels
  -> return only token-free channel projections
  -> bind the no-store list response to a content SHA-256
  -> mirror total, active, and disabled channel counts in headers for CI checks
  -> mirror the channel-list SHA-256 and count headers on Bootstrap alongside
     the full Bootstrap response SHA-256
update signature policy
  -> require or relax HMAC-SHA256 verification under a new channel revision
  -> adjust timestamp-skew tolerance without persisting raw signing material
  -> return no-store content/channel hash, status, revision, and fingerprint
     headers
update retry policy
  -> affect only deliveries accepted after the new revision
  -> preserve maxAttempts + retryBaseMs on every existing delivery
  -> return no-store content/channel hash, status, revision, and fingerprint
     headers
rotate channel token
  -> replace token SHA-256 atomically and increment revision
  -> append old/new fingerprints without either raw token
  -> reject the previous token as soon as the mutation commits
  -> return no-store channel projection hash/status/revision/template/fingerprint
     headers without hashing the raw replacement token
preview adapter mapping
  -> parse bounded sample headers/body through the selected adapter
  -> return content/body/message SHA-256, idempotency fingerprint, and message
     preview
  -> mirror adapter ID, receipt hash, body hash, message hash, and fingerprint
     in headers for CI smoke checks
  -> use no-store headers and avoid delivery, Run, or Ledger mutation
adapter catalog
  -> expose server-owned labels, idempotency sources, required headers, samples,
     and security notes through Bootstrap and /api/channels/adapters
  -> bind the catalog to a stable SHA-256 exposed in Bootstrap and response
     headers for drift checks
  -> mirror adapter catalog SHA-256, adapter count, and adapter-ID set hash
     headers on both Bootstrap and /api/channels/adapters
POST bounded adapter payload with token + idempotency evidence
  -> authorize without revealing whether an unknown channel exists
  -> if required, verify timestamp skew and body signature before acceptance
  -> parse napier_json bodies directly, normalize GitHub delivery/event headers
     plus payload, normalize Slack Events API event_id payloads, or normalize
     Linear webhook entity-change payloads into an internal delivery request
  -> hash the idempotency key and atomically accept or return prior receipt
  -> persist body SHA-256 + adapter catalog SHA-256 as hash-only evidence
  -> append delivery evidence with adapter id, channel revision, body hash, and
     adapter catalog hash
  -> persist accepted delivery before returning 202
  -> return accepted or duplicate no-store receipt with content hash, duplicate
     flag, channel/thread/delivery/trigger identity, optional run id, status,
     revision, fingerprint, and public evidence headers
  -> background worker claims attempt 1 and derives its deterministic trigger
  -> create a leased channel Run or reconcile that attempt's existing Run
  -> settle the delivery and append attempt-bound channel evidence
list channel deliveries
  -> return a no-store delivery projection with content hash, channel id,
     delivery-list hash, delivery-id set hash, total, and per-status count
     headers for polling and machine checks
qualify delivery evidence
  -> read one delivery without mutating Ledger state
  -> return qualified, evidence_missing, or adapter_catalog_drift
  -> compare stored adapter catalog SHA-256 with the current server catalog
  -> bind the no-store qualification response to contentSha256 and mirror
     channel id, delivery id, status, diagnostic count, current catalog hash,
     and optional body/catalog hash evidence in response headers
pre-run dispatch failure with no Run
  -> persist retrying + nextAttemptAt using bounded exponential backoff
  -> claim the next attempt only after its durable due time
failed attempt with a Run, or restart-unknown outcome
  -> fail closed without automatic replay
  -> require explicit operator confirmation
  -> claim a new attempt with a distinct :attempt:<n> trigger
  -> return a no-store retry response with delivery content hash, channel/
     thread/delivery/trigger identity, optional run id, status, attempt counts,
     revision, fingerprint, public evidence hashes, and next-attempt headers
export dead letters
  -> select failed deliveries without queued message content
  -> include public metadata, retry disposition, message SHA-256, and stored
     body/catalog SHA-256 evidence when present
  -> compare stored adapter catalog hash with the current server catalog and
     stamp per-delivery qualification status plus top-level summary counts
  -> bind canonical export content to a stable SHA-256
  -> return the artifact with Cache-Control: no-store and
     channel/thread identity, content, delivery-count, delivery-id set,
     retry-disposition, current-catalog, and qualification summary headers
  -> save direct API attachments and Automations downloads as
     napier-dead-letters-<safe-channel-id>-<content-hash>.json
  -> append channel.dead_letters.exported with count, hash, and
     qualified/missing/drift summary counts
verify dead-letter export
  -> accept an uploaded artifact with a bounded no-store request
  -> recompute canonical content SHA-256 without exportedAt
  -> compare declared delivery count, top-level qualification counts, and
     per-delivery qualification status against stored body/catalog hash evidence
  -> return a hash-bound valid/invalid verification receipt
  -> mirror channel identity, declared/recomputed content hashes, verifier
     status, and observed delivery/qualification counts in headers for machine
     checks
retry dead letters from artifact
  -> generate a no-store retry preview from the verified artifact and current
     delivery projection
  -> mark each delivery retryable, not found, not failed, or retry exhausted
  -> include top-level SHA-256 summaries for candidate, retryable, blocked,
     retried, and skipped delivery ID sets
  -> mirror channel identity, preview verification status, retry/candidate/
     diagnostic counts, and public set hashes in headers for machine checks
  -> require expectedPreviewSha256 and explicit replay confirmation before apply
  -> copy preview candidate/retryable/blocked set hashes into the apply receipt
  -> mirror channel identity, consumed preview hash, retry/skipped counts, and
     retried/skipped set hashes in apply response headers
  -> reuse single-delivery retry guards, append hash-only bulk retry evidence,
     and trigger one delivery drain
  -> project channel.dead_letters.retry_applied events into a no-store retry
     history receipt with event IDs, seq boundaries, an event-set hash, apply
     result hashes, counts, and public hash summaries
  -> return content-disposition plus channel/thread identity, content/event-set
     hash, event-count, and first/last seq headers for direct retry-history
     artifact capture
  -> save direct API attachments and Automations downloads as
     napier-dead-letter-retry-history-<safe-channel-id>-<content-hash>.json
  -> verify uploaded retry history receipts against the current Ledger
     projection without storing the receipt
  -> return verifier status plus observed content/event-set/count/seq headers
     for machine checks
  -> expose the same preview/apply receipt in Automations without displaying
     queued message content, and let operators download, upload, and verify
     retry-history receipts from the UI
  -> refresh the preview and retry history after apply so stale retryable
     candidates become blocked against the current projection
```

The second request with the same channel and idempotency key returns the
original receipt with `200`; its replacement body is ignored. Public APIs omit
the token digest, full idempotency digest, queued message, and model override.
Accepted delivery projections and `channel.delivery.*` events retain only the
raw inbound body SHA-256 and adapter catalog SHA-256 needed to replay parser
context without storing the original webhook body.
The Workbench Trace event list projects schedule and channel receipts through
metadata-only summaries, so management names, queued prompts, delivery errors,
and inbound body prose cannot reappear through generic payload keys.
The GitHub adapter uses `X-GitHub-Delivery` as the source idempotency material
but emits only a SHA-256 fingerprint in the Agent-facing summary. The Slack
adapter uses `event_id` as idempotency material. The Linear adapter hashes
webhook ID, timestamp, entity type/action, and entity ID into idempotency
material. Both likewise emit only an event fingerprint. Inbound content remains
in private runtime state until it becomes ordinary message evidence for the
target ledger.

Adapter preview is a local management operation, not inbound acceptance. It
uses the same parser as `/inbound`, rejects malformed sample headers/bodies,
and returns only hashes, fingerprints, optional model metadata, and a bounded
message preview. It does not require the one-time bearer token because it never
authorizes or enqueues external work.

Signature policy updates take effect for subsequent inbound requests only.
They increment the channel revision, store only public policy metadata, and
append count-free Ledger evidence without raw tokens, signatures, or body
content.

Policy templates are public labels over concrete retry and signature settings:
`legacy_bearer` preserves the bearer-token-only default, `signed_standard`
requires HMAC with a five-minute skew window, and `signed_strict` tightens the
skew and retry posture for higher-risk channels. Editing either policy after
creation recomputes the label; non-matching combinations become `custom`.

Channels accept one to ten attempts and a base delay from 250 ms to 60 seconds.
Each delivery snapshots both values when accepted. Only failures before Run
creation enter bounded exponential backoff; a later channel policy revision
does not alter already accepted work. Once a Run exists, retrying may repeat
tool side effects, so Ops presents a second confirmation before creating a new
attempt.

Dead-letter export is an explicit POST because it emits audit evidence. Its
versioned artifact omits bearer tokens, idempotency keys, full idempotency
digests, model overrides, and queued message text. A message SHA-256 supports
correlation without disclosure, while a canonical content SHA-256 remains
stable across repeated export times. The browser polls only loaded delivery
lists with active states and stops after they become terminal.

## Restart And Recovery Flow

```text
process startup
  -> find persisted queued/running runs
  -> preserve runs whose renewable owner lease is still live
  -> mark only unleased/expired runs interrupted and their Threads waiting
  -> clear expired run ownership
  -> preserve a running inbound delivery when its leased Run remains active
  -> fail other running deliveries because their outcome may be unknown
  -> retain accepted/retrying inbound deliveries for a bounded due-time sweep
  -> cancel pending/running subagent tasks from those runs
  -> cancel undelivered steering/follow-up items with hash-only reason evidence
  -> append missing run.interrupted / subagent.cancelled evidence once
  -> leave schema-1, missing-policy, manual, demo, and imported Runs waiting
  -> for an opt-in schema-2 Run, hash its complete Run-local event range
  -> block any unresolved tool start, write/delegation, unknown effect,
     untrusted chain, or exhausted attempt budget
  -> persist one metadata-only eligibility assessment
  -> after bounded exponential backoff, atomically claim by SQLite revision CAS
  -> derive one deterministic trigger from root Run + attempt number
  -> load the interrupted Run's exact Agent revision and model
  -> create a linked child with safe_read_only_recovery execution mode
  -> expose only local list/read/search; omit plan tools, Extensions,
     Subagents, verification processes, and Memory extraction
  -> settle or reconcile the attempt from its durable child Run
```

Napier does not automatically replay an in-flight tool call after restart.
`tool.started` without a matching terminal event is explicitly described as an
unknown outcome and blocks automatic recovery even for a reviewed read tool.
Known workspace writes, plan mutation, delegation, and reviewed external writes
also block; an unbound Extension effect fails closed as unknown.

An assessment contains resource IDs, configuration/event hashes, canonical
reason codes, tool names/counts, prior-attempt count, and timestamps. It never
contains prompts, tool inputs/outputs, or claim tokens. Attempt records bind the
assessment SHA-256, root/source Runs, deterministic trigger, claim lease, child
Run, revision, and terminal state under their own SHA-256. Raw claim tokens are
worker-only; SQLite stores only their digests.

Claim and Run leases are independent. A pre-Run claim may be reissued after
expiry without consuming another attempt. A running child is owned by its Run
lease and is never duplicated by a second recovery worker. If that child is
itself interrupted, its own events must pass a new assessment and consume the
next root-chain attempt. Failed, cancelled, or completed children are terminal;
there is no generic failure retry loop.

For schema-3 interrupted Runs, automatic recovery also recomputes the current
enabled Skill catalog before creating the child Run. A changed Skill file,
missing Skill, or diagnostic drift changes `skillCatalogSha256`; the claim is
abandoned with hash-only failure evidence and no recovery Run is created.
Manual Resume remains available because an operator can inspect the drift and
decide how to proceed.

Manual Resume remains available regardless of automatic eligibility and keeps
the existing unknown-side-effect warning. Recovery prompts are hidden
lifecycle evidence rather than new user messages, while
`run.recovery.started/completed/failed` and
`run.recovery.auto.*` control evidence remain visible in Trace. Reopening the
store repeatedly is idempotent; the worker backfills missing hash-only control
events from authoritative assessment/attempt state. The Thread recovery REST
projection is no-store, binds the returned assessment/attempt metadata to a
content SHA-256, and mirrors assessment/attempt counts in headers.

## Replay And Evaluation Flow

Portable Run Replay remains evidence export, not tool re-execution. Controlled
Workflow, Agent-message, model-invocation, and tool-invocation experiments are
separate live Runtime paths. Model- and tool-invocation targets can be exported
and verified, but their raw local Context/argument capsules are never portable:

```text
select terminal run
  -> collect only events whose runId matches
  -> collect Subagent task evidence owned by the Run
  -> preserve the Run's pre-execution configuration fingerprint
  -> aggregate primary, compactor, evaluator, memory, and Subagent usage
     without double-counting message projections
  -> derive duration, message/model/tool/task counts, and output-text hash
  -> hash the ordered event stream with SHA-256
  -> hash stable snapshot content independently of generatedAt
  -> return a schema-versioned self-contained replay snapshot
  -> direct API attachments and Run Lab downloads save the JSON as
     napier-<runId>-replay-<content-hash>.json
  -> mirror no-store response content hash, stable snapshot hash,
     event-stream hash, run/thread IDs, event count, first/last event sequence,
     usage/cost, duration, model/tool/message/subagent counts, and output-text
     hash headers
verify replay snapshot (maximum 10 MiB, no mutation)
  -> strictly parse the verify wrapper: only snapshot is accepted
  -> recompute event-stream hash, metrics, assistant-output hash, and content hash
  -> recompute Independent Advisor evidenceSummary from same-Run predecessor events
  -> bind the verified snapshot to the URL thread/run identity
  -> return valid/invalid plus hash-only diagnostics and counts
Workbench replay verification
  -> parse the selected snapshot JSON locally in Run Lab
  -> submit only { snapshot } through the hash-verified management client
  -> bind the uploaded Run ID to the active Thread route
  -> render status, diagnostics, snapshot hash, event count, and Subagent count
  -> leave current Thread state unchanged
```

Comparison requires two distinct runs from one Thread. All metric deltas are
`right - left`; event-type counts and tool-set changes are reported separately.
The source events remain intact so a consumer can inspect the evidence behind
every aggregate. The comparison response is no-store and mirrors a content
SHA-256, left/right Run IDs, left/right event-stream hashes, event counts,
left/right metric headers, right-minus-left metric delta headers,
event-type delta hash, added/removed tool-set hashes, configuration delta
status, changed-field and capability set counts/hashes, output-changed status,
and available configuration hashes in headers.

Each new Run receives a schema-versioned configuration fingerprint before its
first event. The canonical content binds Agent revision, actual selected model,
thinking level, tool policy, sorted tool/skill/subagent sets, effective
delegation and Run limits, automatic-recovery policy, execution mode, and
`systemPromptSha256`. The prompt itself is not duplicated. `contentSha256`
covers every fingerprint field, while the duplicate Run-level revision and
limits must agree with it. Schema 1 keeps its original exact key set and hash;
schema 2 adds recovery policy and execution mode, schema 3 binds the Skill
catalog, schemas 4-5 bind deterministic Advisor policy and correction limits,
schema 6 binds an independent reviewer identity, schema 7 binds frozen Prompt
Variable catalog, snapshot, and rendered Prompt hashes, and schema 8 binds the
Tool Loop Guard policy. A schema-1 Run compares normally but is never
automatically recovered.

Run comparison reports changed configuration fields plus added/removed tools,
skills, and subagent roles. If either side predates fingerprints, drift is
`unavailable`; Napier never projects the current Agent backward onto legacy
history. Evaluators receive the configuration hash beside the event hash and
metrics, so a verdict can distinguish behavior drift from input drift.

OpenTelemetry export projects that same evidence into a vendor-neutral trace
without introducing an SDK dependency or a second runtime truth:

```text
select complete Thread or one Run
  -> exclude model.text.delta and prior trace.otlp.exported audit events
  -> enforce 10,000 source-event / 5,000 span / 10 MiB artifact bounds
  -> derive one deterministic 128-bit trace ID from the Thread
  -> create one Thread root span and child Run spans
  -> map model.response to CLIENT `chat {model}` spans
  -> pair tool.started with completed/failed/blocked by callId
  -> preserve unmatched starts as explicit unknown-outcome tool spans
  -> map durable Subagent tasks to `invoke_agent {role}` spans
  -> attach remaining Ledger records as metadata-only span events
  -> project Advisor verification freshness as boolean/count/seq attributes
  -> hash the safe payload projection on span events and model ledger spans
  -> encode timestamps as decimal nanoseconds and scalar AnyValue attributes
  -> validate IDs, parent graph, temporal containment, schema, and counts
  -> bind source range/hash + redaction policy + OTLP request to content SHA-256
  -> append trace.otlp.exported with only scope, IDs, counts, and hashes
  -> save direct API attachments and Trace Workbench downloads as
     napier-otel-<safe-scope-id>-<content-hash>.json
  -> return no-store artifact headers with trace/thread/run IDs, source seq
     range, event/ span counts, redaction mode/counts, and content hash
verify exported artifact (maximum 10 MiB, no mutation)
  -> strictly parse the verify wrapper: only artifact is accepted
  -> replay the same envelope, graph, redaction, count, and content-hash checks
  -> bind the verified artifact to the URL thread identity
  -> return valid/invalid plus hash-only diagnostics, trace hash, source hash,
     and span/event counts
```

The Napier artifact's `otlp` member is an OTLP/JSON
`ExportTraceServiceRequest` under `resourceSpans -> scopeSpans -> spans`, uses
semantic-convention schema `1.43.0`, and can be posted to a Collector
`/v1/traces` endpoint. Trace and span IDs are hex encoded at 128 and 64 bits.
`generatedAt` is excluded from the Napier artifact hash; prior export-audit
events are excluded from source selection, so an unchanged repeated export
remains deterministic.
Advisor review evidence summaries are exported only as metadata attributes:
verification completed/passed/current booleans, workspace-write booleans, and
latest write/verification sequence numbers. Candidate text, review prompts,
diagnostic prose, and reviewer guidance remain excluded by the redaction
policy. Those public summary attributes are included in
`napier.event.payload_projection_sha256`, which is itself covered by the root
event-anchor set, so partial Trace artifact edits cannot make stale
verification metadata look current without changing the anchored receipt.

The Workbench Trace card exposes the verification path as a file upload. The
browser parses the selected JSON locally, submits only `{ artifact }` through
the hash-verified management client, and renders the no-store receipt status,
diagnostics, counts, and artifact hash. Verification never refreshes or mutates
Thread state.

Content capture is always off. Prompt/completion/reasoning text, tool
arguments/results, Subagent prompts/descriptions/results, notes, evidence,
errors, summaries, credential labels, arbitrary user IDs, and key locators are
not exported. The safe allowlist retains generated resource IDs, models, tool
names, status enums, usage/cache counts, cost, durations, sequence numbers,
and SHA-256/fingerprint evidence. The explicit redaction manifest is itself
hash-bound.

```text
select baseline + candidate
  -> construct both replay snapshots
  -> freeze a 2-6 criterion rubric
  -> send bounded visible evidence to an independent model with no tools
  -> parse one strict JSON verdict and complete criterion scores
  -> persist rubric + both event-stream hashes + verdict
  -> append evaluation.completed to the Thread ledger
```

Ledger payloads are untrusted evaluator data, never instructions. Control
characters and evidence delimiters are neutralized, model responses and hidden
events are excluded, and malformed/model failures produce an `inconclusive`
record. The deterministic demo model also returns `inconclusive`; it cannot
claim independent judgment. Stored evaluations remain attributable even if the
Thread later receives more events because both evaluated stream hashes are
immutable. Evaluation list responses are no-store and mirror a response
SHA-256, Thread ID, and evaluation count headers.

Human adjudication adds truth labels without rewriting the model record:

```text
review evaluation
  -> resolve one immutable RunEvaluationRecord in the target Thread
  -> hash the complete evaluation evidence
  -> normalize expected verdict + optional bounded note
  -> return unchanged state for a semantic no-op
  -> otherwise append a sequential adjudication revision
  -> bind adjudication ID + Thread + evaluation ID + revision content to SHA-256
  -> persist before appending a hash-only evaluation.adjudication.reviewed event
  -> mirror no-store adjudication hash, IDs, current revision, latest verdict,
     evaluation hash, and revision hash headers on write responses
build calibration report
  -> select only the latest valid human revision per evaluation
  -> group by evaluator provider/model + canonical rubric SHA-256
  -> compute exact agreement and a complete 4x4 verdict confusion matrix
  -> hash canonical samples, groups, and aggregates independently of generatedAt
  -> mirror no-store content hash, sample count, agreement count/rate, and
     group count headers
```

One adjudication may exist per evaluation. Startup rejects duplicate IDs,
duplicate truth records for one evaluation, non-sequential revisions,
cross-Thread references, stale evaluation hashes, invalid timestamps, and
revision hash drift. Review notes remain in the hash-bound workspace
projection; Ledger events contain IDs, model/expected verdicts, agreement, and
both hashes only. Evaluations referenced by an adjudication are exempt from
ordinary per-Thread retention. Adjudication list responses are no-store and
mirror response SHA-256, adjudication count, and total revision count headers.

Independent review adds a panel without changing the single-current-truth
contract:

```text
submit reviewer ballot
  -> normalize a stable reviewer lane ID + display-name snapshot
  -> bind expected verdict, bounded note, evaluation SHA-256, and timestamp
  -> return unchanged state for a semantic no-op
  -> otherwise append a sequential lane revision and revision SHA-256
  -> mirror no-store ballot hash, lane ID, reviewer ID, revision, verdict,
     evaluation hash, and revision hash headers on write responses
  -> expose no-store ballot-list hashes, ballot counts, and revision counts
preview consensus
  -> select each lane's current revision in canonical reviewer-ID order
  -> count all four verdicts and require one unique leader
  -> apply 2-9 reviewer quorum + 50%-100% agreement threshold
  -> optionally reject an inconclusive leader
  -> hash gate + ordered vote references + aggregates independently of time
  -> mirror no-store report hash, consensus status, reviewer count, consensus
     count, agreement rate, and optional consensus verdict headers
resolve consensus
  -> recompute the report inside the Store transaction
  -> reject insufficient, tied, below-threshold, or blocked-inconclusive state
  -> append Human Truth with reviewer_consensus + report SHA-256 provenance
  -> bind report + exact adjudication revision into a resolution SHA-256
  -> persist both records before a hash-only evaluation.consensus.resolved event
  -> mirror no-store result hash, created flag, report hash, resolution hash,
     reviewer/agreement counts, and adjudication revision headers
  -> expose no-store consensus-resolution list hashes and resolution counts
```

Ballot notes and reviewer display names remain in the workspace projection and
portable fixture; Ledger events contain lane ID, verdict, revision, and hashes
only. A repeated report hash is a resolution no-op. Later ballot revisions do
not reinterpret an earlier resolution because its report references exact
historical ballot revision hashes. Manual truth may still append a later
revision, preserving both decisions.

Reviewed samples can be promoted into a cross-Thread Casebook:

```text
create Casebook
  -> normalize workspace-global name + description
  -> persist revision 1 with an empty case-ID manifest
  -> mirror no-store Casebook hash, ID, revision count, and case count headers
curate reviewed evaluation
  -> require a valid current adjudication in the source Thread
  -> freeze complete evaluation + selected adjudication revision
  -> bind source IDs, rubric hash, evaluation hash, and case content hash
  -> append the immutable case once to the Casebook registry
  -> append a revision whose sorted manifest references the new case ID
curate unchanged truth
  -> return the current Casebook without revision or Ledger event
refresh after truth changes
  -> append a new immutable case snapshot
  -> replace only that source evaluation's ID in a new revision manifest
remove current case
  -> append a revision without its ID; retain registry evidence and history
  -> mirror current Casebook projection headers on create/update/curate/remove
export
  -> calibrate current manifest with the shared sample/cohort protocol
  -> bind full registry + revision ledger + report to a stable artifact hash
```

The registry and every manifest are bounded. Validation rejects duplicate or
unreferenced case IDs, two current cases for the same source evaluation,
non-canonical ordering, invalid source transitions, future case timestamps,
and drift in the evaluation, adjudication, rubric, case, revision,
calibration, or artifact hashes. Casebook events contain only IDs, revision
source/count, name, and hash; free-text review notes and complete evaluations
remain in the projection and exported artifact.

A consensus-derived case additionally freezes the exact reviewer ballot
histories used by the report and the matching resolution. Validation replays
ballot, report, adjudication, resolution, and case hashes; a bare consensus
source hash without this evidence is rejected.

Casebook qualification executes the frozen gold set without creating ordinary
pair evaluations:

```text
qualify current Casebook revision
  -> normalize evaluator model + exact-agreement gate
  -> resolve current manifest in canonical case order
for each case
  -> rebuild left/right replay snapshots from the source Thread
  -> compare observed event-stream hashes with both curated hashes
  -> mark missing or drifted evidence inconclusive without invoking a model
  -> pass any curated hash-only governance binding back to the evaluator
  -> otherwise call the shared no-tool snapshot judge
  -> bind expected/actual verdict, scores, evidence state, and all hashes
aggregate
  -> count agreement, inconclusive judgments, and unverified source evidence
  -> force inconclusive for an empty or unverified batch
  -> apply the configured inconclusive policy and minimum agreement rate
  -> hash revision + model + gate + ordered results + aggregate status
  -> reject save if the Casebook changed while evaluation was in flight
  -> mirror no-store execution hash, status, audit Thread, sample/agreement/
     inconclusive/unverified counts, and agreement-rate headers
  -> persist before appending a hash-only qualification.completed event on the
     completed qualification Run
```

Execution validation recomputes aggregates and the canonical hash, enforces
rubric-complete 1–5 scores for conclusive verified judgments, and prevents an
unverified source from carrying a substantive verdict. The demo model remains
verified evidence but returns an inconclusive judgment. A qualification
receipt includes the complete Casebook plus only the latest execution for its
current revision; after any Casebook revision it emits `not_run` rather than
borrowing history. The receipt is integrity evidence, not a signature.
Thread replay bundle validation also reprojects any saved pair-evaluation
`comparisonGovernance` from the referenced left/right Run evidence before
accepting exported or imported fixtures. The validator recomputes context
coverage from model response/context-envelope events, recomputes trace
summary-boundary coverage from event types, rebuilds the governance receipt, and
rejects the bundle when the stored receipt differs even if its `contentSha256`
was recalculated. LocalStore uses the same source-binding validator when saving
an evaluation and when restoring SQLite `workspace_state`: restore reads the
referenced Thread events from `ledger_events`, reprojects the left/right Run
governance, and rejects forged persisted receipts before any evaluator record
can influence Casebook, suite, consensus, or Run Lab projections. Governed
evaluations also bind `leftSnapshotSha256` and `rightSnapshotSha256` to the
referenced local Run event streams, so changing either snapshot hash fails even
when the surrounding receipt remains internally well-formed. Imported
historical evaluations are the deliberate exception: their snapshot hashes
continue to describe the validated source replay bundle and are protected by
`ThreadImportProvenance`, because import remaps local IDs and would otherwise
change the event-stream hash. The same validator also checks
`evaluation.completed` ledger events as projections of saved
`RunEvaluationRecord` state: if the event payload's Run IDs, verdict, rubric
name, snapshot hashes, or governance hashes drift from the record, SQLite
restore and Thread replay bundle validation fail closed before Trace or Run Lab
can display the stale projection.
OTLP trace export keeps those evaluation governance signals metadata-only:
status and SHA-256 attributes are allowed, while evaluator `reason` and
`evidence` text remain excluded by the redaction policy. The underlying
evaluator model call is still replayable through its evaluation or
qualification Run envelope and redacted response binding.

Casebook read projections are machine-checkable without parsing the full
artifact:

```text
list/detail Casebooks
  -> hash the returned JSON exactly as served
  -> mirror casebook count, current revision, revision count, and case count
qualification history
  -> hash the returned execution array exactly as served
  -> mirror execution, sample, agreement, inconclusive, and unverified counts
export/receipt
  -> mirror artifact or receipt content SHA-256
  -> expose casebook ID, current revision, case count, qualification state, and
     optional execution ID/status/hash
baseline list
  -> hash the returned baseline array exactly as served
  -> mirror baseline count and latest baseline/execution hashes when present
```

Trusted receipt provenance adds origin evidence without weakening those
integrity validators:

```text
register trust anchor
  -> read a named PKCS#8 private-key environment variable once, or accept SPKI
     public bytes for a verify-only anchor
  -> require Ed25519 and derive canonical SPKI + SHA-256 key ID
  -> persist public evidence and optional locator, never private-key bytes
sign receipt
  -> recreate and deeply validate the current gate or qualification receipt
  -> hash the complete receipt artifact, including generatedAt
  -> build a domain-separated statement over receipt kind, stable content
     SHA-256, complete artifact SHA-256, key ID, and signing time
  -> re-read the private key, derive its public key, and require anchor match
  -> Ed25519-sign the canonical statement
  -> hash the complete trusted envelope independently
verify envelope
  -> replay nested receipt validation before any trust decision
  -> verify stable content, complete artifact, statement, envelope, and
     Ed25519 signature hashes
  -> classify as trusted, revoked, unknown_key, or invalid
promote qualification baseline
  -> require current Casebook revision + current passing execution
  -> require a trusted signing-capable anchor and valid envelope
  -> deduplicate the same revision/receipt/key as a semantic no-op
  -> append a baseline that freezes the envelope and supersedes the prior pin
  -> return a no-store result with created flag, baseline/execution hashes,
     receipt artifact hash, envelope hash, and signer key ID headers
```

Anchor creation, revocation, signing, and baseline events contain only IDs,
key fingerprints, states, and hashes. Environment-variable locators, public
key bytes, private keys, and full signatures are omitted from Ledger payloads.
Revoking a key does not corrupt historical evidence: its signatures remain
cryptographically valid but verification returns `revoked`. A Casebook change
makes its prior baseline stale, and a new revision cannot borrow the old
passing execution.

Receipt Trust read projections are no-store and response-hash-bound:

```text
list anchors
  -> hash the returned anchor array exactly as served
  -> mirror total, trusted, revoked, and signing-capable counts
create/revoke anchor
  -> mirror anchor content SHA-256, anchor ID, key ID, status, and signing flag
verify envelope
  -> hash the verification projection exactly as served
  -> mirror verification status, signature/integrity booleans, receipt kind,
     receipt hash, complete artifact hash, key ID, and envelope hash
```

Evaluation suites build a durable release gate from those same pairwise
records:

```text
create suite
  -> bind one terminal baseline + 1-8 distinct terminal candidates
  -> snapshot a 2-6 criterion rubric, evaluator model, and gate
  -> persist revision 1
edit semantic input
  -> increment revision without rewriting prior executions
execute suite
  -> evaluate every candidate through the no-tool pairwise service
  -> include metadata-only contextCoverageDelta governance in evaluator input
  -> bind that governance projection into the saved pair evaluation hash
  -> hash each complete pair evaluation into its case result
  -> require right_better or tie plus the minimum candidate mean to pass
  -> aggregate pass rate over conclusive cases
  -> apply the configured inconclusive policy and minimum pass rate
  -> hash suite revision + input snapshots + all case and aggregate evidence
  -> persist the execution before appending evaluation.suite.completed
```

The default gate requires a `100%` pass rate, a candidate mean of at least
`3`, and no inconclusive cases. If every case is inconclusive, the batch remains
`inconclusive` even when partial inconclusive cases are allowed. An execution
retains its suite name, revision, candidate register, rubric, model, and gate,
so a later suite edit cannot reinterpret it. The Workbench displays a verdict
only for the current revision; a newly revised suite is `Not run` until that
revision receives an execution.

Case records bind the referenced pair evaluation with `evaluationSha256` and
both replay snapshot hashes. The aggregate `contentSha256` covers every input,
case result, count, score, pass rate, and status in canonical order. Pair
evaluations referenced by retained suite executions are exempt from ordinary
per-Thread evaluation retention.

Evaluation Suite read projections expose no-store response hashes for scripts:

```text
create/update suite
  -> hash the returned suite exactly as served
  -> mirror thread ID, suite ID, revision, baseline run ID, and candidate count
execute suite
  -> return execution content SHA-256 as the response digest
  -> mirror thread ID, suite/execution IDs, suite revision, status, case counts,
     passed/failed/inconclusive aggregates, and pass rate
list suites
  -> hash the returned suite array exactly as served
  -> mirror thread ID, suite count, summed revision count, and candidate count
list executions
  -> optionally scope to one suite ID
  -> hash the returned execution array exactly as served
  -> mirror thread ID, optional suite ID, execution/case counts, and
     passed/failed/inconclusive aggregates
```

Gate receipts make that evidence consumable outside the Workbench:

```text
export current suite gate
  -> select only an execution whose suiteRevision equals the current revision
  -> emit not_run when no such execution exists
  -> collect referenced pair evaluations in exact case order
  -> revalidate pair hashes, case semantics, aggregate counts, and batch hash
  -> hash kind + schema + API version + suite + state + evaluations + execution
  -> exclude only generatedAt from the stable receipt content SHA-256
  -> return a no-store JSON attachment with digest, suite revision, gate state,
     evaluation count, and optional execution ID/status/hash headers
```

The `napier.evaluation-gate-receipt` schema is self-contained: a consumer can
verify every pair hash and the execution aggregate without reading the SQLite
store. It is an integrity receipt, not a cryptographic signature or proof of
origin. CI must pin or obtain the expected SHA-256 through a trusted channel
when authenticity matters. A new suite revision cannot borrow an old passing
execution; it exports `not_run` until evaluated.

Full-thread fixtures preserve the wider evidence graph without reviving work:

```text
export Thread
  -> collect Thread + Agent + Agent Revisions + Runs + Plans + Evaluations
     + Evaluation Adjudications + Reviewer Ballots + Consensus Resolutions
     + Evaluation Suites + Suite Executions + Recovery Assessments/Attempts
     + Subagents + Events
  -> require contiguous sequence numbers and same-Thread ownership
  -> validate every present Run fingerprint, suite execution, and
     duplicate-field consistency
  -> hash the ordered event stream
  -> hash canonical bundle content independently of generatedAt
  -> return napier.thread-replay schema version 1
  -> save direct API attachments and Run Lab downloads as
     napier-thread-<safe-thread-id>-<content-hash>.json
  -> mirror no-store bundle content hash, event-stream hash, thread ID,
     verification status, run/event/plan/evaluation counts,
     ledger-backed/embedded Model Context Envelope counts, and first/last
     event sequence headers
verify fixture (maximum 10 MiB, no mutation)
  -> strictly parse the verify wrapper: only bundle is accepted
  -> run the same schema, reference, event-stream, and content-hash validation
  -> recompute Independent Advisor evidenceSummary from predecessor events
  -> return valid/invalid plus hash-only diagnostics and resource counts
  -> mirror no-store response content hash, verification status,
     diagnostics hash, bundle hash, event-stream hash, and counts
Workbench fixture verification
  -> parse the selected JSON locally in Run Lab
  -> submit only { bundle } through the hash-verified management client
  -> render status, diagnostics, bundle hash, and resource counts
  -> leave current Thread state unchanged
import fixture (maximum 10 MiB)
  -> strictly parse the import wrapper: only bundle and normalized title
     are accepted
  -> reject unknown top-level fields, unsupported API/schema, or either mismatch
  -> allocate fresh IDs for every owned resource, suite/execution/evaluation/
     adjudication/ballot/resolution reference, and auxiliary event Run ID
  -> recursively rewrite exact ID values in event payloads
  -> remap Agent IDs in revision snapshots and recompute every snapshot hash
  -> bind every adjudication revision to the remapped evaluation and recompute
     its evaluation/revision SHA-256
  -> remap ballot histories first, rebuild report vote hashes, then remap
     consensus provenance and resolution SHA-256
  -> recompute remapped pair-evaluation and suite-execution SHA-256 digests
  -> remap recovery root/source/child IDs and deterministic trigger links
  -> recompute Run-local event hashes, assessment hashes, and attempt hashes
  -> remap Operator Decision continuation Run IDs and derive the new projection
     hash while preserving question/answer hashes
  -> replay Agent Milestone predecessor chains and rehash remapped evidence
     event ranges while preserving summary/item hashes
  -> strip ordinary trigger IDs and all lease ownership
  -> close claimed/running recovery attempts as imported terminal evidence
  -> convert queued/running Runs to interrupted
  -> convert running plan steps to blocked and active subagents to cancelled
  -> append a local thread.imported receipt with source hashes and cutoff
  -> commit the complete projection and event batch atomically
  -> persist source hashes, source event count, and import time on the Thread
```

Imported history is an external evidence artifact, not a trusted instruction
source. Live model context marks derived imported lineage as untrusted
historical data and adds a system-level boundary containing source hashes and
coverage counts. Claims of tool effects and embedded requests require current
verification. Branches created from imported Threads inherit the same source
fixture provenance plus a local imported-history cutoff sequence, so
branch-copied historical messages remain behind that boundary without
over-redacting later local operator input. Run Lab and metadata-only OTLP root
span attributes expose the same source event count and local cutoff for audit.
When a matching `thread.imported` receipt exists, OTLP also exports its local
sequence and payload SHA-256 so trace consumers can tell the imported lineage
projection is ledger-backed without replaying or exposing the bundle.
OTLP artifact verification binds the top-level artifact header back to the
root span before checking import-specific evidence: Thread ID, export scope,
Run ID when present, event count, and event-stream SHA-256 must all match the
root attributes. Recomputing the artifact hash after changing either side still
fails closed as root/header projection drift.
The verifier also reconstructs a metadata-only event-sequence projection from
`napier.event.seq` span-event attributes plus specialized span
`napier.ledger.seq` attributes. The projected sequence count, minimum, maximum,
and uniqueness must match the artifact `eventRange`, so a trace cannot drift
its declared event window away from the span evidence it carries.
Specialized model spans also carry `napier.ledger.payload_sha256` and
`napier.ledger.payload_projection_sha256`; their `napier.ledger.event_id` must
deterministically produce the span ID and their operation/timing attributes
must remain completion-only chat evidence. This keeps model-response events
equivalent to ordinary span events for hash-only payload receipts without
storing prompt, completion, reasoning, or tool-call content.
The root span carries `napier.event_anchor_set.sha256`, computed over the
projected event ID, sequence, type, category, visibility, payload hash, and
safe payload-projection hash for ordinary span events and specialized ledger
spans. Verification recomputes that set from the OTLP body, so changing a
span-level event anchor while recomputing the artifact hash fails without
needing raw Ledger payloads.
Trace export and verification mirror that anchor-set hash through no-store
headers, valid verification bodies, and the `trace.otlp.exported` ledger
receipt, giving clients a stable event-anchor proof without parsing the OTLP
span tree.
The Workbench Trace list renders those `trace.otlp.exported` ledger receipts
through a bounded view helper that exposes only scope, span count, and the
event-anchor short hash; raw prompt, completion, reasoning, and arbitrary
payload text are ignored. Malformed trace export receipts fail closed to a fixed
summary instead of using the generic payload text fallback.
It applies the same bounded projection pattern to `thread.imported` receipts:
the Trace list shows source content hash, source event-stream hash, imported
source event count, local cutoff, and envelope coverage counts, while ignoring
source IDs, API version strings, arbitrary text fields, and raw replay content.
Conversation and system-note events are bounded in the Trace list even though
their full text remains available in the conversation-oriented Workbench
surface. `message.*` and `system.note` summaries may show role, model, usage
counts, text byte counts, control-message IDs, and existing text hashes. They
do not render user prompts, assistant answers, reasoning text, run-control
message text, system-note text, or arbitrary future message payload prose.
Unknown `message.*` and `system.*` events fail closed to their category before
the generic fallback can inspect `text` or `message`.
Agent governance events are bounded before the fallback as well. `agent.*`
summaries may show safe Agent/milestone IDs, milestone phase, revision counters,
completed/open-loop counts, predecessor sequence, and SHA-256 receipts. They do
not render milestone titles, summaries, completed item text, open-loop text,
Agent names, descriptions, System Prompts, or arbitrary future Agent payload
prose. The dedicated Agent Milestone card remains responsible for rendering the
reviewed milestone projection; the event-list summary stays metadata-only.
Automation ingress events are bounded too. `schedule.*` summaries may show safe
schedule/trigger/run IDs, lifecycle status, trigger type, occurrence times,
revision, changed-field counts, and safe skip reasons. They do not render
schedule names, scheduled prompts, worker IDs, execution errors, or arbitrary
future schedule payload prose. `channel.*` summaries may show safe
channel/delivery/run IDs, adapter/status/policy enums, retry and attempt
counts, public token/idempotency fingerprints, revision numbers, dead-letter
qualification counts, and SHA-256 receipts such as body, adapter-catalog,
export, preview, artifact, and retry-set hashes. They do not render channel
names, raw tokens, queued message text, inbound body text, delivery errors,
diagnostics, or arbitrary future channel payload prose. Unknown automation
ingress events fail closed to their category before the generic fallback can
inspect `name`, `message`, `error`, `reason`, or `text`.
Credential and Extension governance events use the same projection rule.
`credential.*` summaries may show safe credential-reference IDs, provider IDs,
source type, status, availability, and revision, but not credential labels,
keychain/source names, last-error text, or arbitrary future credential payload
prose. `extension.*` summaries may show safe extension/agent/channel/anchor
IDs, kind/status/trust/review/effect/version enums, public key IDs, booleans,
capability/change counts, rollout/package/dependency counts, and SHA-256
receipts for anchors, manifests, envelopes, package bindings, deployments,
lockfiles, indexes, policies, schemas, and dependency sets. They do not render
extension names, descriptions, capability labels, MCP tool names, direct tool
names, rollout channel names, package-change labels, transport details,
diagnostics, or arbitrary future extension payload prose. Unknown credential
or extension events fail closed to their category before the generic fallback
can inspect `label`, `name`, `description`, `toolName`, `error`, or `summary`.
Package, receipt, and branch governance events extend that boundary.
`skill.*`, `prompt.*`, and `inspector.*` summaries may show installation,
agent, and replacement IDs, package status, verification status, key IDs,
skill/panel counts, file byte/line counts, booleans, and SHA-256 receipts for
manifests, envelopes, catalogs, system prompts, reviews, frontmatter, body, and
current content. They do not render Skill names, relative paths, package
publisher names, prompt package prose, inspector descriptions, or arbitrary
future package payload prose. `receipt.*` and legacy `receipt_trust.*`
summaries may show receipt kind, safe anchor/subscription/decision IDs, status,
refresh status, key IDs, algorithms, counts, booleans, and hash-only receipt,
source, policy, discovery, selection, approval, and failure evidence. They do
not render publishers, source URLs, failure prose, diagnostics, or arbitrary
future receipt payload prose. `branch.*` summaries stay limited to source
Thread ID and sequence lineage; branch names, objectives, descriptions, and
future branch prose do not drive the event-list summary.
The Trace Workbench also computes a local summary-boundary coverage projection
for the rendered event set. Each event summary is classified as a dedicated
bounded projection, a fixed fail-closed receipt summary, a category-only
fallback, or the legacy generic payload fallback. The Workbench displays those
counts plus the distinct event types still using generic fallback, making
privacy regressions visible in the product surface during review.
Run Lab reuses the same projection when comparing two Runs. The comparison
sheet shows baseline and candidate generic fallback counts, bounded-summary
deltas, and diagnostics when the candidate introduces or retains generic
event-list summaries, so privacy posture can be reviewed alongside context
coverage, configuration drift, and output changes.
The generic-fallback boundary itself is also defined in the shared contracts
package as a `dedicated`/`generic` classifier. Runtime Run comparisons compute
`traceSummaryBoundaryDelta` from the same classifier, expose the result through
no-store HTTP headers, and bind its status, generic delta, diagnostic hash, and
full delta hash into `RunEvaluationGovernanceBinding`. Evaluators therefore see
summary-boundary governance beside context coverage, and the binding remains
hash-only: it contains counts, event types, status, diagnostics, and SHA-256
receipts, but not raw Ledger payload prose.
The same governance evidence is projected into metadata-only OTLP event
attributes and the Run Lab evaluation hash strip, so operators can audit the
evaluator's summary-boundary posture from traces or the product UI without
opening raw event payloads.
Both the single-Run coverage projection and the Run Lab delta projection are
canonicalized and hashed into Web-side `contentSha256` receipts. Those receipts
cover only summary source counts, generic event-type sets, deltas, diagnostics,
and status metadata, providing copyable proof of the UI privacy posture without
including raw Ledger payload fields.
The same Web ViewModel exposes fail-closed verifiers for those receipts. A
coverage receipt is invalid when counts do not add up, generic event-type sets
are malformed, or the recomputed canonical hash differs from `contentSha256`.
A delta receipt also checks status, diagnostics, and every delta against the
left/right coverage payloads before accepting its hash.
Trace Workbench and Run Lab call those verifiers as part of their receipt
projection, so the visible evidence includes a valid/invalid status and
bounded diagnostic codes beside the short hash rather than treating generated
receipt hashes as self-validating UI facts.
`model.response` summaries are also rendered through a metadata/hash-only view:
the list may show model, stop reason, model-call purpose, envelope turn index,
tool-call count, token counts, and response/error hashes, but not assistant
text, reasoning, or tool-call arguments. Malformed model response receipts fail
closed to a fixed summary before the generic payload text fallback runs.
Other known model events are bounded before the fallback as well.
`model.text.delta` and `model.thinking.delta` summaries show only redaction
state, byte counts, and SHA-256 receipts when present; raw streaming text and
reasoning deltas are ignored even if they exist in hidden debug payloads.
`model.tool_loop.detected` summaries show only safe tool name, threshold,
attempt count, event range, and hash receipts. Unknown `model.*` events fail
closed to their category instead of using `text`, `summary`, or `result`.
Tool lifecycle events use the same rule: `tool.started`, `tool.completed`,
`tool.failed`, and `tool.blocked` summaries show only the bounded tool name,
status, effect, and known hash receipts such as input or loop-guard hashes.
Raw tool input, output, details, policy prose, and arbitrary payload text never
drive the event-list summary.
Goal and memory governance events are similarly bounded. `goal.*` summaries
show only action, status, blocker, satisfaction, continuation counts, and
no-progress counters; objectives, evaluator reasons, and evidence text are not
rendered. `memory.*` summaries show only action, safe memory IDs, status,
category, scope, confidence, review/count metadata, and safe reason enums;
memory content and extraction error messages are ignored.
Operator decision and live Run-control events follow the same pattern.
`operator.decision.*` summaries show action, safe decision IDs, option/selection
counts, safe reasons, continuation Run IDs, and SHA-256 receipts; questions,
option labels/descriptions, and custom answer text are ignored.
`run.control.*` summaries show safe control IDs, mode, byte counts, sequence
numbers, reasons, and SHA-256 receipts; live control text is never used as the
event-list summary.
Other `run.*` lifecycle and recovery events are bounded separately. Run
summaries may show status, source, mode, model label, safe run/agent/attempt
IDs, agent revision, budget limits and observations, automatic recovery counts,
timestamps, and SHA-256 receipts. They do not render failure messages, recovery
prompt text, interruption reasons, automatic recovery errors, or arbitrary
future run payload prose. Unknown non-control `run.*` events fail closed to
their category before `message`, `error`, `reason`, or `text` can drive the
summary.
Subagent lifecycle and outcome events also use bounded summaries. `subagent.*`
events can show safe task IDs, role/status/kind, counts, stop reason, and
hash-only receipts for text, repair requests, diagnostics, outcomes, item sets,
and evidence sets. Delegated prompts, step text, tool arguments, final results,
diagnostics, and error strings do not drive Trace list summaries.
Model Advisor governance events use an equivalent bounded projection.
`model.advisor.*` summaries may show action, status/source, turn source,
verdict, risk, score, diagnostic/issue/blocker counts, correction attempt
counts, checks/Plan/artifact/goal current/stale metadata, latest
workspace-write and evidence sequence numbers, and SHA-256 receipts for
candidate text, diagnostic sets, issue sets, evidence, request/response hashes,
embedded envelope hashes, and receipt content. Deterministic diagnostic prose,
independent reviewer guidance, correction prompts, correction responses, and
arbitrary advisor payload text never drive the event-list summary.
Known `context.*` receipts are also routed through a bounded summary before the
generic fallback runs. Context summaries may show schema/version metadata,
message/tool/Skill counts, prompt-variable counts, compaction sequence ranges,
checkpoint IDs, delegation/milestone counters, booleans such as redaction or
Skill-catalog injection, and SHA-256 receipts. They do not render context
compaction summaries, compaction failure messages, prompt-variable names or
values, Skill catalog names, embedded Skill bodies, memory text, or arbitrary
context payload prose. Unknown `context.*` events fail closed to their category
instead of using `summary`, `message`, or `text` fields.
Evaluation governance events have the same event-list boundary. `evaluation.*`
summaries may show verdicts, statuses, consensus/adjudication metadata, bounded
counts and rates, safe object IDs, model labels, and SHA-256 receipts. They do
not render evaluator reasons, evidence text, rubric names, criterion score
reasons, reviewer names or notes, casebook names/descriptions, suite names, or
arbitrary future evaluation payload prose. Unknown `evaluation.*` events fail
closed to their category instead of using the generic text fallback.
Artifact export and preview events use a dedicated bounded summary.
`artifact.exported` and `artifact.previewed` summaries may show safe
Plan/artifact IDs, Plan revision, status/kind, byte count, line count,
`pathSha256`, artifact SHA-256, and preview text SHA-256. They do not render
artifact paths, file contents, preview text, evidence prose, or arbitrary
future artifact payload text. Unknown `artifact.*` events fail closed to their
category.
Plan governance events are also bounded in the event list. `plan.*` summaries
may show safe plan/step/artifact/replan IDs, statuses, strategy enums, phase
and ready/blocked counts, revision counters, artifact byte counts, blueprint
qualification state, and SHA-256 receipts. For `plan.artifact.*` receipts the
Trace summary consumes runtime-generated `pathSha256` and `evidenceSha256`
companions instead of rendering the path or evidence fields directly. Plan
summaries do not render plan objectives, step titles, step evidence, blockers,
artifact evidence, artifact paths, replan reasons, or arbitrary future plan
payload prose. Unknown `plan.*` events fail closed to their category before the
generic fallback can inspect `objective`, `reason`, `description`, `evidence`,
`path`, or `summary`.
Every OTLP span event carries a generic `napier.event.payload_sha256` hash-only
projection, and the trace verifier binds the root import receipt attributes
back to the root `thread.imported` span event. Hiding that root receipt,
changing its payload hash, or changing the event payload hash invalidates the
artifact even when the artifact's top-level content hash is recomputed.
The same validator also compares the root provenance projection with the safe
payload projection on `thread.imported`, covering source IDs, source hashes,
source event count, local cutoff, envelope counts, and import time so imported
lineage metadata cannot drift away from its ledger-backed receipt.
ThreadDetail no-store headers expose the same receipt sequence and payload hash
under `X-Napier-Import-Receipt-*`, so API clients get the same proof without
parsing the event stream. Run Lab consumes that header-backed projection and
renders the receipt sequence plus payload hash on imported fixture cards,
without recomputing hashes in the browser or exposing replay content.
Portable replay validation applies the same binding check inside exported
Thread fixtures: if a `thread.imported` receipt is present, it must match
`thread.importProvenance` exactly, and unknown provenance fields are rejected
before the fixture can be imported.
Imported provenance is also an unconditional automatic-recovery blocker; an
imported interrupted Run can only continue through explicit operator action.
SQLite state restore validates imported provenance hashes, counts, timestamps,
and the local cutoff against the persisted Thread event count before any
runtime prompt can consume it. The import action itself is ledger-backed by a
local `thread.imported` lifecycle event appended after the source fixture
events; the event carries only the source Thread/API identifiers, content and
event-stream SHA-256 hashes, event/envelope counts, import time, and the local
cutoff sequence. Restore treats this receipt as optional for older imported
Threads, but if it is present its payload, timestamp, category, visibility, and
sequence must match the persisted Thread provenance exactly.

## Delegation Flow

```text
before every parent model call
  -> derive a bounded projection from all durable Thread SubagentTasks
  -> prioritize active tasks and the newest terminal tasks
  -> bind the full task set and selected projection with separate SHA-256s
  -> inject task labels/status/hash metadata as an ephemeral system block
  -> refresh the block after each tool turn without appending conversation history

parent tool call
  -> validate enabled role and remaining run budget
  -> reject a reusable pending/running/completed role + canonical-prompt intent
  -> persist pending SubagentTask + subagent.queued
  -> wait on the per-run concurrency semaphore
  -> start an isolated Pi Agent with only the delegated prompt
  -> expose read-only workspace tools, never delegate_task
  -> require one strict typed outcome JSON object
  -> normalize workspace-relative evidence and reject unknown fields
  -> if only the output contract is malformed and one turn remains,
     issue one hash-bound tool-free repair request
  -> retain candidate steps as hash + byte count; never persist repair prompts
  -> resolve cited files through the read_file realpath/UTF-8 boundary
  -> hash each observed file and exact cited line range
  -> bind task/role/model/instructions/prompt/result/item-set hashes into a receipt
  -> persist assistant/tool steps, usage, turns, and terminal outcome receipt
  -> return bounded formatted evidence plus receipt metadata to the parent

operator verifies stored outcome
  -> resolve the task inside the path-bound Thread
  -> validate the immutable outcome receipt before trusting its references
  -> return unavailable for schema 1, which has no workspace hashes
  -> reread schema-2 files and ranges through the same bounded no-follow boundary
  -> classify current references as aligned, divergent, or missing
  -> return a no-store stable-hash report without appending Ledger evidence

operator requests independent review
  -> require a reviewer model different from the Subagent worker
  -> send the task + typed outcome to one zero-tool passive reviewer
  -> bind the request to a hash-only model-context envelope
  -> strictly parse accept / revise / reject / inconclusive
  -> bind criteria, input, prompt, response, usage, models, and outcome hashes
  -> return a no-store review artifact; never mutate or stall the delegation
```

Researcher, reviewer, and general roles have separate system prompts. A
subagent does not inherit the parent transcript, reviewed memory, or skills.
Typed outcomes contain a summary, categorized and severity-ranked items,
optional workspace-relative line evidence, and explicit unknowns. Invalid
JSON, unsafe evidence paths, incomplete line ranges, unsupported fields, and
hash drift fail closed. Cited evidence must exist at completion time and fit
the bounded text-file policy; the receipt records file/range hashes, byte and
line counts, plus an aggregate evidence-set SHA-256. Grounding is additive in
schema 2; published schema-1 receipts remain verifiable without those fields.
Malformed JSON, unsupported fields, or invalid output shape may use one
remaining Subagent turn for format repair. A separate Agent receives the
original task and candidate in an ephemeral prompt, has no tools, and cannot
extend the task timeout or turn budget. Request and outcome receipts bind
task/role/model, immutable instructions, predecessor/result hashes,
diagnostics, and an accepted outcome hash. Structurally valid output with
missing, escaping, oversized, non-text, or out-of-range evidence is a grounding
failure and is never repaired. Terminal candidate `subagent.step` events carry
only hash and byte count, so a malformed candidate cannot leak through the
step ledger before rejection. Cross-workspace import rebinds repair task IDs,
request hashes, and accepted outcome hashes in event order.
Legacy tasks without an outcome remain readable; new
coordinator completions always carry a `napier.subagent-outcome` receipt.
Schema-1 role and output instructions are immutable because their exact bytes
are receipt-bound; instruction changes require a new outcome schema version.
Replay verification checks the task binding, while cross-workspace import
remaps the task ID and recomputes the receipt without changing its raw-result
or item-set hashes. Task-scoped evidence verification distinguishes the
historical claim from current workspace state. It returns expected and observed
file/range hashes, aggregate counts, and stable hash-only diagnostics; it does
not return file content, persist the report, or reinterpret schema-1 receipts
as grounded. The Trace delegation card loads this verifier on demand.
The same card can request an independent passive review with the globally
selected model. The fixed review policy scores task alignment, evidence
grounding, uncertainty honesty, and actionability. It rejects the worker model
as reviewer, exposes no tools, bounds provider retries and timeout, and turns
provider or strict-JSON failures into an `inconclusive` hash-bound artifact.
Reviews remain operator evidence rather than execution authority: they are not
persisted, do not alter the task receipt, and cannot block the already settled
delegation.
Parent continuity does not depend on the compactor preserving tool prose.
Before every parent provider request, the runtime independently projects the
Thread's durable tasks into a `napier.delegation-ledger-projection` system
block. It exposes bounded sanitized descriptions, task/run/role/status/model
metadata, turn and step counts, outcome metadata, and prompt/intent hashes, but
never raw task prompts, results, or errors; legacy results and failures are
represented only by result/error hashes. Active work is retained before recent
terminal work; omitted tasks remain covered by the full task-set SHA-256. The
projection is recomputed after tool turns and on new Runs,
recovery, and imported Threads, but is never appended to message history.
`context.prepared` records only counts plus task-set/projection hashes for
Trace; an in-loop change emits the same hash-only evidence as
`context.delegation.updated` without persisting projection content. The
coordinator uses the same role + whitespace-normalized prompt hash to reject
equivalent pending, running, or completed work and restores its per-Run total
from durable tasks. Failed, cancelled, and timed-out intents remain retryable.
Concurrency, total tasks, model turns, and wall time are bounded per parent
run. Profile validation and the coordinator share the same bounds; runtime
does not silently clamp a saved value a second time. Cancellation and budget
exhaustion fail closed, and the first persisted terminal outcome wins over late
callbacks.

## Extension And MCP Flow

```text
propose source
  -> normalize transport + derive mandatory capabilities
  -> persist provenance SHA-256 and pending trust state
  -> approve an explicit subset that includes transport requirements
  -> connect and discover tools (discovery grants no execution rights)
  -> normalize names + hash each input schema
  -> review each tool as external read or external write with optional routing hint
  -> enable the reviewed extension for an Agent
  -> expose a read-only schema search tool at run assembly
  -> load exact external tool schemas only after a schema-search match
  -> re-read trust and tool state immediately before execution
```

Extension management responses are no-store and response-hash-bound:

```text
list extensions
  -> hash the returned Extension array exactly as served
  -> mirror optional Agent filter, total count, trust-status counts, enabled
     Agent count, and tool count
create/review/enable/connect/disconnect/tool review
  -> hash the returned Extension record exactly as served
  -> mirror Extension ID, kind, trust status, connection status, revision,
     requested/approved capability counts, enabled Agent count, tool count,
     reviewed-tool count, and signed package binding hash when present
```

Signed package transfer adds a publisher layer without collapsing the existing
review gates:

```text
register publisher
  -> load an environment-backed PKCS#8 Ed25519 signer or verify-only SPKI
  -> persist only canonical SPKI + key ID + locator/status metadata
sign reviewed Extension
  -> require ready discovery and a reviewed read/write effect for every tool
  -> freeze canonical transport, capabilities, sorted schema/effect catalog,
     reviewed routing hints, dependencies, publisher metadata, creation/expiry,
     and stdio evidence
  -> hash stable manifest content and the complete manifest artifact
  -> sign a domain-separated statement binding both hashes + key + signedAt
  -> hash and download the complete envelope without persisting private bytes
verify/import
  -> enforce the 4 MiB envelope bound and replay every nested validator
  -> require a currently trusted, non-expired publisher signature
  -> reject duplicate package/name before one SQLite mutation
  -> create a pending Extension with zero local approvals or Agent enablement
preview installed update
  -> require a signed-package Extension and verify current + candidate evidence
  -> require the same normalized package name and reject historical replay
  -> classify strict SemVer direction without numeric precision loss
  -> diff publisher/key, metadata, transport, executable, capabilities, tools,
     schemas, effects, reviewed routing hints, lifecycle, and signature
  -> return a no-store preview bound to the current package-binding SHA-256
apply reviewed update
  -> refresh authoritative SQLite state and recompute the complete preview
  -> compare-and-swap the current package binding against the reviewed hash
  -> require independent publisher/key and rollback/opaque-version confirmation
  -> append the old binding to its bounded hash-chain history
  -> preserve Extension ID but clear source, capability, tool, and Agent review
  -> commit the pending/disconnected revision, then close the old transport
preview package deployment
  -> accept 1-8 envelopes under a 16 MiB aggregate boundary
  -> verify every candidate and infer install/update by normalized package name
  -> simulate the complete final workspace without mutating authoritative state
  -> resolve exact/caret/tilde/comparator SemVer ranges and reject opaque values
  -> reject missing targets, incompatible versions, duplicate candidates, or cycles
  -> produce dependency-first order + resolutions + whole-plan SHA-256
  -> expose no-store artifact hash, candidate/install/update counts, dependency
     resolution count, and set-wide confirmation flags
apply package deployment
  -> refresh authoritative state and recompute the complete plan in the Store queue
  -> compare the reviewed plan hash against every current package binding
  -> require set-wide publisher/key and rollback/opaque-version confirmations
  -> create pending installs and review-reset updates in memory
  -> validate the final trusted graph and commit all records in one SQLite CAS
  -> close every updated transport after commit; never expose a partial set
  -> hash the returned apply result and mirror deployment SHA-256 plus applied,
     installed, and updated Extension counts
export package lockfile
  -> select installed signed packages and revalidate trust + dependency closure
  -> serialize complete signed envelopes plus canonical identity/dependency rows
  -> hash stable lockfile content without generatedAt
  -> emit no-store artifact headers, package/dependency counts, envelope/name/
     publisher-key set hashes, and hash-only Ledger evidence
verify/replay lockfile
  -> replay every embedded envelope validator and dependency-closure check
  -> expose no-store verification status, lockfile SHA-256, package count, and
     envelope count
  -> expand envelopes back into package deployment preview/apply
  -> reuse the same whole-plan CAS, risk confirmations, and review reset
publish rollout channel
  -> export the current installed signed package graph as a trusted lockfile
  -> bind a named channel to allowed package names, publisher keys, and limits
  -> persist the complete lockfile plus policy under a channel revision
  -> append hash/count-only rollout publication evidence
  -> expose no-store channel hash, revision, lockfile hash, policy hash, package
     count, dependency count, and package-envelope set hash
preview/apply rollout channel
  -> revalidate channel hash, policy, lockfile signatures, and dependencies
  -> unfold the channel lockfile into deployment preview/apply
  -> bind both rollout-preview SHA-256 and deployment SHA-256 before mutation
  -> reset local review exactly like direct deployment
  -> mirror rollout/deployment hashes and installed/updated/applied counts
sign/verify channel index
  -> select active rollout channels and summarize only channel/policy hashes
  -> optionally bind lockfile retrieval locators to each lockfile SHA-256
  -> sign the canonical index artifact with a local publisher anchor
  -> verify the index offline without exposing lockfile envelopes or approvals
  -> expose no-store index verification status, channel count, key ID, index
     SHA-256, and envelope SHA-256
resolve indexed lockfile
  -> fetch or export the lockfile by the signed lockfile SHA-256 locator
  -> verify lockfile signatures, dependency closure, and publisher trust
  -> replay only through deployment preview/apply CAS and local review reset
connect
  -> recheck signature, revocation, expiry, configuration, dependencies, and binary
  -> require discovered names + normalized names + schema hashes to match
execute
  -> re-read SQLite and recheck publisher/configuration trust immediately
     before policy approval and again before tools/call
```

The manifest's reviewed effect is a publisher assertion, not execution
authorization. Local source review must independently approve transport
capabilities, and local tool review must choose the same effect before the tool
can be enabled. A signed package never imports approval state. Revoking a key
clears bound enablement and connection state; an already instantiated client is
still unusable because the final call path re-reads authoritative state.

Package update preview is advisory evidence, not authority. Apply accepts the
candidate envelope plus the reviewed binding hash and confirmation flags, then
performs every verification and diff again inside the Store queue. A stale
binding or missing confirmation is a conflict. An identical envelope is a
semantic no-op; an envelope already present in package history is rejected
rather than treated as rollback. Successful update events contain only IDs,
version direction, change kinds, counts, and hashes, never manifests, schemas,
signatures, keys, executable bytes, or environment locators.

Deployment preview follows the same rule at workspace scope. Its stable hash
binds sorted candidate identities, each update-preview hash, current binding
hashes, final dependency resolutions, and topological order while excluding
generation time. A concurrent candidate update changes the recomputed plan and
returns a conflict. One invalid candidate prevents every install/update from
being assigned to state. Single-package import and update also simulate and
validate the final graph, which forces mutually dependent major-version
changes through one deployment rather than permitting transient breakage.

Lockfile export is a portable evidence snapshot, not an approval channel. It
contains complete signed envelopes so another workspace can reproduce the same
candidate set without a registry, and its content SHA-256 excludes
`generatedAt` for deterministic comparison. Export requires the currently
installed graph to be trusted and dependency-closed. Verification is offline
and read-only; replaying the lockfile simply unfolds envelopes into the
deployment path, where publisher/key risks, version risks, whole-plan CAS, and
local review reset are enforced again. Ledger events contain only the lockfile
hash, package count, dependency count, and package-envelope set hash.

Rollout channels are named policy pins over those lockfiles. The default
policy is deliberately narrow: it captures the current package names,
publisher key IDs, package count, trusted-publisher requirement, and dependency
closure requirement. Publishing a new revision to the same channel reuses that
policy unless the operator widens it explicitly, and the Store validates the
complete channel record on restart. Preview/apply never trusts the persisted
channel blindly; it replays lockfile verification and policy checks, then
delegates to the same deployment CAS path. Channel events contain channel IDs,
revision numbers, counts, policy hashes, lockfile hashes, and package-envelope
set hashes only.

Signed channel indices are registry summaries over rollout channels, not
deployable package sets. The signed artifact contains the channel name,
revision, channel SHA-256, lockfile SHA-256, package/dependency counts,
package-envelope set hash, and policy hash for each selected active channel.
It does not contain lockfile envelopes, manifests, schemas, public keys,
package signatures, executable evidence, or any local source/tool/Agent
approval. Verification therefore proves only that a trusted registry signer
published a canonical summary; operators must still fetch or provide the
matching lockfile and pass rollout preview/apply or direct deployment CAS
before any workspace state changes.

Dependency satisfaction is not only an installation check. Agent tool
assembly, policy assessment, connection, and the final `tools/call` path
recursively re-read the complete dependency closure from SQLite, require every
target signature to remain trusted, and re-evaluate its range. Publisher
revocation clears enablement and connection state for directly signed packages
and transitive dependents; the REST settlement closes all changed clients.
Deployment Ledger events contain only plan/count/hash evidence.

Stdio evidence is calculated through a read-only, no-follow file handle over a
canonical absolute regular file. The hasher rejects symlinks, empty/oversized
files, and size, mtime, or inode changes across the bounded streaming read.
Every future connection recomputes and compares path, size, and SHA-256 before
process creation. HTTP packages bind the normalized URL and environment-backed
header mapping but contain no resolved secret.

Napier implements MCP Streamable HTTP and line-delimited stdio JSON-RPC
directly. Both negotiate the protocol, support paginated `tools/list`, call
`tools/call`, bound protocol responses and tool output, and resolve credentials
only from named environment variables at connection time. Remote tool output
enters model context under an explicit untrusted-data boundary.

The Extensions Workbench is a lazy-loaded inspector with transport-specific
proposal forms. Its stdio form accepts an absolute executable, one argument per
line, an optional workspace-relative cwd, and target-name to source-name
environment mappings; it never accepts a secret value. The client and runtime
both fail closed, and the runtime closes the capability set by deriving
`process.spawn`, `secrets.env`, and required workspace access from the transport
configuration. Proposal ledger events retain provenance and capability evidence
without serializing executable or environment locator details.

Transport approval and tool approval are separate. A connection may be tested
without making any discovered tool model-visible. Re-discovery preserves review
only when the original tool name, normalized name, and schema hash all match;
schema drift returns the tool to `pending`. Read effects are allowed under
`observe`; external writes additionally require `unrestricted`.

Reviewed routing hints are workspace-authored tool metadata. They are
normalized during local tool approval, never accepted from raw MCP discovery,
and are labeled separately from the untrusted server description in the
Agent-visible tool description. Signed Extension packages freeze reviewed
routing hints when present, but importing the package still creates a pending
Extension with no inherited local tool approval.

External MCP schemas are deferred behind `mcp_schema_search` during live Agent
runs. The initial provider request sees a low-risk, read-only schema lookup
tool plus compact reviewed routing evidence; matching lookup results return
`addedToolNames`, and the next turn receives only those exact external tool
schemas. The actual MCP call path still rechecks source approval, Agent
enablement, package trust, dependencies, tool effect, and active policy
immediately before execution.

Stdio and verifier children start only through an `OsSandboxAdapter`. Both
supported adapters require an absolute executable and use `spawn` with
`shell: false` and `detached: true`; the wrapper owns an isolated process group
so normal exit, cancellation, timeout, and forced shutdown can reap descendants.
macOS invokes `/usr/bin/sandbox-exec` with a deny-default profile. Node needs
data access to the root directory entry itself and metadata access to the
literal ancestors of the executable, cwd, workspace, and private HOME. Those
rules do not grant descendant file data; workspace data remains capability
gated.

Linux requires `/usr/bin/bwrap`, starts from an empty mount namespace, requests
all supported namespace isolation with `--unshare-all`, and retains the host
network only when `network.connect` is approved. It bind-mounts only the
selected executable, runtime libraries/system data, a private writable `/tmp`,
and approved workspace access; executable arguments begin after Bubblewrap's
`--` boundary. Verification receives a read-only workspace bind and never
`--share-net`.

The OCI adapter is opt-in through an explicit image (`NAPIER_CONTAINER_SANDBOX_IMAGE`
or runtime options). It uses an absolute Docker-compatible executable, `--rm`,
`--init`, `--cap-drop ALL`, `no-new-privileges`, a read-only root filesystem,
a private `/tmp`, and `--network none` unless `network.connect` is approved.
Workspace mounts are read-only unless `workspace.write` is separately
approved. Environment values are passed through the container process
environment while command arguments contain only variable names.

Both adapters create a private temporary HOME and add workspace read/write
rules only for separately approved capabilities. Stdio receives no ambient
environment; every variable is an explicit target-name to source-name mapping
gated by `secrets.env`. Verifier environment keys and values are fixed by
Napier. Cwd remains inside the workspace and an explicit cwd requires
`workspace.read`. Missing Bubblewrap or required kernel/setuid namespace
support and other unsupported platforms fail closed. Protocol and verifier
outputs are size-bounded, timeouts and cancellation are enforced, stdio stderr
is never persisted, and process shutdown is bounded.

## Memory Flow

```text
conversation evidence + bounded reviewed-fact inventory
  -> extractor model (no tools, strict JSON, untrusted-data boundary)
  -> validate optional supersedesMemoryId / consolidatesMemoryIds against the
     supplied inventory
  -> proposed fact
  -> human approve / reject
  -> active fact + next review deadline
  -> expire before Run prompt assembly when review is due
  -> stale fact excluded from context
  -> human refresh / archive / propose correction or 2-8 source consolidation
  -> replacement approval atomically archives and links every source fact
  -> scope filter + confidence ordering + character budget
  -> <memory_context> system-prompt block
```

Conversation extraction never writes directly into model context. Only
`active`, in-date facts are injectable; proposed, stale, rejected, and archived
facts remain persisted for audit. Review intervals are bounded to 1–3,650 days
and default to 90. The runtime checks deadlines before prompt assembly,
persists every automatic transition, and emits `memory.stale` once rather than
silently omitting an expired fact.

Memory lifecycle API responses are no-store and response-hash-bound:

```text
list memories
  -> hash the returned Memory array exactly as served
  -> mirror optional Agent filter, total count, and proposed/active/stale/
     rejected/archived counts
propose or review memory
  -> hash the returned Memory fact exactly as served
  -> mirror Memory ID, status, revision, scope, category, review interval,
     review due date when present, use count, optional Agent ID, and
     supersession/consolidation metadata
```

Workspace facts are shared, while agent facts are visible only to their own
Agent profile. Each injected fact increments `useCount` at most once per Run
and records `lastUsedAt` plus `lastUsedRunId`. `context.memory` events retain
the injected IDs and a content hash, not duplicated memory text.

Correction is append-only review evidence. A replacement proposal names
`supersedesMemoryId`, must change content, and must preserve the target scope
and Agent. One target may have only one pending correction and cannot be
corrected after supersession. Approval validates the target again, activates
the replacement, archives the target, and writes both directional links in one
SQLite workspace commit. A superseded fact cannot be restored.

Consolidation uses the same append-only settlement without pretending that one
fact corrected another. A proposal carries 2–8 canonical
`consolidatesMemoryIds`; every source must be active/stale, unsuperseded, and
share scope and Agent. Duplicate, mixed-scope, or overlapping pending targets
fail before mutation. Approval validates all sources first, then activates the
synthesis and archives every source with the same `supersededByMemoryId` in one
SQLite workspace commit. Before approval, no source state changes.

The live-model extractor may assist correction or consolidation detection
without gaining authority to mutate reviewed facts. Its replacement inventory
contains at most 40 visible, unsuperseded active/stale facts and at most 6,000
characters of canonical JSON; facts with pending replacements are omitted.
`memory.extraction.started` records candidate IDs, truncation state, and the
inventory SHA-256 rather than duplicating content. Legacy correction-named
event fields remain additive aliases. The parser rejects malformed, unknown,
duplicate, or repeated target IDs before Store writes. Valid proposals inherit
source scope and Agent and remain `proposed` until a human approves them.

## Plan And Artifact Flow

The live system prompt includes `plan_tool_protocol` whenever the assembled
tool surface contains Plan tools, so the following state machine is presented
as the normal workflow rather than an optional afterthought.

```text
create_plan
  -> validate stable IDs, dependency references, and an acyclic step graph
  -> mark root steps ready and dependent steps pending
  -> derive criticalPathStepIds, readyStepIds, blockedStepIds,
     phaseWaves, activePhaseIndex, parallelReadyStepIds,
     phaseProjectionSha256, and replanRecommendation
replan_plan
  -> compare expectedRevision against the current durable plan revision
  -> require a strategy, reason, and concrete evidence
  -> supersede stale steps / artifacts, redirect dependencies, and append
     replacement steps / artifacts in one Store mutation
  -> hash the added plan slices and dependency-update set
  -> start a ready step under a same-Thread running run
  -> settle completed / blocked / skipped only with explicit evidence
  -> promote newly unblocked dependents
  -> refresh critical-path and phase-wave scheduling projections plus active /
     blocked / completed plan state
```

Late callbacks cannot overwrite terminal step or artifact outcomes. An explicit
`reopen` transition is required to revisit a terminal step. Startup
reconciliation changes a step owned by an interrupted run from `running` to
`blocked`, records its outcome as unknown, and appends one
`plan.step.blocked` event. Plan events, internal planning tool results, and the
Paper Ledger Plan Workbench expose the same critical-path, ready-step,
blocked-step, phase-wave, and parallel-ready projection so the next schedulable
work is visible without recomputing the DAG in each consumer. The phase
projection is a Deer Workflow-style `phase()` / `parallel()` view derived from
the Plan DAG: each wave contains step IDs and status partitions only, the active
phase is the first unfinished wave, and `parallelReadyStepIds` is the current
same-wave executable set. `phaseProjectionSha256` binds that ID/status-only
projection without copying objective, step descriptions, evidence, blockers, or
artifact paths. If there is no ready or running step,
Napier derives a deterministic `replanRecommendation` when the critical path is
blocked or a required artifact is missing. The recommendation binds the current
revision, strategy, affected IDs, suggested supersession IDs, reason/evidence,
and SHA-256 digest. It also carries a generated `ReplanExecutionPlanRequest`
draft under `napier.plan-replan-draft.v1`: blocked-step recovery drafts add
replacement steps and redirect downstream dependencies; artifact-drift drafts
supersede missing artifacts and add restore work plus replacement artifact
entries. Each draft includes a deterministic evaluation projection with
strategy-aligned checks, replacement-work counts, policy-size pressure, a
score/risk pair, and `evaluationSha256`; the Plan Workbench and Agent tool
surface show the score without treating it as authorization to mutate state.
The Workbench also renders an inline draft-change summary before Apply,
covering expected revision, superseded steps/artifacts, added steps/artifacts,
and dependency rewrites so the operator can inspect the concrete recovery
shape without invoking a model review.
An active recommendation can also be reviewed from the Plan Workbench by a
live model through a no-store
`napier.execution-plan-replan-draft-review` artifact. That review hashes the
model-review input, prompt, parsed response, deterministic evaluation,
recommendation, draft, and the live request's hash-only model-context envelope;
`napier/demo` fails closed as inconclusive. The Agent or operator still has to
submit the draft through the normal
revision-CAS replan flow before state changes; the Plan Workbench exposes that
application as an explicit action beside model review. Replans are bounded
history entries on the same ExecutionPlan: they record the strategy, revision
range, affected IDs, and SHA-256 digests for added steps, added artifacts,
dependency updates, and the complete replan record. The Workbench projects the
latest applied replan into an ID/hash summary beside the draft signal, allowing
operators to inspect superseded entities, new work, dependency rewrites, and
component hashes after Apply without rendering reason or evidence prose. When a
Plan has multiple recovery cycles, the same Workbench surface renders a compact
applied replan history with revision spans, strategy enums, structural-change
counts, and replan hashes, preserving the Work Ledger trail without reopening
the archived event stream. Step and artifact cards also project latest-replan
impact badges for added, superseded, and dependency-updated entities, so the
operator can find the replacement path directly in the executable Plan surface.
The same latest-replan card derives recovery progress from current Plan state,
counting settled added steps and verified added artifacts without introducing a
second recovery status source. If the active ready step is one of the latest
replan's added recovery steps, the card exposes an inline Run recovery step
action that reuses the normal Plan continue path rather than creating a separate
execution route. Otherwise the card derives a bounded next-action state from the
same Plan projection: complete, running, blocked by missing or blocked recovery
work, produced artifacts waiting for verification, expected artifacts waiting to
be produced, or earlier ready work that must run before recovery. A stale
expected revision fails as a conflict before any plan mutation is committed.

Plan REST responses are no-store and response-hash-bound:

```text
list plans
  -> hash the returned plan array exactly as served
  -> mirror thread ID, plan count, per-status counts, step/artifact counts, and
     accumulated replan count
create/replan/step/artifact mutation
  -> hash the returned ExecutionPlan exactly as served
  -> mirror thread ID, plan ID, status, revision, step/artifact/replan counts,
     critical-path/ready/blocked/phase/parallel-ready counts, phase-projection
     hash, and active recommendation digest when present
review replan draft
  -> expose reviewSha256 as the content digest
  -> mirror thread ID, plan ID, expected revision, recommendation/draft/
     deterministic-evaluation hashes, verdict, risk, and score
  -> mirror the live review request's model-context envelope hash when present
export plan archive
  -> build napier.execution-plan-archive from the current ExecutionPlan plus
     ordered plan-scoped Ledger events
  -> expose stable content hash, event-stream hash, plan revision/status,
     resource counts, and event-boundary headers without mutating state
  -> save direct API attachments and Plan Workbench downloads as
     napier-plan-<safe-plan-id>-r<revision>-<content-hash>.json
verify plan archive
  -> strictly parse a single archive, recompute stable content and event-stream
     hashes, validate plan/event ownership, recompute phase projection when
     present, bind to the URL Thread and Plan, and return no-store valid/invalid
     diagnostics
export plan blueprint
  -> distill the current archive into napier.execution-plan-blueprint:
     objective, step DAG, artifact declarations, source plan revision, archive
     hash, and event-stream hash
  -> exclude runtime statuses, evidence prose, blockers, and file digests
  -> save direct API attachments and Plan Workbench downloads as
     napier-plan-blueprint-<safe-plan-id>-r<revision>-<content-hash>.json
verify plan blueprint
  -> recompute the stable blueprint hash, validate DAG and source hashes, and
     return no-store valid/invalid diagnostics
create plan from blueprint
  -> validate the blueprint first, replay the normal CreateExecutionPlanRequest
     gate, and append only blueprint/source hashes to plan.created
save blueprint record
  -> validate the blueprint, deduplicate active records by blueprint SHA-256,
     persist an ExecutionPlanBlueprintRecord, and expose no-store
     active/archived count plus set-hash headers
  -> Plan Workbench can save the current verified blueprint into the local
     Template shelf without bypassing the hash-verified JSON client
qualify blueprint record
  -> validate the stored record, report archived/invalid states, and recompute
     local source Plan archive plus event-stream hashes without mutating Ledger
  -> return qualified/source_missing/source_drift with only expected and actual
     hash evidence for CI polling and Workbench receipts
preview plan from blueprint record
  -> run the same qualification and open-Plan gate, then return ready,
     not_qualified, or blocked with an unpersisted Plan projection
  -> expose no-store body hashes, preview status, open-Plan flag,
     qualification hashes, and a stable previewSha256 over Plan shape plus
     hash-only evidence for review-before-run workflows
create plan from blueprint record
  -> recompute the current preview, optionally require expectedPreviewSha256 to
     match, replay the normal Plan creation gate, and append only blueprint
     record/source hashes plus qualification status/report hashes and the
     consumed preview hash to plan.created
  -> Store persists the new Plan projection and plan.created replay evidence in
     one Ledger commit, preventing Plan/history divergence after partial failure
  -> successful responses mirror the atomic replay event id, event seq, and
     event SHA-256 headers so callers can pin the creation evidence without
     scanning the Ledger event stream first
  -> a bounded no-store replay-event verifier checks the declared event id,
     thread, seq, and event SHA-256 against the Ledger and returns only
     hash-only replay projection evidence
  -> Workbench consumes those headers after template replay, verifies the
     single event anchor, and renders the verification status in the creation
     receipt with the verifier receipt hash; missing, malformed, or
     unverifiable anchors become invalid receipt diagnostics without hiding the
     already-created Plan
  -> the qualification/preview/create/history/history-verification/outcome/
     outcome-verification receipt projections are pure Web ViewModel mappings
     with contract tests for source-drift, ready/blocked preview, valid,
     missing-anchor, verifier-failure, latest-replay, empty-history,
     latest-outcome, and observed-count paths
  -> Workbench creation is disabled while the current Thread has an active or
     blocked Plan, matching the server-side creation gate
  -> stale preview hashes, open-Plan conflicts, and non-qualified records return
     the current no-store preview report with 409
     and do not create Plan state
list blueprint record replays
  -> derive napier.execution-plan-blueprint-replay-history from plan.created
     Ledger events with matching blueprintRecordId
  -> expose replay/thread/plan counts, objective SHA-256, qualification hashes,
     preview SHA-256, event-set SHA-256, and stable content SHA-256 only
  -> omit objective prose, raw event payloads, and mutable Plan projections;
     Workbench exports this JSON on demand from the Template shelf
  -> Workbench downloads use
     napier-blueprint-replay-history-<safe-record-id>-<content-hash>.json
verify blueprint record replay history
  -> accept an uploaded replay-history receipt through a bounded no-store API
  -> recompute stable receipt hash without generatedAt/contentSha256, compare
     against declared content/event-set hashes and current Ledger projection
  -> return valid/invalid diagnostics plus declared/recomputed/observed hashes
     and replay/thread/plan counts without mutating Ledger
  -> Workbench can upload a replay-history JSON receipt and render the returned
     verification receipt without trusting the file transport
project blueprint record replay outcomes
  -> join immutable replay creation anchors to current durable Plan
     projections by plan/thread identity
  -> bind status, revision, step/artifact/replan counts, and hash-only evidence
     projections into per-replay outcome hashes without exposing objective,
     path, blocker, or evidence prose
  -> aggregate active/completed/blocked/cancelled/invalid counts, completion
     basis points, replay-history SHA-256, outcome-set SHA-256, and stable
     content SHA-256 in napier.execution-plan-blueprint-replay-outcomes
  -> Workbench downloads use
     napier-blueprint-replay-outcomes-<safe-record-id>-<content-hash>.json
verify blueprint record replay outcomes
  -> accept an uploaded outcomes receipt through a bounded strict no-store API
  -> recompute the artifact hash and compare record, replay-history,
     outcome-set, replay-count, completed, blocked, and invalid evidence with
     the current Ledger plus Plan projections
  -> return declared/recomputed/observed hashes and low-cardinality diagnostics;
     Workbench exports and uploads outcome JSON separately from replay history
promote blueprint record outcome baseline
  -> verify the uploaded outcomes receipt against the current Store projection
     before writing any baseline state
  -> require the current outcomes to satisfy the selected policy; defaults are
     one replay minimum, 100% completion, zero blocked, and zero invalid
  -> append a hash-only baseline containing outcome receipt hash,
     replay-history hash, outcome-set hash, counts, policy, and supersession ID
  -> optionally accept a napier.execution-plan-blueprint-outcome-review
     artifact whose live request can be bound to a hash-only model-context
     envelope; rehash the review, require it to match current outcomes, current
     source qualification, and current outcome qualification status, then gate
     verdict=promote, score, and risk before persisting review hash/model
     evidence into the append-only baseline
qualify blueprint record outcomes
  -> recompute current outcomes and compare counts/rates against the latest
     baseline policy without mutating Ledger
  -> return qualified, missing_baseline, or policy_failed plus current/baseline
     hashes and low-cardinality policy diagnostics for Template shelf receipts
review blueprint record outcomes
  -> build a no-store napier.execution-plan-blueprint-outcome-review artifact
     from current replay outcomes, source/outcome qualification, optional
     reusable criteria, and an explicit evaluator model
  -> feed the model only aggregate counts, replay statuses, Plan projection
     hashes, outcome hashes, baseline hashes, and policy evidence; objective,
     artifact path, blocker, and evidence prose stay out of the artifact
  -> bind verdict, score, risk, per-criteria scores, input SHA-256, prompt
     SHA-256, response SHA-256, schema SHA-256, and review SHA-256; napier/demo
     fails closed as inconclusive
select blueprint record for target Thread
  -> recompute source qualification, outcome-baseline qualification, and
     target-Thread preview readiness for every saved template without mutating
     Ledger
  -> rank only fully qualified candidates through an explicit recommendation
     policy template; source qualification stays a gate, while balanced,
     delivery_first, and portfolio_first tune outcome completion, portfolio
     family completion, reviewed-baseline coverage, and replay evidence
     weights before stable recency/freshness tie-breakers
  -> apply policy precedence request > family_override > balanced default; each
     candidate records the actual policy template, policy SHA-256, policy
     source, and optional family override SHA-256
  -> return napier.execution-plan-blueprint-selection with record IDs,
     preview hashes, family hashes, portfolio-set SHA-256, baseline/outcome
     hashes, recommendation policy hash, override-set SHA-256, selected
     recommendation score/source, low-cardinality diagnostics, selection-set
     SHA-256, and optional objective SHA-256 rather than prose
backtest blueprint recommendation policies
  -> reuse the current portfolio evidence and historical replay outcomes
     without target-Thread preview or Ledger mutation
  -> compare balanced, delivery_first, and portfolio_first policy templates by
     selected record/family, recommendation score, average qualified score, and
     divergent-selection count
  -> return napier.execution-plan-blueprint-recommendation-policy-backtest with
     policy-set SHA-256, portfolio-set SHA-256, hash-only candidate evidence,
     and no objective, step title, artifact path, blocker, or evidence prose
set blueprint family recommendation policy override
  -> require family SHA-256 and one of balanced, delivery_first, or
     portfolio_first, with optional expected portfolio-set SHA-256 CAS
  -> fail closed with 409 when the caller's portfolio evidence is stale or the
     family no longer exists
  -> persist a hash-only
     napier.execution-plan-blueprint-recommendation-policy-override record and
     expose the override-set SHA-256 for future default selection receipts
review blueprint family recommendation policy override drift
  -> recompute current portfolio evidence and family-scoped recommendation
     policy backtests for each persisted override without mutating Ledger
  -> compare the override policy's selected record and recommendation score
     against the current best policy template for that workflow family
  -> return
     napier.execution-plan-blueprint-recommendation-policy-override-drift-review
     with keep/retire recommendations, aligned/retire/missing-family counts,
     override-set SHA-256, drift review-set SHA-256, policy hashes, selected
     record IDs, and low-cardinality diagnostics only
retire blueprint family recommendation policy override
  -> require family SHA-256 plus expected override, override-set, drift
     review-set, and portfolio-set SHA-256 values from a fresh drift review
  -> recompute the current drift review and fail closed with 409 if any CAS
     evidence changed or the family override is not currently retire
     recommended
  -> remove the persisted override, append the retirement receipt into durable
     local history, and return
     napier.execution-plan-blueprint-recommendation-policy-override-retirement
     with retired override/policy hashes, drift review-set SHA-256, remaining
     override-set SHA-256, and no objective, step title, artifact path, blocker,
     or evidence prose
list blueprint family recommendation policy override retirements
  -> validate the append-only retirement receipts and recompute the current
     portfolio-set SHA-256 plus current override-set SHA-256
  -> return
     napier.execution-plan-blueprint-recommendation-policy-override-retirement-history
     with retirement count, retirement-set SHA-256, latest retired timestamp,
     current override-set SHA-256, and the hash-only retirement receipts
verify blueprint family recommendation policy override retirements
  -> accept an exported retirement history without mutating the Ledger
  -> recompute the uploaded stable content hash, validate every embedded
     retirement receipt, recompute the declared retirement-set SHA-256, and
     compare declared portfolio/current override/retirement hashes against the
     current durable store
  -> return
     napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-verification
     with valid/invalid status, low-cardinality diagnostics, and
     declared/recomputed/observed hashes for content, portfolio set, current
     override set, and retirement set
verify blueprint family recommendation policy override retirement proof bundle
  -> accept multiple exported retirement histories without mutating the Ledger
     or requiring those histories to belong to the current local store
  -> validate each history self-contained, recompute embedded retirement
     receipt hashes, and compare portfolio-set/current-override-set/
     retirement-set hash families across histories
  -> return
     napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle
     with aligned/divergent/invalid status, valid/invalid history counts,
     distinct set counts, history/portfolio/current-override/retirement bundle
     hashes, highlighted diagnostics, and no objective, step title, artifact
     path, blocker, or evidence prose
sign blueprint family recommendation policy override retirement proof bundle
  -> accept multiple exported retirement histories plus thread/trust-anchor IDs
     and recompute the proof bundle before signing
  -> refuse invalid proof bundles, but allow aligned and divergent bundles to
     become explicit trusted receipts because divergence is valid audit evidence
  -> wrap the proof bundle in the shared Ed25519 TrustedReceiptEnvelope format,
     append a hash-only receipt.signed Ledger event, and return no-store
     download headers binding envelope, receipt, artifact, and signer key hashes
calibrate blueprint portfolio
  -> group saved templates by a hash of workflow shape, using step/dependency
     and artifact identifiers only after hashing them
  -> aggregate source qualification, outcome qualification, reviewed baseline
     counts, replay counts, completion basis points, and top record IDs without
     exposing objective, step title, artifact path, blocker, or evidence prose
  -> return napier.execution-plan-blueprint-portfolio-calibration with family
     hashes, portfolio-set SHA-256, and no Ledger mutation
```

Planning tools add a model-aware policy template beside the durable plan
projection. `napier/demo` and minimal/off thinking use the conservative
template; high-capability or high-thinking models receive an expansive
template; other live models receive a balanced template. The policy template is
hashed and includes a bounded checklist and instruction for reviewing or
expanding the generated draft, but it is not persisted into the Plan and cannot
mutate state without the same `replan_plan` CAS.

Artifact manifests begin as expected paths. The internal Agent tool observes a
workspace file or directory before marking it produced and computes SHA-256
from actual bytes before marking it verified; models never provide their own
digest. Directory verification hashes a canonical manifest of sorted relative
paths, nested directory markers, file byte counts, and per-file SHA-256 values.
Workspace-relative path confinement, symbolic-link rejection for directory
manifests, and a 32 MB hashing limit bound the operation. The local operator
API can either settle plan evidence explicitly or request `observeWorkspace`
verification, where the server computes the file or directory digest itself
and rejects simultaneous self-reported `sha256` or `sizeBytes` values. Its
REST boundary rejects unknown fields, malformed IDs, oversized JSON, invalid
replan strategies, invalid status values, and invalid SHA-256 values before
the runtime state machine is called. The Plan Workbench exposes the same
operator path as Mark produced, Verify bytes, Recheck bytes, Mark drifted, and
Mark missing actions; Verify/Recheck bytes always uses `observeWorkspace` and
never accepts a browser-supplied digest. Rechecking a verified artifact appends
a fresh `plan.artifact.verified` receipt only when the current workspace digest
still matches the stored digest. A digest mismatch fails closed without changing
the manifest; Mark drifted then asks the server to re-observe the workspace and
only a confirmed missing file or digest mismatch can append `plan.artifact.missing`
evidence, mark the Plan blocked, and surface the existing `artifact_drift`
replan recommendation. Verified artifact cards render the server-computed byte
count beside a short digest while retaining the full SHA-256 as audit context.
Produced or verified file artifacts can also be downloaded from the Workbench
through a no-store, workspace-confined file endpoint. The server rejects
non-file artifacts, unproduced artifacts, symbolic links, files above the
artifact hash limit, and verified digest drift before returning bytes. A
successful download appends an `artifact.exported` Ledger event containing only
the Plan/artifact IDs, Plan revision, status/kind, `pathSha256`, content
SHA-256, and byte count. Direct attachments use
`napier-artifact-<safe-artifact-id>-<content-hash>-<safe-basename>` filenames,
and Workbench fallbacks keep the same safe artifact/hash prefix even if a
browser response lacks a usable attachment header. The event is included in
Plan archives as scoped artifact evidence and has a bounded Trace summary that
never renders the path or file contents. Verified file artifact downloads can
also be uploaded back to a no-store verifier. The verifier reads the uploaded
bytes on the server, enforces the same artifact hash limit, compares the
computed SHA-256 and byte count with the current verified Plan artifact digest,
and appends `artifact.file_verified` with only verification status, diagnostic
count/hash, expected/observed hashes, expected/observed sizes, and `pathSha256`;
uploaded filenames and file contents never enter durable Ledger receipts. The
same produced/verified file
artifacts can be previewed in place when their bytes are valid UTF-8 and no
larger than 64 KiB. Preview
uses the same workspace confinement, symbolic-link, and verified-digest drift
checks, returns text only in the no-store response, and appends an
`artifact.previewed` Ledger event with Plan/artifact IDs, Plan revision,
status/kind, `pathSha256`, artifact SHA-256, byte count, line count, and
`textSha256`. Plan archive verification accepts only that hash-only preview
receipt shape, so raw preview text or paths in the event payload fail closed.
Markdown table, TSV, CSV, JSON, JSONL, and NDJSON file artifacts can also be
profiled through the same produced/verified file boundary. The runtime reuses
the Agent `inspect_data` parser, limits the source to 2 MiB, returns at most 10
sample rows in the no-store response, and computes column-set and sample SHA-256
receipts from the projected profile. The persisted `artifact.data_profiled`
event stores only Plan/artifact IDs, Plan revision, status/kind, `pathSha256`,
artifact SHA-256, byte count, format, row/column counts, truncation state,
`columnSetSha256`, and `sampleSha256`; raw columns, sample rows, artifact
paths, and file contents fail closed at append, restore, replay, and archive
verification boundaries. Workbench can download the no-store data profile JSON
and upload it back to a sibling verifier; the verifier recomputes the current
profile, checks the uploaded columns/sample against their declared hashes, and
returns only valid/drifted status, diagnostics, counts, and declared/observed
hashes. Each accepted verifier call appends an
`artifact.data_profile_verified` Ledger receipt containing only Plan/artifact
IDs, Plan revision, status/kind, `pathSha256`, verification status, diagnostic
count/hash, declared/recomputed/observed artifact, column-set, sample, count,
format, truncation, and byte-size evidence. Uploaded columns, sample rows, and
diagnostic strings remain no-store and fail closed if they appear in persisted
artifact receipts. The no-store verifier response mirrors the appended Ledger
event ID, sequence, and event SHA-256, and the Workbench refreshes the active
Thread after upload verification so Trace immediately shows the replayable
receipt.
Produced or verified directory artifacts expose a sibling manifest preview.
The response is no-store and may include artifact-relative entry paths, file
hashes, byte counts, and aggregate directory digest for operator inspection;
the corresponding `artifact.directory_manifested` Ledger event stores only
Plan/artifact IDs, Plan revision, status/kind, `pathSha256`, directory digest,
byte count, and entry/file/directory counts. Raw directory entries in that
receipt fail closed before persistence, replay export, or archive verification.
Workbench can download the no-store manifest JSON and upload it to a sibling
verifier; the verifier recomputes the current directory manifest, checks the
uploaded entries against their own declared digest/counts, and appends
`artifact.directory_manifest_verified` with only verification status,
diagnostic count/hash, declared/recomputed/observed directory digest, entry-set
hashes, byte counts, and aggregate entry/file/directory counts. Entry paths,
file paths, and diagnostic strings remain no-store and fail closed if they
appear in persisted artifact receipts.
Verified file and directory artifacts also expose a non-mutating drift check
from the Workbench. The server observes the current workspace bytes, returns
`current`, `drifted`, or `missing`, and appends `artifact.drift_checked` with
Plan/artifact IDs, Plan revision, status/kind, `pathSha256`, expected SHA-256,
optional observed SHA-256, optional byte count, and the result. This lets an
operator inspect drift before choosing the state-changing Mark drifted action.
Thread replay bundle and Run replay snapshot validation apply the same
hash-only artifact receipt boundary, preventing recomputed portable replay
hashes from smuggling preview text or raw artifact paths into exported evidence.
SQLite restore also checks the same boundary for every persisted Thread event,
so a locally modified ledger row cannot reintroduce raw preview content on
startup. The LocalStore append path applies the boundary before mutating the
Thread projection or committing to SQLite, so malformed artifact receipts fail
before they can enter the Work Ledger.
Every accepted state change is appended to the Thread ledger. The HTTP API and
internal Agent tool share the same `plan.artifact.*` payload builder, which
also emits `pathSha256` and `evidenceSha256` companions for hash-only Trace
reading. Validators treat the latest artifact event's artifact fields as a
projection of the manifest's current state. SQLite restore, Thread replay
bundle validation, and Plan
archive verification all fail closed if the event's artifact ID, path, path
hash, status, evidence, evidence hash, digest, size, or source Run drifts from
the current artifact manifest. Phase and ready/blocked projection metadata is
validated for shape but may reflect the event-time plan state, so later step
transitions do not make a verified artifact look tampered.

## Context Compaction Flow

```text
conversation projection exceeds message or character budget
  -> find the newest checkpoint whose source and summary hashes still verify
  -> retain the newest raw messages within the active model budget
  -> send only the previous checkpoint plus newly covered evidence to a
     no-tool compactor
  -> record the compactor request as a hash-only model-context envelope
     with a redacted response binding
  -> require strict summary / decisions / openLoops / artifacts JSON
  -> hash every covered raw message event and the normalized summary
  -> append context.compaction.completed without altering source events
  -> inject the checkpoint as untrusted system data beside recent raw messages
  -> derive no-store checkpoint calibration from ledger events
```

The checkpoint chain is incremental: a later checkpoint names its parent but
binds a fresh hash over the full raw sequence range it represents. Reuse
recomputes both hashes from the ledger. Invalid or oversized checkpoints are
ignored. If the compactor fails, Napier keeps the previous valid checkpoint,
falls back to at most 24 uncovered raw messages, and records the exact omitted
count in `context.compaction.failed`. Goal evaluation consumes the same
validated checkpoint projection as the main Agent.

Checkpoint calibration is a derived report, not mutable state. It scans the
current ledger for `context.compaction.completed` and
`context.compaction.failed` events, replays source and summary hash checks,
classifies each checkpoint as verified, drifted, or malformed, and exposes
coverage, compression ratio, fallback omission count, latest valid checkpoint,
sample hashes, and an overall `contentSha256`. The REST endpoint
`GET /api/threads/:threadId/context-checkpoint-calibration` returns the report
with `Cache-Control: no-store`, `X-Napier-Content-SHA256`, Thread/event-stream
hash headers, checkpoint verified/drifted/malformed counts, failure counts,
coverage/compression ratios, fallback omission counts, and latest-checkpoint
hash headers; `ThreadDetail` embeds the same projection for the Context
Inspector.

## Security Boundary

The current boundary has seventy-four parts:

1. workspace path confinement with canonical realpaths and external-symlink
   rejection;
2. tool allowlists on each Agent profile;
3. a pre-execution policy decision for every tool call;
4. extension source/capability/tool review before model visibility;
5. MCP endpoint screening, redirect denial, response budgets, and no persisted
   secret values;
6. hash verification and untrusted-data labeling for compacted context;
7. same-Thread run ownership and runtime-computed hashes for plan artifacts;
8. OS-sandboxed stdio MCP with capability-derived network, filesystem, process,
   and environment boundaries;
9. hash-preconditioned, size-bounded atomic edits with protected-path,
   symlink, and multi-runtime lock checks;
10. command-closed verification with canonical targets, fixed local CLIs,
    read-only offline sandbox capabilities, process-group cleanup, and
    time/output budgets;
11. revisioned and per-Run-snapshotted turn, token, reported-cost, and wall-time
    limits with pre-tool side-effect blocking and first-reason evidence;
12. prompt-redacted, canonical Run configuration fingerprints with independent
    SHA-256 validation, duplicate-field consistency, and explicit legacy
    unavailability.
13. reviewed Memory as data-only context, with Agent scope filtering, deadline
    exclusion before injection, bounded content, and append-only
    correction/consolidation history.
14. append-only human evaluation truth with immutable evaluation binding,
    bounded notes, hash-only events, and model/rubric-scoped calibration.
15. workspace-wide Casebook curation with adjudication-gated inputs,
    append-only evidence registries, revision manifests, bounded artifacts,
    and full hash-chain validation.
16. executable Casebook qualification with source replay hash verification,
    current-revision compare-and-swap, no-tool judging, bounded history, and
    current-revision-only receipts.
17. independent reviewer lanes with bounded append-only histories, strict
    quorum/leader policy, atomic consensus-to-truth resolution, privacy-safe
    events, and portable provenance remapping.
18. Ed25519 receipt origin verification with complete-artifact and stable
    content binding, public-only durable trust anchors, last-moment private-key
    matching, irreversible revocation, and current-passing-only qualification
    baselines.
19. metadata-only OpenTelemetry projection with explicit content-key
    exclusion, known-resource-ID allowlisting, bounded artifacts, deterministic
    IDs, complete graph/time validation, and self-excluding audit evidence.
20. opt-in automatic recovery with source-snapshot policy binding,
    metadata-only eligibility hashes, unmatched-tool and effect analysis,
    SQLite-CAS claims, deterministic attempt triggers, bounded retry chains,
    imported-history exclusion, and an execution-time local read-only tool
    reduction.
21. Ed25519 Extension publisher provenance with dual manifest/artifact hash
    binding, public-only durable anchors, irreversible revocation, independent
    local source/tool/Agent gates, strict schema/configuration matching,
    canonical stdio executable hashing, connect/call-time revalidation,
    package-binding CAS updates, explicit publisher/version risk confirmation,
    append-only supersession history, replay rejection, and mandatory review
    reset; signed bounded dependency ranges, acyclic final-graph validation,
    dependency-first atomic package-set CAS, transitive revocation settlement,
    call-time dependency-closure enforcement, and self-contained lockfile
    replay plus policy-bound rollout channels and signed channel indices that
    never inherit local approval.
22. allowlisted receipt-trust directory subscriptions with private local
    source locators, hash-only public evidence, policy-bound last-good
    discoveries, bounded transparency histories, rollback detection,
    weighted independent-origin quorum receipts with publisher metadata pins,
    quorum promotion receipts, signed quorum-promotion baselines, expiring
    refresh claims, revision CAS, publisher-signed directory metadata, active
    verifier-set selections, transparency checkpoints, hosted signed checkpoint
    discovery, durable checkpoint registries, and checkpoint-registry quorum
    alerting; hosted signed verifier-rotation proposal discovery plus durable
    leased subscriptions with last-good preservation and hash-only transparency;
    fail-closed promotion preserves the active verifier set across rejected,
    failed, stale, or split rotations.
23. durable Operator Decision gates with one-open/total bounds, strict
    selection validation, single-tool terminating turns, Store-enforced
    continuation authorization, explicit answer/continue separation,
    first-terminal-wins projection, linked child Runs, metadata-only OTLP, and
    portable Run-ID rebinding.
24. Agent-authored milestones with active-Run-only writes, strict text/item
    bounds, immutable predecessor chains, runtime-derived Ledger event-range
    evidence, imported-range text redaction, metadata-only OTLP, read-only
    management access, and portable evidence rehashing.
25. independent final-turn review with primary/reviewer identity separation,
    zero-tool model calls, strict typed verdicts, hash-only candidate and
    guidance receipts, shared bounded correction, frozen-budget accounting,
    fail-closed inconclusive enforcement, metadata-only OTLP, lazy inspection,
    and portable receipt revalidation.
26. frozen Prompt Variables with strict revisioned definitions, single-pass
    non-recursive resolution, exact Skill catalog injection, schema-7 Run
    fingerprints, hash-only Ledger/OTLP evidence, lazy Context editing, and
    portable snapshot-to-Run binding.
27. a durable Tool Loop Guard with Agent-revision policy, canonical
    argument/result repetition evidence, compaction-immune next-turn redirects,
    pre-side-effect blocking, schema-8 fingerprints, metadata-only OTLP, lazy
    Context/Trace inspection, and portable trigger revalidation.
28. explicit-argv Node command execution with direct absolute
    executable launch, canonical cwd, fixed environment, read-only/offline
    capabilities, bounded wall/output lifetime, parent cancellation,
    argument/output-redacted Ledger evidence, stable loop-detection hashes, and
    a real local-sandbox smoke.
29. bounded Workspace Process Sessions with per-Thread admission control,
    cursor output, cancellation and graceful shutdown, Thread-scoped local
    inspection, hash-only lifecycle settlement, restart interruption
    reconciliation, incremental projection, and a real Agent-to-Sandbox smoke.
30. bounded Process input streams with closed-by-default stdin, explicit
    interactive opt-in, serialized UTF-8 writes and close, independent
    message/session/action limits, hash-only input receipts, Workbench
    controls, schema v1/v2 compatibility, and a real stateful
    Agent-to-Sandbox smoke.
31. standard TypeScript LSP diagnostics with one-file canonical confinement,
    separately bound read-only Runtime assets, framed JSON-RPC lifecycle,
    bounded diagnostics/protocol/latency, Agent/Server/Context/Trace
    integration, and message/path-redacted durable evidence.
32. write-linked TypeScript/JavaScript diagnostics with CAS-bound preflight,
    post-commit delta classification, target-drift detection, path-free patch
    evidence, public SSE/Trace integration, and explicit unavailable semantics.
33. workspace-confined LSP definitions, references, and complete rename
    previews with canonical target files, bounded live-only source edits,
    strict rejection of unsupported WorkspaceEdit operations, Agent/Server/
    Context/Trace integration, and hash-only durable evidence.
34. diagnostic-driven LSP quick-fix previews with bounded alternatives,
    insertion-aware text-only WorkspaceEdits, ignored command/data payloads,
    aggregate context/output budgets, Agent/Server/Context/Trace integration,
    and a real preferred-fix-to-hash-bound-patch verification path.
35. semantic TypeScript/JavaScript document symbols with hierarchical and flat
    LSP compatibility, exact server-provided symbol/name ranges, bounded output,
    Agent/Server/Context/Trace integration, hash-only durable evidence, and a
    real symbol-range-to-CAS-patch-to-typecheck path.
36. persistent synchronous JavaScript calculations within one Agent Run,
    reusing bounded Process Sessions and the read-only/offline OS Sandbox,
    with in-realm result rendering, terminal uncertain-state handling,
    hash-only durable evidence, and Agent/Server/Trace integration.
37. bounded in-process TypeScript/JavaScript AST query and no-write structural
    edit previews with file/node freshness, complete-file syntax reparse,
    comment-trivia rejection, unique exact-patch output, CAS/typecheck
    dogfood, hash-only durable evidence, and Agent/Server/Trace integration.
38. persistent restricted synchronous Python calculations within one Agent
    Run, with fixed interpreter/runtime-asset binding, pure-computation
    syntax/builtins, uncatchable traced-heap enforcement, private Process
    protocol, hash-only evidence, and Agent/Server/Trace integration.
39. Run-owned Node launch debugging through an authenticated private DAP
    protocol, canonical source and loaded-module freshness, read-only/offline
    Sandbox execution, bounded stack/value/output projection, terminal unknown
    outcomes, and hash-only Agent/Server/Trace evidence.
40. Run-owned TypeScript language-server Sessions shared across diagnostics,
    symbols, definition, references, rename, Code Actions, and write-linked
    diagnostics, with bounded workspace freshness, operation/global admission,
    terminal uncertain-state handling, one-shot fallback, and hash-only
    reuse evidence.
41. Run-owned controlled Chrome Sessions with fresh ephemeral profiles,
    authenticated fixed-IP public-network proxies, independent Route-level
    SSRF checks, explicit top-level cross-origin authorization, bounded ARIA
    interaction and screenshots, canonical upload/download confinement,
    settlement cleanup, and hash-only Ledger/Trace evidence.
42. Run-local Browser Source capture and claim-bound citations with bounded
    normalized visible text, immutable capture hashes, exact line ranges,
    cancellation-safe isolation, citation-bearing Markdown delivery, and
    privacy-bounded Ledger/Trace evidence.
43. Citation-backed Markdown verification with canonical workspace reads,
    complete-file freshness, one-use current-Run tokens, exact claim-line
    matching, and hash-only report evidence.
44. Process-isolated read-only SQLite analysis with static database snapshots,
    parameterized single statements, SQLite authorizer enforcement, hard
    timeout/cancellation, source drift rejection, Agent/Workflow reuse, and
    hash-only durable results.
45. Bounded read-only Agent Map execution with typed array cardinality,
    exclusive four-Run-safe scheduling, Ledger-proved coordinator/child
    lineage, restricted child configurations, independent item deadlines,
    ordered aggregate validation, explicit retry, and complete-evidence-only
    restart reconstruction.
46. Preview-bound coordinated LSP rename application with same-Run one-use
    capabilities, complete target locking and hash revalidation,
    same-filesystem staging/backups, verified rollback, bounded before/after
    diagnostics, explicit indeterminate outcomes, and body-free Trace evidence.
47. Write-linked TypeScript/JavaScript relevant-test verification with
    nearest-package or declared-workspace bounded static dependency graphs,
    changed-declaration association, exact read-only/offline Vitest targets,
    post-run source/config freshness, Agent/HTTP/Replay/Trace integration, and
    path/output-free durable evidence.
48. A versioned local stdio JSON-RPC Agent and typed Workflow entry with strict
    bounded framing, request-bound Ledger notifications, hash-bound Approval
    answer-and-resume, preview-bound Workflow checkpoint experiments, shared
    Runtime execution, mixed concurrent admission, standard cancellation,
    ordered shutdown, built subprocess coverage, and no second execution loop.
49. A line-oriented interactive Agent CLI that keeps one local Runtime open
    across durable turns, delegates through the embedded Agent service, supports
    bounded model/Thread/new/resume/status controls, separates assistant output
    from metadata-only tool status, applies per-turn cancellation and timeout,
    and is covered through a real built-process PTY.
50. Deterministic single- and multi-series SQLite chart delivery through the
    existing read-only worker, with complete-result enforcement, bounded shared
    Y geometry, grouped bars or multiple lines, fixed legends, live-only
    semantic output, typed Workflow receipts, public SSE/Trace projection, and
    CAS plus Plan Artifact verification for actual file delivery.
51. Pi's complete pinned built-in Provider catalog, with no duplicated Napier
    protocol implementations, fair bounded Workbench projection, full explicit
    ModelRef resolution, existing credential-reference enforcement, offline
    listing, caller-selected live-provider smoke coverage, and object-rooted
    function schemas for strict OpenAI-compatible endpoints.
52. Typed deterministic Workflow Reduce with bounded required array/value
    paths, fixed operations and empty identities, finite safe arithmetic,
    JSON-number normalization, leased Run execution, strict Schema and receipt
    validation, body-free public evidence, recomputed restart recovery,
    experiment reuse/rerun, and no model, tool, expression, coercion, or
    side-effect path.
53. Preview-bound historical user-message re-execution with frozen Agent,
    Prompt Variable, Skill, Memory, history, model, and Workspace bindings;
    isolated read-only Branch execution; source/target comparison; CLI, SDK,
    stdio RPC, HTTP SSE, portable Replay, and privacy-bounded Trace.
54. Preview-bound single-model-invocation re-execution with exact local-only
    provider Context capsules, primary/compaction/Goal/Memory capture, one
    isolated provider call, zero candidate tool execution, call-level
    comparison, CLI/HTTP/SDK/RPC/Web delivery, independently verified browser
    protocol, and privacy-bounded Replay/Trace receipts.
55. Preview-bound single-tool-invocation re-execution for eleven built-in
    stateless read-only tools with exact local-only argument capsules, scoped
    Workspace freshness, implementation/effect/policy binding, one isolated
    tool call and zero model calls, source/target comparison,
    CLI/HTTP/SDK/RPC/Web delivery, independently verified browser protocol,
    and argument/path/output-body-free Replay/Trace projections.
56. Frozen historical results inside Agent message experiments for the same
    eleven stateless read-only tools, with post-settlement local result capsules,
    exact ordered implementation/argument matching, zero live-tool fallback,
    preserved source error state, divergence failure, shared
    Web/CLI/HTTP/SDK/RPC delivery, and body-free Ledger/Replay/Trace evidence.
57. Preview-bound Workflow checkpoint output simulation with runtime Schema
    validation, descendant-only normal scheduling, capability-gated
    zero-model/zero-tool materialization, SQLite recovery, exact-preview
    freshness, source/target comparison, CLI/HTTP/SDK/RPC/Web delivery, and
    hash-only public simulation evidence.
58. Preview-bound Workflow checkpoint constructed-input replacement with
    runtime Schema validation, verified ancestor reuse, normal selected-node
    and descendant scheduling, exact hidden recovery evidence, opaque portable
    import, honest per-node comparison, CLI/HTTP/SDK/RPC/Web delivery, and
    hash-only public input evidence.
59. Preview-bound scoped Workspace Process writes with exact command and
    complete workspace freshness, one-use Thread/Run capabilities, explicit
    non-overlapping writable mounts, cross-Manager serialization,
    directory-aware Delta containment, schema-v5 Ledger recovery, local path
    inspection, and path/body-free public evidence.
60. Preview-bound operator rollback for changed scoped Process writes with
    private content/mode-verified scope snapshots, settled-after freshness,
    cross-Manager serialization, multi-scope reverse recovery, two-phase
    Ledger intent/outcome evidence, restart blocking for pending outcomes,
    HTTP/Web delivery, and path/body-free Trace.
61. Explicitly preauthorized scoped-write failure compensation with
    schema-v2 preview/schema-v7 Session binding, unsuccessful within-scope-only
    admission, same-lock settled-after freshness, two-phase automatic
    intent/outcome evidence, poll finality, restart non-retry, operator fallback,
    and shared Agent/HTTP/Web/Replay/Trace projection.
62. Typed root multi-way Switch templates inside existing Deterministic
    Workflow Runs, with 2–16 schema-valid unique cases, optional default,
    model/tool-free execution, explicit unmatched blocking, concurrent
    isolation, cancellation, exact decision/output recovery, SDK/CLI delivery,
    independent Web Manifest validation, and selector/output-body-free Trace.
63. Capability-bound LSP Code Action resolve for bounded data-backed quick
    fixes, with edit-only client support, 16-request admission, stable action
    identity, deny-all command policy, opaque-data confinement, real
    TypeScript Fix All execution, and hash/count-only Agent/HTTP/Web/Replay
    evidence.
64. Preview-bound coordinated Code Action application with one mutually
    exclusive same-Run capability per alternative, sibling invalidation,
    shared CAS/staging/fsync/rollback transaction, fresh before/after
    diagnostics, linked tests, command denial, and body-free Agent/HTTP/Web/
    Replay evidence.
65. Run-owned external source-map debugging for compiled TypeScript with
    explicit original/program/map bindings, bounded single-source v3 parsing
    inside the private adapter, original-coordinate breakpoints and stack/step
    frames, complete three-file freshness, schema-v2 Agent/HTTP/Web/Replay
    evidence, and no compiler, network, Inspector TCP, or write authority.
66. Monorepo-aware write-linked test selection over declared workspace package
    names and safe TypeScript path aliases, with bounded no-follow
    loaded-or-missing config discovery, inherited project applicability,
    typed reverse edges, reachable-only incompleteness, exact config freshness,
    real cross-package Vitest execution, and path/body-free Agent/HTTP/Web/
    Replay evidence.
67. Capability-inherited coder candidate commands using the existing
    explicit-argv Node runner against only private unmerged bytes, with fixed
    environment, denied network, read-only dependency overlay, bound runtime
    identities, eight-attempt and time/output limits, shared mutation ordering,
    complete before/after snapshot equality, fail-closed read-only violation,
    independent fresh/stale status, and argv/output/path-free
    Agent/HTTP/Web/Replay evidence that never counts as verification.
68. Capability-inherited private coder semantic LSP using existing one-shot
    symbols/definition/references/rename/Code Action runners and WorkspaceEdit
    coordinators, with complete read-snapshot equality, exact file-grant
    filtering before apply-capability issuance, deny-all Code Action commands,
    shared candidate operation ordering, fail-closed uncertain mutation,
    same-Run previews, real two-file rename Dogfood, and no new durable
    evidence stream. Nested packages outside declared workspaces keep nearest-
    package test scans while declared workspace changes retain monorepo-wide
    reverse-dependency discovery.
69. Capability-inherited private coder Node DAP using the existing debugger and
    a private-protocol-only candidate Process scope, with shared Process
    admission, read-only/offline Sandbox execution, Thread/Run and manager-local
    ownership, serialized complete candidate snapshot checks, source/program/
    map/module/toolchain freshness, cleanup-before-drift ordering, fail-closed
    write detection, live-only debugger data, path-free Process evidence, and
    real breakpoint/evaluation/step/merge Dogfood.
70. Preview-bound Workflow node step control using schema-v5 experiment
    projections and the existing persistent breakpoint scheduler, with every
    remaining rerun node held in Manifest order, exact one-node release across
    parallel-ready branches, continued-but-unsettled restart recovery,
    CLI/HTTP/SDK/RPC/Web delivery, independent browser validation, portable
    Replay, and real built-CLI four-node Dogfood.
71. Sandboxed JavaScript Workflow Session nodes using the existing managed
    Process/Kernel private protocol, with 1–8 content-hashed cells sharing
    state only inside one leased Run, typed input/output bounds, frozen Agent
    capability and policy checks, cancelled-and-unchanged settlement,
    explicit-only retry after interruption, body-free completion evidence,
    checkpoint reuse/rerun, complete CLI/SDK/HTTP event reconciliation, and no
    production direct-process fallback.
72. Selector-free top-level Workflow input replacement using schema-v6
    controlled re-execution, with complete Schema validation, zero source-node
    reuse, whole-Manifest Tool-effect confirmation, ordinary scheduler input,
    lineage-bound recovery and comparison, CLI/SDK/RPC/HTTP/Web delivery, and
    body-free experiment Trace.
73. Sandboxed restricted Python Workflow Session nodes using the existing
    fixed Python Kernel and managed Process protocol, with immutable canonical
    JSON input, exact 32 KiB JSON result projection independent of `repr`,
    compact intermediate records, private-only 96 KiB protocol output,
    runtime/configuration/memory-bound body-free evidence, commit-gap recovery,
    explicit-only stateful retry, checkpoint reuse/rerun, CLI/SDK/RPC/HTTP/Web
    delivery, and no package, file, network, subprocess, or host fallback.
74. Hash-bound bounded DataFrame transformation over the shared
    JSON/JSONL/CSV/TSV/Markdown parser, with explicit cast/filter/select/sort/
    group/limit plans, homogeneous comparison and finite aggregation semantics,
    complete 1,000-row/256 KiB table JSON, source-drift rejection,
    Agent/Workflow/Artifact reuse, privacy-bounded Replay/Trace, and no
    expression, package, process, filesystem-write, or network authority.
75. A Store-free `napier doctor` preflight with canonical workspace/runtime,
    optional model credential presence, bounded real Search/Fetch/Browser and
    OS Sandbox probes, fixed privacy-safe recovery codes, total cancellation,
    hash-bound human/JSONL reports, and no workspace state creation.

`observe` permits only in-process read operations, including bounded DataFrame,
AST query, and edit preview. `workspace` additionally
permits individually enabled hash-bound edits, read-only structured
verification, read-only/offline TypeScript LSP diagnostics/symbols/navigation/
rename/quick-fix previews, preview-bound coordinated rename or selected
quick-fix application, explicit-argv command execution, persistent synchronous
JavaScript and restricted Python calculations, Run-owned Node launch debugging,
and bounded background Process Session lifecycle control plus preview-bound
writes to explicit existing scopes and optional same-scope failure
compensation.
`unrestricted` additionally permits an explicitly enabled controlled Browser
Session and Research Source citations derived from its active page. It does
not expose a shell, arbitrary host networking, an existing user browser
profile, or unrestricted local files; known destructive command patterns
remain denied.

An in-process policy is not a sandbox. General shell and package installation
remain disabled. Stdio MCP, workspace verification, the command runner, and
Workspace Process Sessions, including the JavaScript/Python kernels and Node
debugger, use narrow macOS sandbox-exec or Linux Bubblewrap adapters; a
container or VM remains the recommended outer boundary for production
third-party code.

## Capability Roadmap

The current priority and acceptance state is maintained in
[`next-stage-gap-matrix.md`](next-stage-gap-matrix.md). Distributed work stays
deferred until the local P0-P9 product loop is stable.

### Layer 1: Local execution and architecture

- extend bounded Workspace Process Sessions beyond identity-checked observed
  descendant cleanup with kernel-enforced rapid double-fork containment,
  cross-restart reattachment, and remote scoped-write backends;
- extend restricted Python into package-backed data/Notebook sessions and add
  managed tool callbacks without weakening Run ownership or Sandbox boundaries;
- hard CPU/memory/process quotas through managed OCI or equivalent isolation;
- domain extraction from the oversized Server and Store modules;
- extend the checked local CLI/Runtime/tool/1,000-event/SQLite performance
  budget to external Providers, HTTP, browser sessions, 10,000-event Threads,
  and enforced process resource quotas.

### Layer 2: Coding and workflow

- broader Code Action kinds, Node attach/multi-thread DAP, inline or bundled
  source-map coverage and debugger UX, broader multi-node AST transforms,
  richer cross-package build/test configuration, coding outcome benchmarks,
  coder directory lifecycle, and child package-script/Python/persistent
  execution;
- extend typed Agent/Deterministic/JavaScript/Python/Tool/Approval DAG execution
  with package-backed Python/Notebook Sessions, cross-node handles,
  graph-level branch pruning, write-capable Map/Loop, compensation,
  write/session side-effect simulation, external Agent adapters, and a visual
  builder;
- extend controlled Workflow, user-message, model-call, and stateless read-only
  tool-call re-execution with stateful/write checkpoints and result simulation,
  Prompt/Skill/Memory/environment replacement, batch experiments, interactive
  root-cause views, and evaluation promotion.

### Layer 3: Product and outcome proof

- add authenticated remote transport, a full-screen TUI, ACP, Desktop,
  persistent browser UX, and broader data/research capability slices over the
  same Runtime and Ledger;
- add explicit dynamic catalog refresh, subscription login UX, custom
  OpenAI-compatible Provider manifests, local-server discovery, and
  evaluation-backed routing over the pinned Pi Provider core;
- stable Extension developer APIs, ecosystem discovery, and compatibility
  tests;
- broaden fixed Capability & Outcome benchmarks across task success, recovery,
  cost, latency, security, installation, and Web onboarding UX.

### Deferred: team and distributed

- Postgres, distributed workers, cross-host leases, multi-user RBAC, and
  collaboration begin only after the local acceptance gates hold.
