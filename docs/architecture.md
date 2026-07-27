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
- tool assembly, canonical workspace-path checks, hash-bound atomic editing,
  sandboxed structured verification, and last-moment policy checks;
- standard Agent Skills discovery;
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
- transactional SQLite thread, run, and event persistence with legacy
  JSON/JSONL migration.

The runtime has no HTTP or React dependency.

### Server

`@napier/server` is a thin Hono adapter:

- REST for snapshots and mutations;
- bounded, strictly parsed Thread creation, Branch creation, Goal, Resume,
  Prompt, and Trace export requests;
- bounded, strictly parsed Plan creation, step transition, and artifact
  settlement requests;
- bounded full-thread fixture import and attachment export;
- no-store, hash-addressed evaluation gate receipt export for CI;
- no-store evaluator calibration reports with stable content hash headers;
- no-store reviewer consensus previews plus explicit atomic resolution;
- bounded, no-store Evaluation Casebook calibration, artifact, and
  qualification-receipt export;
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
- adapter-normalized authenticated webhook ingestion and background schedule,
  channel, and safe recovery workers;
- same-origin static hosting for production;
- provider secret values remain process-local and are never serialized.

Disconnecting an SSE client does not cancel a run. Runs are durable operations;
explicit cancellation uses the stop endpoint.

### Workbench

`@napier/web` maintains a projection of server state. It may optimistically
display transient model deltas, but completed messages and run state are
replaced by the final server snapshot.

The UI has ten primary projections:

- **Ledger**: user-visible messages;
- **Trace**: lifecycle, model, tool, goal, subagent, and system evidence plus
  metadata-only OpenTelemetry export and archived-artifact verification for a
  complete Thread or one Run;
- **Run Lab**: immutable per-run replay, portable full-thread fixtures,
  configuration drift, run deltas, snapshot-bound verdicts, and revisioned
  multi-candidate quality gates with case evidence, append-only human truth,
  independent reviewer panels, evaluator/rubric calibration matrices,
  workspace-wide gold-set Casebooks, source-verified evaluator qualification,
  execution history, portable gate receipts, trust anchors, signed envelopes,
  public verifier anchor directories, and qualification baselines;
- **Plan**: dependency DAG, step evidence, blockers, artifact manifests,
  portable Plan archive verification, reusable blueprint export/upload
  verification, and a local template shelf for saving, archiving, restoring,
  and replaying workflow blueprints;
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

Trace, Plan, Run Lab, Evaluation Suite, Memory, Extensions, Context, and
Automations are separate browser chunks. Their forms and mutation clients
remain inside those lazy boundaries so the primary Workbench entry stays under
its 150 kB budget.

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
runtime-environment receipt, Web dist receipt, and Web dist manifest into one
`napier.release-artifacts-audit` receipt. It stores only artifact kinds,
repo-relative paths, SHA-256 values, validity booleans, package name/version,
and a canonical artifact-set digest. Verification re-runs the component receipt
verifiers and fails if any underlying artifact or the aggregate receipt drifts.

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
trust state.
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
bound to that key.

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
canonical manifest of the enabled Skill files loaded for that Run. The manifest
contains requested/loaded/missing Skill names, relative `SKILL.md` paths,
byte counts, diagnostics hash, and file SHA-256 values; it never stores Skill
instruction text. The Agent records the same manifest as a `context.skills`
debug event before model execution, so replay comparison can detect Skill
content drift even when the enabled Skill names did not change.

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
Credential ledger events contain only reference ID, provider, label, source
type, status, availability, revision, and a sanitized error. Environment-
variable names and Keychain locators are metadata; submitted or resolved
values exist only in memory for the vault operation or provider call.

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
Anthropic, Google, the deterministic demo model, and unknown providers each
use explicit strategy IDs. The same projection carries reported cost,
price-table estimated cost, `budgetCostUsd`, cost strategy, price table ID, and
price table SHA-256. `maxCostUsd` uses `budgetCostUsd` when present and raw
reported cost otherwise; known providers use a conservative max(reported,
estimated) value, while unknown providers remain provider-reported. Wall time
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

## Workspace Edit Flow

General shell execution and unconstrained file writes are not Agent tools.
The only built-in write primitive is hash-bound, structured `apply_patch`:

```text
read_file
  -> resolve the target's canonical realpath inside the workspace
  -> reject external symlinks, non-files, invalid UTF-8, and oversized input
  -> return requested lines plus complete-file size and SHA-256
apply_patch create
  -> require workspace policy + enabled tool + expectedSha256 null
  -> require an existing safe parent and a missing target
apply_patch replace
  -> require workspace policy + enabled tool + complete expected SHA-256
  -> require every oldText to occur exactly once in the evolving buffer
both operations
  -> reject .git / .napier / node_modules and symlink path components
  -> cap output at 256 KiB and reject null bytes or no-op output
  -> acquire a per-target dataRoot lock, recovering only a dead owner's lock
  -> re-read and recheck the precondition immediately before commit
  -> fsync a same-directory temporary file
  -> atomically link a new file or rename over an existing file
  -> fsync the parent directory
  -> append tool.completed with path, byte counts, and both content hashes
```

This lock serializes Napier runtimes on one host; the second writer fails or
observes a stale hash instead of silently overwriting the first. External
processes do not honor the lock, so the final precondition recheck narrows but
cannot turn a local filesystem into distributed consensus. File deletion,
directory creation, and permission changes are intentionally outside this
tool. Subagents call the read-only tool factory and never receive
`apply_patch`.

## Workspace Verification Flow

Napier does not expose a general shell for build validation. The
`verify_workspace` tool is a closed dispatcher for three local verifiers:

```text
model requests typecheck / test / format
  -> require non-observe policy + enabled verify_workspace tool
  -> validate a workspace-relative cwd, optional target, and 1-120 second budget
  -> canonicalize cwd, target, current Node, and the fixed workspace-local CLI
  -> construct Napier-owned arguments without consulting package scripts
  -> launch with process.spawn + workspace.read only
  -> keep the workspace read-only and networking disabled in the OS sandbox
  -> cap stdout and stderr independently at 32,000 characters
  -> terminate the isolated process group on timeout, cancellation, or output cap
  -> append structured status and output digests to tool.completed
```

The fixed entrypoints are TypeScript's `tsc`, Vitest's `vitest.mjs`, and
Prettier's `prettier.cjs` under the workspace `node_modules`. Typecheck always
adds `--noEmit`; Vitest runs with a bounded two-worker thread pool; Prettier
uses `--check`. The child environment is exactly `CI=1`, `FORCE_COLOR=0`, and
`NO_COLOR=1`. A non-zero exit is a normal `failed` verification result, not a
successful check or a hidden transport exception. `timed_out` and
`output_capped` remain separately queryable outcomes.

The result records kind, sandbox, workspace-relative cwd and target, duration,
exit code, signal, character counts, truncation flags, and independent
stdout/stderr SHA-256 digests. Full bounded output is returned to the Agent;
the structured details are retained in Trace. Subagents remain read-only and
never receive the verifier.

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

Replay is evidence export, not tool re-execution:

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
  -> mirror no-store response content hash, stable snapshot hash,
     event-stream hash, run/thread IDs, event count, first/last event sequence,
     usage/cost, duration, model/tool/message/subagent counts, and output-text
     hash headers
verify replay snapshot (maximum 10 MiB, no mutation)
  -> strictly parse the verify wrapper: only snapshot is accepted
  -> recompute event-stream hash, metrics, assistant-output hash, and content hash
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
schema 2 adds recovery policy and execution mode. A schema-1 Run compares
normally but is never automatically recovered.

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
  -> encode timestamps as decimal nanoseconds and scalar AnyValue attributes
  -> validate IDs, parent graph, temporal containment, schema, and counts
  -> bind source range/hash + redaction policy + OTLP request to content SHA-256
  -> append trace.otlp.exported with only scope, IDs, counts, and hashes
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
  -> persist before appending a hash-only qualification.completed event
```

Execution validation recomputes aggregates and the canonical hash, enforces
rubric-complete 1–5 scores for conclusive verified judgments, and prevents an
unverified source from carrying a substantive verdict. The demo model remains
verified evidence but returns an inconclusive judgment. A qualification
receipt includes the complete Casebook plus only the latest execution for its
current revision; after any Casebook revision it emits `not_run` rather than
borrowing history. The receipt is integrity evidence, not a signature.

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
  -> mirror no-store bundle content hash, event-stream hash, thread ID,
     run/event counts, and first/last event sequence headers
verify fixture (maximum 10 MiB, no mutation)
  -> strictly parse the verify wrapper: only bundle is accepted
  -> run the same schema, reference, event-stream, and content-hash validation
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
  -> strip ordinary trigger IDs and all lease ownership
  -> close claimed/running recovery attempts as imported terminal evidence
  -> convert queued/running Runs to interrupted
  -> convert running plan steps to blocked and active subagents to cancelled
  -> commit the complete projection and event batch atomically
  -> persist source hashes, source event count, and import time on the Thread
```

Imported history is an external evidence artifact, not a trusted instruction
source. Live model context marks every imported sequence as untrusted
historical data and adds a system-level boundary containing both source hashes.
Claims of tool effects and embedded requests require current verification.
Imported provenance is also an unconditional automatic-recovery blocker; an
imported interrupted Run can only continue through explicit operator action.

## Delegation Flow

```text
parent tool call
  -> validate enabled role and remaining run budget
  -> persist pending SubagentTask + subagent.queued
  -> wait on the per-run concurrency semaphore
  -> start an isolated Pi Agent with only the delegated prompt
  -> expose read-only workspace tools, never delegate_task
  -> persist assistant/tool steps, usage, turns, and terminal outcome
  -> return bounded evidence to the parent as a tool result
```

Researcher, reviewer, and general roles have separate system prompts. A
subagent does not inherit the parent transcript, reviewed memory, or skills.
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

```text
create_plan
  -> validate stable IDs, dependency references, and an acyclic step graph
  -> mark root steps ready and dependent steps pending
  -> derive criticalPathStepIds, readyStepIds, blockedStepIds, and
     replanRecommendation
replan_plan
  -> compare expectedRevision against the current durable plan revision
  -> require a strategy, reason, and concrete evidence
  -> supersede stale steps / artifacts, redirect dependencies, and append
     replacement steps / artifacts in one Store mutation
  -> hash the added plan slices and dependency-update set
  -> start a ready step under a same-Thread running run
  -> settle completed / blocked / skipped only with explicit evidence
  -> promote newly unblocked dependents
  -> refresh critical-path scheduling projection and active / blocked /
     completed plan state
```

Late callbacks cannot overwrite terminal step or artifact outcomes. An explicit
`reopen` transition is required to revisit a terminal step. Startup
reconciliation changes a step owned by an interrupted run from `running` to
`blocked`, records its outcome as unknown, and appends one
`plan.step.blocked` event. Plan events, internal planning tool results, and the
Paper Ledger Plan Workbench expose the same critical-path, ready-step, and
blocked-step projection so the next schedulable work is visible without
recomputing the DAG in each consumer. If there is no ready or running step,
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
An active recommendation can also be reviewed from the Plan Workbench by a
live model through a no-store
`napier.execution-plan-replan-draft-review` artifact. That review hashes the
model-review input, prompt, parsed response, deterministic evaluation,
recommendation, and draft; `napier/demo` fails closed as inconclusive. The
Agent or operator still has to submit the draft through the normal
revision-CAS replan flow before state changes; the Plan Workbench exposes that
application as an explicit action beside model review. Replans are bounded
history entries on the same ExecutionPlan: they record the strategy, revision
range, affected IDs, and SHA-256 digests for added steps, added artifacts,
dependency updates, and the complete replan record. A stale expected revision
fails as a conflict before any plan mutation is committed.

Plan REST responses are no-store and response-hash-bound:

```text
list plans
  -> hash the returned plan array exactly as served
  -> mirror thread ID, plan count, per-status counts, step/artifact counts, and
     accumulated replan count
create/replan/step/artifact mutation
  -> hash the returned ExecutionPlan exactly as served
  -> mirror thread ID, plan ID, status, revision, step/artifact/replan counts,
     critical-path/ready/blocked counts, and active recommendation digest when
     present
review replan draft
  -> expose reviewSha256 as the content digest
  -> mirror thread ID, plan ID, expected revision, recommendation/draft/
     deterministic-evaluation hashes, verdict, risk, and score
export plan archive
  -> build napier.execution-plan-archive from the current ExecutionPlan plus
     ordered plan-scoped Ledger events
  -> expose stable content hash, event-stream hash, plan revision/status,
     resource counts, and event-boundary headers without mutating state
verify plan archive
  -> strictly parse a single archive, recompute stable content and event-stream
     hashes, validate plan/event ownership, bind to the URL Thread and Plan,
     and return no-store valid/invalid diagnostics
export plan blueprint
  -> distill the current archive into napier.execution-plan-blueprint:
     objective, step DAG, artifact declarations, source plan revision, archive
     hash, and event-stream hash
  -> exclude runtime statuses, evidence prose, blockers, and file digests
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
     artifact; rehash the review, require it to match current outcomes, current
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
the runtime state machine is called. Every accepted state change is appended
to the Thread ledger.

## Context Compaction Flow

```text
conversation projection exceeds message or character budget
  -> find the newest checkpoint whose source and summary hashes still verify
  -> retain the newest raw messages within the active model budget
  -> send only the previous checkpoint plus newly covered evidence to a
     no-tool compactor
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

The current boundary has twenty-one parts:

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
    refresh claims, revision CAS, and publisher-signed directory metadata;
    fail-closed promotion preserves the active verifier set across rejected,
    failed, or stale rotations.

`observe` permits only in-process read operations. `workspace` additionally
permits enabled hash-bound edits and read-only structured verification.
`unrestricted` is reserved for future sandboxed shell execution, but known
destructive command patterns are still denied.

An in-process policy is not a sandbox. General shell and package installation
remain disabled. Stdio MCP and workspace verification use narrow macOS
sandbox-exec or Linux Bubblewrap adapters; a container or VM remains the
recommended outer boundary for production third-party code.

## Capability Roadmap

### Layer 1: Reliable local runtime

- a Postgres backend for distributed workers;
- generated OpenAPI/JSON Schema artifacts and compatibility fixtures for
  external management-plane clients.

### Layer 2: Long-horizon work

- durable activation-decision history and replay, so signed baseline approvals
  can be exported, verified, and compared across workspaces before trust-state
  promotion.

### Layer 3: Extension fabric

- a Windows sandbox adapter with Job Object/AppContainer enforcement;
- Linux Secret Service and Windows Credential Manager write adapters.

### Layer 4: Operations and evaluation

- resumable distributed run workers and cross-host delivery claims;
- additional authenticated SaaS channel adapters beyond GitHub/Slack/Linear and
  policy templates.
