# Napier

Napier is a local-first, glass-box agent runtime for work that takes more than
one prompt. It combines a small extensible agent core with durable goals,
workspace-scoped tools, replayable event ledgers, and an inspection-first UI.

The product takes inspiration from:

- [Pi](https://github.com/earendil-works/pi): a small runtime, unified model
  API, composable tools, and standard skills.
- [LLM Space](https://github.com/deer-flow/llm-space): local-first agent
  prototyping, trace inspection, replay, and evaluation.
- [DeerFlow](https://github.com/bytedance/deer-flow): long-horizon goals,
  context governance, sandboxes, memory, subagents, and operational APIs.
- [Deer Workflow](https://github.com/deerwork-ai/deer-workflow): workflow-style
  decomposition, durable handoffs, and inspectable multi-step execution.
- [Oh My Pi](https://github.com/can1357/oh-my-pi): Hashline editing,
  independent passive advisors, narrow reviewer tool scopes, and resilient
  model-side control loops.

Napier is not a fork of any of them. Its distinguishing primitive is the
**work ledger**: messages, model calls, tools, goals, branches, artifacts, and
runtime decisions share one ordered evidence stream.

## Current Slice

Version `0.1.0` includes:

- a Pi-powered multi-provider runtime for OpenAI, Anthropic, Google, and
  OpenRouter;
- a deterministic zero-key demo model for onboarding and CI;
- an authoritative SQLite WAL that commits workspace projections and ordered
  events atomically, uses revision CAS for concurrent local writers, and
  migrates legacy `workspace.json`/JSONL state without evidence loss;
- replayable threads and branch creation from any message sequence;
- durable goals with independent evidence evaluation, bounded automatic
  continuation, and no-progress breakers;
- bounded strict JSON parsing for Thread creation, Branch, Goal, Resume,
  Prompt, and Trace export requests before runtime state mutation, evidence
  copying, or model execution;
- bounded strict JSON parsing for schedule, inbound-channel, Memory,
  Credential, Receipt Trust, signed receipt, Agent profile, MCP Extension
  management, package signing/rollout governance, Run Evaluation, reviewer
  consensus, Evaluation Suite administration, and Evaluation Casebook
  mutation/qualification before state mutation, model judging, signing, tool
  exposure, or background workers can claim new automation work;
- revisioned parent-Run budgets for model turns, total tokens, reported model
  cost, and wall time, snapshotted onto every Run with fail-closed Ledger
  evidence;
- workspace-confined read, list, and literal search tools with canonical
  realpath checks and complete-file SHA-256 evidence;
- a hash-bound `apply_patch` tool for atomic UTF-8 file creation, exact
  replacement, and Hashline-style line-anchor replacement under the explicit
  `workspace` policy, without general shell or file deletion;
- configurable deterministic Model Advisor notices that scan assistant text for
  risky verification claims or destructive command references, then record only
  hash-bound diagnostics before the assistant message is shown, with optional
  bounded tool-free correction and fail-closed enforcement for blocker-level
  findings;
- a `verify_workspace` tool for bounded TypeScript, Vitest, and Prettier checks
  through the OS sandbox with a read-only workspace, no network, no shell, and
  fixed local CLI entrypoints;
- a fail-closed tool policy that blocks host escape and destructive commands;
- Agent Skills discovery through standard `SKILL.md` packages;
- Ed25519-signed Skill package baselines that bind enabled `SKILL.md` file
  paths, sizes, diagnostics, and SHA-256 values without copying Skill
  instructions;
- reviewed Skill package installation baselines that persist a qualified
  signed catalog as local approval evidence and require explicit replacement
  confirmation, with no-store status/count/hash headers for polling;
- reviewed Skill content install/replace flow that writes `SKILL.md` only
  after preview-hash confirmation and records hash-only audit evidence with
  review/content/frontmatter/body SHA-256 headers;
- Ed25519-signed Prompt package baselines that bind an Agent revision hash and
  System Prompt SHA-256 without copying prompt text, plus qualification against
  the current Agent profile and no-store verification/qualification headers;
- Ed25519-signed Inspector package baselines that bind the Workbench Inspector
  catalog, panel capabilities, default panel, and catalog SHA-256 without
  copying user data or UI source, with status/panel-count/hash headers;
- model-extracted memory proposals with explicit human review, agent scoping,
  configurable review intervals, automatic stale exclusion, per-Run usage
  evidence, immutable correction supersession, atomic multi-source
  consolidation, bounded injection, and audit events;
- isolated researcher, reviewer, and general subagents with read-only tools,
  bounded run budgets, cancellation, strict typed outcomes, and hash-bound
  delegation receipts;
- reviewed Streamable HTTP MCP connections with provenance, capability and
  per-tool effect approval, local routing hints, deferred schema search, Agent
  enablement, no-store extension state headers, and last-moment policy checks;
- sandboxed stdio MCP on macOS and Bubblewrap-enabled Linux with absolute
  executables, explicit environment mapping, capability-derived
  filesystem/network rules, bounded JSON-RPC, and fail-closed unsupported
  platforms;
- a lazy Extensions Workbench for HTTP/stdio transport selection, one-argument-
  per-line stdio configuration, workspace-scoped cwd, secret-free environment
  source mappings, and review of both requested and transport-derived
  capabilities before approval;
- Ed25519-signed MCP Extension packages with environment-backed local
  publishers, verify-only SPKI anchors, irreversible revocation, dual
  manifest/envelope hashes, frozen transport/capability/tool-effect catalogs,
  reviewed routing hints, canonical non-symlink stdio executable SHA-256
  evidence, and no-store publisher trust headers for anchor state/count polling;
- a Publisher & Package Desk for signer enrollment, two-step revocation,
  signed JSON download, offline verification, and trusted import that always
  creates a new pending Extension rather than inheriting local approval;
- reviewed in-place signed package updates with deep frozen-manifest diffs,
  package-binding compare-and-swap, explicit publisher/rollback confirmation,
  append-only package history, and mandatory local approval reset;
- signed SemVer dependency ranges plus bounded multi-package deployment with
  dependency-first ordering, whole-plan compare-and-swap, atomic install/update,
  transitive revocation settlement, call-time graph revalidation, and no-store
  deployment preview/apply headers for hash/count polling;
- self-contained signed Extension package lockfiles that export an installed
  dependency-closed package set with stable content SHA-256, offline
  verification, and replay through the same atomic deployment review gates;
- policy-bound signed package rollout channels that pin a named lockfile,
  allowed package names, publisher keys, package count, and dependency closure
  before replaying through deployment CAS;
- signed Extension package channel indices that export rollout-channel
  summaries, lockfile hashes, optional lockfile locators, policy hashes, and
  package-envelope set hashes as offline-verifiable registry evidence without
  shipping package envelopes or local approvals;
- renewable run leases with token hashes at rest, worker-only lease handles,
  heartbeat enforcement, deterministic trigger IDs, and lease-gated
  finalization;
- no-store ThreadDetail snapshots, including create/import/goal/branch responses,
  with content SHA-256 plus run/event/plan/evaluation/subagent/recovery count
  headers for operator polling;
- no-store Thread event projections with content SHA-256, requested `after`
  sequence, event count, and first/last sequence headers for incremental
  polling;
- durable interval and UTC cron schedules with claims, overlap suppression,
  bounded misfire handling, restart-safe advancement, and ledger evidence for
  every outcome;
- authenticated inbound webhook channels with Napier JSON, GitHub webhook,
  Slack events, and Linear webhook adapters, one-time bearer tokens, hashed
  idempotency keys, durable deliveries, exact duplicate receipts, and background
  draining;
- evidence-backed delivery attempts with bounded pre-run exponential backoff,
  operator-confirmed retries for failed or unknown outcomes, and distinct
  attempt trigger IDs;
- revisioned per-channel retry policies that are snapshotted onto each accepted
  delivery, plus hash-bound dead-letter exports that omit queued messages and
  authorization material;
- restart-safe orphan-run reconciliation, explicit operator Resume, and
  Agent-level opt-in automatic recovery that only claims hash-proven
  side-effect-free interruptions, uses the frozen Agent revision, and executes
  linked child Runs through a reduced local read-only tool surface;
- immutable self-contained per-run replay snapshots with ordered event-stream
  SHA-256, stable content SHA-256, Subagent evidence, prompt-redacted
  configuration fingerprints, no-store verification preflight, response
  hash/count headers, right-minus-left metrics, output hashes, and
  tool/event/configuration deltas plus no-store comparison response summaries;
- portable full-thread replay fixtures that bind Agent, Runs, plans,
  evaluations, append-only human adjudications, reviewer ballots, consensus
  resolutions, evaluation suites and executions, automatic-recovery
  assessments and attempts, subagents, and the complete ordered event stream
  to independent content/event SHA-256 digests, with atomic import and
  collision-free ID remapping;
- OpenTelemetry-compatible OTLP/JSON trace export for complete Threads or
  individual Runs, with deterministic trace/span identities, GenAI semantic
  attributes, metadata-only redaction, stable artifact hashes, no-store
  verification preflight, and hash-only export evidence;
- no-tool rubric evaluation that preserves the exact rubric and both evaluated
  evidence hashes, with malformed or unavailable evaluators failing closed;
- reviewed evaluation adjudication that binds every human truth revision to
  the immutable pair-evaluation SHA-256, preserves semantic no-ops, and
  exposes no-store evaluation/adjudication list and calibration headers for
  evaluator/rubric-scoped agreement rates and complete verdict confusion
  matrices;
- independent reviewer ballot lanes with append-only revisions, configurable
  quorum/agreement policy, explicit consensus resolution, hash-bound promotion
  into Human Truth, and no-store reviewer/consensus count headers;
- workspace-wide Evaluation Casebooks that curate reviewed judgments across
  Threads into append-only gold-set revisions, store each immutable case
  snapshot once, and expose hash-bound calibration artifacts;
- executable Casebook qualification that rebuilds source replay evidence,
  verifies both frozen snapshot hashes, re-judges the current manifest with a
  selected evaluator, and emits current-revision-only qualification receipts;
- Ed25519 trusted receipt provenance with environment-backed local signers,
  verify-only public anchors, irreversible revocation, offline envelope
  verification, and append-only passing qualification baselines;
- revisioned evaluation suites that compare one baseline against 1–8 settled
  candidates, reuse immutable pair evaluations, bind every case and aggregate
  verdict to canonical SHA-256 evidence, and apply explicit pass-rate, score,
  and inconclusive quality gates, with self-contained CI gate receipts;
- incremental context compaction that keeps recent raw messages, verifies
  source and summary hashes, reuses checkpoints across runs, and records
  explicit fallback evidence when summarization fails, with hash-bound
  checkpoint calibration for coverage, compression, drift, and fallback
  omission signals, with no-store count/rate headers for CI polling;
- durable dependency-aware execution plans with persisted critical-path,
  ready-step, and blocked-step projections, evidence-gated step transitions,
  governed revision-CAS replanning, hash-bound replan recommendations for
  blocked critical paths and missing artifacts, generated replacement-plan
  drafts that can be fed back through replan CAS, deterministic draft
  evaluation scores with risk and evidence hashes, no-store hash-bound model
  review artifacts for active drafts plus explicit draft application from the
  Plan Workbench, model/thinking-specific replan policy templates in Agent
  tool output, hash-bound Plan archive export plus no-store archive
  verification, no-store Plan REST response hashes and plan/replan count
  headers, reusable workflow blueprint export/upload verification, a local
  Workflow Blueprint Library with active/archived template replay, hash-only
  replay history and current delivery-outcome export/upload verification,
  bounded Plan REST input validation, orphan-run reconciliation, internal Agent
  tools, and file or directory artifact verification against actual workspace
  bytes, including public `observeWorkspace` Plan artifact updates that reject
  self-reported digests;
- revisioned Agent profiles for the default model, thinking level, tool policy,
  workspace tools, skills, delegation roles, parent-Run limits, bounded
  subagent budgets, and snapshot-bound interruption policy;
- a hash-bound Agent configuration ledger that retains every semantic profile
  revision, migrates legacy SQLite state, previews field-level rollback, and
  restores history only by creating a new revision;
- secret-free provider credential references backed by named environment
  variables or macOS Keychain service/account locators, with explicit
  availability checks and fail-closed resolution;
- an HTTP API with live SSE run streaming;
- a responsive Paper Ledger workbench with Trace, Run Lab, Plan, Goal, Memory,
  Extensions, Automations, and Context inspectors; Run Lab exports and imports
  complete portable ledgers, runs revisioned Evaluation Suite quality gates,
  and exposes a human-truth calibration ledger plus executable gold-set
  qualification in addition to per-run evidence, while Context can sign,
  verify, qualify, and install hash-only Skill baselines, review/apply actual
  `SKILL.md` content writes, and transfer Prompt packages for the current
  Agent. Trace exports metadata-only OTLP archives and verifies archived trace
  JSON against the active Thread without mutating Ledger state.

The current release is intentionally local and single-user at the product
boundary, while its store safely serializes multiple local runtime instances.
General shell execution, automatic managed package upgrades, additional SaaS
inbound adapters beyond GitHub/Slack/Linear, and distributed multi-host workers
are next-layer capabilities, not simulated features.

## Quick Start

Prerequisite: Node.js `>=22.19.0`.

```bash
npm install --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:5173`. The demo model works without credentials.

For a production build served by the API process:

```bash
npm run build
npm start -w @napier/server
```

Open `http://127.0.0.1:8787`.

## Live Models

Napier resolves credentials on the server. Keys are never persisted in Napier
or returned to the web client.

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."
export OPENROUTER_API_KEY="..."
```

Then open **Context → Provider credentials** and register the corresponding
environment variable name, such as `OPENAI_API_KEY`. On macOS, the reference
may instead name an existing Keychain service and account, or write a secret
to that Keychain item once through the bounded vault-write API. Napier stores
only the locator and clears the submitted secret from the web form after the
request completes.

An active reference is resolved only when needed and can be checked, disabled,
or re-enabled independently. If it is missing, model authentication fails
closed rather than falling back to ambient credentials. The active Agent
profile defaults to `napier/demo`; Context separates the next-run model from
the revisioned persistent default.

Credential list, registration, Keychain write, availability check, and status
responses are no-store and hash-bound. Headers mirror only provider ID, source
type, status, availability, revision, last-check time, and aggregate counts;
they do not repeat environment-variable names, Keychain locators, or secrets.

Copy [`.env.example`](./.env.example) for the complete environment surface.

## Signed Extension Packages

Open **Extend → Publisher & package desk** to register either a local Ed25519
signer or a verify-only publisher. A local signer stores only its normalized
SPKI public key, SHA-256 key ID, status, label, and the name of an environment
variable containing a PKCS#8 private key. Private bytes are read only while
signing, checked against the anchor, and never enter SQLite, REST responses, or
Ledger events.

Signing requires a connected MCP catalog whose every tool has a reviewed
`read` or `write` effect. The manifest freezes publisher/name/version,
canonical transport, requested capabilities, sorted tool names and schema
hashes, reviewed effects, reviewed routing hints when present, optional
canonical package dependencies, creation/optional expiry, and, for stdio, the
canonical absolute executable path, byte size, and streamed SHA-256.
Dependency ranges support exact SemVer, `*`, caret, tilde, and explicit
comparator intersections such as
`>=1.4.0 <2.0.0`; opaque versions never satisfy a dependency. Stdio hashing
rejects symlinks, non-files, files over 256 MiB, and size/mtime/inode changes
during the read. The Ed25519 statement binds both the stable manifest content
SHA-256 and the complete manifest artifact SHA-256; the outer envelope has its
own SHA-256 and is bounded to 4 MiB. Dependency-bearing manifests use schema
2; schema 1 remains valid only for dependency-free packages.

Routing hints are local review metadata, not MCP-server-discovered authority.
The Agent-visible tool description labels them separately from the untrusted
server description, and imported packages must still pass local tool review
before any signed hint can influence model routing.

Import verifies the complete envelope against a currently trusted key before
mutating state. It rejects unknown, revoked, expired, malformed, duplicate, or
tampered packages and creates a new `pending` Extension with no approved
capabilities, tool approvals, or Agent enablement. **Signed does not mean
approved**: publisher verification, source/capability review, per-tool effect
review, and Agent enablement remain independent gates.

An installed signed Extension can be updated without changing its Extension
ID. Napier first verifies the candidate and presents a no-store deep diff of
publisher/key, version direction, metadata, transport, executable evidence,
capabilities, tools, schemas, effects, reviewed routing hints, lifecycle, and
signature. Strict SemVer regressions or opaque version transitions require an
explicit version override; publisher or key changes require a separate
confirmation.

Applying an update re-verifies and recomputes the preview inside one
SQLite-CAS mutation using the current package-binding SHA-256. It rejects stale
reviews, historical-envelope replay, and package-name changes. A successful
update appends the prior binding to a bounded hash-chain history, preserves the
Extension ID, closes its transport, and clears source/capability, tool, and
Agent approvals. The new revision therefore returns to `pending` and must pass
the local review gates again. An identical envelope is a no-op.

Open **Atomic package deployment** to select up to eight signed packages,
bounded to 16 MiB total. Napier verifies every envelope, infers install versus
update by normalized package name, resolves the final workspace graph, rejects
missing/incompatible/cyclic dependencies, and presents a dependency-first
apply order. Publisher/key changes and rollback or opaque-version transitions
have separate set-wide confirmations.

Apply recomputes the entire plan inside the Store queue and compares its
SHA-256 with the reviewed preview. All installs and updates commit through one
SQLite revision CAS or none do. New and updated Extensions begin `pending`
with no inherited local approvals; updated transports close after commit.
Single-package import/update uses the same final-graph validator, so a breaking
major upgrade must include its dependents in one deployment.

Use **Export lockfile** to download the installed signed package set as a
`napier.extension-package-lockfile`. The lockfile contains complete signed
envelopes, canonical package identity rows, dependency rows, and a stable
content SHA-256 that excludes generation time. Export revalidates publisher
trust and dependency closure first, sets no-store/digest headers, and records
only package counts and hashes in the Work Ledger. Both export and
hash-addressed lockfile retrieval mirror package count, dependency count,
package-envelope set hash, normalized package-name set hash, and publisher key
set hash for release scripts.

The verify action accepts a single package envelope, one lockfile, or a signed
channel index. Lockfile verification replays envelope validation and
dependency-closure checks, and verification responses expose no-store status,
digest, key, package-count, envelope-count, and artifact-hash headers without
expanding manifests or tool schemas into headers. It is still only offline
provenance evidence.
To replay a package set in another workspace, select the lockfile in
**Atomic package deployment**; Napier expands it into envelopes and runs the
normal preview/apply CAS, publisher-risk, version-risk, and review-reset
workflow. Lockfiles never carry local source approval, tool-effect review, or
Agent enablement.

Use **Rollout channels** to publish the current installed signed package graph
to a named lane such as `stable`. A channel stores a complete lockfile plus a
policy that pins the maximum package count, allowed package names, allowed
publisher key IDs, trusted-publisher requirement, and dependency-closure
requirement. Updating the same channel without widening policy must continue
to satisfy that policy.

Previewing a rollout channel unfolds its pinned lockfile into the same Atomic
package deployment preview. Applying it binds both the rollout-preview SHA-256
and the deployment SHA-256, then runs the normal deployment path; installed or
updated packages still start pending with no inherited source, tool, or Agent
approval. Channel Ledger events record channel IDs, revisions, counts, policy
hashes, lockfile hashes, and package-envelope set hashes, never manifests,
schemas, signatures, public keys, or executable bytes.

Package deployment, rollout list/publish/preview/apply, and reviewed
single-package update preview/apply responses are no-store and expose content
or artifact SHA-256 headers plus status, revision, CAS, package, dependency,
install/update, and review-reset counts. Headers deliberately avoid package
manifest bodies, transport URLs, tool descriptions, schemas, signatures, and
public keys.

Use **Channel index registry** to sign active rollout channels as a
summary-only registry index. Each entry can include a signed lockfile locator
for `/api/extensions/packages/lockfiles/{lockfileSha256}`; fetching it returns
the complete lockfile by stable hash, after which verification and Atomic
package deployment still enforce the usual trust, dependency, CAS, and local
review-reset gates. The index itself never embeds package envelopes or local
approval state.

Use **Channel index registry** to sign the active rollout channels as a
`napier.signed-extension-package-channel-index`. The index is a remote-registry
foundation: it contains channel names, revisions, channel hashes, lockfile
hashes, package/dependency counts, package-envelope set hashes, and policy
hashes. It deliberately omits lockfile envelopes, manifests, schemas,
signatures, public keys, executable evidence, and local approvals. Verifying an
index proves summary provenance only; installing still requires fetching or
providing the corresponding lockfile and replaying the normal rollout or
deployment gates.

Every connection re-verifies the signature, anchor status, manifest binding,
transport, dependency closure, tool catalog, and current stdio executable
digest before opening the transport. Every policy decision and actual tool
call re-reads SQLite and rechecks publisher, configuration, and transitive
dependency trust, so revocation blocks an already exposed tool. Revoking a
publisher is irreversible, atomically clears enablement and connection state
for directly bound and dependent Extensions, and records only IDs, counts,
and hashes in the Work Ledger.

## Background Operations

Open **Ops** to create a bounded interval or five-field UTC cron schedule for
the current ledger. Scheduled occurrences use deterministic trigger IDs and
renewable claims, so a retry cannot silently create a second run. The register
shows the next occurrence, last run, claim owner, revision, and pause state.
Schedule list/create/update APIs are no-store and expose content/list or
projection SHA-256 headers plus status, revision, next-run, and active/paused
count headers for operator polling. Lifecycle Ledger events keep schedule IDs,
status, timing, and revision evidence without copying the scheduled prompt.

Ops can also create an authenticated webhook channel. Its bearer token is
shown once and removed from the DOM after dismissal; Napier persists only its
SHA-256 digest. Channel create, status, retry-policy, signature-policy, and
token-rotation responses are no-store; they mirror the channel projection hash,
status, revision, policy template, and token fingerprint in headers without
hashing the raw one-time token. `GET /api/channels` returns only token-free
channel projections, so it is also no-store and exposes a content SHA-256 plus
total, active, and disabled channel count headers for polling and CI checks.
Bootstrap mirrors the same channel-list digest/count headers plus adapter
catalog digest/count headers, and now also binds the full Bootstrap response to
`X-Napier-Content-SHA256` for direct Web startup verification.
Channels can additionally require an HMAC-SHA256 body signature using that same
one-time token as the signing key. Sign the exact `<timestamp>\n<body>` payload
and send a stable idempotency key with every delivery:

Webhook creation includes policy templates for the common operational modes:
`signed_standard` for default signed CI inboxes, `signed_strict` for narrow
timestamp skew and fewer retries, `legacy_bearer` for compatibility-only
senders, and `custom` when Ops edits the retry or signature knobs directly.
Each channel also declares an adapter. `napier_json` expects the native
`idempotencyKey`/`message` JSON body shown below. `github_webhook` accepts a
GitHub webhook JSON payload plus `X-GitHub-Delivery` and `X-GitHub-Event`
headers, derives the idempotency key from the delivery header, and queues a
concise Agent message containing repository/action/subject metadata plus only a
delivery fingerprint. `slack_event` accepts Slack Events API callback payloads,
derives deduplication from `event_id`, and queues a team/app/event summary with
only an event fingerprint. `linear_webhook` accepts Linear webhook payloads,
derives deduplication from a hash of webhook ID, timestamp, entity type/action,
and entity ID, and queues issue/project metadata plus only an event fingerprint.

Before accepting real work, Ops can run a no-store adapter preview from the
Automations panel or `POST /api/channels/<channel-id>/adapter-preview`. The
preview parses the same sample headers/body, returns body and message SHA-256
values, the derived idempotency fingerprint, and a short Agent message preview,
binds the no-store preview receipt to `contentSha256`, and mirrors the adapter
ID, receipt hash, body hash, message hash, and fingerprint in response headers
for CI smoke checks, but does not create a delivery, Run, or Ledger event.
Supported adapter metadata comes from the server-side adapter catalog exposed
through Bootstrap and `GET /api/channels/adapters`, including labels,
idempotency source, required headers, sample headers/body, and security notes.
Both surfaces expose the same SHA-256 catalog digest, adapter count, and
adapter-ID set hash for drift checks.

```bash
BODY='{"idempotencyKey":"ci-build-1842","message":"Review the failed build."}'
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SIG="sha256=$(printf "%s\n%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "<one-time-token>" -hex | awk '{print $2}')"
curl --request POST \
  --url http://127.0.0.1:8787/api/channels/<channel-id>/inbound \
  --header "Authorization: Bearer <one-time-token>" \
  --header "X-Napier-Channel-Timestamp: $TS" \
  --header "X-Napier-Channel-Signature: $SIG" \
  --header "Content-Type: application/json" \
  --data "$BODY"
```

The first accepted request returns `202`. Repeating the same channel and
idempotency key returns the original delivery receipt with `200`, regardless
of body changes, and does not create another run. Both success paths are
no-store and mirror the receipt content hash, duplicate flag, delivery status,
revision, channel/thread/delivery/trigger identity, optional Run ID,
idempotency fingerprint, and public body/catalog hashes in response headers.
Disable a channel to reject new deliveries while retaining its audit history.
Every accepted delivery also records the raw inbound body SHA-256 and the
active adapter catalog SHA-256, then carries those hash-only values into
`channel.delivery.*` Ledger events beside the adapter ID and channel revision.
`GET /api/channels/<channel-id>/deliveries`
is a no-store projection with a content hash, channel ID, delivery-list hash,
delivery-ID set hash, delivery total, and per-status count headers for polling
and CI checks. `GET
/api/channels/<channel-id>/deliveries/<delivery-id>/qualification` is a
no-store read that reports `qualified`, `evidence_missing`, or
`adapter_catalog_drift` by comparing that delivery evidence with the current
server adapter catalog digest. The response carries a stable `contentSha256`
and matching channel ID, delivery ID, status, diagnostic-count, current-catalog,
and optional body/catalog evidence headers; the Automations panel exposes the
same receipt hash on each delivery row. Signature policy revisions can require
or relax HMAC verification and adjust the accepted timestamp skew without
exposing the token or rewriting existing delivery evidence. Token rotation
requires an explicit inline confirmation, invalidates the previous token
atomically, and shows the replacement only once.

Each channel configures one to ten attempts and a base delay from 250 ms to 60
seconds. A delivery snapshots that policy when accepted, so later policy
changes cannot silently alter in-flight work. Dispatch failures that occur
before Napier creates a Run use bounded exponential backoff. Once a Run exists,
or a restart makes its side effects uncertain, Napier fails the delivery
closed. Ops then requires explicit confirmation before creating a new attempt
with its own trigger ID and Ledger evidence. A successful manual retry response
is no-store and mirrors the returned delivery content hash, status, attempt
counts, revision, channel/thread/delivery/trigger identity, optional Run ID,
idempotency fingerprint, public evidence hashes, and next-attempt timestamp in
response headers.

Ops can export all failed deliveries for a channel as a versioned JSON
artifact. The export contains operational metadata, retry disposition, and a
SHA-256 of each queued message rather than its content. When available, it also
carries the inbound body SHA-256, adapter catalog SHA-256 captured at
acceptance, the current adapter catalog SHA-256, and a per-delivery
qualification status. Bearer tokens, idempotency keys, and full idempotency
digests are omitted. The artifact has a stable content SHA-256, every export is
returned with matching content, delivery-count, current-catalog, and
qualified/missing/drift summary headers, channel/thread identity, delivery-ID
set hash, and retry-disposition count headers, and the Ledger event records the
same top-level counts for quick audit. The same JSON can be posted back to the
no-store verification endpoint to recompute its canonical content hash and
compare delivery/qualification counts.
That verifier mirrors channel identity, declared/recomputed content hashes,
status, plus observed delivery and qualification counts into response headers
for CI and operator scripts.
Operators can also generate a no-store retry preview from the artifact and then
apply only that exact preview hash with explicit replay confirmation; changed
delivery state blocks the bulk retry instead of silently reusing stale evidence.
Preview and apply receipts carry top-level SHA-256 summaries of candidate,
retryable, blocked, retried, and skipped delivery ID sets for quick audit; apply
receipts repeat the preview candidate-set hash they consumed. Preview/apply
responses mirror channel identity, candidate/diagnostic counts, those counts,
and set hashes in headers for machine checks. A no-store retry-history endpoint
projects the channel Ledger back into public
apply records with event IDs, seq boundaries, an event-set hash, apply result
hashes, counts, and the same hash summaries, so operators can audit prior bulk
retries without reading raw event payloads. The response includes a
content-disposition filename plus channel/thread identity, content/event-set
hash, event-count, and first/last seq headers for direct artifact capture. The
same receipt can be posted back to the no-store
retry-history verifier to compare its hashes and seq boundaries against the
current Ledger projection; the verifier also exposes status and observed
content/event-set/count/seq hashes as response headers for machine checks.
The Automations export receipt shows the same counts, verifies uploaded exports
without raw messages, previews retryable failures, and applies the confirmed
preview hash. After apply, Automations refreshes both the preview and retry
history against the current delivery projection. The retry-history card can
download the receipt as JSON, upload a saved receipt, and submit either the
visible or uploaded receipt to the same no-store verifier. Stale retryable
entries become blocked and the new hash-only apply event is visible. Active
delivery lists refresh only while work is accepted, running, or waiting for
backoff.

## Safe Automatic Recovery

Context defaults every Agent to **Manual resume only**. Enabling **Automatic ·
safe read-only** snapshots a bounded one-to-three attempt policy and base
backoff into every new schema-2 Run fingerprint. An interrupted legacy Run,
Run without a fingerprint, imported fixture, or demo-model Run can never
inherit this permission from the current Agent.

After restart, the recovery worker examines the interrupted Run's own ordered
events. It refuses a claim when any `tool.started` lacks exactly one matching
terminal event, when a write/delegation tool appeared, when an Extension effect
is unknown, or when the frozen attempt limit is exhausted. An eligible
assessment binds the source configuration SHA-256, source event-stream
SHA-256, metadata-only tool counts and names, recovery-chain root, and
eligibility time to an independent SHA-256. Prompt text, tool arguments,
outputs, and claim tokens never enter this report or its control events.

Claims are SQLite-CAS coordinated and use renewable worker-only tokens. A
deterministic root/attempt trigger prevents two local runtimes from creating
duplicate recovery children; expired pre-Run claims can be taken over without
incrementing the attempt. A child interrupted by another restart is assessed
again and consumes the next bounded attempt. A failed or cancelled child is
not silently retried.

Execution is constrained, not merely prompted. Napier loads the source Run's
exact Agent revision and model, emits a `safe_read_only_recovery` fingerprint,
forces `observe`, disables plan tools, Extensions, Subagents, verification
processes, and Memory extraction, and exposes only local list/read/search
tools. Manual Resume remains independent and continues to warn that prior side
effects may be unknown. **Ops → Recovery ledger** shows qualified, blocked,
claimed, running, and terminal decisions with reason codes and hashes.
`GET /api/threads/:threadId/recovery` exposes the same no-store metadata with
a content SHA-256 and assessment/attempt count headers for operator polling.

## Durable Run Budgets

Context configures four parent-Run limits: model turns, total tokens, reported
model cost in USD, and wall time. Defaults are 24 turns, 250,000 tokens, $10,
and 15 minutes. Limits are validated as part of the revisioned Agent profile,
then the current revision and complete limit set are copied onto the Run before
execution. Editing the profile cannot change an in-flight or replayed Run.

The token and cost totals include the primary Pi loop, context compaction, Goal
evaluation, Memory extraction, and delegated Subagents. Raw provider `usage`
is preserved for replay, while model-specific `usageAccounting` records a
hash-bound strategy, raw total, calibrated `budgetTokens`, token weights,
reported cost, price-table estimate, `budgetCostUsd`, and the price-table
hash. The built-in provider price table catalog is exposed as a refreshable,
hash-bound artifact and can be verified before custom tables are used for cost
preview. Catalog and verifier responses are no-store and expose content or
catalog SHA-256, table/provider counts, provider-set hashes, diagnostic counts,
and diagnostic-set hashes for polling. Run token limits use `budgetTokens` when
present and raw totals
otherwise; cost limits use `budgetCostUsd` when present and raw reported cost
otherwise. A response that crosses a limit is retained as evidence, but any
tool calls it requested are blocked before execution. A limit reached exactly
may settle a final answer; another model turn is not started. Optional Memory
extraction is skipped when no budget remains.

Wall time covers the complete leased Run. The first exhausted dimension wins
and appends `run.budget.exhausted` with limits, observed usage, turns, elapsed
time, and a stable reason before the Run fails closed. Ordinary operator
cancellation remains a distinct `run.cancelled` outcome.

## Agent Configuration History

Context treats Agent configuration as an append-only revision ledger. Every
semantic profile change stores the complete normalized profile, changed field
names, source, creation time, System Prompt SHA-256, and a canonical snapshot
SHA-256 in the same SQLite workspace commit as the new current Agent. A
semantic no-op creates no revision. Older workspaces receive one `migrated`
baseline which is persisted once during startup.

The Workbench shows model, policy, changed fields, timestamps, and both hashes
without rendering historical System Prompt text. Selecting an older snapshot
opens a second confirmation ticket with the exact fields that differ and the
revision that will be created. Rollback first verifies that the historical
model is still available, then restores the snapshot as a new revision;
neither the current nor target history record is modified.

Agent profile update, revision history, and rollback responses are no-store and
hash-bound. They mirror Agent ID, current revision, profile revision SHA-256,
System Prompt SHA-256, changed-field counts, and rollback source hashes so CI
or operator scripts can audit configuration movement without scraping events.

`agent.updated` and `agent.rolled_back` events carry only Agent ID, revision,
changed fields, provenance revisions, and snapshot hashes. Run configuration
fingerprints remain separate and continue to prove the effective configuration
used by each execution. Schema 3 Run fingerprints additionally bind the
enabled Skill catalog SHA-256. The corresponding `context.skills` Ledger event
records only Skill names, relative `SKILL.md` paths, byte counts, diagnostics
hashes, and file SHA-256 values, never Skill instructions. Portable
full-thread fixtures optionally carry the complete Agent revision ledger, remap
the Agent ID, and recompute every revision hash during atomic import; legacy
schema-version-1 fixtures remain valid.

`POST /api/skills/packages/sign` issues a `napier.signed-skill-package`
envelope over that same hash-only Skill catalog evidence using an Ed25519
publisher anchor. Verification accepts revoked or unknown keys as explicit
statuses, and the envelope never includes `SKILL.md` instruction bodies.
`POST /api/skills/packages/qualify` additionally reloads the current workspace
Skill files and reports `qualified`, `catalog_drift`, or `missing_skill`
against the signed catalog SHA-256. `POST /api/skills/packages/installations`
persists a reviewed local installation baseline only after qualification
passes. Replacing an active baseline requires `replaceInstallationId` plus
`confirmReplacement: true`; publisher/key changes and loaded Skill-set changes
each require their own explicit confirmation. Repeat installs of the same
envelope are idempotent. The installation record and Ledger events contain
hashes, skill names, counts, publisher metadata, and replacement links, never
Skill instructions.

`POST /api/skills/content/preview` reviews a candidate `SKILL.md` body without
writing it, extracting the frontmatter name, fixing the target to
`skills/<name>/SKILL.md`, and returning action, current hash, candidate hash,
candidate frontmatter/body hashes, byte/line counts, and stable review
SHA-256. `POST /api/skills/content/apply` must echo that review hash and
explicitly confirm install or replacement before writing through the same
hash-preconditioned atomic workspace writer. Ledger events record only hashes,
target path, action, byte counts, and line counts, never Skill instructions.

`POST /api/prompts/packages/sign` issues a `napier.signed-prompt-package`
envelope for the current Agent profile revision. The manifest freezes the
source Agent ID, Agent name, revision number, Agent revision SHA-256, System
Prompt SHA-256, publisher, and expiry metadata without copying prompt text.
`POST /api/prompts/packages/verify` checks publisher provenance, while
`POST /api/prompts/packages/qualify` recomputes the current Agent prompt hash
and reports `qualified`, `prompt_drift`, or `agent_missing`. The corresponding
Ledger events contain only hashes, IDs, revision numbers, and signer metadata.

## Reviewed Memory Lifecycle

Memory is governed context, not an editable prompt fragment. A manual or
model-extracted fact begins as `proposed` and cannot enter model context until
it is approved. Approval assigns a review deadline from a configurable
1–3,650 day interval (90 days by default). At the first Run after that
deadline, Napier atomically moves the fact to `stale`, appends
`memory.stale`, and excludes it before assembling the system prompt. Operators
may also mark a fact stale early, refresh an active or stale fact to start a
new review interval, or archive it.

Memory list, proposal, and review responses are no-store and hash-bound. They
mirror total and per-status counts, Memory ID/status/revision/scope/category,
review interval/due date, use count, optional Agent ID, and supersession or
consolidation headers so automation can track lifecycle state without replaying
the Thread event stream.

Every injected fact records a deduplicated per-Run use, total use count, last
use time, and last Run ID. The prompt contains only approved, in-date facts
visible to the selected Agent, wrapped as untrusted data rather than
instructions; Ledger events retain fact IDs and a content hash instead of
duplicating the text.

Corrections never overwrite reviewed history. The Workbench creates a new
proposal with `supersedesMemoryId`, preserves the original scope and Agent,
and refuses unchanged content, competing pending corrections, or an already
superseded target. Approving the replacement archives and links the old fact
in the same SQLite workspace commit. The old fact remains visible as immutable
review evidence and cannot be restored.

Consolidation is also proposal-first. An operator may select 2–8 compatible
active/stale facts with the same scope and Agent, then write one synthesized
fact. Napier canonicalizes and binds every source ID, rejects duplicate,
cross-scope, already superseded, or pending targets, and uses the shortest
source review interval as the conservative UI default. Approval activates the
new fact and archives every source with a shared `supersededByMemoryId` in one
SQLite workspace commit. Until approval, all sources remain active or stale
exactly as they were.

Live-model extraction can identify an explicit contradiction against reviewed
context or propose a faithful consolidation. The no-tool extractor receives
only the current Agent's eligible active/stale replacement inventory, bounded
to 40 facts and 6,000 JSON
characters. Napier records the candidate IDs, truncation state, and inventory
SHA-256. A model may name one `supersedesMemoryId` for correction or 2–8
`consolidatesMemoryIds` for compatible fragments, but never both. Unknown,
malformed, duplicate, or repeated targets fail the extraction before proposals
are written. A target with a pending replacement is omitted. Valid detections
inherit source scope and Agent but remain ordinary proposals requiring human
approval.

## Controlled Workspace Editing

`read_file` reports the SHA-256 and byte size of the complete UTF-8 file even
when only a line range is returned. A write-capable Agent must pass that digest
back to `apply_patch`; creation instead requires `expectedSha256: null` to
assert non-existence. Every replacement must match exactly once, and a stale
digest fails without changing the file.

`read_file` also emits bounded line hash anchors for the returned range.
`apply_patch hashline_replace` can replace a line by its anchor SHA-256 and
optional line number, so small line edits do not require the model to retype
the old text. Duplicate anchors fail closed unless the read line number is
provided, and the complete-file SHA-256 is still checked before and immediately
before the atomic commit.

Edits are limited to 256 KiB and cannot target `.git`, `.napier`, or
`node_modules`, follow a symlink outside the workspace, delete a file, or
create parent directories. Local runtimes serialize each target with a
recoverable PID lock, write and fsync a same-directory temporary file, recheck
the precondition, and commit with an atomic link or rename. Trace records the
operation, path, byte counts, and before/after hashes. Researcher, reviewer,
and general subagents remain read-only. New delegations must return a bounded
JSON outcome containing a summary, typed findings/risks/recommendations,
workspace-relative line evidence, and explicit unknowns. Napier normalizes that
result into a receipt bound to the task, role, model, prompt SHA-256, raw result
SHA-256, immutable role-instructions SHA-256, item-set SHA-256, and stable
content SHA-256; malformed outcomes fail the delegation without becoming
parent evidence. Workspace evidence references are resolved through the same
realpath and UTF-8 boundary as `read_file`; each receipt records the observed
file SHA-256, selected-range SHA-256, byte size, line count, and aggregate
evidence-set SHA-256. Missing, escaping, oversized, non-text, or out-of-range
references fail closed.
Grounded receipts use schema 2; existing schema-1 outcomes remain verifiable
and portable without grounding fields.
The Trace delegation card can recheck a stored outcome against the current
workspace through `POST
/api/threads/:threadId/subagents/:taskId/outcome/verify`. This no-store read
returns `aligned`, `divergent`, or legacy `unavailable`, with per-reference
`aligned`, `divergent`, or `missing` status. Reports bind expected and observed
file/range hashes, counts, hash-only diagnostics, the source outcome hash, and
a stable content SHA-256 without appending Ledger events or returning file
content.
When a final Subagent candidate fails only the strict JSON/output contract,
Napier may spend one remaining Subagent turn on a dedicated tool-free repair
pass. The repair request binds the task, role, model, original prompt,
immutable outcome instructions, predecessor-result hash/size, diagnostic, and
repair prompt/instructions. The outcome receipt binds the repaired result to
that request and the accepted outcome receipt or a hash-only rejection.
Grounding failures, oversized output, cancellation, timeout, and exhausted
turn budgets never trigger repair. Final and repaired candidate steps persist
only SHA-256 and byte counts; raw malformed candidates and repair prompts do
not enter the Ledger. Replay import remaps task IDs and recomputes both repair
receipts without changing result or diagnostic hashes.
An operator can also run `POST
/api/threads/:threadId/subagents/:taskId/outcome/review` with a model different
from the worker. This no-store, zero-tool reviewer scores task alignment,
evidence grounding, uncertainty honesty, and actionability, returning
`accept`, `revise`, `reject`, or `inconclusive` with score, risk, reason,
concerns, usage, and a stable review SHA-256. Reviewer failures become
inconclusive artifacts and never rewrite the task, append Ledger events, or
stall the completed delegation. The Trace card uses the globally selected
model as the reviewer candidate and disables review until it is independent.

## Sandboxed Workspace Verification

Selecting `workspace` and enabling **Sandbox verify** allows the parent Agent
to run one of three reviewed checks: TypeScript typecheck, Vitest test, or
Prettier format check. Napier invokes the current Node executable and the
workspace-local CLI directly; it never evaluates a package script, shell
command, or model-provided executable.

Each verifier receives only `process.spawn` and `workspace.read`. The OS
sandbox mounts or authorizes the workspace read-only and leaves networking
disabled. The working directory and optional target must resolve inside the
workspace. Runs default to 60 seconds, cannot exceed 120 seconds, and retain at
most 32,000 characters from each output stream. Timeout, cancellation, or
output exhaustion terminates the isolated process group so descendants cannot
outlive the check.

`passed`, `failed`, `timed_out`, and `output_capped` are distinct results. A
non-zero exit is preserved as failed verification evidence rather than a tool
transport error. Trace records the sandbox, target, duration, exit status,
signal, output sizes, truncation flags, and independent stdout/stderr SHA-256
digests.

## Durable Plan Archives

Open **Plan → Workflow archive** to export the active durable plan as a
hash-bound workflow record. The JSON artifact contains the current
`ExecutionPlan`, its step/artifact/replan projection, plan-scoped Ledger events,
an ordered `eventStreamSha256`, and a stable `contentSha256` that excludes
`generatedAt`. This makes a Deer Workflow-style plan review portable without
requiring a full Thread fixture.

`GET /api/threads/:threadId/plans/:planId/archive` returns the artifact with
`Cache-Control: no-store`, `X-Napier-Content-SHA256-Mode: stable`,
`X-Napier-Plan-Archive-SHA256`, plan revision/status, event-stream hash, count
headers, and event-boundary headers. `POST
/api/threads/:threadId/plans/:planId/archive/verify` accepts a previously
exported archive, recomputes the stable content hash and event-stream hash,
validates plan ownership plus plan-scoped event ownership, binds the artifact
to the URL Thread and Plan, and returns `valid` / `invalid` plus
low-cardinality diagnostics without mutating Ledger state. The Plan Workbench
exposes the same verifier as a local JSON upload action before an operator
trusts an archived workflow record.

Open **Plan → Reusable plan** to export the same work as a smaller
`napier.execution-plan-blueprint`. A blueprint keeps only the reusable shape:
objective, step DAG, artifact declarations, source Plan revision,
Plan-archive SHA-256, and source event-stream SHA-256. It drops step status,
blockers, evidence prose, file digests, and runtime event bodies.

`GET /api/threads/:threadId/plans/:planId/blueprint` returns the blueprint as a
stable-hash JSON attachment. `POST
/api/threads/:threadId/plans/blueprints/verify` validates an uploaded blueprint
without mutating state and mirrors status, diagnostic hash, blueprint hash,
source hashes, and step/artifact counts in headers. `POST
/api/threads/:threadId/plans/from-blueprint` creates a new Plan through the
normal Plan creation gate, then appends only blueprint/source hashes to the
`plan.created` Ledger event.

Blueprints can also be saved into the local Workflow Blueprint Library. `POST
/api/threads/:threadId/plan-blueprints` validates the blueprint and creates an
active `ExecutionPlanBlueprintRecord`, deduplicated by blueprint SHA-256. `GET
/api/plan-blueprints` returns the active/archived library with no-store
count/set-hash headers, `GET /api/plan-blueprints/:recordId/qualification`
recomputes local source evidence without mutating Ledger state, `POST
/api/threads/:threadId/plans/from-blueprint-record/preview` previews the
resulting Plan projection without writing state and returns a stable
`previewSha256` over the Plan shape plus hash-only qualification evidence,
`POST /api/plan-blueprints/:recordId/status` archives or restores a record,
and `POST /api/threads/:threadId/plans/from-blueprint-record` creates a Plan
from a saved record through the same normal creation gate after recomputing the
current preview. Create requests may include `expectedPreviewSha256`; stale or
mismatched preview hashes, open-Plan conflicts, and non-qualified records
return `409` with the current no-store preview report and do not create a Plan.
The Store commits the new Plan projection and its `plan.created` replay
evidence in one Ledger revision, so replay history cannot lose the creation
event after the Plan is persisted. Ledger events retain only record IDs,
blueprint hashes, source hashes, qualification status, qualification report
hashes, and the consumed preview hash. Successful create responses mirror the
atomic replay evidence as `X-Napier-Blueprint-Replay-Event-Id`,
`X-Napier-Blueprint-Replay-Event-Seq`, and
`X-Napier-Blueprint-Replay-Event-SHA256` headers for immediate machine polling.
`POST /api/plan-blueprints/:recordId/replays/events/verify` verifies that
single event anchor without returning the raw Ledger event payload, and the
Plan Workbench runs that verification immediately after template replay so the
creation receipt includes both the event-anchor status and the verifier receipt
hash; missing, malformed, or unverifiable event anchors are rendered as invalid
receipt diagnostics while preserving the already-created Plan state. `GET
/api/plan-blueprints/:recordId/replays` derives a no-store
`napier.execution-plan-blueprint-replay-history` receipt from `plan.created`
Ledger events, exposing replay/thread/plan counts, event-set SHA-256, latest
preview SHA-256, and objective SHA-256 without copying objective prose or event
bodies. `POST /api/plan-blueprints/:recordId/replays/verify` accepts a replay
history receipt, recomputes its stable hash, compares it with the current
Ledger-derived projection, and returns low-cardinality diagnostics without
mutating state. `GET
/api/plan-blueprints/:recordId/replays/outcomes` joins those immutable creation
anchors to the current durable Plan projections and emits a separate
`napier.execution-plan-blueprint-replay-outcomes` receipt. It reports active,
completed, blocked, cancelled, and invalid replay counts, completion basis
points, per-replay outcome hashes, and a stable outcome-set SHA-256 without
copying objective, artifact path, blocker, or evidence prose. `POST
/api/plan-blueprints/:recordId/replays/outcomes/verify` recomputes the artifact
hash and compares it with both the current replay history and current Plan
projections, so a previously valid outcome receipt becomes stale and fails
closed when delivery state changes. Outcome receipts can be promoted into a
policy-bound baseline through `POST
/api/plan-blueprints/:recordId/replays/outcomes/baselines`. Promotion accepts
only the current no-store outcomes artifact, stores only hashes, counts,
thresholds, and the supersession link, and defaults to a strict 100% completed,
0 blocked, 0 invalid policy. `GET
/api/plan-blueprints/:recordId/replays/outcomes/qualification` recomputes the
current outcomes and reports `qualified`, `missing_baseline`, or
`policy_failed` against the latest baseline without mutating state. The Plan
Workbench can ask a selected evaluator model to review those current outcomes
through `POST /api/plan-blueprints/:recordId/replays/outcomes/review`. The
review is no-store and returns a
`napier.execution-plan-blueprint-outcome-review` artifact with verdict, score,
risk, criteria scores, model, input/prompt/response hashes, review schema hash,
and the current outcome/baseline hashes; `napier/demo` fails closed as
`inconclusive`. The review input uses only aggregate counts, replay statuses,
Plan projection hashes, outcome hashes, and policy evidence, so objective text,
artifact paths, blockers, and evidence prose are not copied into the review
artifact. The same review artifact can be passed back into outcome baseline
promotion. Reviewed promotion re-verifies the review hash, current outcomes,
source qualification, outcome qualification status, and a gate that defaults
to score >= 80 with risk <= medium before appending review input/response/model
hash evidence into the superseding baseline and response headers. The Plan
Workbench exposes this as a separate reviewed promotion action so a plain
policy baseline and a model-reviewed baseline remain visibly distinct. The Plan
Workbench can also ask the server to select a policy-qualified template for the
current Thread through `POST /api/threads/:threadId/plan-blueprints/selection`.
The selection receipt is no-store and hash-bound: candidates must pass source
qualification, outcome-baseline qualification, and target-Thread preview gates;
the deterministic rank now carries an explicit recommendation policy template
(`balanced`, `delivery_first`, or `portfolio_first`). Source qualification
remains a hard gate, while the selected template weights outcome completion,
portfolio-family completion, reviewed-baseline coverage, and replay evidence
volume before the stable recency/freshness tie-breakers. The policy and policy
SHA-256 are mirrored into the receipt and response headers beside the selected
recommendation score. It returns only record IDs, preview hashes, family
hashes, portfolio-set hash, baseline/outcome hashes, policy hashes, counts,
diagnostics, and a selection-set SHA-256, so objective overrides are
represented by hash rather than copied back into the artifact. Family-level
policy overrides can be set through `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides`, binding
`familySha256`, the selected policy template, and the current portfolio-set
SHA-256 into a persistent hash-only override record. Default selection applies
overrides as `family_override` evidence only when the request does not provide
an explicit `policyTemplate`; explicit request policy still wins, followed by
family override, then the `balanced` default. Stale `expectedPortfolioSetSha256`
values fail closed with `409 Conflict`, and selection receipts mirror the
override-set SHA-256 plus the selected policy source. `GET
/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review`
reviews the current override set against current portfolio/backtest evidence
without mutating the Ledger. The no-store receipt returns aligned, retire
recommended, and missing-family counts, plus an override drift review-set
SHA-256 and per-family diagnostics that compare the override policy template
and selected record with the current best policy. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire` removes
a stale family override only when the caller supplies the current family hash,
override SHA-256, override-set SHA-256, drift review-set SHA-256, and
portfolio-set SHA-256. If the review evidence changes, the override changes, or
the override is not retire recommended, the request fails closed with
`409 Conflict`. The retirement receipt mirrors the retired override hash,
retired policy hash, drift review-set hash, and remaining override-set hash.
The same retirement is appended into durable local history; `GET
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements`
returns a no-store history receipt with retirement count, current override-set
SHA-256, retirement-set SHA-256, latest retirement timestamp, and every
retirement receipt so deleted overrides remain auditable after defaults change.
`POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify`
accepts an exported retirement history and returns a no-store verification
receipt. The server recomputes the uploaded history content hash, validates each
embedded retirement receipt, recomputes the retirement-set SHA-256, and compares
declared portfolio/current override/retirement hashes against the current
durable store. Diagnostics distinguish tampered files from otherwise valid
exports that no longer match current Ledger state, while response headers mirror
the verification status, diagnostic hash, and declared/recomputed/observed
hashes. The Template shelf downloads the audit history JSON and can upload it
back through the same verification flow.
`POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/verify`
accepts multiple exported retirement histories and returns a cross-Ledger
proof-bundle receipt. Each history is validated self-contained, embedded
retirement receipts are rehashed, and the server reports aligned, divergent, or
invalid status based on file validity, minimum history count, and distinct
portfolio/current override/retirement-set hashes. Bundle headers mirror history
counts, distinct-set counts, diagnostics, and bundle-set SHA-256 values. The
Template shelf can upload multiple retirement history JSON files at once to
compare environments without exposing objectives, step titles, artifact paths,
blockers, or evidence prose.
`POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign`
recomputes the same bundle, refuses invalid inputs, and wraps aligned or
divergent proof bundles in the existing Ed25519 `TrustedReceiptEnvelope`
format. The signed envelope binds the proof-bundle content hash, artifact hash,
signer key id, and signature statement hash; `receipt.signed` Ledger events
record only those public hashes. The Template shelf adds **Sign bundle** beside
**Verify bundle**, refreshes signing-capable receipt trust anchors before
signing, downloads the signed JSON envelope, and renders the envelope hash plus
source proof-bundle hash so independent Ledgers can compare retirement
evidence without sharing a local trust root.
`GET
/api/plan-blueprints/portfolio/recommendation-policy-backtest` runs the three
policy templates against the current library's historical replay outcomes
without target-Thread preview or Ledger mutation. The no-store receipt returns
policy-set hash, portfolio-set hash, divergent selection count, per-policy
selected record/family IDs, recommendation scores, and hash-only candidate
evidence so operators can compare operating modes before changing defaults.
`GET
/api/plan-blueprints/portfolio/calibration`
returns a no-store `napier.execution-plan-blueprint-portfolio-calibration`
receipt for the whole library. It groups templates by hashed workflow shape and
returns only family hashes, record counts, qualification totals, reviewed
baseline counts, aggregate replay outcomes, top record IDs, and a
portfolio-set SHA-256. The Plan
Workbench exposes this as a
**Template shelf**: save the current verified blueprint, refresh the local
library, browse active and archived templates with hash evidence, archive or
restore records, qualify whether the saved source archive/event stream still
matches local evidence, preview the Plan shape, and replay an active template
into the current Thread only by passing the just-reviewed preview hash when no
active or blocked Plan is open. The shelf can also fetch each template's replay
history as a compact hash-only receipt for later audit, download that JSON
artifact, and upload it back through the same hash-verifying client for
no-store validation. It provides the same export/upload loop for replay
outcomes, keeping creation provenance and mutable delivery status visibly
separate, can promote or qualify the current outcome baseline for each
template, can run model review over current outcomes, and can run adaptive
selection across the shelf before replaying a candidate. It can also calibrate
the whole portfolio to compare reusable workflow families without exposing
objective, step, or artifact prose, backtest recommendation policies over
current outcome evidence, and renders the selected policy template, policy
hash, recommendation score, policy-set hash, override-set hash, policy source,
and divergence count as part of the selection/backtest/override receipts.

## Portable Replay Fixtures

Open **Lab → Portable ledger** to export the current Thread as one versioned
JSON fixture. The bundle includes its Agent profile, Runs, execution plans,
Agent revision ledger, evaluations, evaluation adjudications, reviewer ballots,
consensus resolutions, evaluation suites and executions, automatic-recovery
assessments and attempts, subagent tasks and typed outcome receipts, and every
ordered event.
`generatedAt` is excluded from the canonical content digest, so repeated
exports of unchanged evidence produce the same content SHA-256.
The fixture response is no-store and mirrors the bundle content SHA-256,
event-stream SHA-256, thread ID, run/event counts, and first/last event
sequence headers for CI archive checks.
Per-Run replay snapshots are self-contained: they carry the Run, ordered events,
Subagent task evidence, a stable `contentSha256`, and an ordered
`eventStreamSha256`. `POST /api/threads/:threadId/runs/:runId/replay/verify`
recomputes the snapshot content hash, event-stream hash, metrics, assistant
output hash, and URL thread/run binding without mutating state. Run Lab exposes
the same verifier as an upload action, binding archived replay JSON to the
active Thread before an operator trusts it for evidence review or CI regression
checks. Replay and comparison responses also mirror duration,
message/model/tool/subagent counts, token/cache counts, cost USD, output-text
hash, and right-minus-left metric deltas in headers for budget and quality
regression checks. Comparison headers also include event-type delta hashes,
added/removed tool-set hashes, and configuration changed-field/capability set
hashes so CI can detect behavioral drift without parsing full replay bodies.
The import endpoint first strictly parses the wrapper object, accepting only a
`bundle` and an optional normalized non-empty title, before the runtime validates
the full fixture schema and hashes.
`POST /api/threads/import/verify` runs the same validation as a no-store
preflight without importing state. The response mirrors verification status,
content/event-stream hashes, resource counts, and diagnostic hashes in headers
so CI can reject a fixture before handing it to the mutating import path.
Run Lab exposes that preflight beside the import action, so operators can
upload an archived fixture, see a valid/invalid receipt and diagnostics, and
only then choose whether to import it into a fresh remapped Thread.

Every new Run also snapshots a canonical configuration fingerprint before
execution. It binds the actual model selection (including a one-Run override),
Agent revision, thinking and tool policies, canonical tool/skill/subagent sets,
effective limits, interruption policy, execution mode, and a SHA-256 of the
system prompt. The prompt text is not copied into the fingerprint. Schema 3
also binds the enabled Skill catalog SHA-256. Schema 1 remains hash-compatible
and is interpreted as manual recovery; schema 2 remains valid for Runs created
before Skill catalog binding. **Lab → Compare** reports the exact fields that
drifted and shows both fingerprint hashes; a legacy Run without this evidence
is labeled unavailable rather than reconstructed from the current Agent.

Import accepts at most 10 MiB and verifies both the complete content digest and
the event-stream digest before mutation. Napier remaps every resource ID,
including suite, execution, and referenced pair-evaluation IDs, then recomputes
their case and batch SHA-256 digests. Adjudication and evaluation IDs are
remapped together; each truth revision receives the remapped evaluation
SHA-256 and a newly bound revision SHA-256. Napier strips trigger and lease
ownership and commits the new workspace projection plus all imported events in
one SQLite transaction. A Run captured as queued or running becomes
`interrupted`; running plan steps become `blocked`; active subagents become
`cancelled`; in-flight recovery claims become terminal imported evidence.
Recovery IDs, source-event hashes, assessment hashes, trigger links, and
attempt hashes are remapped or recomputed. Imported provenance always blocks a
new automatic recovery decision. Outcomes remain unknown until an operator
starts a new Run that verifies current state.

Imported event history is externally supplied data. Live model context marks
the imported sequence range and source hashes explicitly, and instructs the
Agent never to treat embedded requests as current operator instructions or
authorization.

## OpenTelemetry Trace Export

Open **Trace → OpenTelemetry export** to download a complete Thread or one Run
as a hash-bound Napier trace artifact. Its `otlp` member is an OTLP/JSON
`ExportTraceServiceRequest` that can be sent to an OpenTelemetry Collector
`/v1/traces` endpoint and inspected in compatible backends such as Jaeger or
Tempo. Napier emits one Thread root span, child Run spans, `chat` client spans
for model responses, `execute_tool` spans for tool calls, and `invoke_agent`
spans for delegated Subagents.

Trace IDs and span IDs are deterministic SHA-256-derived 128-bit and 64-bit
hex values. Millisecond Ledger timestamps are encoded as decimal nanosecond
strings. Parent-child intervals, event intervals, unique IDs, OTLP AnyValue
types, schema URLs, counts, and the complete span graph are validated before
download. Interrupted, blocked, failed, and unknown tool outcomes remain
distinct status evidence instead of being presented as successful work.

Export is metadata-only. Prompts, completions, reasoning, message text, tool
arguments/results, Subagent descriptions/results, review notes, evidence
prose, errors, credential labels, arbitrary user IDs, and key locators are
excluded. Safe IDs, models, tool names, states, token/cache counts, cost,
durations, sequence numbers, and evidence hashes remain. The artifact binds
the selected source-event range, its SHA-256, explicit redaction policy,
complete OTLP request, and span count to a stable content SHA-256 independent
of `generatedAt`.

Every export appends a `trace.otlp.exported` Ledger event containing only
scope, source Run ID when applicable, trace ID, counts, source hash, and
artifact hash. Export audit events and streaming text deltas are excluded from
later OTLP source selection, so repeating an unchanged export remains
deterministic rather than recursively changing its own evidence. Export
responses are no-store and mirror the artifact SHA-256, trace/thread/run IDs,
event range, event-stream SHA-256, span/event counts, and redaction counts in
headers without expanding span contents.
`POST /api/threads/:threadId/trace/otlp/verify` accepts an exported artifact,
replays the same strict validator without mutating the Ledger, binds the
artifact back to the URL thread, and returns `valid` / `invalid` with
low-cardinality diagnostics. Verification responses are no-store and mirror the
response hash, trace artifact hash, trace/thread/run IDs, source event-stream
hash, span/event counts, and diagnostic hash headers for CI archive checks.
The Trace card exposes the same verifier as an upload action, so an operator
can download an OTLP artifact, archive it externally, and later confirm whether
that JSON still matches the active Thread boundary before sending it to a trace
backend.

## Durable Evaluation Suites

Open **Lab → Evaluation suites** after at least two Runs settle. A suite fixes
one baseline, 1–8 distinct candidates, an exact rubric snapshot, an evaluator
model, and a quality gate. Semantic edits create a new revision. An execution
always retains the revision and complete inputs it evaluated, so later edits
cannot reinterpret old evidence.

Each candidate is evaluated through the same no-tool pairwise service used by
Run Lab. A case passes only when its verdict is `right_better` or `tie` and its
candidate mean reaches the configured score. Missing, malformed, or demo-model
judgment remains `inconclusive`. The aggregate gate applies the minimum pass
rate over conclusive cases and, by default, fails closed when any case is
inconclusive.

Every case stores the pair-evaluation ID and SHA-256 alongside both replay
snapshot hashes. The execution stores a canonical batch SHA-256 over the suite
revision, inputs, all case evidence, counts, scores, and final status. Revising
a suite marks the new revision `Not run` in the Workbench until it receives its
own execution; prior executions remain durable history.

Suite create/update, execution, and list APIs are no-store and hash-bound for
CI polling. They mirror `X-Napier-Thread-Id`, suite/execution IDs, revision and
candidate counts, execution status, case totals, and passed/failed/inconclusive
aggregates without requiring clients to parse the full JSON body.

Each suite can export a `napier.evaluation-gate-receipt` JSON artifact for CI
or release automation. The receipt contains the exact current suite snapshot,
the current-revision execution, and the complete pair evaluations in case
order, then binds them to a stable content SHA-256 that excludes only
`generatedAt`. A suite without a current execution exports an explicit
`not_run` receipt with no borrowed history. The download response also exposes
the digest, suite ID/revision, gate state, evaluation count, and current
execution ID/status/hash in no-store response headers.

## Reviewed Evaluation Adjudication

Open **Lab → Evaluator calibration** after a pair evaluation or suite
execution. The review register shows the immutable model verdict beside the
current expected verdict. Recording human truth creates one adjudication per
evaluation; changing that truth appends a revision, while submitting the same
normalized verdict and note is a semantic no-op.

Every revision stores the complete evaluation SHA-256, expected verdict,
normalized note, timestamp, and a canonical revision SHA-256. The original
model verdict, rubric, scores, reason, and evidence never change. Ledger events
record only IDs, verdicts, agreement, revision, and hashes, so review notes are
not duplicated into the event stream. Reviewed evaluations are exempt from
the ordinary 50-record Thread retention window.

The calibration report uses only the latest human revision. Samples are
grouped by evaluator provider/model and canonical rubric SHA-256, with exact
agreement counts, rates, and a complete 4×4 verdict confusion matrix. Its
stable content SHA-256 excludes only `generatedAt` and is returned in
`X-Napier-Content-SHA256`. The Paper Ledger calibration panel exposes coverage,
cohort rates, the matrix, revision provenance, and reload-persistent review
controls.

For higher-stakes truth, **Panel review** keeps up to nine reviewers in
independent lanes. Each reviewer ID owns an append-only ballot history with a
display-name snapshot, expected verdict, bounded rationale, evaluation
SHA-256, and revision SHA-256. A semantic no-op does not append. The consensus
preview applies a 2–9 reviewer quorum, 50%–100% exact-agreement threshold, and
an explicit inconclusive policy. Tied leaders, insufficient quorum, a missed
threshold, or a disallowed inconclusive verdict cannot be resolved.

Resolution is explicit rather than automatic. Napier recomputes the report
inside the Store transaction, appends a Human Truth revision carrying
`source: reviewer_consensus` and the report SHA-256, then persists a resolution
that binds the exact historical ballot revisions and adjudication revision.
Repeating the same report is a no-op. Ballot names and notes stay out of Ledger
events; events carry lane IDs, verdicts, revision numbers, and hashes only.
Adjudication writes, reviewer ballot writes, and consensus resolution writes
also return no-store response hashes plus IDs, revisions, verdict/status,
reviewer counts, agreement rates, and report/resolution hashes for polling
without mirroring private rationale text into headers.

## Durable Evaluation Casebooks

Open **Lab → Evaluation Casebooks** to turn reviewed judgments from the current
Thread into a workspace-wide gold set. A Casebook starts with an empty revision
and accepts only evaluations that already have human adjudication. Each case
freezes the complete model evaluation, the selected truth revision, source
Thread/evaluation/adjudication IDs, rubric SHA-256, evaluation SHA-256, and its
own canonical content SHA-256.

Case evidence is append-only and stored once in a registry. Casebook revisions
contain sorted case-ID manifests plus normalized metadata and provenance. This
preserves every historical collection without duplicating complete evaluation
snapshots in every revision. Re-curating unchanged truth is a semantic no-op;
a newer truth revision creates a new case snapshot and `case_refreshed`
revision. Removing a case only changes the current manifest, so prior revisions
remain independently verifiable.

Each current revision produces evaluator/rubric cohorts, exact agreement rates,
and full verdict confusion matrices through the same calibration protocol used
by Thread review. The `napier.evaluation-casebook` export contains the complete
revision ledger, append-only case registry, and calibration report under a
stable content SHA-256 independent of generation time. Exports are bounded to
10 MiB, served with `Cache-Control: no-store`, and expose
`X-Napier-Content-SHA256`.

When current truth was resolved by a reviewer panel, the Casebook case also
freezes the exact ballot histories and consensus resolution. The report hash
must match the adjudication provenance, and the complete resolution is covered
by the case SHA-256. This keeps exported gold sets self-contained instead of
leaving an unverifiable consensus hash behind.

Older development snapshots that embedded complete cases in every revision are
migrated online into the registry/manifest representation and persisted in one
CAS-protected SQLite update. Duplicate IDs, conflicting legacy snapshots,
unreferenced evidence, invalid revision transitions, and any case,
adjudication, rubric, evaluation, revision, or artifact hash drift fail closed.

### Executable Casebook Qualification

The qualification desk turns a Casebook from a static gold-set archive into an
evaluator release gate. It selects a configured evaluator, minimum exact
agreement, and inconclusive policy, then operates only on the current Casebook
manifest. For every case, Napier rebuilds both source Run replay snapshots and
requires their observed event-stream SHA-256 values to match the hashes frozen
in the curated evaluation before invoking the no-tool judge.

Casebook create, update, curate, remove, and qualification requests are
bounded and strictly parsed before touching projection state or invoking an
evaluator. Unknown wrapper fields, malformed gates, and oversized bodies fail
closed with no revision, execution, or Ledger event.
Successful write responses are no-store and mirror Casebook ID/revision/case
counts or qualification execution status, audit Thread, sample/agreement/
inconclusive counts, unverified count, agreement rate, and execution hash.

Missing or drifted source evidence never reaches the evaluator and forces the
execution to `inconclusive`. Verified judgments retain expected/actual
verdicts, rubric scores, reason, source state, and all expected/observed hashes.
The aggregate binds case order, evaluator, gate, counts, agreement rate, final
status, audit Thread, and Casebook revision to one canonical SHA-256. It is
stored separately from ordinary `RunEvaluationRecord` history and emits only a
hash-level `evaluation.casebook.qualification.completed` Ledger event.

The workspace retains the latest 20 executions per Casebook. A
`napier.evaluation-casebook-qualification-receipt` includes the complete
Casebook and only the latest execution for its current revision. Metadata,
curation, refresh, or removal creates a new revision whose receipt is
explicitly `not_run`; an older passing execution cannot be borrowed. Receipt
responses are no-store JSON attachments with `X-Napier-Content-SHA256`.
Casebook list/detail, calibration, export, qualification history, qualification
receipt, and baseline-list APIs also mirror casebook IDs, revisions, case
counts, qualification execution counts, status totals, and baseline hashes in
no-store response headers for CI polling.

### Trusted Receipt Provenance

Open **Lab → Receipt trust desk** to register an Ed25519 signing identity from
a named environment variable or import a Base64 DER SPKI public key for
verification only. A signing variable must contain a PEM PKCS#8 private key or
`base64:`-prefixed PKCS#8 DER. Napier derives and persists only the public key,
its SHA-256 key ID, label, status, and environment-variable locator; private
key bytes are read only while signing and never enter SQLite, HTTP responses,
or Ledger events.

Both Evaluation Suite gate receipts and Casebook qualification receipts can be
wrapped in `napier.trusted-receipt-envelope`. Its Ed25519 statement binds the
receipt kind, stable receipt `contentSha256`, SHA-256 of the complete receipt
artifact including `generatedAt`, signer key ID, and signing time. The outer
envelope has an independent canonical SHA-256. This dual binding preserves
stable CI correlation while preventing mutable export metadata from being
rewritten under a valid signature.

The verifier replays all nested receipt validation before checking the
statement and signature, then reports `trusted`, `revoked`, `unknown_key`, or
`invalid`. Revocation is irreversible: historical signatures remain
cryptographically verifiable but are no longer trusted. Signature and baseline
Ledger events contain only IDs, public fingerprints, states, and hashes.
Anchor list/create/revoke and verification responses are no-store and expose
content hashes, anchor counts, trusted/revoked/signing-capable totals,
signature key IDs, verification status, and integrity/signature booleans as
headers for machine audit.
`GET /api/receipt-trust/anchors/directory` exports the current public verifier
set as `napier.receipt-trust-anchor-directory`: labels, key IDs, SPKI public
keys, trust/revocation state, public entry hashes, and an anchor-set SHA-256,
without `signingSource` or environment-variable locators. `POST
/api/receipt-trust/anchors/directory/verify` validates an uploaded directory
without mutating Ledger state, and `POST /api/receipt-trust/verify` can accept
that directory alongside a signed envelope to verify external receipts without
copying the local workspace trust table. Both directory verification endpoints
accept an optional freshness/rotation policy with `maxAgeMs`,
`expectedAnchorSetSha256`, `minimumTrustedCount`, and
`requiredTrustedKeyIds`. Policy violations produce an `invalid` directory
verification receipt with policy hash, directory age, and low-cardinality
diagnostics, and signed receipt verification fails closed before trusting a
signature if the uploaded directory violates that policy. The Receipt trust
desk can export and verify these directory JSON files for cross-Ledger
policy-retirement proof bundle audits.

`POST /api/receipt-trust/anchors/directory/discover` fetches a hosted directory
without persisting it. Sources must use public HTTPS and match an exact origin
from the comma-separated `NAPIER_RECEIPT_TRUST_DIRECTORY_ORIGINS` environment
variable. Discovery rejects redirects, non-JSON responses, non-200 status,
private/reserved DNS results, responses above 2 MiB, and requests exceeding
eight seconds. Its no-store receipt exposes only source URL/origin hashes,
response hash/size, and the nested directory verification; the URL is not
returned or written to the Ledger. The Receipt trust desk applies a 24-hour,
minimum-one-trusted-key policy by default, accepts an optional expected
anchor-set SHA-256, and uses an accepted discovered directory for subsequent
signed JSON verification until the operator clears it.

Operators can explicitly promote a hosted source into a durable subscription
through `POST /api/receipt-trust/anchors/directory/subscriptions`. Subscription
creation reruns bounded discovery before storing anything, then retains the
source URL only in the local workspace snapshot so refresh survives restart;
list responses, receipts, headers, and Ledger events expose URL/origin hashes
only. Each subscription binds its policy hash, refresh interval, next refresh
time, revision, and last-good discovery. Production services claim due
subscriptions with expiring tokens and refresh them in the background.
`POST
/api/receipt-trust/anchors/directory/subscriptions/:subscriptionId/refresh`
uses the same path for an immediate refresh, while the subscription update
endpoint pauses or resumes polling through an expected-revision CAS. Invalid,
failed, rollback, concurrent, or stale refreshes cannot replace
`lastGoodDiscovery`; they record only bounded status/discovery/failure hashes
and advance the schedule. Accepted observations append a bounded transparency
entry chain with sequence, previous-entry SHA-256, discovery hash, directory
hash, anchor-set hash, and trusted-key count. If a later hosted response
returns a previously observed non-current directory, refresh returns
`rollback_rejected` and preserves the active verifier set. The Receipt trust
desk restores the newest active last-good directory after reload and exposes
refresh, pause/resume, transparency-tail, and explicit verifier-selection
controls.
`POST /api/receipt-trust/anchors/directory/subscriptions/quorum` evaluates the
active last-good subscription set without mutating Ledger state. The default
policy requires at least two active sources from two distinct source origins
agreeing on the same anchor-set SHA-256; callers can provide
`minimumSources`, `minimumAgreementCount`, `minimumDistinctSourceOrigins`,
`minimumAgreementWeight`, `minimumMetadataPublisherCount`, `sourceWeights`,
`requiredSourceOriginSha256s`, `requiredMetadataPublisherSha256s`, and an
optional expected anchor-set pin. A quorum request can include signed metadata
envelopes for specific subscription IDs; the server verifies each envelope
against that subscription's last-good directory and converts the publisher into
a SHA-256 pin before selection. The quorum receipt groups sources by anchor
set, exposes source/candidate/agreement counts, agreement weight,
distinct-origin count, metadata publisher count/set hash, policy hash,
diagnostics, selected directory hash, and hash-only source evidence. The Receipt
trust desk can request this quorum receipt and renders its status, agreement
count, agreement weight, metadata publisher count, selected anchor set, and
receipt hash beside the subscription list.
`POST /api/receipt-trust/anchors/directory/subscriptions/quorum/promotion`
uses the same no-store request shape, requires the evaluated quorum to be
`agreed`, and returns a self-contained promotion receipt. That receipt embeds
the quorum, selected anchor-set/directory hashes, selected subscription-set
hash, and the selected signed metadata envelopes whose hashes match trusted
source metadata evidence, so an external verifier can archive the promotion
without re-querying the hosted directory endpoints.
`GET /api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines`
lists the append-only signed promotion baselines. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines`
recomputes the same quorum promotion, signs it as a
`receipt_trust_anchor_directory_quorum_promotion` trusted receipt, and promotes
it into local long-lived trust state. Baseline idempotency is keyed by selected
anchor set, selected directory, selected subscription set, and signer key, so
re-running metadata verification cannot create duplicate active verifier pins.
Responses are no-store and expose baseline, envelope, receipt artifact,
selected verifier-set, and signer-key hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/verify`
verifies an uploaded baseline against either local receipt-trust anchors or an
uploaded public trust directory, returning a hash-bound verification receipt
with trusted/revoked/unknown/invalid status, diagnostic hashes, selected-set
hashes, and optional trust-directory verification evidence. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import`
performs the same verification and then appends a local baseline only when
`expectedCurrentBaselineSha256` matches the current latest baseline hash; use
an empty string when importing into a workspace with no existing quorum
baseline. The imported local baseline keeps the archived signed envelope but
receives a local ID, local audit Thread, and local supersession link. Import
requests can also include an optional `importPolicy`. When present, the server
emits a hash-bound `policyReview` and refuses activation before persistence
unless the uploaded archive satisfies local freshness limits, minimum quorum
strength, selected anchor/directory pins, required source-origin hashes, and
required signed-metadata publisher or signer hashes. Successful responses expose
the import policy hash and policy-review hash in headers and in the result
body.
The Web Receipt Trust Desk now includes a baseline activation workbench. It
loads the latest quorum-promotion baseline, compares its selected source-origin
set against current active last-good directory subscriptions, verifies the
baseline against local or active external trust anchors, and imports uploaded
baseline archives with an automatically derived `importPolicy`. The result
surfaces the trusted verification receipt and policy-review hashes next to the
current source alignment state before the verifier set is treated as active.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision`
signs that activation evidence as a
`receipt_trust_anchor_directory_quorum_activation_decision` trusted receipt. The
receipt binds the local baseline, verification receipt, policy review, source
alignment projection, metadata publisher set, metadata signer set, and
approved/rejected diagnostics into one portable envelope; the Web desk can sign
and download it from the activation workbench. Signed decisions are also
retained as durable local records. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions`
exports a stable hash-bound activation history with decision counts,
baseline/source/policy set hashes, and the signed decision records. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify`
performs no-store verification of an uploaded history against the current local
projection, returning `valid`, `divergent`, or `invalid` diagnostics. The Web
workbench can export that history and verify uploaded histories beside the
activation decision receipt. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection`
returns the current active verifier-set selection state. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply`
CAS-applies an approved activation-decision record into that active selection,
binding the public selected directory, baseline hash, decision record hash, and
previous selection hash without importing private signing material. The Web
workbench exposes this as **Apply activation** and renders the active verifier
selection receipt. Once applied, `POST /api/receipt-trust/verify` uses that
active selection directory as the default verifier-key source when the request
does not upload an explicit directory. Verification responses and headers expose
whether the trust source was `active_selection` or `uploaded`, along with the
selection ID/hash when active selection was used.
`GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit`
now performs a no-store comparison between the active selection and the current
subscription quorum, returning `missing_selection`, `aligned`,
`directory_drift`, `anchor_set_drift`, or `quorum_unavailable` with only
selection/quorum hashes and low-cardinality diagnostics. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review`
preflights a candidate activation-decision record against the current
selection CAS hash and live source alignment before any replacement. Requests
can also include `checkpointRegistryQuorumPolicy`; when present, the review
embeds the current checkpoint-registry quorum receipt and blocks the rotation
unless that quorum is `agreed`. The Web workbench adds **Audit drift** and
**Review rotation** receipts beside Apply activation, and automatically gates
rotation review with the default checkpoint-registry quorum policy whenever
checkpoint subscriptions exist, so operators can see whether a verifier-set
rotation is eligible, already active, stale, missing, split, or blocked before
mutating trusted state.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal`
builds on that review to emit an automated no-store rotation proposal receipt.
The proposal consumes the latest or requested checkpoint-registry quorum
baseline as a fail-closed prerequisite, optionally CAS-pins the baseline hash,
and compares its selected checkpoint, selection-set, and chain-tail hashes
against the current activation-selection transparency checkpoint. Only when
the rotation review is eligible and the archived checkpoint quorum baseline
matches current selection transparency does the receipt become `proposed`;
otherwise it remains a diagnostic receipt such as
`missing_checkpoint_registry_baseline`, `already_active`, `stale_selection`,
or `blocked`. The Receipt Trust Desk adds **Propose rotation** beside Review
rotation so operators can inspect proposal, review, checkpoint-baseline, and
current-checkpoint hashes before applying a verifier-set change.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/sign`
turns an eligible proposal into a trusted receipt envelope with kind
`receipt_trust_anchor_directory_quorum_activation_selection_rotation_proposal`.
The server recomputes the proposal at signing time and refuses to sign unless
its status is still `proposed`; the Ledger event records only proposal, review,
decision, baseline, selection, and checkpoint hashes. Once an active verifier
selection exists, `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply`
requires a signed fresh proposal envelope before replacing that selection.
The apply gate verifies the envelope with the active selection directory,
recomputes the current proposal, rejects stale proposals with diagnostic
mismatch labels, and records hash-only proposal evidence on successful
selection rotation. Reapplying the already active decision remains idempotent
and does not require a rotation proposal because it does not mutate trusted
state.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/discover`
fetches a hosted signed proposal envelope from the same allowlisted public
HTTPS source boundary used by trust-directory and checkpoint discovery. The
no-store discovery receipt never returns the raw URL; it records URL/origin,
response, policy, envelope, proposal, review, signer, checkpoint-baseline, and
preflight hashes. Operator policy can pin envelope/proposal hashes, activation
decision ID, expected current selection hash, signer key IDs, and maximum
envelope age. Discovery is `valid` only when the hosted envelope validates,
the signed-proposal preflight is `accepted`, and all policy pins pass;
otherwise it returns `invalid` with diagnostics such as
`proposal_hash_mismatch`, `signer_not_allowed`, or `envelope_expired`.
Operators can persist the same hosted signed-proposal source through `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions`.
Creation reruns discovery first, stores the raw URL only in the local workspace
snapshot, and exposes URL/origin evidence only as SHA-256 values in
subscriptions, headers, receipts, and Ledger events. `GET` on that collection
lists durable subscriptions without source locators. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/refresh`
refreshes a source through the same leased claim path used by the background
worker. Manual and scheduled refreshes update last-good only for `accepted` or
`unchanged` discoveries, reject known rollback observations, preserve last-good
across invalid or failed refreshes, and append a bounded transparency chain
over discovery, envelope, proposal, and preflight hashes.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId`
pauses or resumes a subscription with the same revision guard.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/sign`
signs an operator approval receipt for the subscription's current last-good
proposal. The server rechecks subscription revision/content pins, optional
discovery/envelope/proposal hash pins, reruns the signed-proposal preflight,
and refuses to sign unless the proposal is still `accepted`. The trusted
receipt binds subscription, source, policy, discovery, envelope, proposal,
current preflight, activation-decision, and proposal-signer hashes without
exposing the hosted URL. Callers may include `queueForApply` and `applyAfter`
to store that approval envelope as a local-only pending apply on the
subscription; the public subscription projection and content hash stay
unchanged.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply`
uses that signed approval as the unattended apply gate. The server verifies the
approval envelope with the current active verifier directory, rechecks the
subscription revision/content hash, confirms the approval still matches the
last-good proposal, reruns the current proposal preflight, and only then
CAS-applies the activation decision. Successful Ledger evidence includes
approval, proposal, subscription, and current-preflight hashes only. The
leased subscription worker also claims queued approval applies when
`applyAfter` is due, reruns the same gate, and settles success or failure with
hash-only events.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-review`
reviews a set of signed approvals against an approval policy before apply. The
policy currently supports `minimumDistinctSignerCount` and optional
`requiredSignerKeyIds`; duplicate approvals from the same signer collapse to
one signer, every accepted approval still passes the same approval apply gate,
and the no-store review receipt records envelope, accepted-envelope, signer,
required-signer, subscription, proposal, and current-preflight hashes.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-apply`
requires that policy review to be `accepted`, then uses one accepted approval
gate to CAS-apply the activation decision and returns a policy-bound apply
receipt. Failed policy applies return the review receipt with diagnostics such
as `approval_distinct_signer_count_below_policy` or
`required_signer_missing`.
`GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines`
lists append-only signed approval policy baselines. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-baselines`
recomputes an accepted policy review, signs it as a trusted receipt, and wraps
the envelope in a local baseline that binds policy, subscription, accepted
approval-set, signer-set, and required-signer hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines/verify`
verifies uploaded baselines against local or uploaded trust directories, and
`POST .../approval-policy-baselines/import` CAS-imports trusted archives into a
local append-only chain with a fresh baseline ID.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-apply/queue`
queues unattended policy apply only after the current policy review is
`accepted` and the supplied approval policy baseline hash matches that review's
policy, subscription, proposal, accepted-approval-set, signer-set, and
required-signer hashes. The queued state remains local-only on the subscription
and is excluded from public subscription content hashes; the leased worker
claims due queues, reruns policy review and the baseline gate, CAS-applies the
activation decision, and settles success or failure with hash-only events.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply/replay`
emits a no-mutate post-apply replay receipt for a signed approval. The replay
uses the approval-bound previous selection as the verifier source, checks that
the current active selection has advanced to the approved activation decision,
and returns `aligned`, `divergent`, or `invalid` with only subscription,
approval, proposal, verifier-selection, and active-selection hashes.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/preflight`
runs that same signed-proposal gate without mutating state. The no-store
response returns `accepted`, `rejected`, or `not_required`, includes CAS,
active-selection, envelope, proposal, review, trusted-verification, and
checkpoint-baseline hashes when available, and carries a stable
`contentSha256` so automation can archive the preflight receipt before calling
Apply activation. The Receipt Trust Desk exposes this as **Preflight
proposal** after a proposal is signed.
`GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint`
exports the applied verifier-set rotation chain as a compact checkpoint. Each
entry binds only sequence, selection hash, activation-decision hashes, baseline
hash, selected directory/anchor-set hashes, policy-review hash, and
source-alignment hash; raw subscription URLs and private signer locators are
not included. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify`
validates an uploaded checkpoint against the current local selection history
without persisting it, returning `valid`, `divergent`, or `invalid`
diagnostics. The Web workbench can export and verify those checkpoint JSON
artifacts beside drift and rotation receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/sign`
signs the current checkpoint as a
`receipt_trust_anchor_directory_quorum_activation_selection_checkpoint`
trusted receipt envelope. The Web workbench adds **Sign checkpoint** and
downloads the signed envelope so external registries can publish the rotation
chain without trusting the local transport channel. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/discover`
now fetches one of those signed checkpoint envelopes from the same allowlisted
hosted-source boundary as public anchor directories. The no-store discovery
receipt verifies the Ed25519 envelope with an uploaded directory, the current
active selection directory, or local anchors; compares the checkpoint against
local selection history; and enforces freshness, required signer keys, expected
checkpoint/selection-set/tail hashes, minimum selection count, and rollback
rejection. Source URL/origin, response body, policy, envelope, and checkpoint
evidence are returned as hashes only. The Receipt Trust Desk adds **Discover
checkpoint** with URL and optional checkpoint-hash pin fields, then renders
accepted or rejected hosted checkpoint receipts beside the signed envelope.
Operators can promote the same hosted checkpoint source into a durable
checkpoint registry subscription through `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions`.
Subscription creation reruns discovery first and stores the raw URL only in the
local workspace snapshot; list responses, headers, receipts, and Ledger events
keep URL/origin evidence hash-only. Manual and scheduled refreshes use the same
signed-envelope discovery path, update last-good only for accepted or unchanged
checkpoints, preserve last-good across invalid or failed refreshes, and append
a bounded transparency chain over discovery, envelope, checkpoint, selection
count, selection-set, and chain-tail hashes. Pause/resume uses revision CAS,
and the Receipt Trust Desk can create, refresh, and pause checkpoint
subscriptions beside the discovery receipt.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum`
evaluates those durable checkpoint registries without mutation. The default
policy requires at least two eligible signed checkpoint sources, two agreeing
observations, and two distinct source origins. Callers can add checkpoint,
selection-set, chain-tail, minimum-selection, source-origin, signer-key, and
observation-age pins. The no-store quorum receipt groups eligible sources by
checkpoint SHA-256 and returns `agreed`, `insufficient_sources`, `split`,
`policy_failed`, or `stale` with hash-only source, candidate, policy, selected
checkpoint, selected selection-set, selected chain-tail, agreement, and
diagnostic evidence. The Receipt Trust Desk adds **Evaluate checkpoint quorum**
so operators can see independent-registry agreement or stale/split policy
alerts before trusting a hosted active-selection checkpoint.
`GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines`
promotes an `agreed` checkpoint-registry quorum into a signed append-only
baseline. The baseline envelope uses trusted receipt kind
`receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum`
and binds the selected checkpoint, selection-set, optional chain-tail,
subscription-set, source-origin-set, signer-set, signer key, and supersession
link. Duplicate promotion is idempotent by the selected registry evidence and
signer key. The Receipt Trust Desk adds **Promote checkpoint quorum** and
downloads the signed baseline JSON so independent-source checkpoint agreement
can be archived for cross-workspace verifier rotation audits.
`POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/verify`
performs no-store verification of an uploaded baseline against local anchors
or an uploaded trust directory, returning baseline/signature/integrity
diagnostics plus baseline, envelope, quorum, selected checkpoint, source-set,
signer-set, and directory verification hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/import`
then CAS-imports a trusted baseline with `expectedCurrentBaselineSha256`,
appending a local supersession record and hash-only Ledger event or returning
an idempotent already-archived result. The Receipt Trust Desk can verify the
current checkpoint quorum baseline and import signed baseline JSON archives.

Publisher-signed directory metadata adds a signed statement around a public
anchor directory without changing the directory format. `POST
/api/receipt-trust/anchors/directory/signed-metadata` signs the current local
directory as a `receipt_trust_anchor_directory_metadata` trusted receipt,
binding publisher, directory SHA-256, anchor-set SHA-256, key counts, optional
source URL/origin hashes, and optional expiry. `POST
/api/receipt-trust/anchors/directory/metadata/verify` verifies the envelope
against either local receipt-trust anchors or an uploaded trust directory, then
separately verifies that the signed metadata still matches the supplied
directory. Responses are no-store and expose signature, integrity,
directory-binding, diagnostics, signer key, directory hash, and anchor-set hash
headers. The Receipt trust desk can export signed metadata and verify uploaded
metadata against the active external directory.

A Casebook qualification baseline can be promoted only from a current
revision's `passed` receipt signed by a currently trusted local signer. It
freezes the complete signed envelope and exact qualification execution,
protects that execution from history pruning, and links to the prior baseline
without rewriting it. A Casebook revision makes the baseline stale; a signer
revocation makes it revoked. Neither state may borrow an older passing result.
Baseline promotion responses are no-store and mirror the result hash, created
flag, Casebook revision, baseline hash, qualification execution hash, receipt
artifact hash, envelope hash, and signer key ID for release gating.

## Architecture

```text
apps/web             Paper Ledger workbench; consumes contracts only
apps/server          Hono HTTP/SSE adapter and static production host
packages/contracts   Stable domain and stream contracts
packages/runtime     Agent loop, policy, goals, memory, subagents, MCP, store
skills/              Bundled Agent Skills packages
.napier/             SQLite ledger and compatibility projections; ignored by Git
```

The runtime follows four invariants:

1. Durable behavior is recorded before it is presented.
2. Sequence numbers are strictly increasing within a thread.
3. Model credentials and host capabilities stay server-side.
4. Tool permission is evaluated immediately before execution.

See [Architecture](./docs/architecture.md) for the event contract, runtime
boundaries, and planned capability layers.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run check
npm run check:management-openapi
npm run check:management-openapi-compatibility
npm run check:package-lock
npm run check:package-lock-receipt
npm run check:release-artifacts
npm run check:runtime-environment
npm run check:runtime-environment-receipt
npm run check:web-dist
npm run check:web-dist-manifest
npm run check:web-dist-receipt
npm run update:web-dist-manifest
npm run verify:package-lock-receipt
npm run verify:release-artifacts
npm run verify:runtime-environment-receipt
npm run verify:web-dist-receipt
npm run write:management-openapi
npm run write:management-openapi-compatibility
npm run write:package-lock-receipt
npm run write:release-artifacts
npm run write:runtime-environment-receipt
npm run write:web-dist-receipt
```

`npm run check` first audits the current Node runtime against
`package.json#engines.node` and required `process.versions` components, verifies
the stored runtime receipt, audits `package-lock.json` against the root package
and every workspace package, verifies the generated management-plane OpenAPI
route artifact, verifies the management OpenAPI compatibility fixture, then
builds every workspace, verifies the production Web dist against a generated
`docs/artifacts/web-dist-0.1.0.sha256`, enforces the `150 KiB` uncompressed
main-entry budget, verifies the checked-in Web dist receipt, and then runs all
tests. The runtime gate checks the observed Node version, platform, arch, and
SQLite/OpenSSL/libuv/V8 component versions before build output is trusted;
`npm run write:runtime-environment-receipt` refreshes the
`docs/artifacts/runtime-environment-audit-0.1.0.json` release evidence after an
intentional runtime baseline change. The package-lock gate checks lockfile
version, root/workspace package metadata, workspace links, and external package
integrity hashes before any build work starts, and
`npm run check:package-lock-receipt` verifies the stored
`docs/artifacts/package-lock-audit-0.1.0.json` receipt against the current
root package and lockfile. Use `npm run write:package-lock-receipt` after
intentional dependency changes. `npm run write:management-openapi` scans
`apps/server/src/app.ts` and writes
`docs/artifacts/management-openapi-0.1.0.json`, a stable OpenAPI 3.1 route
catalog with source and route-set SHA-256 evidence; `npm run
check:management-openapi` fails when that artifact no longer matches the
current management API routes. `GET /api/health` has a promoted
`HealthResponse` schema, and the receipt-trust anchor lifecycle now promotes
list, create, directory, directory metadata signing, metadata verification,
directory verification, hosted discovery, durable subscription management,
multi-source quorum evaluation, generic receipt verification, revoke request,
and anchor response schemas for external verifier management clients.
`npm run
write:management-openapi-compatibility` writes
`docs/artifacts/management-openapi-compatibility-0.1.0.json`, a published
operation baseline derived from that OpenAPI artifact; `npm run
check:management-openapi-compatibility` allows additive routes but rejects
removed operations or drift in operation ids, path parameters, JSON request-body
presence, promoted schema refs, tags, or response status sets. After a Web build
changes chunk names or hashes, run `npm run update:web-dist-manifest` to write the canonical manifest;
`npm run check:web-dist-manifest` is the check-only guard that fails when the
checked-in manifest is stale. `npm run write:release-artifacts` writes a
top-level `napier.release-artifacts-audit` receipt that binds the package-lock
receipt, runtime-environment receipt, management OpenAPI artifact, management
OpenAPI compatibility fixture, Web dist receipt, and Web dist manifest by
SHA-256; `npm run check:release-artifacts` /
`npm run verify:release-artifacts` verify that aggregate receipt against the
current component receipts. `npm test` starts with root-level release-gate contract
tests before running workspace suites, so package-lock drift, runtime version
drift, missing runtime components, OpenAPI route drift, manifest drift, extra
dist files, malformed manifests, stale receipts, compatibility regressions,
aggregate artifact drift, and entry-budget regressions are covered without
mutating the real build output.
`npm run check:web-dist -- --json` emits a `napier.web-dist-audit` receipt with
relative paths, file counts, main-entry budget status, the manifest SHA-256,
the canonical dist-content SHA-256, and any errors for CI capture. Trace, Plan,
Run Lab, Evaluation Suites, Memory, Extensions, Context, and Automations remain
separate lazy chunks, while React-compatible components compile against Preact's
compatibility runtime. Sourcemaps remain enabled for dependency auditing.
`npm run write:web-dist-receipt` writes the same passing receipt to
`docs/artifacts/web-dist-audit-0.1.0.json`; custom `--receipt-path` values must
stay repo-relative, and a failed audit removes an existing target instead of
leaving a stale success receipt behind. `npm run check:web-dist-receipt` and
`npm run verify:web-dist-receipt` re-run the current audit and compare the
stored receipt byte-for-byte against the expected receipt projection.

## Data And Safety

Runtime data defaults to `<workspace>/.napier` and can be moved with
`NAPIER_HOME`. Tool access is confined to `NAPIER_WORKSPACE` (the current
directory by default). `ledger.sqlite` is authoritative; `workspace.json` and
`events/*.jsonl` are non-authoritative compatibility projections for local
inspection and legacy migration. `/api/health` returns the shared
`HealthResponse` contract with the current SQLite schema version, quick-check
result, migration history, and public Node runtime readiness metadata without
exposing workspace content. The health response is `no-store` and mirrors a
response content hash, service/status, Node version/platform/arch, runtime
component count/hash plus SQLite/OpenSSL/libuv/V8 versions, Ledger schema
version, quick-check status, migration count, migration-list hash, and latest
migration metadata in headers for CI readiness probes.
Thrown management API errors, explicit management JSON errors, and unknown
`/api/*` routes use the same no-store projection style: the JSON error body is
hash-bound with `X-Napier-Content-SHA256`, and headers expose only the HTTP
status, a stable low-cardinality error code, and a SHA-256 of the error
message.
The Web client requires management JSON responses to carry
`X-Napier-Content-SHA256`. It accepts either an exact response-body hash or a
stable digest handle such as `contentSha256` / `reviewSha256` only after
recomputing the same canonical JSON projection client-side. Hash-bound JSON
responses also expose `X-Napier-Content-SHA256-Mode`, with `body` meaning the
header binds the exact serialized JSON response and `stable` meaning the header
binds a canonical durable projection. The Web verifier treats that mode as a
constraint when it is present and keeps backward-compatible inference only for
older responses that omit it; unsupported explicit mode values fail closed
before any body text is trusted. For `body` mode, successful and failed JSON
responses verify the raw response hash before `JSON.parse`; malformed JSON
after a verified hash is reported as a structured parse failure instead of
falling through to an untyped syntax error or status-only fallback. Stable
artifact projections cover generated/exported timestamp exclusion, execution
ID/runtime timestamp exclusion, review receipts, Casebook artifacts, and
Extension deployment/rollout previews that replace nested preview bodies with
their SHA-256 handles. Failed JSON response bodies and
`X-Napier-Error-Message-SHA256` are verified before trusting their text. Failed
API responses are wrapped as `NapierApiError`, preserving the server message
plus status/code/content/message hashes for operator diagnostics without
accepting tampered body text. Shared UI error banners format those fields
consistently so operators see the same status/code/hash handles as automation.
All JSON API wrappers use one shared request helper, keeping success hash
verification, error hash verification, header parsing, and error construction
centralized; streaming Run APIs only keep their separate fetch path for SSE
decoding. Malformed successful SSE frames fail with `NapierStreamFrameParseError`
that carries only the stream path, frame SHA-256, and line count; JSON-valid
frames that violate the `StreamFrame` union fail with
`NapierStreamFrameContractError` and a low-cardinality reason. Runtime
`error` frames remain valid protocol frames and carry the stream `threadId`, a
stable public message, `run_failed` code, and SHA-256 diagnostic handle for the
original exception; the raw exception text is not streamed. Prompt and resume SSE responses expose
thread/run intent headers plus the stream error code, diagnostic type, and
public error-message hash up front, while keeping terminal per-error diagnostics
inside the streamed error frame. The Web client verifies these stream response
headers before reading the SSE body and requires every successful stream to end
with a terminal `done` or `error` frame; when an SSE `event:` name is present it
must match the JSON `frame.type`; event frames must carry an SSE `id:` equal to
`frame.event.seq` and stream-local event sequence values must strictly
increase, while non-event frames must not carry `id:`. Event frames must use a
positive safe-integer sequence plus known `EventCategory` and `EventVisibility`
values, and carry `eventSha256`; the Web client recomputes the hash of
`frame.event` before dispatch. Event, snapshot, `done`, and `error` frames must
also bind back to the declared stream thread, event/`done` frames must stay on
one Run identity, and `done.status` must be one of `completed`, `failed`,
`cancelled`, or `interrupted`. Any
snapshot frame must include `thread.id`, a known `thread.status`, and a
non-negative `thread.eventCount` that matches the event list length and final
sequence. Snapshot event lists must contain only same-thread valid RunEvent
records with contiguous increasing `seq` values, and the snapshot must include
the Workbench-owned `agent`, `contextCheckpointCalibration`, and top-level
collection projections. Snapshot `agent.id` must match `thread.agentId`, every
Run must belong to that thread and Agent, and `thread.runIds` / `currentRunId`
must resolve inside the `runs` projection. Snapshot frames also carry
`detailSha256`; the Web client recomputes the hash of `detail` before replacing
the Workbench projection. A terminal `done` frame carries `threadId`,
`snapshotSha256`, `eventCount`, and `eventStreamSha256`, and is accepted only
after that final snapshot has been received and verified. The `threadId` must
match the declared stream thread, the snapshot hash, event count, and ordered
event-stream hash must match the snapshot, and the snapshot must contain the
same `done.runId` with the same terminal status. The final snapshot must also
contain every already-streamed event with the exact same event SHA-256, so stale
or truncated projections fail before UI callbacks. A runtime `error` frame can
still terminate a failed stream without a snapshot when its `threadId` matches
the stream. Any semantic frame after the terminal frame is rejected before it
reaches UI callbacks.
Callback errors from frame consumers are allowed to propagate unchanged. The Web
workspace includes contract tests for success JSON content-hash verification,
recomputed stable artifact/review/execution/preview digests, hash drift
rejection, error body/message hash drift rejection, header-backed
`NapierApiError`, missing-metadata fallback paths, SSE frame parsing,
unterminated final records, missing terminal-frame rejection, runtime error
frames with diagnostic hashes, SSE event/frame type matching, SSE id/sequence
matching, monotonic event-sequence rejection, stream thread/run identity
rejection, invalid event field rejection, event hash drift rejection, invalid or
incomplete snapshot rejection, snapshot hash drift rejection,
missing-final-snapshot rejection, snapshot/done run-status mismatch rejection,
done/snapshot hash mismatch rejection, snapshot/streamed-event mismatch
rejection, done/event-count mismatch rejection, non-terminal `done` rejection,
terminal-after-data ordering, prompt/resume
intent and error-protocol headers, hash-only malformed/invalid-frame
diagnostics, hash-bound pre-stream error wrapping, pre-stream missing-hash
rejection, missing readable bodies, and a static API-boundary
allowlist that keeps direct `fetch` calls confined to `api-client.ts` and the
SSE client in `api.ts`.
`requestJson` call sites are statically scoped to `/api/*` management routes so
static assets and external URLs cannot inherit the management hash contract by
accident. These Web contract tests are included in the Web TypeScript project so
`npm run build -w @napier/web` typechecks them before the production bundle is
emitted.

Run lease tokens, automatic-recovery claim tokens, webhook bearer tokens, and
inbound idempotency keys, including GitHub delivery IDs used for deduplication,
are never stored in plaintext. Their SHA-256 digests support authorization and
deduplication; public snapshots expose only short fingerprints. Inbound message
content remains durable work evidence and is visible to the target Agent, so
channels should accept only intended operational data.

The default Agent policy is `observe`:

- read/list/search inside the workspace are allowed;
- `apply_patch` and `verify_workspace` are not exposed;
- workspace writes and process execution are blocked;
- shell execution is blocked;
- destructive shell patterns remain blocked even under the future
  `unrestricted` policy.

Selecting `workspace` exposes only individually enabled structured tools:
**Atomic patch** is hash-preconditioned and supports Hashline-style line
anchors, while **Sandbox verify** is read-only, offline, and command-closed.
Authorization is checked again immediately before every call.

This in-process policy is defense in depth, not an operating-system sandbox.
General shell execution remains disabled. Stdio MCP and structured workspace
verification are the narrow process exceptions: macOS uses
`/usr/bin/sandbox-exec`; Linux requires `/usr/bin/bwrap` and usable kernel or
setuid namespace support. Windows or explicitly containerized deployments can
opt into an OCI adapter by configuring `NAPIER_CONTAINER_SANDBOX_IMAGE`; it
uses an absolute Docker-compatible executable, read-only root filesystem,
capability-derived workspace mounts, and `--network none` unless networking is
approved. These adapters launch only an explicitly selected absolute
executable, avoid shell invocation, and derive network and workspace access
from reviewed capabilities. Missing sandbox prerequisites and unsupported
platforms fail closed; a container or VM remains the recommended outer
boundary for production third-party code.

## License

Napier is released under the [MIT License](./LICENSE).
