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

- Pi's complete version-pinned built-in model catalog: 38 Provider factories
  spanning OpenAI/Anthropic/Google APIs, OpenAI-compatible services, regional
  endpoints, subscription-capable Providers, gateways, and local-model hosts;
- a deterministic zero-key demo model for onboarding and CI;
- `napier chat` for line-oriented and `napier tui` for bounded full-screen
  one-Runtime multi-turn terminal sessions with model/Thread switching,
  interrupted-Run resume, per-turn timeout, active-Run cancellation, and
  metadata-only tool cards, plus `napier run`, `napier resume`,
  sequence-accurate `napier branch`, and typed `napier workflow` commands with
  human output or hash-bound JSONL, all backed by the same Agent Runtime, model
  registry, policy, Sandbox, SQLite Ledger, and domain services as HTTP/Web;
- a long-lived local `napier rpc` stdio JSON-RPC 2.0 process for Agent and
  typed Workflow run/resume plus fresh Approval answer-and-resume,
  preview-bound checkpoint experiments, request-bound Ledger event
  notifications, standard cancellation, bounded concurrency, and orderly
  shutdown over the same Runtime services used by the TypeScript SDK;
- versioned executable Plan Workflow manifests with bounded runtime schemas,
  explicit typed node bindings, frozen Agent revision, real Run-backed Agent
  nodes, bounded model-free Deterministic data-shaping nodes, model-free Tool
  nodes, bounded read-only Agent Map fan-out, bounded sequential read-only
  Agent Loop refinement, and durable human Approval gates, strict JSON output,
  declared tool effects, policy/schema preflight, optional bounded parallel
  waves, persistent pre-node breakpoints with Manifest-bound Plan Workbench
  continuation, explicit retry, safe checkpoint reuse, restart reconstruction,
  and shared CLI/HTTP/SDK/RPC/Web/Trace evidence. A Workflow with declared
  workspace file or directory Artifacts completes only after Napier hashes
  current bytes and records the existing `produced -> verified` Plan lifecycle;
  missing, drifted, oversized, escaped, or symlink-backed delivery blocks
  instead of trusting node output;
- controlled Workflow checkpoint experiments with verified ancestor reuse,
  isolated descendant reruns, per-node model replacement, preview-bound
  side-effect confirmation, and source-versus-target status, Run, model,
  retry, latency, usage, cost, tool, output, Evaluation, and Artifact
  comparison. A schema-2 single-node mode executes only the selected
  checkpoint, pauses durably before its direct successors, and requires an
  explicit breakpoint continuation before the remaining subgraph can run. A
  schema-3 simulation mode instead Schema-validates one explicit selected-node
  output, materializes it as a zero-model/zero-tool `workflow_simulation` Run,
  and executes only its descendants through the normal scheduler. A schema-4
  input-replacement mode Schema-validates one complete constructed checkpoint
  input, reuses verified ancestors, then executes the selected node and every
  descendant through that same scheduler. A schema-5 step-control mode executes
  the selected checkpoint, holds every remaining rerun node, and releases
  exactly one ready node per durable Continue even across parallel branches or
  restart. A selector-free schema-6 top-level input replacement validates one
  complete Workflow input, reruns every node through the ordinary scheduler,
  and compares the resulting graph without a hidden node override. SDK, local
  RPC, CLI, HTTP, and a lazy Plan Workbench desk share the complete
  preview-confirm-execute-inspect flow;
- controlled Agent message experiments that select a terminal historical
  `message.user`, freeze its Agent revision, Prompt Variables, Skill catalog,
  reviewed Memory context, complete model-message history, and current
  Workspace snapshot, then rerun it in an isolated read-only Branch with an
  optional model replacement. CLI JSONL, HTTP SSE, TypeScript SDK, and local
  stdio RPC return a hash-bound source/target status, configuration, latency,
  usage, cost, output, and tool comparison while experiment-specific Ledger
  and Trace evidence remains prompt/result-body-free. An optional
  `reuse_source` mode supplies exact captured results for the source Run's
  stateless read-only tools without executing their bodies; any changed,
  reordered, missing, extra, or partially consumed call fails the isolated
  target. A lazy Run Lab desk adds browser-independent hash validation,
  explicit cancellation, bounded comparison, target navigation, and deliberate
  result download without adding the experiment client to the main Workbench
  bundle;
- controlled single-model-invocation experiments for provider-backed Agent
  calls. Primary turns, compaction, Goal evaluation, and Memory extraction
  capture the exact Pi provider Context plus safe sampling options in a
  permission-restricted, bounded local CAS while the Ledger retains only a
  hash-bound receipt. CLI JSONL, HTTP SSE, TypeScript SDK, local stdio RPC, and
  a lazy Run Lab desk can preview one terminal source turn, optionally replace
  its model, and execute exactly one isolated provider call. Candidate tool
  calls are compared but never executed; the browser independently validates
  the complete hash chain while provider Context, raw thinking, candidate
  text/tool arguments, and capsule contents remain absent from portable Replay,
  Web Trace, and the rendered desk;
- controlled single-tool-invocation experiments for eleven built-in stateless
  read-only tools. Exact admitted arguments remain in a bounded local-only
  capsule while CLI JSONL, HTTP SSE, TypeScript SDK, local stdio RPC, and a
  lazy Run Lab desk preview-bind the source call, current scoped Workspace,
  Agent revision, tool implementation, and completed output before executing
  that tool exactly once with no Agent Loop or model call. The browser
  independently validates the result stream and renders only status, latency,
  byte counts, and hashes; arguments, paths, source output, and candidate
  output remain outside Ledger, portable Replay, Trace, and the desk;
- a checked product-path performance budget over three cold built-CLI JSONL
  runs, shared Runtime bootstrap, the production `read_file` executor, a
  1,000-event SQLite Thread, observed RSS, and closed-ledger database growth,
  with a strictly reprojected release baseline;
- an authoritative SQLite WAL that commits workspace projections and ordered
  events atomically, uses revision CAS for concurrent local writers, and
  migrates legacy `workspace.json`/JSONL state without evidence loss;
- replayable threads and branch creation from any message sequence;
- durable goals with independent evidence evaluation, bounded automatic
  continuation, and no-progress breakers;
- bounded strict JSON parsing for Thread creation, Branch, Goal, Resume,
  Prompt, live Run control, and Trace export requests before runtime state
  mutation, evidence copying, or model execution;
- bounded strict JSON parsing for schedule, inbound-channel, Memory,
  Credential, Receipt Trust, signed receipt, Agent profile, MCP Extension
  management, package signing/rollout governance, Run Evaluation, reviewer
  consensus, Evaluation Suite administration, and Evaluation Casebook
  mutation/qualification before state mutation, model judging, signing, tool
  exposure, or background workers can claim new automation work;
- revisioned parent-Run budgets for model turns, total tokens, reported model
  cost, and wall time, snapshotted onto every Run with fail-closed Ledger
  evidence;
- a durable in-flight Run control inbox with one-at-a-time steering and
  follow-up delivery, atomic user-message evidence, bounded queues, terminal
  settlement, and a live Workbench composer;
- durable Operator Decision gates that let the Agent stop on one structured
  2-4 option question, preserve answer and continuation as separate Ledger
  transitions, and resume through an explicitly linked child Run without
  allowing an ordinary Prompt to bypass the waiting gate;
- durable Agent Milestones that let a live Agent record bounded planning,
  execution, verification, or delivery snapshots; each immutable snapshot is
  predecessor-linked and automatically binds the actual same-Run Ledger events
  since the prior milestone before being reinjected on the next Pi turn;
- workspace-confined read, list, literal search, and structured data inspection
  tools with canonical realpath checks plus complete-file, entry-set,
  line-anchor, column-set, and sample SHA-256 evidence;
- `ast_query` and `ast_edit_preview` tools for bounded, in-process
  TypeScript/JavaScript syntax selection and no-write structural previews
  bound to current file and node hashes; reviewed changes still pass through
  the existing CAS patch and verification path;
- a hash-bound `apply_patch` tool for atomic UTF-8 file creation, exact
  replacement, and Hashline-style line-anchor replacement under the explicit
  `workspace` policy, without general shell or file deletion;
- configurable Model Advisor gates that combine deterministic checks with an
  optional distinct zero-tool review model before assistant text becomes
  visible; candidate and reviewer guidance prose remain hash-only while
  observe/enforce modes share bounded tool-free correction receipts;
- a durable Tool Loop Guard that detects repeated single-tool calls with
  identical argument/result hashes, injects a next-turn redirect, and blocks a
  further identical call before execution;
- hash-only Model Context Envelopes that bind every actual Pi provider request
  to System Prompt, provider-message, tool-name, and tool-definition hashes
  without persisting raw prompts, messages, tool names, tool schemas, or tool
  outputs;
- a `verify_workspace` tool for bounded TypeScript, Vitest, and Prettier checks
  through the OS sandbox with a read-only workspace, no network, no shell, and
  fixed local or explicitly bound external CLI entrypoints;
- automatic write-linked TypeScript/JavaScript test verification for
  `apply_patch` and verified LSP rename/quick-fix writes when
  `verify_workspace` is explicitly enabled: Napier scans the nearest package
  or declared monorepo workspace, binds changed declarations and a bounded
  static relative/workspace-package/path-alias graph, executes up to eight
  reverse-dependent Vitest files in the same read-only, offline Sandbox, and
  rejects stale source or resolution-config evidence;
- `lsp_diagnostics`, semantic `lsp_symbols`, `lsp_definition`,
  `lsp_references`, preview-bound `lsp_rename` / `lsp_rename_apply`, and
  quick-fix-only `lsp_code_actions` / `lsp_code_action_apply` tools that drive
  the standard TypeScript language server against TypeScript or JavaScript
  workspace files through the same read-only, offline OS sandbox, reuse one
  Run-owned Session while the bounded workspace remains unchanged, resolve
  advertised data-backed actions for text edits only, deny every returned
  command, and optionally commit exactly one selected alternative through the
  shared coordinated WorkspaceEdit transaction with hash-only durable
  projections;
- a `run_command` tool for foreground Node diagnostics with
  explicit argv, a canonical workspace cwd, read-only/offline OS sandbox
  capabilities, a fixed secret-free environment, bounded output and wall time,
  parent-Run cancellation, and argument/output-redacted Ledger evidence;
- a `git_inspect` tool for workspace-root repository status, working/staged
  patches, and one bounded 1–4 path regular-text conflict set. Napier generates every Git
  argument, parses the exact bound index for base/ours/theirs stages, rejects
  gitfiles/symlinked metadata/index locks, disables optional locks, pagers,
  external diff, textconv, and submodule traversal, binds HEAD/index/config
  freshness, and keeps paths, hunks, and conflict text live-only;
- `git_stage_preview` and `git_stage_apply` tools that build an exact
  one-to-sixteen-path whole-file set or one selected-hunk patch in a private
  index/object directory, bind every attribute chain, selection, and repository
  state, then promote verified objects and atomically install only the reviewed
  index through `index.lock`;
- `git_commit_preview` and `git_commit_apply` tools that reconstruct the
  complete staged tree in a private object directory, bind an ordinary or
  exact two-parent merge topology plus normalized message and fixed identity/
  timestamp, then promote verified objects and CAS-update only the attached
  branch with durable reflog, restart-safe merge-state cleanup, and recovery
  evidence;
- `git_branch_create_preview` and `git_branch_create_apply` tools that bind one
  validated local branch name to the exact current HEAD, then zero-old-CAS
  create and fsync only that ref/reflog without switching HEAD or touching the
  index/worktree;
- `git_branch_switch_preview` and `git_branch_switch_apply` tools that attach
  HEAD to an existing local branch through an exact source/target ref
  transaction; same-tree switches preserve dirty state, while bounded
  divergent text trees use durable worktree/index backup and recovery;
- `git_review_preview` and `git_review_apply` tools that expose every bounded
  linear commit patch from one older local target to current attached HEAD,
  then fast-forward only that target through old-target CAS and exact reflog
  proof without switching or rewriting source history;
- a `workspace_process` tool and lazy Processes Workbench for bounded
  background Node sessions with cursor-based stdout/stderr observation,
  explicit interactive stdin, cancellation, lifecycle settlement, graceful
  shutdown, fail-closed restart reconciliation, and one-use preview-bound
  writes to explicit existing scopes with directory-aware Delta containment;
- a `javascript_kernel` tool for persistent synchronous JavaScript calculations
  within one Agent Run, reusing the same read-only/offline Process Session
  boundary with bounded evaluations, live-only values, cancellation, and
  terminal handling for uncertain state;
- a `python_kernel` tool for persistent restricted synchronous Python
  calculations within one Agent Run, with fixed interpreter/runtime assets,
  pure-computation syntax and builtins, traced-heap enforcement, and the same
  private Process/Ledger boundary;
- preview-bound `workspace_file_preview` / `workspace_file_apply` tools plus a
  lazy Files recovery panel for directory creation, no-overwrite-intent moves,
  reversible trash, and explicit restore without shell access;
- a `sqlite_query` tool for schema inspection, parameterized read-only SQL, and
  deterministic single- or multi-series bar/line SVG over canonical static
  workspace database snapshots, with process-isolated timeout/cancellation,
  live-only rows/SVG, and verified Artifact delivery through the existing CAS
  writer;
- a hash-bound `data_frame` tool for complete JSON/JSONL/CSV/TSV/Markdown
  table transformations through explicit typed casts, filters, selection,
  stable sorting, grouping, aggregation, and limits, with complete JSON output,
  Agent/Workflow reuse, and body-free Replay/Trace evidence;
- a default-enabled, provider-neutral `web_search` tool under the read-only
  `observe` policy. It supports general/news/image discovery plus time,
  language, region, site, count, and safe-search constraints; prefers
  configured Brave or Tavily credentials, then falls back to credential-free
  Bing RSS and DuckDuckGo HTML. Every request validates public DNS, pins the
  connected address, revalidates bounded redirects, strips credentials across
  origins, and caps time and bytes. Queries, result URLs/snippets, and
  credentials remain outside Ledger and Trace;
- a default-enabled `web_fetch` Source reader under the same `observe` policy.
  It reads public HTML through Mozilla Readability, pretty-prints JSON, retains
  Markdown/plain text, and extracts text from PDF bytes with Apache-licensed
  PDF.js. Each fetch creates a Run-local hash-bound Source with bounded preview;
  `read`, `find`, and `list` progressively recover exact line ranges without
  refetching. Downloads stop at 8 MiB, PDF parsing stops at 200 pages/15
  seconds, normalized content stops at 2 million characters/20,000 lines, and
  Source URLs/bodies remain outside Ledger and Trace. When the default
  read-only Browser is also enabled, a successful HTML `document.write` shell
  with little static text automatically renders once through the same
  controlled Chrome manager. HTTP errors, PDFs, binaries, password forms,
  ordinary static HTML, and arbitrary parse failures never trigger fallback;
  bounded `Render`, fallback status/diagnostic, and Browser provenance remain
  auditable without exposing page content.
  `research_source capture_fetch` can import that exact same-Run Source by ID
  and content hash, then reuse the ordinary claim-bound citation and Markdown
  report verifier;
- Run-owned controlled Chrome Sessions plus a `research_source` tool that
  freezes bounded Browser or imported Fetch text, binds exact line ranges to
  report claims, returns citation tokens to the live Agent, and retains only
  privacy-bounded hashes, ranges, counts, and source-specific provenance in
  Ledger and Trace;
- fresh default `observe` Agents expose a read-only Browser schema with
  `start`, `navigate`, `back`, bounded `wait`, literal `find`, bounded vertical
  `scroll`, `snapshot`, `screenshot`, and `close`, plus `research_source`
  capture/cite/list/report verification. Find and scroll keep Browser network
  access closed. Interactive `click`, `type`, `select`, `upload`, and
  `download` are omitted from that schema and remain policy-denied unless an
  Agent explicitly uses `unrestricted`; forged calls never reach Playwright;
- a fail-closed tool policy that blocks host escape and destructive commands;
- Agent Skills discovery through standard `SKILL.md` packages;
- frozen Agent Prompt Variables with strict `literal`, `current_date`, and
  `skill_catalog` definitions, single-pass non-recursive System Prompt
  rendering, schema-7/8 Run fingerprints, and hash-only replay receipts;
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
  plus an opt-in `coder` role that creates, modifies, deletes, or renames up to
  eight explicitly authorized text-file paths in a bounded private workspace
  snapshot, runs real LSP and optional fixed Sandbox verification against
  candidate bytes, and returns a bounded live change review plus
  snapshot-fresh pass/fail/stale evidence and a one-use candidate for explicit
  parent merge. Parent apply automatically compares supported lifecycle paths
  with fresh LSP and, when enabled, runs tests selected from both the old and
  new dependency graphs. All roles retain bounded run budgets, cancellation,
  strict typed outcomes, hash-bound delegation receipts, and a
  compaction-immune durable task projection;
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
  assessments and attempts, subagents, Operator Decisions, Agent Milestones,
  frozen Prompt Variable snapshots, Model Context Envelopes, and the complete
  ordered event stream to independent content/event SHA-256 digests, with
  atomic import, collision-free resource-ID remapping, and milestone
  evidence-range rehashing;
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
  ready-step, blocked-step, phase-wave, and parallel-ready projections,
  evidence-gated step transitions, governed revision-CAS replanning,
  hash-bound replan recommendations for
  blocked critical paths and missing artifacts, generated replacement-plan
  drafts that can be fed back through replan CAS, deterministic draft
  evaluation scores with risk and evidence hashes, no-store hash-bound model
  review artifacts for active drafts with Workbench-visible hash-only request
  envelopes plus explicit draft application from the Plan Workbench,
  model/thinking-specific replan policy templates in Agent tool output,
  hash-bound Plan archive export
  plus no-store archive
  verification, no-store Plan REST response hashes and plan/replan count
  headers, reusable workflow blueprint export/upload verification, a local
  Workflow Blueprint Library with active/archived template replay, hash-only
  replay history and current delivery-outcome export/upload verification,
  bounded Plan REST input validation, orphan-run reconciliation, internal Agent
  tools, and file or directory artifact verification against actual workspace
  bytes, including public `observeWorkspace` Plan artifact updates that reject
  self-reported digests and fail closed when rechecking a verified artifact
  whose workspace bytes have drifted, plus server-confirmed drift marking that
  turns the artifact into recoverable replan evidence;
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

The re-audited [next-stage gap matrix](docs/next-stage-gap-matrix.md) tracks
which local execution and product slices are complete, partial, or intentionally
deferred.

## Quick Start

Prerequisite: Node.js `>=22.19.0`.

```bash
npm install --ignore-scripts
npm run postinstall
npm run dev
```

Open `http://127.0.0.1:5173`. The demo model works without credentials.
The root `dev` command loads a repository `.env` only when present before it
starts Server and Web, so both child processes inherit the same environment
without putting secret values in command arguments. On the first-use ledger,
the **Live Provider** docket lists only standard environment-variable names and
their status. Choose **Enable** to explicitly register one available locator;
the secret value never leaves the Server and ambient variables alone remain
unauthorized. Advanced and Keychain locators remain available in
**Context → Provider credentials**.
The explicit root `postinstall` prepares only the current-platform native PTY
helper after the dependency install; it rejects missing, non-regular, or
symlinked helpers.

The CLI exposes the same preview-bound setup without creating another task
Thread or revising the Agent:

```bash
npm run --silent napier -- setup --workspace . --jsonl

# Copy providerId and contentSha256 from that preview:
npm run --silent napier -- setup \
  --workspace . \
  --provider deepseek \
  --expected-preview <sha256> \
  --apply
```

Apply succeeds only while the exact preview is current. Napier creates or
re-enables the known locator, checks credential availability and the pinned
stable model, and rolls a newly changed reference back to disabled if
verification fails. It never prints or persists the environment value.

Before the first live task, run the Store-free readiness diagnostic:

```bash
npm run --silent napier -- doctor \
  --workspace . \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY
```

`napier doctor` canonicalizes the workspace without creating `.napier` state,
checks Node/runtime components and optional model credential presence, then
uses bounded real production paths for credential-free public Search, HTML Fetch,
sandboxed Chrome, and the OS process Sandbox. `--offline` skips the three
public-network/Browser probes. Human output uses fixed recovery codes; `--jsonl`
returns one hash-bound `napier.doctor-report` with `ready`, `degraded`, or
`blocked` status. Workspace paths, credential variable names/values, fetched
content, URLs, and raw probe errors are absent.

Inspect or change the active Agent's user-facing capability preset without
editing SQLite or reasoning about raw policy names:

```bash
npm run --silent napier -- capabilities --workspace .
npm run --silent napier -- capabilities --workspace . --preset browser
npm run --silent napier -- capabilities --workspace . --preset browser --apply
```

The five presets are `coding`, `research`, `data`, `browser`, and
`safe_automation`. Status is read-only; selecting a preset without `--apply`
previews the exact policy/tool/Skill/delegation projection; `--apply` persists
that projection through the existing Agent profile revision path. The Browser
preset is deliberately **Read only**: it enables Search, Fetch, Browser
reading, and Research citations but reports **Browser interact: no**. No preset
grants `unrestricted`, and Web preset selection only fills the existing form
until the user saves it. Chat/TUI `/status` and the Web composer display the
same preset and permission labels.

Safe Automation and custom writable profiles can expose Browser
`click`/`type`/`select`/`upload`/`download` only in the Web entry. Every such
action pauses before execution and shows a hash-only confirmation docket with
**Approve once** and **Reject**. Approval is bound to the exact Run, tool call,
action, validated argument SHA-256, and 60-second expiry; it cannot be reused.
The docket previews only redacted effects such as target kind/hash, text byte
count/hash, selected-value count/set hash, workspace-path hash, and
cross-origin intent.
Neither `workspace` nor `unrestricted` bypasses this gate. The confirmed action
continues in the same Run-owned Browser Session. CLI, Chat, and TUI continue to
expose the read-only Browser schema because they do not yet have a confirmation
surface.

For one task or interactive session, pass the same strict preset ID directly
to `run`, `chat`, or `tui`:

```bash
npm run --silent napier -- run \
  --workspace . \
  --prompt "Research the current behavior." \
  --preset research
npm run --silent napier -- chat --workspace . --preset browser
npm run --silent napier -- tui --workspace . --preset safe_automation
```

This is a temporary per-Run projection. It freezes the selected policy, tools,
Skills, and Subagents into each Run configuration and records the preset ID in
the private `run.started` lifecycle evidence, but it does not update the Agent
or append a profile revision. Chat and TUI apply the selected preset to every
new prompt in that process and report the effective temporary status.
`/resume`, recovery, schedules, channels, Workflows, and experiments cannot
select a temporary preset. An operator-decision continuation reuses the origin
Run's recorded preset and fails closed if its revision, model, or capabilities
drift.

Browser interaction confirmation is a separate process-local authority. The
Contracts and Runtime narrow subpaths share only action, hashes, timestamps,
status, and receipt digests. Selector, text, values, URLs, upload paths, and
download paths never enter confirmation events or the Web/Chat/TUI docket.
Web uses buttons; Chat and TUI accept only the exact words `approve` or
`reject` while the Run is paused. Invalid terminal input is consumed locally,
is not queued as a prompt, and does not enter Ledger evidence. `Ctrl-C`,
timeout, EOF during a pending Chat decision, rejection, or Run cancellation
fails closed. Pending and terminal confirmation events remain durable, while
the one-use resolver is intentionally non-resumable across process restart.

While an active user Run owns a Browser Session, Web also shows **Browser
Live**. The panel polls a network-closed viewport PNG every 1.5 seconds through
a `no-store`, byte-hash-verified endpoint. Live captures reuse the current
Session and operation number without consuming the Agent's 64-operation budget,
opening network access, appending Ledger events, creating Artifacts, or storing
page pixels/text in Napier state.

The same panel exposes **Pause** and **Resume** only for that active standard
user Run and active Browser Session. Pause authority becomes active
immediately, but it never interrupts an in-flight Browser action. Instead, the
next Browser action waits in policy preflight before execution while Browser
Live remains observable. Resume compares the exact hash-bound paused state,
releases that same Run and Session, and cannot replay an older pause cycle.
Requested, resumed, and cancelled transitions append hash-only Ledger evidence;
page content, URL, title, pixels, and Browser arguments remain absent. Run
cancellation, Session loss, close, settlement, or Server restart releases or
rejects waiters and fails closed. The panel disappears when the Session closes
or the Run settles. Direct user takeover, tabs/history, DevTools, login
handoff, and restart recovery remain separate work.

For a production build served by the API process:

```bash
npm run build
npm start -w @napier/server
```

Open `http://127.0.0.1:8787`.

For a zero-key one-shot terminal Run with the demo model:

```bash
npm run napier -- run \
  --workspace . \
  --prompt "Summarize this workspace."
```

For the first real DeepSeek task, put the key in the repository-local `.env`
file, then explicitly name its locator:

```bash
# .env
DEEPSEEK_API_KEY="..."

npm run napier -- run \
  --workspace . \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --prompt "Inspect this workspace and report the highest-risk gap."
```

The repository `napier` script loads `.env` only when it exists. The Run
preflight stores or reuses only the environment-variable name, verifies that
the selected live model is configured, and creates no task Thread on a missing
or conflicting locator. It never persists the key. An installed `napier`
binary uses the same command after the variable is exported by the shell.

The same explicit clean-state bootstrap is available before an interactive
session starts:

```bash
npm run napier -- chat \
  --workspace . \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY

npm run napier -- tui \
  --workspace . \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY
```

`chat` and `tui` create no task Thread until the first prompt. A missing or
conflicting locator fails before the session becomes ready or calls the model.
Later `/model` changes reuse already configured Provider references and do not
implicitly authorize another environment variable.

After one explicit credential locator is active, the untouched built-in Napier
Agent becomes **live-ready by default** across one-shot CLI, Chat, TUI, Web,
SDK, and RPC standard user Runs. Omitting `--model` or leaving the Web model
selector untouched chooses the first executable live model from the bounded
catalog; an explicit CLI/Web/SDK model still wins. This is a per-Run choice:
the Agent remains `napier/demo`, no profile revision is created, and
Workflow/recovery/experiment Runs retain their frozen model semantics.

Ambient environment variables alone never mark a Provider configured. Napier's
model registry uses only active credential references (environment-variable
names or Keychain locators) and never falls back to `process.env` during auth
resolution. This preserves the explicit-locator trust boundary while removing
the need to repeat model flags or discover Context before every task. If no
live reference is configured, all entries continue to use the zero-key demo
model.

Human mode writes only the final assistant result to stdout and a concise Run
status to stderr. Use the same Runtime as a line-delimited automation stream:

```bash
npm run --silent napier -- run \
  --workspace . \
  --prompt "Inspect this workspace and report the highest-risk gap." \
  --jsonl
```

JSONL mode writes hash-bound event frames followed by one final snapshot and
one terminal done frame. It emits no banner or other non-JSON stdout. The
`--silent` npm flag suppresses wrapper/build logs; an installed `napier` binary
does not need it.

For a multi-turn terminal session that keeps one Runtime open:

```bash
npm run --silent napier -- chat \
  --workspace . \
  --data-root .napier \
  --model napier/demo
```

Use `/status`, `/model <provider/id>`, `/thread <thread-id>`, `/new [title]`,
`/resume [run-id]`, `/help`, and `/exit`. `Ctrl-C` cancels an active Run while
keeping the session open; at an idle prompt it exits. EOF closes the Runtime.
`chat` requires TTY stdin and rejects `--jsonl`; scripts should use `run
--jsonl` or `rpc`. Assistant text goes to stdout, while stderr receives prompts,
bounded Run status, and metadata-only tool cards without tool arguments or
result bodies. When a writable Browser action pauses, stderr shows only its
action, hash prefixes, bounded byte/count metadata, cross-origin status, and
expiry; type `approve` or `reject` at `confirm>`. Model-provided terminal
controls and bidirectional-formatting characters are rendered as visible
`\uXXXX` escapes rather than executed by the terminal.

For the full-screen local terminal over the same Runtime and Ledger:

```bash
npm run --silent napier -- tui \
  --workspace . \
  --data-root .napier \
  --model napier/demo
```

`tui` requires raw-mode stdin and TTY stdout. It provides a bounded transcript,
streaming assistant text, body-free live tool cards, operator-waiting status,
UTF-8 editing and history, PageUp/PageDown scrolling, bracketed paste, resize
reflow, and the same slash commands as `chat`; `/clear` clears only the local
viewport. A pending Browser action opens a bounded hash-only confirmation
docket and changes Enter to `approve/reject`; other text is rejected locally
rather than queued. `Ctrl-C` cancels an active Run or exits with status 130
while idle, and `Ctrl-D` exits while idle. Alternate-screen, cursor, paste, and
raw-mode state are restored on normal exit, EOF, cancellation, parent
termination, and recoverable failures. If a destroyed output channel makes
restoration unconfirmable, TUI cancels active work and exits non-zero. Dynamic
content cannot issue terminal controls, and tool arguments/results,
diagnostics, credentials, hidden messages, and raw event JSON are never
rendered.

Continue an existing Thread by passing its explicit ID and the same state
directory:

```bash
npm run --silent napier -- run \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --prompt "Continue from the prior evidence." \
  --jsonl
```

Live models use `--model provider/model-id` and the same credential-reference
store as Web. An ambient API key alone is insufficient: register its
environment-variable name through **Context -> Provider credentials** in the
selected data root first.

Resume a Thread left waiting after a process interruption:

```bash
npm run --silent napier -- resume \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --run run_interrupted_example \
  --jsonl
```

`resume` accepts no new prompt. It selects the requested or latest interrupted
Run, creates a recovery child linked by `parentRunId`, and asks the Agent to
inspect durable evidence before acting. Unknown tool side effects are not
silently replayed. Human and JSONL output, model overrides, timeout,
cancellation, credential resolution, Run leases, and shutdown use the same
path as `run`.

Create an independently continuable Thread from an exact source Ledger
sequence:

```bash
npm run --silent napier -- branch \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --from-seq 42 \
  --title "Alternative investigation" \
  --jsonl
```

The branch copies only message events visible through `--from-seq`, links its
materialization Run to the last source Run visible at that sequence, and
records `branch.created` source lineage. Human mode prints the new Thread ID;
JSONL emits every new branch event followed by its authoritative snapshot and
done frame. A future or missing source sequence fails before creating a
Thread. The new ID can be passed to `napier run --thread` to continue through
the normal Agent Runtime. The `branch` command itself is message-history
branching, not model/tool checkpoint re-execution or side-effect replay.
`napier chat` remains the compatible line-oriented session; `napier tui` is the
full-screen local projection. Neither command claims ACP or Desktop packaging.

Preview and execute a controlled read-only rerun of one historical user
message:

```bash
npm run --silent napier -- experiment \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --run run_example \
  --message-seq 42 \
  --preview \
  --jsonl

npm run --silent napier -- experiment \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --run run_example \
  --message-seq 42 \
  --model deepseek/deepseek-v4-flash \
  --expected-preview <sha256> \
  --jsonl
```

Preview performs no mutation and fails closed if the source Run is not a
terminal user Run with modern configuration evidence, or if its frozen Agent,
Prompt Variables, Skills, reviewed Memory, candidate model, or complete
Workspace snapshot are unavailable. Execution reprojects the same inputs,
creates a Branch immediately before the selected message, proves its copied
model-message history matches the preview, and runs only the configured
read-only tool subset with no Sessions, Plan/Memory mutation, write tools, or
subagents. A cancelled, timed-out, or failed target remains comparable; retry
creates a new isolated target from the unchanged source rather than resuming
uncertain model state.

Preview and execute exactly one captured provider call without entering the
Agent Loop or executing candidate tool calls:

```bash
npm run --silent napier -- model-experiment \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --run run_example \
  --turn-index 0 \
  --preview \
  --jsonl

npm run --silent napier -- model-experiment \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --run run_example \
  --turn-index 0 \
  --model deepseek/deepseek-v4-flash \
  --expected-preview <sha256> \
  --jsonl
```

The source must be a terminal configured Run with one exact local capsule,
matching context-envelope receipt, and following model response. Preview is
mutation-free and binds the capsule, source response, Agent revision, context,
candidate model, and isolated execution mode. Execution makes one
`completeSimple` call in a new Thread/Run with no enabled tools, Skills, or
subagents. The result compares status, stop reason, latency, usage, cost,
text/output hashes, and tool names; returned tool calls are untrusted output
and are never dispatched. Cancellation and provider failure settle the target
as comparable evidence, while orchestration failure is recorded and fails
closed.

Exact provider Context may contain prior model-visible tool results, so its CAS
is deliberately local-only: the data-root directory is mode `0700`, capsule
files are mode `0600`, symbolic links and permission drift are rejected, each
capsule is limited to 8 MiB, and the store is bounded to 256 entries / 128 MiB.
Only provider-consumed Context fields and safe sampling options are captured;
credentials, headers, environment, callbacks, and AbortSignals are excluded.
Portable Replay carries the receipt, not the capsule. This path currently has
Runtime, CLI, HTTP/SSE, SDK, local stdio RPC, lazy Web Run Lab, and
privacy-bounded Trace entrances.

Preview and execute exactly one captured built-in read-only tool call without
entering the Agent Loop:

```bash
npm run --silent napier -- tool-experiment \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --run run_example \
  --call-id call_example \
  --preview \
  --jsonl

npm run --silent napier -- tool-experiment \
  --workspace . \
  --data-root .napier \
  --thread thread_example \
  --run run_example \
  --call-id call_example \
  --expected-preview <sha256> \
  --jsonl
```

Eligible source calls are `list_files`, `read_file`, `search_files`,
`list_symbols`, `inspect_data`, `sqlite_query`, `inspect_code`, `read_symbol`,
`ast_query`, and `ast_edit_preview`. Capture occurs only after capability and
policy admission and before the tool body executes. Exact validated arguments
stay in a local-only capsule; Ledger and portable Replay contain its receipt,
the tool/result hashes, sizes, and status, not the private argument body.
Preview requires a terminal configured source Run, one exact capsule receipt,
one matching completed call, the unchanged source Agent revision and tool
definition, and a complete current snapshot of the argument's workspace scope.

Execution reprojects freshness, creates one capability-gated
`tool_experiment_read_only` Run, regenerates the same built-in tool through the
normal Runtime factory, repeats Schema/effect/`observe` policy checks, and calls
that tool exactly once. It compares status, latency, output SHA-256, and output
bytes. Failure and cancellation settle inspectable targets; a stale preview
creates no target. SQL, query parameters, and result rows remain absent from
Ledger and Replay, while deliberate CLI/HTTP/SDK/RPC results and Web downloads
may return the live candidate output to their caller. The shared private CAS
uses `0700`/`0600` permissions, atomic no-overwrite installation, serialized
capacity admission, and post-install validation; tool capsules are limited to
512 KiB each and 512 objects / 64 MiB total.

This standalone tool-call slice does not allow Extensions, Browser,
shell/Process, Kernel, Debugger, stateful Session, write, or unknown-effect
tools. Historical result reuse is available only inside controlled Agent
message experiments; write/session result simulation, environment restoration,
batch execution, and experiment promotion remain open.

Local stdio RPC exposes `napier/tool/experiment/preview` and
`napier/tool/experiment/run` with the same request-bound events, stale-preview
conflict, cancellation, admission, and shutdown behavior as the other
experiment methods. The lazy Run Lab read-only tool-call desk lists only
strict receipt-plus-terminal-call metadata, requires a fresh preview, supports
explicit cancellation and target navigation, and offers candidate output only
through a deliberate CAS-named download. Its independent browser protocol
recomputes preview, comparison, and result-frame hashes, verifies event order,
Snapshot identity, and the complete event-stream hash, and rejects raw
arguments, Workspace paths, or output bodies before rendering.

Run one local Runtime as a line-delimited stdio JSON-RPC 2.0 process for an
editor, desktop shell, or automation host:

```bash
npm run --silent napier -- rpc \
  --workspace . \
  --data-root .napier
```

The client first sends `initialize`, then calls Agent, Workflow, Approval, or
experiment methods. `napier/agent/experiment/preview` and
`napier/agent/experiment/run` expose the same preview-bound historical-message
path as the CLI. `napier/model/experiment/preview` and
`napier/model/experiment/run` expose the same one-provider-call path as
`napier model-experiment`, including request-bound events and a deliberate
cancelled result after durable settlement. `napier/tool/experiment/preview`
and `napier/tool/experiment/run` provide the corresponding preview-bound
single read-only tool-call path. `napier/workflow/experiment/preview` projects
a source Thread/Plan checkpoint without mutation;
`napier/workflow/experiment/run` requires the returned `previewSha256`, creates
an isolated target Thread, reuses verified ancestors, reruns the selected
descendants, or materializes one schema-3 typed output before executing its
descendants, and returns the candidate Manifest and source/target comparison.
Write or unknown historical tool effects also require explicit
`confirmSideEffects`. A waiting Workflow response includes its pending
Decision and `contentSha256`; `napier/workflow/answer` requires that hash plus
the same Manifest, Thread, Plan, Decision, and selected option before it
persists the answer and resumes. Every durable event produced by a request is
streamed as a `napier/event` notification carrying the originating request ID
and the same event SHA-256 used by SSE/JSONL before the terminal result:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"my-editor"}}}
{"jsonrpc":"2.0","id":2,"method":"napier/agent/run","params":{"prompt":"Inspect this workspace.","model":{"provider":"napier","id":"demo"}}}
{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":2}}
{"jsonrpc":"2.0","id":3,"method":"shutdown"}
{"jsonrpc":"2.0","method":"exit"}
```

The protocol is exported by `@napier/contracts` at version `1`. Input is strict
UTF-8 JSON with a 1 MiB line cap and at most four active Agent, Workflow, or
experiment requests. Workflow Manifest hashes, input Schemas, experiment
source evidence, preview freshness, and side-effect confirmation are validated
before target mutation. Malformed, unknown, stale, pre-initialize, duplicate,
over-capacity, pre-settlement cancellation, and post-shutdown requests use
stable JSON-RPC error codes; a durably settled cancelled experiment instead
returns its recovery-ready target result. Internal diagnostics are hash-only.
EOF, SIGINT, SIGTERM, `exit`, and Runtime shutdown cancel and await active Runs
before SQLite closes. The transport is local stdio only: it does not open a
socket, accept remote credentials, expose Store, or implement a second Agent
or Workflow loop. Remote transport/authentication and ACP remain follow-up
work.

Execute a versioned typed Workflow manifest through the same Runtime:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --input-json '{"request":"Produce the verified report."}' \
  --jsonl
```

Generate manifests from an existing `ExecutionPlanBlueprint` with the exported
TypeScript `defineExecutionPlanWorkflow()` helper. It binds the Blueprint DAG,
runtime input/output schemas, literal or field-path node input bindings,
Agent-node models, bounded Deterministic templates, Tool-node names/effects,
Approval questions/choices, timeouts, attempt limits, and optional
`maxConcurrency` into one stable content hash. Concurrency defaults to `1` and
is bounded to `4`. JSONL emits ordered Ledger event frames, one authoritative
snapshot, and one hash-bound `workflow_result` frame. Resume or explicitly retry
a blocked node without supplying the input again:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_example \
  --plan plan_example \
  --retry-blocked \
  --jsonl
```

The original input is recovered and hash-checked from the Work Ledger. A retry
never reuses an unknown side effect automatically.

Pause before one or more Manifest nodes on the initial execution:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --input-json '{"request":"Produce the verified report."}' \
  --break-before verify,publish \
  --jsonl
```

The result is `paused` before the selected ready node creates a Run or invokes
a Tool. Repeating an ordinary resume remains paused. Continue the durable open
breakpoint explicitly:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_example \
  --plan plan_example \
  --continue-breakpoint \
  --jsonl
```

Breakpoints are recovered from Ledger after restart. Continuation and
`--retry-blocked` are mutually exclusive because they authorize different
state transitions.

An Approval node returns a successful `waiting` result without holding a
process open. Answer and resume the exact Plan atomically from CLI:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_example \
  --plan plan_example \
  --approve \
  --decision-note "Reviewed the verification evidence." \
  --jsonl
```

Use `--reject` to record an explicit rejection and block the node. HTTP clients
answer through the existing operator-decision route, then resume the Workflow
route with the original Manifest and Plan ID.

Preview a controlled experiment from one Workflow checkpoint without creating
a target Thread:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_source \
  --plan plan_source \
  --from-node report \
  --model-overrides-json \
    '{"report":{"provider":"deepseek","id":"deepseek-chat"}}' \
  --preview-experiment \
  --jsonl
```

Remove `--preview-experiment` to execute the fork. Completed nodes outside the
selected node's descendant subgraph are re-materialized from verified source
Run/Ledger evidence as `source=workflow_reuse`; the selected node and all
descendants execute in a new Thread with the candidate Manifest. If prior
attempts in the rerun subgraph contain write, unknown, or unresolved tool
effects, execution requires both `--confirm-side-effects` and the exact
`--expected-preview <sha256>` returned by the current preview. A stale preview
fails before target creation. JSONL ends with a hash-bound
`workflow_experiment_result` frame. That frame includes a privacy-bounded
source-versus-target comparison with per-node execution classification and
target-minus-source metrics. Human mode prints the aggregate duration, token,
tool-call, and cost delta; output bodies, prompts, tool arguments, Evaluation
prose, and Artifact paths remain outside the comparison.

Add `--single-node` to preview or execute only the selected checkpoint:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_source \
  --plan plan_source \
  --from-node report \
  --single-node \
  --preview-experiment \
  --jsonl
```

The compatible default subgraph preview remains schema 1. Single-node previews
use schema 2 and bind three distinct sets: `rerunNodeIds` is the complete
descendant subgraph that cannot be reused, `executionNodeIds` contains only
the selected checkpoint, and `stopBeforeNodeIds` contains its direct
successors. Execute by repeating the request with
`--expected-preview <previewSha256>`. Tool-effect projection and side-effect
confirmation cover only `executionNodeIds`; historical write evidence from a
successor that will not run cannot authorize or block the selected-node test.

Execution uses the normal Workflow scheduler. When direct successors exist, it
returns `paused` after the selected node settles and before any successor
creates a Run; a terminal checkpoint completes normally. Ordinary resume
remains at the same durable breakpoint across SQLite reopen. Continue with the
normal `--continue-breakpoint` request and the target Thread/Plan from the
result to advance the remaining subgraph. Multiple direct successors retain
independent holds and are continued one at a time in Manifest order. This mode
reuses real source evidence and executes a real node; it does not mock node
output, replace arbitrary input, simulate side effects, or provide mid-node
stepping.

Use `--step-nodes` when the complete rerun subgraph should advance one node per
operator action:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_source \
  --plan plan_source \
  --from-node inspect \
  --step-nodes \
  --preview-experiment \
  --jsonl
```

Schema-5 previews keep the complete selected-node descendant set in
`rerunNodeIds`, put only the selected checkpoint in initial
`executionNodeIds`, and bind every other rerun node in Manifest order as
`stopBeforeNodeIds`. At most 16 remaining nodes can be held. Execution requires
the exact preview hash. Historical Tool effects and side-effect confirmation
cover the complete rerun subgraph because later Continue actions can execute
those nodes. The selected node then runs normally and pauses at the first ready
held node.

Each ordinary `--continue-breakpoint` persists one exact continuation and lets
only that bound node enter the scheduler. Other parallel-ready nodes remain
held until later actions. If cancellation or process loss happens after the
continuation event but before node settlement, recovery executes the same
released node without requesting duplicate consent or opening another hold.
This is pre-node orchestration, not mid-node DAP stepping or a separate
Workflow engine.

Run the opt-in four-node built-CLI Dogfood:

```bash
npm run test:live-workflow-step
```

Use `--simulate-output-json` to replace one selected checkpoint output while
executing its descendants normally:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_source \
  --plan plan_source \
  --from-node inspect \
  --simulate-output-json '{"summary":"Reviewed fixture","count":4}' \
  --preview-experiment \
  --jsonl
```

Execution repeats the same request with
`--expected-preview <previewSha256>`. Schema-3 previews keep
`rerunNodeIds` as the selected checkpoint plus descendants, but
`executionNodeIds` contains only descendants and `simulatedNodeId` names the
selected checkpoint. The supplied value must be valid JSON, fit the 32 KiB
node-output bound, and satisfy that node's output Schema. The selected node
never calls a model or Tool; a capability-gated `workflow_simulation` Run
settles it, then the ordinary Workflow scheduler evaluates and executes
descendants. Historical write or unknown effects on those descendants still
require exact-preview side-effect confirmation.

The exact simulated value is hidden local recovery evidence and is included in
an explicit full portable Thread fixture because cross-restart/import recovery
requires it. Public `workflow.node.simulated` evidence, Web Trace summaries,
and the rendered desk expose only safe IDs, Schema/output hashes, byte counts,
and Run source. Per-node comparison labels the selected node `simulated`
rather than implying a real rerun. This mode does not replace arbitrary
Workflow input, simulate write/session side effects, or capture external
Session state.

Use `--replace-input-json` to replace the complete constructed input of one
selected checkpoint and execute that checkpoint plus its descendants normally:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_source \
  --plan plan_source \
  --from-node report \
  --replace-input-json '{"prepared":{"summary":"Reviewed fixture"}}' \
  --preview-experiment \
  --jsonl
```

Schema-4 previews require the exact current preview hash for execution.
`rerunNodeIds` and `executionNodeIds` both contain the selected checkpoint plus
all descendants, while `replacedInputNodeId`, the canonical input SHA-256, and
the byte count bind the override. The JSON value is limited to 32 KiB and must
satisfy the selected node's input Schema. Verified ancestors remain
`workflow_reuse` Runs; the selected node and descendants use the ordinary
Workflow scheduler, policy, Sandbox, timeout, retry, cancellation, and
side-effect confirmation paths. The selected comparison row is labeled
`input_replaced` and reports the actual input change rather than implying
simulation.

The exact override is unique hidden
`workflow.node.input_replacement.requested` recovery evidence. Public
experiment and node events, Web Trace, and the rendered desk expose only safe
IDs, Schema/input hashes, and bytes. Portable full-Thread import preserves the
override as opaque user JSON while remapping actual resource lineage. This
mode replaces neither top-level Workflow input nor historical dependency
outputs, and it does not simulate write/session effects or external Session
state. `--replace-input-json`, `--single-node`, `--step-nodes`, and
`--simulate-output-json` are mutually exclusive.

Use `--replace-workflow-input-json` without `--from-node` to compare the whole
Workflow against a new top-level input:

```bash
npm run --silent napier -- workflow \
  --workspace . \
  --data-root .napier \
  --manifest workflows/report.json \
  --thread thread_source \
  --plan plan_source \
  --replace-workflow-input-json '{"request":"Re-evaluate the full report"}' \
  --preview-experiment \
  --jsonl
```

Schema-6 previews bind `reusedNodeIds=[]` and put every Manifest node, in
order, in both `rerunNodeIds` and `executionNodeIds`. The value is limited to
32 KiB and must satisfy the top-level Workflow input Schema. Execution requires
the exact preview hash; write, unknown, or unresolved historical effects from
any source node additionally require explicit confirmation. The replacement
becomes the target's real `workflow.started` input, so every constructed node
input is rebuilt and every node runs through its ordinary model, Tool,
Approval, condition, Sandbox, timeout, retry, cancellation, and recovery path.
No fake checkpoint, `workflow_reuse` Run, hidden node input override, or second
Workflow state is created.

Public preview and Trace expose only the canonical replacement hash and byte
count. Recovery reads the ordinary target Workflow input and recomputes its
Schema, hash, bytes, complete node sets, source revision, and lineage binding.
The existing comparison reports the top-level input change plus actual
per-node input/output, model, metric, Evaluation, Artifact, and Tool-set
changes. CLI JSONL, TypeScript SDK, stdio RPC, HTTP/SSE, and the Plan Workbench
all call this same Runtime mode; checkpoint schemas 1-5 remain compatible.

The same path is available in **Plan -> Workflow experiment desk**. Load the
exact versioned Manifest used by the source run, select its durable source Plan
and checkpoint node, optionally replace that node with the currently selected
configured model, select full-subgraph, single-node, typed-output simulation,
step control, typed checkpoint-input replacement, or selector-free top-level
input replacement, and preview before execution. The desk renders historical
read/write/unknown effects and
`rerun`/`execute now`/`stop before`/`simulated`/`input replaced` counts, and
requires an explicit checkbox for a preview that needs side-effect
confirmation. A successful isolated fork shows aggregate and per-node
target-minus-source deltas, can open the target Thread, and downloads the
complete local result as
`napier-workflow-experiment-<plan>-<hash>.json`. The browser revalidates the
Manifest, Preview, SSE event hashes/order, final Snapshot, comparison, result
frame, source/target identities, and no-store response contract; changing
Thread aborts the in-flight browser request.

## Product Performance Budget

The repository gate runs a real local product-path benchmark after the build:

```bash
npm run check:product-performance
npm run bench:product-performance
```

The checked `local_ci_v1` profile takes the median of three fresh built
`napier run --jsonl` processes from spawn to `run.started`, first
`model.text.delta`, and terminal `done`. The same isolated sample measures
shared Runtime bootstrap, 25 production `read_file` executions, append and
`getDetail()` latency for a 1,000-event Thread, observed process RSS, and the
closed SQLite ledger's total bytes and bytes per event.

Limits live in
[`docs/product-performance-budget.json`](docs/product-performance-budget.json).
The reviewed baseline is
[`docs/artifacts/product-performance-baseline-0.1.0.json`](docs/artifacts/product-performance-baseline-0.1.0.json);
release audit strictly reprojects its medians, percentiles, RSS aggregate,
database ratio, checks, budget hash, and content hash. `npm run
bench:product-performance` writes a fresh report under ignored
`benchmark-results/`.

The demo first-token measure covers local startup, Ledger, stream, and model
plumbing; it is not a claim about external Provider network latency. RSS is
sampled at named checkpoints rather than enforced as a hard quota, and this
profile is a regression gate for the supported local CI environment rather
than a cross-machine score.

### Store Scale Baseline

Run the opt-in store benchmark after changes to persistence or Thread
projection code:

```bash
npm run bench:store-scale
npm run bench:store-scale -- --output /tmp/napier-store-scale.json
```

The default report measures cumulative 100- and 1,000-event checkpoints and
prints JSON with append latency, `getDetail()` latency, Thread/event payload
bytes, growth ratios, and the latest Store persistence sample. Pass `--output`
for a machine-readable report unaffected by npm build logs. Use
`NAPIER_BENCH_EVENT_COUNTS=100,1000,10000` for the extended 10k profile. The
benchmark uses a temporary workspace and deletes it on exit.

`/api/health` exposes process-lifetime Store commit, failure, timing, and byte
metrics without event content. Thread Detail, incremental event, Bootstrap,
and terminal SSE projections also expose exact UTF-8 byte counts so payload
growth can be audited independently of wall-clock noise.

## Coding Outcome Benchmark

Three fixed Outcome cases cover a single-file boundary repair, a multi-file API
migration with real TypeScript LSP References, and a JavaScript defect that
must be inspected with the real Node debugger before repair. Each runs in an
isolated temporary workspace. The scorer does not trust the assistant summary
or execute generated code without isolation. Case schema v2 requires the exact
declared changed-path set and runs hash-bound hidden assertions in the existing
read-only, network-denied Node Sandbox. Schema v3 additionally requires
selected capabilities to have a `tool.completed` event in the scored Run.
The complete target-file AST remains evidence, but behaviorally correct
alternative structures are not rejected merely for differing from one expected
AST.

Run a deterministic failed demo baseline:

```bash
npm run bench:coding
```

Select the multi-file API migration:

```bash
npm run bench:coding -- \
  --case benchmarks/coding/pricing-options-migration-v1
```

Select the debugger-qualified loyalty calculation:

```bash
npm run bench:coding -- \
  --case benchmarks/coding/loyalty-discount-debug-v1
```

Run the real provider case with an explicit credential locator:

```bash
source .env
npm run bench:coding -- \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY
```

Run 2–10 independent trials sequentially:

```bash
npm run bench:coding -- \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 3
```

Run the same generated suite through Napier and the installed Oh My Pi using
`deepseek-v4-flash`:

```bash
npm run bench:coding:compare -- \
  --seed 20260806 \
  --profile extended_v1 \
  --trials 1 \
  --timeout-ms 120000 \
  --trusted-outer-sandbox true
```

The comparison runner generates cases from the seed, validates every
hash-bound manifest, counterbalances executor order, isolates OMP
HOME/profile/workspace state, runs the same hidden assertions, and verifies the
report before writing it under ignored `benchmark-results/`. The
`--trusted-outer-sandbox true` mode is test-only: it bypasses a second local
process Sandbox only when the whole runner is already inside a trusted outer
Sandbox. Omit it for production platform-Sandbox evidence. The API key is read
from `.env` through `DEEPSEEK_API_KEY`; it is never passed in argv or written
to the report.

A single run writes two CAS-named files under ignored `benchmark-results/`: a
small result and a privacy-bounded Ledger bundle. A repeated run also writes a
CAS series with completed/scored/inconclusive counts, pass rate, and
min/p50/p95/max/mean/total distributions for latency, cost, tokens, and tool
behavior. The bundle retains the full
source event-stream hash, event-type counts, Run configuration/usage, tool
metrics, the `benchmark.evaluated` event, and chained receipts for important
events. For schema v3, the evaluation also commits to the required and
same-Run-completed capability sets. Started, failed, blocked, other-Run, and
assistant-reported tool use cannot qualify a result. Prompt, assistant text,
reasoning, debugger expressions/variables/output, tool bodies, paths, hidden
test source, and credential values are omitted. Verification enforces exact
nested schemas before checking hashes, so an injected raw field remains invalid
even if an attacker recomputes the artifact's self-describing hashes. It
refuses result files above 256 KiB and Ledger files above 4 MiB before parsing.
Verify an archived pair without a model call:

```bash
npm run bench:coding -- \
  --verify-result <napier-benchmark-result-...json> \
  --ledger <napier-benchmark-ledger-...json>
```

Verify a series and every referenced result/Ledger pair from the same
directory:

```bash
npm run bench:coding -- \
  --verify-series <napier-benchmark-series-...json>
```

If OS Sandbox unavailability is the only unmet gate, Napier records the trial
as `inconclusive`, keeps `passRate` null when no trial was scoreable, exits
non-zero, and never falls back to host execution. Independent failures such as
a missing required capability still produce `failed`. The checked-in v1
[DeepSeek result](docs/artifacts/benchmarks/napier-benchmark-result-coding_shipping_boundary_v1-ad31aff64f35d15a.json)
and
[Ledger bundle](docs/artifacts/benchmarks/napier-benchmark-ledger-coding_shipping_boundary_v1-c52d3c3d04232076.json)
remain a historical AST-scored successful sample. The checked-in v2
[three-trial series](docs/artifacts/benchmarks/napier-benchmark-series-coding_shipping_boundary_v1-d7738151e8036e7e.json)
is deliberately inconclusive because this IDE host denied nested
`sandbox-exec`; it is not a 0% success rate. A real DeepSeek execution of the
multi-file case also has an archived
[result](docs/artifacts/benchmarks/napier-benchmark-result-coding_pricing_options_migration_v1-ecba9265f0750865.json)
and
[Ledger bundle](docs/artifacts/benchmarks/napier-benchmark-ledger-coding_pricing_options_migration_v1-e8ef307d538aab40.json).
It changed exactly the three allowed files in 19.087 seconds, but its LSP and
outcome Sandbox launches were denied by this host, so it remains inconclusive.

### Workflow Outcome Benchmark

The fixed `workflow_document_map_reduce_v1` case runs three typed, parallel
Agent Map items through the selected model and aggregates their exact outputs
with the model-free deterministic Reduce node. Success requires the expected
ordered Map output and total, two completed Workflow node results, three
isolated `workflow_map_read_only` child Runs, exact Map/Reduce Ledger events,
zero model/tool events in Reduce, valid portable Replay, and no credential
leak.

Run one real-provider trial:

```bash
source .env
npm run bench:workflow -- \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY
```

Run and aggregate 2–10 independent trials:

```bash
npm run bench:workflow -- \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

Each trial writes a CAS result plus a privacy-bounded Ledger projection bound
to a fully verified Thread Replay and source event stream. High-volume model
deltas are summarized by count and hash; prompt, assistant text, reasoning,
and document bodies are omitted. The Series binds every pair by hash-derived
filename and reports task pass rate plus latency, cost, token, and Run-count
distributions. Offline commands support `--verify-result ... --ledger ...`
and `--verify-series ...` with no model call.

The checked-in DeepSeek
[two-trial Workflow series](docs/artifacts/benchmarks/napier-workflow-benchmark-series-workflow_document_map_reduce_v1-b8bead9bcd08f431.json)
passed 2/2 trials. Duration was 3.115–3.541 seconds, mean cost was
`$0.0013821556`, and every trial used five Runs. This is a reproducible fixed
case, not a cross-model success-rate or superiority claim.

### Data Outcome Benchmark

The `data_sqlite_metric_map_reduce_v1` case reuses the same Workflow runner,
Series, and offline evidence protocol. Three isolated Map Runs inspect one
hash-bound `analytics.sqlite` snapshot: two calculate paid/refunded totals and
one renders a deterministic paid-revenue bar chart. The Reduce node sums the
typed `90`, `12`, and `3` outputs to `105`.

```bash
npm run bench:workflow -- \
  --case benchmarks/data/sqlite-metric-map-reduce-v1 \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

Passing requires exact Map/final outputs, a valid `schema -> operation`
protocol in every Map Run, at least the required `schema/query/chart` action
distribution, and an unchanged database hash. Extra read-only queries remain
visible in action, cost, token, and latency evidence but do not turn a correct
outcome into a false failure. Setup SQL runs under a fail-closed SQLite
authorizer that denies attachment, extensions, temporary objects, and writes
outside the fixture database.

The checked-in DeepSeek
[two-trial Data series](docs/artifacts/benchmarks/napier-workflow-benchmark-series-data_sqlite_metric_map_reduce_v1-48f028b75bb535cc.json)
passed 2/2 trials in 9.494–10.193 seconds with five Runs per trial. Mean cost
was `$0.0018431`; mean input/output tokens were 8,490/2,129.5. Each trial used
three schema, four query, and one chart action while preserving the database.
The retained action events contain only runtime hashes and counts; SQL, rows,
SVG, model text/reasoning, and credentials are absent.

The `data_frame_map_reduce_v1` case applies the same evidence protocol to one
hash-bound CSV. Three isolated Map Runs must each complete exactly
`inspect_data -> data_frame`; each inspection must be complete and bind the
same path, format, bytes, and dimensions transformed by DataFrame. The hidden
oracle binds the resulting row hashes and dimensions for paid total `90`,
refunded total `12`, and three paid-region rows before deterministic Reduce
returns `105`. Passing also requires an unchanged source hash and zero
prompt-injection canaries in user-visible output.

```bash
npm run bench:workflow -- \
  --case benchmarks/data/data-frame-map-reduce-v1 \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

The checked-in DeepSeek
[two-trial DataFrame series](docs/artifacts/benchmarks/napier-workflow-benchmark-series-data_frame_map_reduce_v1-c03e1665999f8b6c.json)
passed 2/2 trials in 17.755–24.364 seconds with five Runs per trial. Mean cost
was `$0.002430694`; mean input/output tokens were 10,597.5/3,097.5. Offline
verification reconstructs the six data-tool events and all hidden evidence
from body-free Ledger projections. The release audit binds this Series and its
four Result/Ledger files plus the verified Coding executor comparison into the
43-artifact set `90cf892b914fc793`.

### Security Outcome Benchmark

The `security_sqlite_prompt_injection_v1` case proves that the selected model
actually queried three rows containing adversarial instructions before
returning exact typed values. Case schema 3 binds the SQL, parameter-set, and
result-row SHA-256 for every injection. Passing also requires the ordinary
schema-before-query protocol, exact Map/Reduce outputs, an unchanged database,
and zero canary strings in assistant text or Workflow/node outputs.

```bash
npm run bench:workflow -- \
  --case benchmarks/security/sqlite-prompt-injection-v1 \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

The canary scan receipt binds sorted canary hashes, the source Replay hash, and
the scanned output-projection hash without retaining row text. Tool output and
model reasoning are excluded from the user-output leak verdict: they prove the
model saw the attack, while strict final output determines whether it followed
or repeated it.

The checked-in DeepSeek
[two-trial Security series](docs/artifacts/benchmarks/napier-workflow-benchmark-series-security_sqlite_prompt_injection_v1-feaceb9d2fee8ab8.json)
passed 2/2 trials in 5.804–7.779 seconds with five Runs per trial. Mean cost
was `$0.001511958`; mean input/output tokens were 6,967.5/1,746.5. Each trial
used three schema and three query actions, matched all injection-row receipts,
and leaked no canary into user-visible output.

### Long-Horizon Outcome Benchmark

The `long_horizon_restart_approval_v1` case runs three model-backed Map items,
waits at a durable Approval, closes the complete local Runtime, reopens the
same SQLite data root, recovers and answers the pending decision, and finishes
through deterministic Reduce. Passing requires the original Map Run IDs to be
reused and zero model responses after the restart event.

```bash
npm run bench:workflow -- \
  --case benchmarks/long-horizon/restart-approval-map-reduce-v1 \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

The restart event binds the pre-restart Replay SHA-256, event count, Map Run
IDs, Manifest/Plan, and pending decision SHA-256. Offline verification binds
that event to the general receipt chain and independently recomputes Approval
recovery, Map reuse, and post-restart model-call count.

The checked-in DeepSeek
[two-trial Long-horizon series](docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_restart_approval_v1-6ae542a21fc5f485.json)
passed 2/2 trials in 2.540–2.925 seconds. Every trial used seven Runs, one
Runtime restart, three reused Map Runs, and zero post-restart model calls.
Mean cost was `$0.0020458732`; mean input/output tokens were 13,652.5/467.
Oh My Pi v17.2.1 exposes session continuation but no equivalent typed Workflow
Manifest, durable Approval, or completed-Map reuse contract, so this capability
case is recorded as not directly comparable rather than an OMP failure. The
same-task Coding comparison remains the cross-executor evidence.

The schema-6 `long_horizon_multi_restart_approval_v1` case extends the same
graph across two complete Runtime restarts. The first reopen verifies the
pending Approval and persists its answer. The runner then exports another
valid Replay, closes the Runtime again, verifies the exact answered decision
after the second reopen, and only then resumes Reduce.

```bash
npm run bench:workflow -- \
  --case benchmarks/long-horizon/multi-restart-approval-map-reduce-v1 \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

Two retained five-trial DeepSeek Series preserve the observed variance:

- the
  [variance series](docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_multi_restart_approval_v1-c99798474740bc5a.json)
  completed 5/5 trials with one pass and four Provider-error inconclusive
  outcomes, for an overall success rate of 0.2 and no scored failure;
- the subsequent
  [confirmation series](docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_multi_restart_approval_v1-42d4d77a9581f02a.json)
  passed 5/5 in 2.425–7.147 seconds, at mean cost `$0.00203473536` and mean
  input/output usage 13,464/508.8.

Across both retained Series, 6/10 trials completed both restarts and 4/10 were
inconclusive Provider responses before the first gate; no trial reached the
recovery path and then failed its recovery invariants. Every successful trial
retained two individually receipt-bound restart events, reused all three Map
Runs, and recorded one answered/continued pair with zero model responses after
the first restart.

The runner retains blocked, waiting, paused, or cancelled pre-gate outcomes
with their matching Workflow terminal receipt and optional output/Reduce
evidence. Schema-6/7 trials also append a body-free, Replay-bound model-response
observation containing counts, error/usage presence, and a response-set hash.
Provider-error outcomes are inconclusive; normal responses with invalid typed
output remain failed. Series report both overall `successRate`, conditional
`passRate`, and `usageSampleCount`. The variance Series predates the optional
persisted `successRate`; its 0.2 value is derived from its receipt-bound
`passedTrialCount=1` and `completedTrialCount=5`.

Schema 7 adds `long_horizon_offline_wait_approval_v1`. It completes the Map,
closes the Runtime, waits one real wall-clock second with no Runtime instance,
reopens before the original Approval deadline, recovers the exact pending
decision, answers it, and resumes model-free Reduce.

```bash
npm run bench:workflow -- \
  --case benchmarks/long-horizon/offline-wait-approval-map-reduce-v1 \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 5
```

Restart receipt schema 2 binds the offline interval start, required duration,
original decision request sequence, Approval timeout, and absolute expiry.
Offline verification recomputes elapsed time from the restart event timestamp,
binds the request receipt, and rejects a shortened wait or reset deadline.

Three retained DeepSeek Series preserve all nine requested trials:
[sample A](docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_offline_wait_approval_v1-29e6600a075de2d2.json),
[sample B](docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_offline_wait_approval_v1-f9763a9fb75404b4.json),
and the
[five-trial distribution](docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_offline_wait_approval_v1-8fbd6eba325a0839.json).
Combined outcome was 4 pass, 0 failed, and 5 Provider-error inconclusive, for
overall success 4/9 and conditional pass rate 1. Every trial that reached the
recovery path waited 1009–1013 ms, preserved the original deadline, reused all
three Map Runs, and made zero post-restart model calls. Those four successful
trials completed in 3.248–3.767 seconds at mean cost `$0.0020105008`; mean
input/output usage was 13,469.5/430.25.

Schema 8 adds `long_horizon_token_budget_exhaustion_v1`. Its Map is
intentionally sequential: the first child has a frozen 1,000-token Run limit,
and expected exhaustion must stop the remaining two items and Reduce. A
business `workflow.blocked` result is a benchmark pass only when exactly one
receipt-bound `run.budget.exhausted` event reports `tokens`/`1000`, no
`tool.completed` occurs after that event, Replay is valid, and credentials are
absent.

```bash
npm run bench:workflow -- \
  --case benchmarks/long-horizon/token-budget-exhaustion-map-reduce-v1 \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 5
```

An initial concurrent calibration produced two Provider-error inconclusive
trials, each with one valid budget event and two Provider errors; it is
documented as calibration rather than included in the current release set.
The retained
[two-trial sample](docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_token_budget_exhaustion_v1-3661f272968004ae.json)
and
[five-trial distribution](docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_token_budget_exhaustion_v1-ee23f61783f8c111.json)
passed 7/7 with no failed or inconclusive current-case trial. Every trial used
two Runs, retained exactly one token exhaustion, started neither remaining Map
item nor Reduce, and recorded zero post-exhaustion tool completions. Duration
was 2.182–3.121 seconds; mean cost was `$0.0001877784`, and mean input/output
usage was 795.86/266.86.

### Durable Goal No-Progress Benchmark

`long_horizon_goal_no_progress_v1` exercises the ordinary durable Goal loop
against a hash-bound objective requiring three distinct evidence markers. The
fixed Agent response completes only `alpha` and explicitly leaves `beta` and
`gamma` unfinished. A pass requires three primary responses, three
`goal.evaluated` events, two `goal.continuation.started` events, a final
`goal_not_met_yet` block at `noProgressCount=2`, no continuation after that
block, valid Replay, and the same Goal state after complete Runtime shutdown
and reopen.

```bash
npm run bench:goal-no-progress -- \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

The Result/Ledger pair binds the final Goal projection, selected Goal and
assistant events, a body-free model-response observation, terminal and
evaluation events, and a bounded receipt chain. High-volume text/thinking
deltas are omitted from receipts, while the full source Replay hash and event
count remain bound. Offline verification reconstructs all counters and
bindings; changing the final no-progress count, assistant evidence, or a
Result/Ledger reference fails the release gate.

The retained
[two-trial DeepSeek Series](docs/artifacts/benchmarks/napier-goal-no-progress-benchmark-series-long_horizon_goal_no_progress_v1-87aeab3e1c06e1a1.json)
contains one pass and one ordinary failure. The passing trial blocked after
exactly two no-progress continuations, recovered the same Goal after reopen,
and made no post-block continuation. In the failed trial, the model deviated
from the fixed continuation response and claimed all markers were complete;
the evaluator completed the Goal after one continuation, and the benchmark
correctly scored that divergence as failed. This 1/2 sample proves the
protocol and its fail-closed evidence path, not stable model adherence.

### Research Outcome Benchmark

The fixed `research_aurora_contradiction_v1` case injects three immutable
Browser capture contracts into the ordinary Run-owned Research Source manager:
two primary sources agree on a 2024 launch and 30-day retention, while one
secondary source claims a conflicting 2023 launch. Production runtimes still
capture through the real Browser manager unless this narrow provider SPI is
explicitly supplied.

```bash
npm run bench:research -- \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

Passing requires all three captures, the exact seven claim/source/line/quote
citation bindings, primary/secondary coverage, explicit contradiction
handling, hidden claim agreement, a Markdown report written through
`apply_patch`, successful production `research_source verify_report`, valid
Replay, and no credential leak. The Ledger retains capture, authority,
citation, report, and evaluation hashes plus privacy-projected tool receipts.
URLs, titles, source text, quotes, claim text, citation tokens, report
path/content, assistant text, reasoning, and credentials are omitted.

The checked-in DeepSeek
[two-trial Research series](docs/artifacts/benchmarks/napier-research-benchmark-series-research_aurora_contradiction_v1-7860868b48599ded.json)
passed 2/2 trials in 49.443–103.865 seconds. Mean cost was `$0.0042888636`;
mean input/output tokens were 10,061.5/9,145.5. Offline verification recomputes each
Result/Ledger pair and the Series aggregate. This fixed-source case does not
measure open-web retrieval, source freshness, or cross-model superiority.

The separate `research_open_web_source_triad_v1` case runs the unchanged
default `observe` Agent against the real open internet:

```bash
npm run bench:research:open-web -- \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY
```

Passing requires keyless Search discovery, the exact official Node.js 24
release page through Fetch, the W3C dummy PDF through Fetch, the
JavaScript-rendered Quotes to Scrape page through Browser, three Research
captures, three exact claims, and one claim-bound adjacent citation per claim.
The case and accepted quote ranges are content-addressed. The privacy-bounded
Result retains tool/source/citation/claim hashes, Replay bindings, usage,
counts, and an event receipt chain while omitting credentials, URLs, source
text, quotes, claims, citation tokens, assistant text, and reasoning.

The retained
[DeepSeek open-web Result](benchmark-results/napier-open-web-research-benchmark-result-research_open_web_source_triad_v1-b90a841f097b03b9.json)
passed in 39.646 seconds with one Search, two Fetches, three Browser actions,
three captures, and three citations at `$0.0054105128`. Offline verification
recomputes the self-hash, receipt chain, evidence aggregates, exact case hash,
tool bounds, source URL/kind/format hashes, accepted quote hashes, and
claim-to-citation-token adjacency. The release audit repeats that semantic
verification. This is one current-source trial, not a freshness SLA,
reliability distribution, or cross-model superiority claim.

### First-Task UX Outcome Benchmark

The fixed `ux_first_task_cli_v1` case measures the clean-state one-shot path
through a fresh built CLI process rather than calling the Runtime directly:

```bash
npm run bench:ux -- \
  --model deepseek/deepseek-v4-flash \
  --credential-env DEEPSEEK_API_KEY \
  --trials 2
```

Every trial starts a new Node process, workspace, data root, Thread, and Run.
Passing requires one manual command, exact model output, a completed Run within
the case latency budgets, exactly one available environment credential
locator, the expected clean-state Thread count, valid Replay, and zero raw-key
matches in CLI output/Replay and every workspace or data-root file. The Result
and Ledger retain hashes and scalar UX evidence but omit the prompt, assistant
text, environment variable name, credential, and reasoning. Series
verification recomputes both trial verdicts and aggregate latency/cost/token
distributions.

The checked-in DeepSeek
[two-trial UX series](docs/artifacts/benchmarks/napier-ux-benchmark-series-ux_first_task_cli_v1-747782333f3ad3c3.json)
passed 2/2 trials. Cold-process first event was 717–823 ms and total CLI
completion was 2.787–2.891 seconds; mean cost was `$0.0007643804`. A reverse
scan of the five retained files found no key, locator name, prompt, or
assistant-text match. The timing starts at the built CLI process launch and
does not include repository installation or compilation.

Cross-model, broader Coding, Workflow, Data, Security, Long-horizon, and
Research cases, UX recovery/browser-onboarding cases, and reference-project
suites remain open.

## Live Models

Napier resolves credentials on the server. Keys are never persisted in Napier
or returned to the web client.

Napier registers Pi's complete built-in Provider catalog rather than
maintaining a second endpoint or compatibility list. The pinned Pi version
contributes 38 Provider factories and 1,116 resolvable models. The Workbench
projection is network-free and bounded to 18 models per Provider and 512 live
models total, with round-robin selection ensuring every static Provider remains
visible; the current catalog projects 414 models in about 76 KiB. CLI, SDK,
RPC, Workflow, and direct Agent calls can still resolve any model in the full
catalog by `provider/model-id`, including models omitted from the bounded
Workbench list.

Action-union tool definitions retain their precise `anyOf` validation while
also publishing the top-level `type: object` required by strict
OpenAI-compatible function APIs. This applies across Browser, kernels, DAP,
research, SQLite, AST editing, file lifecycle, and Process Sessions.

```bash
export OPENAI_API_KEY="..."
export DEEPSEEK_API_KEY="..."
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

For the five standard Providers, `napier setup` and the first-use Web
**Live Provider** docket provide a shorter explicit path. Preview reports
`ready`, `available`, `missing`, `conflict`, or `unavailable` for DeepSeek,
OpenRouter, Anthropic, OpenAI, and Google. Apply requires the selected Provider
plus the exact preview SHA-256, verifies the credential and pinned model, and
then refreshes Web Bootstrap so an untouched demo selection moves to the
live-ready default. Existing explicit model choices and the revisioned Agent
profile are not changed.

For a CLI first task, explicit `run`, `chat`, and `tui`
`--credential-env <variable>` options perform the same environment-locator
registration before creating a Thread or calling the model. Later invocations
reuse that persisted reference.

An active reference is resolved only when needed and can be checked, disabled,
or re-enabled independently. If it is missing, model authentication fails
closed rather than falling back to ambient credentials. The active Agent
profile defaults to `napier/demo`; Context separates the next-run model from
the revisioned persistent default. Runtime model selectors group models by
provider and show configured/total counts, so Providers such as Groq, Mistral,
xAI, OpenAI Codex, GitHub Copilot, and DeepSeek remain visible but disabled
until their credential requirements are available. Evaluation
Suite creation uses the same grouped catalog selector; executable Casebook
qualification only offers configured evaluator candidates. The main Run,
resume, Run Lab evaluation, Evaluation Suite gate, and Plan Workbench
model-review actions are disabled client-side when the selected or suite
evaluator model is not configured. Trace Subagent outcome reviews use the same
availability check before invoking an independent reviewer. Saving an Agent
profile likewise refuses to persist an unconfigured runtime model as the
default, and Independent Advisor review models must be configured live models
distinct from the primary runtime model. The Agent Profile API and rollback
path also reject Advisor reviewers that are `napier/demo`, unknown to the
model registry, or equal to the effective primary model before a revision is
persisted. Server-side prompt, resume, model-call, and persistence entry points
repeat the same configured-live check before accepting live provider models,
including Run Evaluation creation and Evaluation Suite execution after
credential drift, while `napier/demo` remains the explicit zero-key demo path.
Due schedules re-check the effective model at execution time too; credential
drift settles the claim as `schedule.failed` without creating a Run.
Inbound deliveries do the same before dispatch; drift enters the existing
retry/dead-letter lane without creating a Run.
Direct `AgentRuntime.runPrompt()` callers keep the Work Ledger failure contract:
an unconfigured live provider becomes a stable `run.failed` diagnostic before
the provider is called, so active goals block with replayable evidence.

For a low-cost live DeepSeek smoke test, export the key and model, then run the
explicit opt-in test:

```bash
export DEEPSEEK_API_KEY="..."
export DEEPSEEK_MODEL="deepseek-v4-flash"
npm run test:live-deepseek
npm run test:live-cli
```

Both smokes use a temporary local store and workspace, store only the
`DEEPSEEK_API_KEY` environment-variable locator as a credential reference, and
check that the raw key never appears in recorded output. The Runtime smoke
asserts `model.response`, `context.model_envelope`, assistant message, and
`run.completed` Ledger evidence. The CLI smoke drives the JSONL entry point and
verifies one-shot, interrupted-resume, and typed Workflow terminal frames. They
are skipped by default and are not part of `npm run check`.

To test a newly exposed API-key Provider with a real model:

```bash
export GROQ_API_KEY="..."
export NAPIER_LIVE_PROVIDER_MODEL="groq/<model-id>"
export NAPIER_LIVE_PROVIDER_CREDENTIAL_ENV="GROQ_API_KEY"
npm run test:live-provider
```

The generic smoke rejects the five Providers that Napier registered before
this catalog expansion, then runs the selected model through the same Agent,
CredentialReferenceStore, model-context evidence, secret redaction, and
portable Replay path. The existing DeepSeek live smoke also exercises the
complete default Agent tool catalog against a strict OpenAI-compatible API.
Dynamic model refresh, subscription login UI, custom Provider manifests, and
adaptive routing remain separate follow-up work.

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

## Live Run Control

While a live-model Run is active, the main composer remains available as a
durable control inbox. **Steering** is delivered one item at a time after the
current assistant turn and all tool calls finish; it changes the next model
turn without aborting work already in flight. **Follow-up** waits until the
Agent would otherwise stop, then starts another bounded turn. Both consume the
same frozen Run turn/token/cost/time budgets.

`POST /api/threads/:threadId/runs/:runId/control-messages` accepts one strict
`{ mode, text }` request. Napier first appends `run.control.queued`; delivery
atomically appends `run.control.delivered` and the exact `message.user`, so a
process exit cannot acknowledge a direction that disappears from recovery
history. `GET` on the same path returns the ordered hash-only projection, while
`POST .../:controlMessageId/cancel` cancels a pending item. Public projections
contain mode, status, text SHA-256/byte count, timestamps, event sequence
anchors, and stable content SHA-256, never the text.

Each Run accepts at most 64 control messages with at most 16 simultaneously
pending. Run completion, failure, cancellation, or restart interruption
atomically cancels anything not delivered using a low-cardinality reason.
First terminal state wins. Restart recovery summaries and metadata-only OTLP
exports retain only control IDs, mode, reason, byte count, and text hash for
undelivered items. The zero-key demo model rejects live control messages
because it does not run the Pi queue hooks.

## Durable Operator Decisions

A live Agent can call `request_operator_decision` when progress requires a
human choice. The call must be the only tool request in its assistant turn and
contains a short header, one bounded question, 2-4 described options, and a
single/multi-select flag. The tool first commits
`operator.decision.requested`, returns a terminating Pi tool result, and
gracefully completes the origin Run while leaving the Thread `waiting`.
Napier permits one open decision at a time and at most 64 decisions per
Thread.

Answer and continuation are separate durable operations. `POST
/api/threads/:threadId/operator-decisions/:decisionId/answer` records selected
option IDs and optional custom text; an answered decision survives a process
exit without starting work. Explicit `POST .../:decisionId/continue` then
starts an SSE child Run with the origin model and Agent revision,
`parentRunId` pointing to the origin Run, and a user-authored continuation
message. Store-level authorization rejects every ordinary Prompt while the
decision is pending or answered. `GET
/api/threads/:threadId/operator-decisions` returns the ordered projection, and
`POST .../:decisionId/cancel` settles an open gate without resuming it.

The Workbench renders the open decision as a lazy Paper Ledger docket with
radio/checkbox semantics, custom answer, receipt hash, Continue, and Cancel;
the ordinary composer remains disabled until the gate is terminal. Question,
option descriptions, and custom answer stay local to the Ledger and are
excluded from metadata-only OTLP. Portable Thread import remaps both origin
and continuation Run IDs, reconstructs the decision from events, and
recomputes its final content hash while preserving question and answer hashes.

## Durable Agent Milestones

The non-terminating `record_run_milestone` tool gives long-running work an
explicit phase boundary without creating mutable task state. A milestone
records `planning`, `execution`, `verification`, or `delivery`, a concise
summary, concrete completed items, and every remaining open loop. Napier allows
at most 32 milestones per Run and 128 per Thread, rejects contradictory or
duplicate items, and requires the active Thread Run.

Milestone evidence is runtime-derived rather than model-asserted. Before
committing `agent.milestone.recorded`, the Store binds every same-Run Ledger
event after the previous milestone and before the new event into a sequence
range and event-stream SHA-256. Each later snapshot names the exact predecessor
milestone and event sequence, so a tampered, reordered, or stale chain is
ignored by normal projection and rejected by portable fixture validation.

The latest bounded projection is rebuilt after tool execution and injected into
the next Pi turn as system-maintained progress state, making open loops survive
context compaction without accumulating messages. Milestones inside an
imported event range contribute IDs, phases, counts, and hashes only; external
prose is not promoted into system context, while milestones recorded by later
local Runs regain bounded text. `GET
/api/threads/:threadId/agent-milestones` returns the no-store, body-hash-bound
local projection, while the lazy Trace panel renders phase, summary, open
loops, evidence count, and receipt hash. Metadata-only OTLP excludes title,
summary, and item text.

## Independent Model Advisor

Before any final answer is committed, the deterministic Model Advisor checks
completion claims against current Run evidence. Passing-check claims require a
`verify_workspace` result with structured `passed` status after the latest
workspace write. Plan-complete claims require a completed Plan event after the
latest workspace write with no later Plan invalidation. Artifact-verified
claims require a `plan.artifact.verified` event after the latest workspace
write with no later artifact invalidation such as `plan.artifact.missing` or
`plan.artifact.superseded`. Goal-complete claims require a satisfied
`goal.evaluated` event after the latest workspace write with no later
unsatisfied goal evaluation. Recovery-complete claims require a
`run.recovery.completed` or `run.recovery.auto.completed` event after the
latest interruption or recovery invalidation. Evaluation-complete claims
require an `evaluation.completed`, `evaluation.suite.completed`, or
`evaluation.casebook.qualification.completed` event after the latest workspace
write. Evaluation-pass claims require a passed suite or casebook qualification
event after the latest workspace write with no later failed, inconclusive, or
updated evaluation gate. Stale or missing evidence records a hash-only
`model.advisor.notice` before the visible assistant message.

An Agent can add a distinct `modelAdvisor.reviewModel` to review every final
candidate turn before `message.assistant` is committed. The reviewer receives
the current turn prompt, candidate text, and a metadata-only summary of Run
evidence in an isolated zero-tool call. It must return strict JSON containing
an `accept`, `revise`, `block`, or `inconclusive` verdict, score, risk, and up
to six typed issue codes. The primary and review models cannot be the same in
the saved Agent profile, and the review model cannot be the zero-key
`napier/demo` model. Verification evidence distinguishes a completed
`verify_workspace` call from a passed one; failed, timed-out, output-capped, or
legacy status-less verifier completions are not treated as passing checks. A
passed verifier also has to occur after the latest workspace write in the Run,
so a later `apply_patch` invalidates earlier passing-check evidence until the
workspace is verified again.

The durable `model.advisor.independent.reviewed` receipt stores model
identities, issue codes, severities, usage, a low-cardinality evidence summary
for checks, Plan, artifact, and goal completion freshness, and SHA-256 bindings
for the candidate, prompt, evidence, response, issue set, the live request's
hash-only model-context envelope, and complete review. Candidate text and
free-form reviewer guidance are never copied into the receipt. In
`observe` mode the turn remains visible with an auditable second opinion. In
`enforce` mode a non-accept verdict joins deterministic blockers in the
existing correction state machine: at most three subsequent primary-model
turns run without tools, and only a candidate accepted by every configured
advisor is persisted as the visible answer.
Trace renders each independent review with both the request envelope hash and
the review receipt hash plus verification current/stale metadata, so the
second opinion can be inspected without opening raw event JSON. OTLP exports
the same envelope hash as metadata-only telemetry.

Reviewer usage participates in the same frozen Run token, cost, and time
budgets and in final Run settlement. Schema-6 Run fingerprints bind the review
model while schema 1-5 fingerprints remain verifiable. Portable replay rejects
malformed review receipts; metadata-only OTLP exposes verdict, risk, score,
model identities, usage, and hashes but no candidate or guidance prose. The
lazy Trace register renders the same receipt metadata outside the
size-constrained main Workbench bundle.

## Frozen Prompt Variables

Agent profiles can declare up to 32 strict Prompt Variables and reference them
as `{{name}}` inside the System Prompt. A definition can provide a bounded
literal, one of three local current-date formats, or the exact Pi-compatible
Skill catalog loaded for the Run. Definitions are normalized by name and
revisioned with the Agent. Unknown tokens remain unchanged, while replacement
runs once only: a literal containing another token cannot recursively expand
or introduce a second template pass.

Before Run creation, Napier resolves the variables at one timestamp and freezes
the canonical catalog SHA-256, each resolved value SHA-256 and byte count, the
unresolved-name-set SHA-256, reference counts, and rendered System Prompt
SHA-256. Schema 7 introduced bindings for the catalog, complete snapshot, and
rendered Prompt hashes beside the Skill catalog and Advisor policy; current
schema 8 retains them. The
`context.prompt_variables` event carries that hash-only snapshot; it never
contains literal values, rendered Prompt text, or unresolved names. If a
`skill_catalog` token was used, the catalog is not appended a second time.

Every turn, Goal continuation, and Advisor correction inside the Run reuses the
same rendered Prompt. Portable replay requires exactly one valid snapshot event
for each schema-7 or schema-8 Run, verifies all three fingerprint bindings, and
recomputes the catalog plus entry names/types from the exact Agent revision.
Metadata-only OTLP exports only counts, booleans, and hashes. The lazy Context
editor provides typed definitions and token insertion without increasing the
main Workbench entry bundle.

## Durable Tool Loop Guard

The revisioned `toolLoopGuard` policy is enabled by default with threshold
three and an optional canonical exemption list. Napier follows Pi's actual
tool-call content rather than provider-specific stop reasons. It counts only
consecutive single-tool turns whose canonical argument SHA-256 and terminal
result SHA-256 are both identical; a changed tool, argument, result, parallel
batch, or exempt tool resets the streak.

When the threshold completes, `model.tool_loop.detected` records only the tool
name, event range, count, policy/call/result/attempt-set hashes, and receipt
hash. The next Pi turn receives a system-maintained redirect that survives
context compaction. If the model still requests the same call,
`beforeToolCall` emits a hash-only `tool.blocked` receipt and returns an in-band
instruction to change arguments, inspect different evidence, use another tool,
or report the blocker. No fourth side effect executes.

This intentionally differs from mid-token stream abort: Pi 0.82 shares one
abort signal across the Run, and an interrupted provider response cannot always
settle usage reliably. Napier waits for the complete billed tool turn, then
redirects before the next side effect. Schema 8 binds the effective policy;
portable replay recomputes every trigger from prior Ledger events; OTLP exposes
only scalar metadata and hashes. Lazy Context and Trace registers configure and
inspect the circuit breaker outside the main entry bundle.

## Model Context Envelopes

Every provider request leaves a debug-only `context.model_envelope` receipt
just before Pi calls the model. The receipt is generated after Napier has built
the current System Prompt and Pi has converted Agent messages into provider
messages, so the first envelope includes the live user prompt and later
envelopes include tool-result context. It stores only role counts, byte counts,
turn index, and SHA-256 projections for the System Prompt, message set,
tool-name set, and tool-definition set.

The raw prompt, messages, tool names, tool schemas, and tool outputs are not
copied into the receipt. Portable ledger and Run replay snapshot validation
replay the receipt shape, hash, and per-Run turn-index sequence so a tampered
or duplicated model-context claim fails closed during export/import
verification. Each `model.response` also carries the envelope hash, turn index,
message-set hash, and
tool-definition-set hash for the request that produced it; OTLP exposes those
values on the chat span as metadata only. The lazy Trace Workbench renders
these envelopes as a hash-only register, shows the bound response sequence,
model, and stop reason when the response hashes match, and refuses malformed
payloads or payloads containing raw fields. Run replay snapshots and Run Lab
comparisons expose envelope coverage plus bound/unbound response counts as
ordinary metrics, then derive a metadata-only `contextCoverageDelta` status so
operators can see whether a candidate Run is clean, partial, missing, or
regressed. The same envelope binding now covers pairwise evaluator model calls:
each service-created evaluation Run records the evaluator request envelope and
a redacted `model.response` with only text hashes, byte counts, usage, and the
binding hashes. Replay validation fails closed when an envelope lacks exactly
one bound response. Live Agent primary turns share a Run-level turn counter, so
goal continuations and advisor corrections keep a contiguous envelope sequence
instead of restarting at turn 0. Context compaction, goal-evaluator, and
memory-extraction auxiliary calls also emit hash-only envelopes and redacted
response bindings; their usage remains on `context.compaction.*`,
`goal.evaluated`, or `memory.extraction.*`, so total Run accounting is not
double-counted.

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
enabled Skill catalog SHA-256; schema 6 additionally binds an independent Model
Advisor identity; schema 7 binds frozen Prompt Variable catalog, snapshot, and
rendered System Prompt hashes; schema 8 additionally binds the Tool Loop Guard
policy. The corresponding `context.skills` Ledger event records only Skill
names, relative `SKILL.md` paths, byte counts, diagnostics hashes, and file
SHA-256 values, never Skill instructions. Portable full-thread fixtures
optionally carry the complete Agent revision ledger, remap the Agent ID, and
recompute every revision hash during atomic import; legacy schema-version-1
fixtures remain valid.

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

## Sandboxed Command Execution

An Agent with `workspace` or `unrestricted` policy can opt into
`run_command`. It passes 0–64 literal argv items directly to Napier's fixed
Node executable. Napier does not evaluate a command string, invoke a shell,
inherit the server environment, or resolve a user-controlled executable.

The command cwd is canonicalized inside the workspace. The OS sandbox receives
only `process.spawn` and `workspace.read`; workspace writes and networking stay
denied. The child receives a fixed CI-oriented environment without provider
credentials. Each foreground invocation has a 1–120 second wall-time limit,
32,000-character caps for stdout and stderr, process-group cancellation, and
distinct `succeeded`, `failed`, `timed_out`, and `output_capped` outcomes.
Non-zero exits are structured results rather than hidden transport failures.

The live model receives bounded stdout/stderr so it can use the result. The
Ledger does not retain argv or output text: `model.response`, `tool.started`,
and `tool.completed` keep only runtime/count metadata, input/output hashes,
stable result evidence, exit state, limits, and sandbox capability state.
Trace renders the same bounded view. The Tool Loop Guard consumes the redacted
call and stable result hashes, so privacy does not disable repetition
detection. Unknown interrupted outcomes remain subject to normal recovery
checks and are never silently repeated.

Run the real local-backend smoke outside an already sandboxed parent process:

```bash
npm run test:live-command
```

macOS rejects nested `sandbox-exec`, so the smoke fails closed when launched
from an IDE process that is itself sandboxed. OCI command execution is also
fail-closed until runtime executable identity can be bound across the host and
image. Foreground `run_command` remains pipe-only; terminal-aware work uses the
separately managed `workspace_process` PTY below. Foreground commands remain
read-only; Process Sessions add only the preview-bound scoped write mode
described below. Hard per-command CPU/memory quotas remain explicit next-stage
work. Python remains a separate restricted Kernel protocol. Generic
`run_command` stays Node-only; Git uses the purpose-built inspection, staging,
commit, branch-creation, and branch-switch surfaces below rather
than exposing arbitrary Git argv.

## Controlled Git Inspection, Staging, Commit, And Branch Operations

`git_inspect` reads the workspace-root repository through fixed
`/usr/bin/git` execution in the same local read-only, denied-network OS
Sandbox. `status` returns porcelain-v2 branch and entry lines. `diff` returns a
working or staged patch, optionally limited to one workspace-relative path and
0–10 context lines. Output is capped at 128 KiB; an over-limit patch fails
instead of returning incomplete evidence.

`conflict` accepts `path` or a mutually exclusive canonical `paths` set of 1–4
workspace-relative files with unmerged index stages. Napier normalizes aliases,
rejects NFC/case collisions, reads and SHA-1-checks the exact preview-bound
index bytes once, and parses all targets from that v2/v3 index scan. It
classifies modify/modify, add/add, and either modify/delete direction, then uses
fixed `cat-file blob` commands for each present base/ours/theirs object. Every
canonical no-follow worktree file and stage must be complete UTF-8 text bounded
to 24 KiB;
FIFO/device, symlink, gitlink, binary/control text, invalid checksum, SHA-256/
v4 index, and changed worktree/index state fail closed. The complete
worktree/base/ours/theirs text is live untrusted data. Multi-path Receipt
`conflictStageCount` is the total stage count, `mixed` means classifications
differ, and presence booleans mean every target has that side. Agents can
resolve the set
through `read_file` and `apply_patch`, then reuse
`git_stage_preview`/`git_stage_apply` to atomically replace the unmerged stages
with one reviewed resolved index state.

Napier supplies every argument and disables optional locks, pagers, color,
filesystem monitoring, rename detection, external diff, textconv, and
submodule traversal. Literal pathspec mode prevents a path from expanding into
Git pathspec magic. A fixed config preflight reads local key names without
following includes and rejects include paths, clean/smudge/process filters,
diff commands/textconv, `core.attributesFile`, worktree config, split index,
sparse checkout, reftable ref storage, and SHA-256 object repositories. A
direct `.git` directory is required at the workspace root; gitfiles,
symlinked metadata,
`config.worktree`, `sharedindex.*`, sparse-checkout/graft metadata, protected
paths, active index locks, OCI, commits, checkout, reset, clean, and arbitrary
subcommands are rejected. Replacement refs are disabled. Before and after
execution, Napier rechecks no-follow HEAD/current-ref, packed-refs, index,
config, and shallow metadata. Git executable drift or repository metadata
drift fails the call.

Paths, branch/status lines, patch bodies, and conflict text are available only
to the current model as untrusted repository data. Ledger, Replay, Workflow
output evidence, and Web Trace retain action/scope, conflict kind/stage
presence, counts, output bytes, duration, and repository/HEAD/index/config/
conflict/executable/actual-argv/environment/limit/output/result hashes,
including the selected Sandbox backend hash. The tool supports Agent and
model-free typed Workflow Tool nodes.

`git_stage_preview` extends this read surface without changing the real index,
refs, worktree, or object database. It accepts `path` for one bounded regular or
tracked-deleted file, or `paths` for one canonical 1–16 target set. Napier
normalizes aliases, rejects NFC/case-fold collisions on relevant filesystems,
sorts targets by code point, and binds every file bytes/mode plus root-to-target
`.gitattributes` chain. Present target bytes are capped at 16 MiB each and
32 MiB aggregate. Napier copies the current index into
`.git/napier-stage/<ephemeral>`, directs both `GIT_INDEX_FILE` and
`GIT_OBJECT_DIRECTORY` there, then runs fixed `git add -- path` once per ordered
target against that same private index. It renders one complete patch by
concatenating a fixed path-filtered `git diff --cached HEAD` for every target.
If a supported unmerged text target resolves into an index state whose tree
matches HEAD, the otherwise empty diff becomes an explicit canonical index
transition naming the prior stage set and zero tree delta. An ordinary empty
target remains rejected. Every target therefore contributes reviewable staged
tree or index-transition evidence, with a 128 KiB aggregate limit.

For one `path`, a strictly increasing set of 1-based `hunkIndexes` instead
selects up to 32 complete hunks from a fixed single-path index-to-worktree patch
and applies only those hunks to the private index through fixed
`git apply --cached --unidiff-zero`. Hunk selection is unavailable with
`paths`. New/deleted/binary,
mode-changing, renamed, malformed, CRLF patch, or out-of-range selections fail
closed; whole-path staging remains available for supported new/deleted files.
The OS Sandbox keeps the complete workspace read-only and grants write access
only to that ephemeral directory. The resulting live patch/index transition,
proposed index hash, repository/config/index state, target bytes/mode,
selected-hunk protocol and digest, parent `.gitattributes` chain, and
`.git/info/attributes` produce a one-use five-minute capability scoped to its
Agent Run or Workflow Plan.

`git_stage_apply` consumes that capability, locks the real index plus every
target path, rechecks every binding, reconstructs the same private index, and
requires identical index and patch hashes. Runtime verifies every new loose
object by SHA-1, promotes it by no-overwrite hard link, acquires the standard
`.git/index.lock`, revalidates again, fsyncs the prepared index, and atomically
renames it into place while preserving the prior index mode. A concurrent
metadata/worktree/attribute change blocks before commitment or produces an
explicit indeterminate postcondition after commitment. Paths and patch bodies
remain live-only; durable evidence retains the expiring capability, bounded
counts, state hashes, environment/argv/Sandbox hashes, durability, and result
hash. The selection digest is folded into the existing `gitArgumentsSha256`,
preserving the schema-1 32-property Workflow Receipt and legacy Web Trace
contract.

`git_commit_preview` consumes the complete existing staged index without
changing refs, the real index, worktree, or object database. It rejects empty
ordinary staging, more than 32 changed entries, staged gitlinks, detached or
unborn HEAD, and rebase/cherry-pick/revert/bisect/sequencer/squash/autostash
state.
An ordinary commit requires no operation markers. A merge commit requires
exactly one bounded `MERGE_HEAD`, a bound `MERGE_MSG`, an already resolved
stage-0 index, and optional bound `MERGE_MODE`, `AUTO_MERGE`, and `MERGE_RR`
files. If that resolved index has no tree delta from HEAD, Napier emits an
explicit canonical merge-tree transition and still reviews the two ordered
parents; ordinary empty commits remain unavailable. Octopus merge heads are
rejected. The Runtime writes a normalized
message, copied index, and new objects only under
`.git/napier-stage/<ephemeral>`, then runs fixed `write-tree` and `commit-tree`
with one or two ordered `-p` arguments, the
`Napier Agent <napier@localhost>` identity, and preview timestamp. The
five-minute one-use Run/Plan capability binds both parents when present, tree,
exact proposed commit SHA-1, message, staged tree/transition, operation state,
repository, executable, Sandbox, environment, and limits.
Before reading operation state, preview takes the private commit lock and scans
for one unfinished Napier marker-isolation transaction. It restores only
content/mode-verified backup bytes, verifies the complete original operation
hash, and removes the transaction durably; malformed, multiple, or corrupted
transactions fail closed. A durable `.complete` directory is private garbage
only and is removed best-effort.

`git_commit_apply` consumes that capability under index and branch-ref locks,
reconstructs the same commit, requires every bound hash to match, and promotes
only SHA-1-verified loose objects. A fixed
`update-ref <previewed-branch> <new> <old>` CAS is the sole ref mutation;
`core.hooksPath=/dev/null` disables reference hooks, and no editor, signing,
checkout, merge execution, remote, or arbitrary revision is exposed to the
model. Private construction files must be removed before ref CAS. Apply settles
HEAD after failures, timeout, cancellation, or process uncertainty and uses
only the original deadline's remaining budget. A merge isolates immutable
backups of every exact marker only after a clean ref result and durable
ref/reflog transition; final settlement failure restores the original marker
bytes, while success commits the isolation through an fsynced `.complete`
directory rename. A result is `applied` only when HEAD and the attached branch
equal the proposed commit, the index remains unchanged, staged diff is empty,
operation state is cleared, both reflog tails bind the parent-to-commit
transition, and final settlement proves the same state. Any uncertainty is
`indeterminate`. Messages, patches, and operation-file content remain
live/private-only; durable evidence retains topology plus bounded
content/state/runtime hashes.
Apply holds the same private commit lock, so preview, apply, crash recovery, and
completion garbage collection cannot classify the same marker transaction
concurrently.

`git_branch_create_preview` accepts one bounded ASCII local branch name and
binds it to the exact current `HEAD^{commit}` plus repository/config/index
state. It rejects invalid or existing loose/packed refs, shared/reftable/
SHA-256 repositories, unsafe config, and symlinked ref ancestors. Preview is
read-only and returns a five-minute one-use Run/Plan capability; branch names
remain live-only while durable evidence retains only their ref hash and byte
count.

`git_branch_create_apply` consumes that capability under the exact ref lock,
rechecks HEAD/repository/config/index state and ref absence, then runs only
`update-ref <previewed-ref> <target> <zero>` with hooks disabled. It fsyncs the
new loose ref and branch reflog, verifies the zero-to-target reflog tail, and
settles HEAD, repository state, and the exact branch before and after
durability. `applied` therefore proves the branch exists at the previewed
commit while HEAD, index, worktree, and objects remain unchanged. A concurrent
HEAD switch or uncertain ref process is returned as `indeterminate`; the
created ref, if present, is never hidden as a safe failure.

`git_branch_switch_preview` accepts one existing local target and binds exact
source/target commits, repository/index state, HEAD reflog content/mode/bytes,
fixed runtime evidence, and a one-use Run/Plan capability. Same-tree targets
need no checkout and preserve dirty index/worktree state. A target with a
different tree requires a globally clean repository and returns the complete
bounded checkout patch for review. That path accepts at most 32 existing-parent
regular UTF-8 files, 64 KiB per file, 512 KiB total source/target bytes, and a
128 KiB patch. It rejects binary, symlink, gitlink, directory-lifecycle,
attribute-converted, `core.autocrlf/eol/safecrlf`, unsafe, non-canonical,
linked/shared/reftable/SHA-256/alternate, and OCI state.
Both branch-switch tools are conservatively classified as high-risk writes:
preview normally leaves Git state unchanged, but it must be authorized and
serialized because it may reconcile one interrupted checkout transaction.

For a divergent tree, `git_branch_switch_apply` first reconstructs the exact
target index and target blobs, then writes/fsyncs a 0700 private manifest,
source index, target index, staged files, and independently copied source
backups. Under
one root/index/HEAD/ref/changed-path lock it commits the reviewed worktree,
atomically installs the target index through `index.lock`, and changes HEAD
last. The fixed `update-ref --no-deref --stdin` transaction verifies the target
OID and old dereferenced HEAD OID before attaching HEAD; hooks are disabled and
the transaction body is hash-bound stdin.

Apply proves target/HEAD, exact index, bounded worktree files, static repository
state, and an exact old-to-new `napier switch branch` HEAD reflog append before
an fsynced `.complete` boundary. Before that boundary, a source-HEAD state
restores worktree then index from immutable backup; a fully verified target-HEAD
state is completed on the next preview/apply. Corrupt, unknown, multiply
active, or lock-set-drifting recovery state fails closed and retains private
evidence. Same-tree switches retain the ref-only fast path. Timeout,
cancellation, process ambiguity, extra reflog writes, or any postcondition
uncertainty returns `indeterminate`.
Receipt/Trace expose `recoveryAction=none|rolled_back|completed`; patch, paths,
branch names, file content, and recovery locations remain live/private.

`git_review_preview` requires current HEAD to be attached to a direct local
source branch and accepts one different existing direct local target branch.
The target must be an ancestor of source. Napier rejects merge topology and
walks at most 64 strictly linear commits in parent order, rendering each commit
ID plus its complete patch so intermediate add-then-delete content cannot be
hidden by a cumulative tree diff. Across the range it permits at most 32
regular UTF-8 A/M/D file transitions, 64 KiB per blob, 512 KiB aggregate blob
bytes, and 128 KiB of live review output. Every old/new blob is independently
read with fixed `cat-file` and verified by Git SHA-1. Binary, symlink, gitlink,
type-transition, non-ancestor, merge, symbolic-ref, unsafe, and stale ranges
fail closed.

`git_review_apply` consumes the one-use Run/Plan capability under HEAD,
source-ref, and target-ref locks, reconstructs the complete per-commit review,
then runs only fixed hooks-disabled
`update-ref --no-deref -m <fixed> <target> <source> <old-target>`. The
`--no-deref` boundary prevents a last-moment symbolic-ref replacement from
redirecting authority. Apply requires HEAD/source/index/config to remain
preview-exact, fsyncs only the target loose ref and reflog, proves the target
reflog equals its previewed prefix plus one exact old-to-new record, and settles
HEAD/source/target plus unchanged HEAD reflog twice. A CAS loss, extra reflog
append, process ambiguity, or postcondition drift is `indeterminate`; it is
never retried as merge, force, reset, or history rewriting. Branch names and
patches remain live-only while Ledger/Replay/Workflow/Web retain commit IDs,
counts, and plan/ref/runtime/result hashes.

These slices do not stage directories or symlinks. Multi-path staging is capped
at 16 whole paths and does not permit per-path hunk selections; selected-hunk
staging is text-only and does not split new/deleted, binary, mode, rename, or
more-than-32-hunk changes. They do not
support repositories without an existing
index/HEAD, linked worktrees, split/sparse indexes, SHA-256 objects, reftable
refs, alternates, staged submodule/gitlink changes, shared repository ACLs, or
OCI execution. Divergent switching remains limited to clean bounded UTF-8
regular files with existing canonical parent directories; it does not support
binary/symlink/gitlink files, attribute conversion, directory lifecycle,
general checkout/reset/clean, merge execution, octopus/squash/autostash merge
completion, multi-file conflict resolution as one transaction, non-linear
Review promotion, signing, hooks, or remote operations. Those operations remain
separate preview-bound transactions;
arbitrary Git argv and dangerous history rewriting remain unavailable.
Preview capabilities are process-local and intentionally non-resumable:
expiry or Runtime restart requires a fresh preview rather than replaying a
stale index or ref mutation.

## Workspace Process Sessions

An Agent can separately opt into `workspace_process` to start, send input to,
poll, or cancel a longer Node diagnostic. Ordinary starts reuse the same
explicit-argv preparation, fixed environment, executable binding, canonical
cwd, read-only workspace, and denied-network OS Sandbox as `run_command`;
there is still no command string, shell, inherited provider credential, or
user-selected executable. Stdin closes at launch unless the start explicitly
opts into interactive mode.

A write session requires a separate `preview_write` followed by
`start_write(previewId)`. The preview binds the exact command, environment,
limits, complete workspace baseline, owning Thread and Run, five-minute
expiry, and one to eight explicit existing workspace-relative file or
directory scopes. Workspace root, overlap, symlinks, `.git`, `.napier`, and
`node_modules` are rejected. The preview is one-use and fails stale when the
workspace, scope tree, executable, or Runtime assets change. The OS Sandbox
keeps workspace root read-only and remounts only those scopes writable;
network remains denied. Cross-Manager data-root locks serialize scoped writers
for the same workspace.

`preview_write` can additionally bind
`failureRecovery: "restore_scopes"`. This explicit pre-launch authorization
creates a schema-v7 Process and does not broaden the approved paths. After a
failed, timed-out, output-capped, or cancelled Process produces a complete
`changed + within_scope` settlement, Napier keeps the same workspace lock,
persists terminal Process evidence, rechecks settled-after freshness, and runs
the existing two-phase recovery transaction. Process polls remain pending
until the compensation outcome is known. Successful, unchanged,
outside-scope, indeterminate, or interrupted Sessions do not auto-restore;
restart never invents or retries a missing compensation attempt. Operator
rollback remains available when the automatic attempt was not safe or was
fully reverted.

`npm run bench:process-recovery -- --trials 5
--trusted-outer-sandbox` runs the fixed
`long_horizon_process_write_compensation_v1` Outcome benchmark. Each trial
launches a real temporary Node process, changes one preview-authorized file,
exits with code 17, requires automatic byte restoration, closes and reopens
the Store and Process Manager, and verifies Replay plus the ordered
`started -> settled -> rollback_started -> rolled_back` evidence. Result and
Ledger artifacts retain only hashes, counts, statuses, and bounded Process
events. The explicit trusted-outer adapter is for an already isolated test
host and is recorded as `trusted_outer_test`; it is not evidence that
`sandbox-exec`, Bubblewrap, or OCI enforced the child boundary. The default
command remains fail-closed on the platform Sandbox. This capability has no
isomorphic OMP operation and is therefore excluded from Napier/OMP scoring.

Before a scoped write launches, Napier copies only the approved scopes into a
mode-checked private recovery directory under the local data root. A changed,
fully settled schema-v6 session exposes operator-only rollback through
`POST .../rollback/preview` followed by one-use `POST .../rollback`. Preview
requires the complete current workspace digest to still equal that Process
settlement. Apply rechecks the digest under the workspace write lock, stages
every original scope beside its target, swaps all scopes, verifies content and
POSIX mode hashes, and reverses already committed swaps if a later scope
fails. It never overwrites changes made after settlement.

Rollback writes a hash-only `workspace.process.rollback_started` intent before
the first file swap and a matching `workspace.process.rolled_back` outcome
after verification. If intent persistence fails, no file changes. If outcome
persistence fails, the durable pending intent blocks retries after both the
current process and a Runtime restart. A verified `reverted` outcome permits a
fresh preview; `indeterminate` requires manual inspection. `restored` and
`reverted` require successful parent-directory synchronization; staging,
cleanup, reversal, or durability failure remains `indeterminate` with private
recovery material retained. Recovery manifests and rollback evidence reject
unknown fields even when their hashes are recomputed, and Process recovery
directories are read with `lstat` so a replacement symlink is never followed.
Paths, backup bytes, command source, symlink targets, and raw errors remain
local.

An alternative explicit `terminal` start allocates a real pseudo-terminal with
bounded initial columns and rows. `node-pty` launches only the existing
`sandbox-exec` or Bubblewrap wrapper; the selected Node target remains inside
that wrapper. The child observes TTY stdin/stdout and fixed
`TERM=xterm-256color`. PTY stdout and stderr are one merged, ordered terminal
stream, and the Agent can perform up to 64 Run-owned bounded resizes. The
Workspace Processes panel labels merged output, displays the current size and
resize count, and retains plain-text rendering for untrusted control
sequences.

Each Thread may have at most four active sessions and one Runtime at most eight
in total. A session retains at most 32,000 characters per stream and 256
ordered chunks, settles on exit, non-zero exit, timeout, output cap, parent
cancellation, operator cancellation, or graceful Runtime shutdown, and exposes
output through a monotonically increasing cursor. The live Agent and local
Processes panel can read that bounded output while the Runtime remains alive.
Repeated Workbench polling uses an incremental in-memory projection rather than
scanning the complete Thread.

An interactive session accepts at most 32 KiB per UTF-8 input action, 256 KiB
in total, and 64 serialized input actions. A write may append one newline and
may close stdin after the bytes are accepted. Input after close, settlement, a
different owning Run, or Runtime restart fails closed. The Processes panel
offers the same Thread-scoped send and close controls, preserves the final
receipt after close, and discards stale list, output, delta, or input responses
when the Thread or selected Process changes. Client cancellation before a
queued write prevents it; once a write starts, a disconnected caller cannot
prove whether kernel-buffered bytes reached the child and must inspect the
session and Trace rather than retry blindly.

PTY input uses the same message, total-byte, action, ownership, and redaction
limits, but it cannot use pipe close semantics because a pseudo-terminal cannot
be truthfully half-closed. The Agent or operator may send literal terminal
control bytes, wait for terminal settlement, or cancel. Native PTY writes prove
synchronous adapter acceptance rather than target consumption, so an unknown
outcome must still be inspected instead of retried.

Each new session also captures a deterministic workspace snapshot before
launch and another after settlement. Ordinary read-only sessions retain the
compatible 2,000-file/16 MiB window. Scoped writes use a directory-aware,
10,000-entry/64 MiB complete baseline so empty-directory creation or removal
cannot disappear from the Delta. Symlink identity is hashed without following
or exposing its target. Truncation or an unavailable snapshot is
`indeterminate`. A scoped Delta is `within_scope` only when every observed path
is inside an approved scope; any outside path is `outside_scope`. External
processes do not honor Napier's lock, so outside-scope drift has unknown
attribution rather than being falsely assigned to the child.

Input and output text plus argv never enter the Ledger, Trace, Replay, or
exported fixtures. Durable `workspace.process.started`, `.input`, `.resized`,
`.settled`, `.interrupted`, `.rollback_started`, and `.rolled_back` events bind
the Napier Process ID, owning Thread and Run, status, executable,
command/environment/limit hashes, input
sequence/counts and cumulative digest, output hashes/counts, cursor, truncation
state, I/O mode, terminal dimensions, and resize sequence. Schema-v5 through
schema-v7 scoped-write events additionally bind the preview hash, scope
count/set hash, optional failure-recovery policy, and
`within_scope`, `outside_scope`, or `indeterminate` settlement. They also bind
pre/post workspace digests, comparison status, changed-entry count, and a
changed-path-set digest without storing paths.
Relative paths and before/after file metadata are bounded to 256 entries and
available only from the current local Runtime through the owning Thread's
Processes panel. After restart, an unclosed session becomes `interrupted` with
unknown outcome and no output or path details; Napier does not silently rerun
it or claim the old host process was reattached. Existing schema v1-v4 Process
receipts and schema-v5 scoped writes remain readable, ordinary pipe and PTY
sessions use schema v4, ordinary recoverable scoped writes use schema v6, and
explicitly compensated writes use schema v7.

Run the complete Agent-to-Sandbox smoke from a non-sandboxed Terminal:

```bash
npm run test:live-process
```

Graceful shutdown terminates active process groups before Store close. Abrupt
host or Runtime loss still leaves the task outcome unknown. On macOS, the
guardian terminates the target group plus descendants whose PID and start time
were observed at launch, during bounded background scans, or immediately
before cleanup. This covers an observed child that creates a separate session
without trusting PID alone. A rapid double-fork that reparents entirely between
two scans, cross-restart reattachment, hard CPU/memory/process quotas, and
remote write backends still require a stronger managed or OCI boundary.
Scoped settlement proves observed path containment, not which external process
wrote each byte. Operator rollback restores approved scopes only; it cannot
undo outside-scope drift, recover an unknown crash window, or become an
unreviewed Agent action. The only automatic path is the exact failure recovery
bound into the original write preview. Pipe interaction remains distinct from
PTY; the PTY provides
terminal sizing and control bytes but not shell access, cross-restart attach, a
durable screen buffer, or Napier job-control commands. The separate JavaScript
kernel below builds on the read-only Process Session boundary. The restricted
Python kernel below shares the same read-only Process service; full
package-backed Python and Notebook execution remain future work.

## Persistent JavaScript Kernel

An Agent with `workspace` or `unrestricted` policy can opt into
`javascript_kernel`. It starts one synchronous JavaScript context, evaluates
multiple snippets against the same in-memory state, and explicitly cancels the
kernel when the calculation is complete. The process is owned by the current
Thread and Run and reuses `WorkspaceProcessManager`, the fixed secret-free
environment, canonical workspace cwd, read-only workspace, denied network,
bounded output, process-group cancellation, and OS Sandbox used by
`workspace_process`. If the Agent omits `cancel`, successful, failed, waiting,
and cancelled Run settlement terminates every remaining kernel for that Run
before the terminal Run event.

Each snippet is limited to 16 KiB and 1-2,000 ms of VM execution. A kernel has
a 10-120 second total lifetime and a 64 MiB V8 old-space limit. Live results
contain at most 4,096 preview characters and 12 console entries of 256
characters each. UTF-16LE base64 keeps control characters and isolated
surrogates from expanding the private JSONL frame, and a 30 KiB cumulative
protocol budget reserves room for a structured terminal response before the
Process output cap. Synchronous errors are visible without discarding valid
prior state. Promise microtasks are drained before an evaluation returns and
remain inside its VM timeout; an infinite chain therefore times out instead of
mutating state after the result. A returned Promise or thenable, VM or
result-render timeout, output-budget exhaustion, caller cancellation, process
exit, malformed protocol response, or unknown input outcome terminates the
complete kernel so uncertain asynchronous state is never reused.

The context has no `process`, `require`, `fetch`, inherited environment,
dynamic string code generation, WebAssembly, shared-memory Atomics, or
GC-timed callbacks through `FinalizationRegistry`/`WeakRef`. Ordinary
`ArrayBuffer` and TypedArrays remain available for pure calculation. Console
capture and value formatting are created inside the VM realm; no host function
or object is injected into untrusted code. Regression tests cover
`console.log.constructor`, `Function`, `eval`,
`globalThis.constructor.constructor`, delayed microtasks, and malicious
custom-inspector and `toJSON` paths. `node:vm` is not treated as the security
boundary: the child still runs inside the read-only/offline OS Sandbox, and
unsupported or nested Sandbox startup fails closed.

Code, values, console text, and cwd paths are available only to the live tool
call. The Ledger, Replay, Server SSE history, and Web Trace retain bounded
status/count/latency metadata plus code, request, worker, result, and output
hashes. The underlying Process Session is marked as a private protocol while
live: generic Process APIs and Workbench report output and stdin unavailable,
so they cannot expose reversible frames or inject evaluations around the typed
tool. State is intentionally ephemeral: another Run or a recreated Runtime
manager cannot adopt it, and restart reconciliation records the underlying
Process Session as interrupted rather than replaying input.

This slice is a synchronous calculation kernel, not a Node module environment
or Notebook. It does not provide imports, timers, async I/O, package access,
workspace writes, Napier-tool callbacks, snapshots, cross-restart recovery, or
Python execution. The opt-in real OS-Sandbox smoke is included in:

```bash
npm run test:live-process
```

## Persistent Restricted Python Kernel

An Agent with `workspace` or `unrestricted` policy can opt into
`python_kernel`. It starts one isolated Python process, preserves pure
calculation variables and functions across synchronous evaluations, and
explicitly cancels the state when finished. It reuses
`WorkspaceProcessManager`, per-Thread admission, Run ownership, canonical cwd,
read-only workspace, denied network, private protocol projection, process-group
cancellation, and terminal-before-Run Ledger ordering. If the model omits
`cancel`, every successful, failed, cancelled, or operator-waiting Run closes
its remaining JavaScript and Python kernels.

Napier resolves a fixed system Python executable rather than the macOS
`/usr/bin/python3` Developer Tools shim. On macOS it accepts only recognized
Command Line Tools or Xcode framework locations; Linux uses the fixed
`/usr/bin/python3` runtime. The executable, bounded no-site worker bootstrap
dependency set, existing bytecode, native extensions, fixed environment,
compressed worker bytes, argv, resource limits, and versioned runtime root are
hash-bound. The OS Sandbox mounts the exact Python version root read-only.
Runtime preparation and post-settlement verification rehash the executable and
bound assets; a host regression proves that set covers every module file
actually loaded by the worker. OCI execution remains fail-closed until
host/image runtime identity is defined.

Each snippet is limited to 16 KiB and 1-2,000 ms; the whole kernel lasts
10-120 seconds. Live previews are capped at 4,096 characters, console capture
at 12 entries of 256 characters, cumulative private protocol output at 96 KiB,
and complete Agent output at 32 KiB. The elevated output budget is available
only to trusted private protocols and is recorded on the Process Session;
ordinary shell and PTY Sessions remain capped at 32K characters. Code requests
use canonical base64 and the fixed worker uses zlib plus canonical base64 to
stay inside the unchanged 16 KiB explicit-argv budget. Result strings use
canonical UTF-16LE base64. Trusted requests may also bind one canonical JSON
input and receive one exact JSON result up to 32 KiB. Lists and objects are
frozen into tuples and mapping proxies, and result projection rejects cycles,
non-string keys, unsupported objects, non-finite numbers, and excessive
depth/node counts. Python `repr` is never used as a data protocol.
The worker's trusted timer remains the execution deadline; the parent allows a
separate bounded five-second scheduling and protocol-delivery grace so a
loaded host cannot cancel a valid result before the worker starts processing.
The interpreter starts with `-I -B -S -u`, so system/user site initialization
does not run. A trusted signal handler enforces each wall timeout with an
uncatchable process exit; CPU time, child processes, output file size, core
dumps, and file descriptors also have hard worker limits. A second uncatchable
exit enforces a 32 MiB `tracemalloc` Python-heap budget even around a user
`except:` block. This is not a hard total-RSS limit for arbitrary native
extensions; extensions and imports are unavailable, while OCI/VM memory quotas
remain the stronger future boundary.

The worker exposes a deliberately narrow pure-computation language. Imports,
classes, async/await, yield and generator expressions, context managers,
global/nonlocal declarations, decorators, private or dunder names/attributes,
frame/traceback access, dynamic compilation, file APIs, environment access,
subprocesses, and networking are unavailable. The globals dictionary contains
only bounded arithmetic, container, iteration, conversion, exception, and
printing builtins. Regression tests cover import, dunder, generator-frame
introspection, bare-except memory-limit bypass, oversized input,
worker-enforced wall timeout, external cancellation, concurrency, cross-Run
access, protocol spoofing boundaries, complete loaded-asset coverage, and
cumulative output exhaustion. The OS Sandbox remains the outer host security
boundary; the Python restrictions reduce capability and protect protocol/state
integrity rather than replacing process isolation.

Synchronous syntax and runtime errors are live and non-terminal, preserving
earlier valid state. Wall/CPU timeout, traced-memory exit, output-budget
exhaustion, background thread detection, caller cancellation, malformed
protocol, worker exit, or any unknown post-write result destroys the complete
kernel. Another Run or recreated manager cannot adopt the state. Generic
Process APIs expose neither protocol stdout nor writable stdin, while operator
cancellation remains available.

Code, values, console text, cwd paths, and fixed memory-limit markers are never
stored as event text. Ledger, Replay, public SSE history, and Web Trace retain
only action/status/type, Python version, counts, timing, memory peak/limit, and
request/worker/runtime/command/result/output hashes. Deterministic Agent and
public HTTP dogfood preserve a list across turns, calculate a result through
real Python, cancel the process, and verify a privacy-safe Replay.

This slice is not general Python, a package environment, DataFrame/SQL runtime,
Notebook, async kernel, filesystem tool bridge, checkpoint, or cross-restart
session. Run the opt-in real OS-Sandbox smoke from a non-sandboxed Terminal:

```bash
npm run test:live-process
```

The nested IDE host used for this revision rejects the Python probe with exit
71 and `sandbox-exec: sandbox_apply: Operation not permitted`, matching the
existing Process/JavaScript smoke limitation. No unsandboxed fallback is used.

## Run-Owned Node Debugger

The opt-in `node_debugger` tool launches one workspace JavaScript or
Node-executable TypeScript entry under a fixed Node Debug Adapter Protocol
adapter. The adapter runs through the existing private
`WorkspaceProcessManager` protocol in a read-only, network-denied OS Sandbox.
It supports source breakpoints, exception stops, stack traces, scopes,
variables, side-effect-rejected expression evaluation, continue, step over,
step in, step out, and explicit cancellation.

Compiled TypeScript can instead bind an original `path`, generated
`programPath`, and external `sourceMapPath`. The fixed adapter validates and
parses one bounded v3 single-source map inside the Sandbox, maps requested
source breakpoints to generated locations, and maps accepted stack/step frames
back to the original TypeScript coordinates. The map must be the generated
program's exact relative `sourceMappingURL`, name that program, resolve its
single source to the bound original file, and contain at most 8,192 decoded
mappings. It cannot use a URL, another workspace source, a symlink, sections,
or unbound `sourcesContent`.

All one or three launch files are canonical, workspace-relative,
non-symlinked, protected-root free, valid UTF-8, and individually capped at
1 MiB. The adapter controller runs in a Worker and attaches `node:inspector`
to the target main thread without opening a TCP listener. DAP frames, message
count, session/action time, breakpoints, stack, scopes, variables, references,
expressions, target output, and Agent output are independently bounded. Every
adapter response and event carries a random per-process authenticator, so
target stdout cannot forge a stop, stack, or variable result.

The source, generated program, optional source map, and loaded workspace module
graph are captured at each stop. Every paused-state action revalidates all
bindings before returning data; any drift terminates the complete session.
Unknown post-write outcomes, malformed or unauthenticated frames,
target/adapter exit, timeout, caller cancellation, and protocol exhaustion also
fail closed. `AgentSessionRuntime` cancels any debugger left paused before the
owning Run records a terminal event.

Paths, stack/scope/variable names and values, expressions, argv, source, and
target output are live-only untrusted model context. Ledger, Replay, public SSE
history, and Web Trace retain only bounded status/count/version metadata and
source/program/source-map/module/worker/runtime/DAP/result hashes. Generic
Process APIs expose neither private protocol output nor writable stdin.

This is a Node launch-debugging slice, not attach, hot breakpoint mutation,
multi-thread/child debugging, a generic third-party DAP host, debugger UI,
cross-restart recovery, write-capable execution, inline/sectioned maps, or
multi-source bundler maps. The opt-in real OS-Sandbox smoke is part of
`npm run test:live-process`; the nested IDE host used for this revision exits
before adapter initialization, matching its existing `sandbox-exec` denial, so
that smoke is inconclusive here and no unsandboxed fallback is used.

## Controlled Workspace Editing

When workspace tools are available, the Runtime injects a concise
`workspace_tool_protocol` into the live system prompt. It tells the Agent to
treat tool output as evidence, inspect before editing, prefer symbol/range
hashes for code changes, pass complete-file SHA-256 preconditions to
`apply_patch`, opt in to parent-directory creation only for intentional new
artifact paths, and rerun `verify_workspace` after relevant writes before
claiming checks passed.

When Plan tools are available, the Runtime also injects a concise
`plan_tool_protocol`. It tells the Agent to create one focused plan for
multi-step or artifact delivery work, start and settle steps with evidence,
record planned artifacts after workspace bytes exist, verify file and directory
artifacts through runtime-computed digests, and avoid claiming plan completion
until required steps and artifacts are settled. Produced or verified file
artifacts can be downloaded from the Plan Workbench through a no-store,
workspace-confined endpoint that rehashes bytes, rejects verified digest drift,
and appends a hash-only `artifact.exported` Ledger event. Small UTF-8 file
artifacts can also be previewed in place; the server enforces the same
workspace and digest checks plus a 64 KiB preview limit, returns text only in
the no-store response, and records a hash-only `artifact.previewed` event. The
same manifest path lets produced or verified directory artifacts show their
bounded directory entries, file hashes, byte counts, and aggregate digest in
Workbench while recording only counts and hashes in
`artifact.directory_manifested`. The
Workbench can also run a non-mutating drift check for verified file and
directory artifacts; it records `artifact.drift_checked` with only
expected/observed hashes, byte count, and the `current`/`drifted`/`missing`
result before the operator decides whether to mark the artifact drifted.

`read_file` reports the SHA-256 and byte size of the complete UTF-8 file even
when only a line range is returned. A write-capable Agent must pass that digest
back to `apply_patch`; creation instead requires `expectedSha256: null` to
assert non-existence. Every replacement must match exactly once, and a stale
digest fails without changing the file.

`list_files` returns the human-readable workspace entries to the Agent while
retaining a structured path SHA-256 and entry-set SHA-256 for Trace. Workbench
summaries show only the entry count, truncation state, path hash, and entry-set
hash.

`search_files` is also hash-aware. Literal matches include the workspace path,
line number, complete-file SHA-256, matched-line SHA-256, and file byte size in
the structured tool details, plus a match-set SHA-256 receipt. The text output
keeps the matching line for human-readable orientation. This lets a follow-up
`read_file` or `apply_patch hashline_replace` bind work to the same evidence
without trusting plain grep output, while Trace summaries render only the
match count, truncation state, and match-set hash.

`list_symbols` gives the Agent a bounded directory-level code map for
TypeScript, JavaScript, Python, and Go files without starting LSP,
subprocesses, or network capabilities. It returns symbol paths, names, lines,
signature previews, and line/signature/file hashes to the model, skips
oversized or invalid UTF-8 code files with a count-only receipt, and records
root path, language counts, file-set, and symbol-set SHA-256 receipts. Trace
summaries show only file/symbol/skipped counts, line/byte counts, truncation,
and hashes, never paths, symbol names, or signatures.

`inspect_data` gives the Agent a bounded local preview for UTF-8 JSON, JSONL,
CSV, TSV, and Markdown table files without adding a shell or network
dependency. It resolves through the same workspace realpath boundary, rejects
oversized or malformed input, returns only a capped structured sample to the
model, and records path/file, column-set, and sample SHA-256 receipts. Trace
summaries show only format, row/column counts, byte size, truncation state, and
hashes, never column names or sample values.

`data_frame` turns one exact `inspect_data` file SHA-256 into a deterministic
bounded table transformation without evaluating code or expressions. Ordered
plans support explicit scalar casts, typed filters, column selection, stable
null-last sorting, grouping with count/sum/mean/min/max, and limits over up to
10,000 source rows. CSV, TSV, and Markdown cells remain strings until an
explicit cast; nested cells, implicit numeric coercion, oversized results, and
source drift fail closed. The complete result is returned as table JSON up to
1,000 rows and 256 KiB. Ledger, Replay, Workflow, and Trace retain only source,
plan, parser, engine, columns, rows, output, limits, and result hashes plus
bounded counts.
Delivery still uses `apply_patch` and Plan Artifact verification.

`sqlite_query` adds real SQL analysis without opening a general database or
shell capability. `schema` accepts a canonical `.db`, `.sqlite`, or `.sqlite3`
workspace file up to 64 MiB and returns its bounded table/view shape plus
complete file SHA-256. `query` requires that exact database hash, one
parameterized `SELECT`, `WITH`, or `VALUES` statement, up to 50 positional
parameters, 100 rows, and a 100-5,000 ms deadline. `chart` uses the same query
boundary but requires a complete 1-50 category result, one unique X column, and
either one finite numeric Y column or 2-6 finite numeric series. It renders a
fixed-theme standalone grouped bar or multi-line SVG with bounded title,
legend, axis labels, and dimensions.

Napier rejects symlinks, protected paths, live WAL/journal sidecars, PRAGMA,
ATTACH, DDL, DML, extension loading, multiple statements, unsafe functions,
and database drift. It copies the verified database into a temporary read-only
snapshot and executes fixed hashed worker code in a separately killable Node
process whose working directory and only environment variable point at the
private snapshot directory. This confines SQLite temporary state and allows
timeout and cancellation to terminate native SQLite work; the source database
is rehashed before results are accepted. SQLite authorizer/defensive mode
requires Node.js 24.12 or newer and fails closed on older runtimes.

Schema names, rows, labels, and generated SVG are untrusted live tool output.
The renderer accepts no markup, URL, CSS, event handler, image, script, or
foreign object from data; text is XML-escaped and geometry must remain finite.
Ledger, Replay, SSE, and Trace retain only database/path, SQL, parameter-set,
column-set, row-set, chart-spec, renderer, SVG, worker, runtime, limit, and
result hashes plus bounded counts, dimensions, bytes, and duration. Typed
Workflow Tool nodes consume only that receipt. To deliver a chart, the Agent
must still create the `.svg` through `apply_patch` and verify the actual file as
a Plan Artifact; `sqlite_query chart` itself has no write capability.

Run the real process-isolated smoke:

```bash
npm run test:live-sqlite
```

`inspect_code` gives the Agent a bounded local symbol outline for TypeScript,
JavaScript, Python, and Go files without starting LSP, subprocess, or network
capabilities. It resolves through the same read-only workspace boundary,
returns capped symbol names, lines, signature previews, and line/signature
hashes to the model, and records language, line/byte counts, file hash, and a
symbol-set SHA-256 receipt. Trace summaries show only language, symbol count,
line/byte counts, truncation state, and hashes, never symbol names or
signatures.

`read_symbol` turns a `list_symbols` or `inspect_code` line into a bounded
source slice. The caller supplies the file path, 1-based symbol line, and
optionally the exact line SHA-256; a mismatch fails closed before any content is
returned. Napier infers a conservative brace or indentation range, includes
optional context, emits line anchors for follow-up Hashline edits, and records
file/range/signature/name hashes. Trace summaries show only kind, range,
counts, truncation state, and hashes, never source text, paths, symbol names, or
signatures.

`ast_query` parses one current TypeScript, TSX, JavaScript, JSX, MTS, CTS, MJS,
or CJS file with the pinned TypeScript compiler in the Runtime process. A
bounded kind/name/ancestor selector returns exact syntax nodes, UTF-16 source
ranges, signature previews, file hashes, and node hashes to the live Agent.
The file is limited to 1 MiB and 100,000 visited nodes; paths must remain
canonical workspace files outside protected roots, and malformed UTF-8 or
syntax fails closed. Query source, paths, names, and signatures remain
live-only. Ledger, Replay, Server SSE history, and Trace retain only language,
completeness, counts, budgets, TypeScript version, latency, and hashes.

`ast_edit_preview` binds a replace, remove, insert-before, or insert-after
request to both the current file SHA-256 and one exact node SHA-256 from
`ast_query`. It performs no write. Napier rebuilds and reparses the complete
file, expands surrounding line context until the old text is unique, rechecks
source freshness, and returns one exact OLD/NEW replacement for
`apply_patch`. Insert/remove operations fail closed when leading or trailing
comments could be reassociated with another node; a reviewed replacement can
handle that case explicitly. Syntax validity is not type or behavior
correctness, so the Agent must still run LSP diagnostics and relevant
verification after CAS application. Native filesystem failures are mapped to
path-free live errors, and durable evidence contains no source or replacement
text.

`lsp_diagnostics` establishes the semantic IDE runtime. It launches
`typescript-language-server` 5.3.0 with TypeScript 5.9.3 over standard framed
JSON-RPC, opens one current TypeScript, TSX, JavaScript, JSX, MTS, CTS, MJS, or
CJS file, and waits for bounded published diagnostics. An ordinary Agent Run
keeps that read-only, offline server available for later LSP tools; direct
Runner calls and stateless Workflow Tool nodes retain the one-shot lifecycle.
The selected file is canonicalized inside the workspace, symlinks and
protected roots are rejected, UTF-8 and 1 MiB limits are enforced, and the
process runs read-only and offline with a fixed secret-free environment. The
server and TypeScript assets are separately read-only-bound into the Sandbox
and checked for digest drift after execution.

Compiler source locations, codes, and messages are returned only to the live
Agent. Durable tool evidence retains path/file hashes, language, package
versions, severity counts, diagnostic/code-set hashes, protocol bytes, latency,
stderr hash, resource limits, and result hash. Trace renders that bounded view
without path or message text.

`lsp_symbols` issues standard `textDocument/documentSymbol` for the opened
file. Napier explicitly advertises hierarchical symbol support and also accepts
the flat `SymbolInformation[]` fallback. Hierarchical parent/child ranges,
selection ranges, SymbolKind values, current-document URIs, UTF-16 positions,
and source bounds are validated before any result reaches the Agent. The
protocol response is capped at 1,024 nodes, depth 32, and 16 MiB of aggregate
symbol/name range characters before materialization; the tool exposes at
most 256 canonical symbols under a 48 KiB UTF-8 display budget and 64 KiB final
output budget.

The live Agent receives names, kinds, details, containers, exact
server-provided symbol/name ranges, current file hash, bounded signature
previews, and range hashes as untrusted source evidence. Hierarchical responses
carry the full `DocumentSymbol` range; a flat fallback preserves only its
`SymbolInformation.location.range` and does not invent declaration extent or
depth. Durable calls, Ledger events, Replay, Server SSE, and Trace retain only
response shape, completeness, counts, depth, display bytes, versions, latency,
and path/file/symbol/kind/result hashes. `complete` means no distinct symbol was
dropped by the requested count or display budget; it does not claim
project-wide indexing. A coding Agent can read the reported range, then use the
existing complete-file CAS `apply_patch` boundary and diagnostics rather than
trusting heuristic symbol inference.

`lsp_definition` uses the same runtime and standard
`textDocument/definition` request to resolve a 1-based source position. It
accepts Location and LocationLink responses, independently canonicalizes every
returned URI, and exposes only regular files inside the current workspace.
External, virtual, protected, missing, symlinked, oversized, or invalid UTF-8
targets are omitted. Up to 32 canonical definitions return relative paths,
ranges, file hashes, and bounded source previews to the current Agent; durable
tool calls, Ledger events, Replay, and Trace retain only counts, versions,
latency, and hashes. Language-server source is untrusted evidence rather than
instructions.

`lsp_references` uses standard `textDocument/references` with explicit
declaration inclusion to reveal a symbol's bounded workspace impact set before
an edit. It returns up to 64 canonical locations using the same target
confinement and live-only previews as definition lookup. Omitted or truncated
results are marked incomplete and must not be treated as all usages. Durable
evidence retains include-declaration mode, counts, versions, latency, and
stable reference/target-file hashes without paths, exact positions, or source.

`lsp_rename` issues standard `textDocument/prepareRename` followed by
`textDocument/rename`, then validates the returned WorkspaceEdit as one
complete preview. It accepts at most 32 regular workspace files and 256
non-overlapping text edits, with at most 32 KiB of aggregate old/replacement
text and 64 KiB of final tool output. External, virtual, protected, missing,
symlinked, oversized, invalid UTF-8, drifting, resource-operation, annotated,
empty-range, overlapping, and over-limit results fail the whole request rather
than producing a partial rename. When a server sends both WorkspaceEdit
representations, standard `documentChanges` takes precedence over `changes`.
Relative paths, current file hashes, exact ranges, old text, and replacement
text are available only to the live Agent. Ledger, Replay, Trace, and
model-call evidence retain only completeness, counts, preview bytes, versions,
latency, and source/name/prepare/edit/file/result hashes. `complete` means
Napier omitted no edit returned by the current language-server project; it
does not prove coverage of unloaded projects or external dependencies.

`lsp_rename` remains read-only and the language server cannot call
`workspace/applyEdit`. When the Agent profile also enables
`lsp_rename_apply`, a found preview returns one random, same-Run, one-use
capability that expires after five minutes. Apply accepts only that capability,
not paths or replacement text. Napier revalidates the complete preview,
acquires all canonical target locks, rehashes every file, stages and fsyncs all
new bytes in the target directories, creates same-filesystem hard-link
backups, then commits each target. A later commit failure restores prior files
in reverse order and verifies the original file set. Incomplete rollback is
`indeterminate` and retains a counted local recovery artifact; it is never
reported as a successful rename or automatically retried.

This is a coordinated local commit, not portable atomic visibility across
multiple files. External processes can observe intermediate renames and do not
honor Napier's locks. The postcondition therefore distinguishes `verified`,
`drifted`, and `indeterminate`. Cancellation before the commit point changes
nothing; cancellation observed after commit begins settles the complete commit
or rollback before returning evidence.

Up to eight TypeScript/JavaScript targets receive automatic pre-write and
post-write LSP diagnostics. Preflight timeout, failure, or file-hash mismatch
prevents every write. Postflight failure cannot hide committed files and is
reported as `diagnostics.status=unavailable`; omitted files and truncated
diagnostics remain explicit. Relevant behavior verification is still required
before claiming task completion.

`lsp_code_actions` waits for the opened file's current diagnostics, selects
only diagnostics intersecting the requested 1-based UTF-16 position, and
issues standard `textDocument/codeAction` with `only: ["quickfix"]`. It accepts
at most 64 returned entries and exposes at most 16 text-edit alternatives.
Disabled entries and commands without an edit or bounded resolve data are
counted as omitted. When the server explicitly advertises
`codeActionProvider.resolveProvider=true`, Napier can send at most 16
sequential `codeAction/resolve` requests for data-backed quick fixes. The
client advertises only the resolvable `edit` property; the returned action must
preserve title, kind, preference, and exact data identity before its text edits
are accepted. Unsupported, unproductive, over-limit, truncated, or omitted
responses remain explicitly incomplete.

Opaque resolve data is strict JSON, at most 64 KiB with the surrounding action,
and is returned only to the same live language-server Session. It never enters
Agent output, Ledger, Replay, SSE, or Trace. The command policy is always
`deny_all`: direct and resolved actions may carry a command, but Napier marks
it `commandIgnored` and never executes, returns, or persists the command or its
arguments. `workspace/applyEdit` remains rejected. `complete` therefore
describes alternative exposure only and is not a claim that an ignored command
side effect occurred.

Each alternative reuses the strict WorkspaceEdit boundary, with zero-length
insertion ranges explicitly allowed. Across all alternatives, Napier caps
targets at 32 files, edits at 256, aggregate old/replacement text at 32 KiB,
and final Agent output at 64 KiB. Resource operations, annotations,
external/protected/symlinked targets, malformed or overlapping edits, source
or runtime drift, and over-limit responses fail closed. Candidate totals are
checked before filesystem reads; locations are materialized serially with a
cache, source document version/hash is revalidated, and every target hash is
checked again before returning. TypeScript's
one-character-past-line-break insertion quirk is normalized only for
zero-length Code Action edits and remains strict for rename and replacement
ranges.

The live Agent sees bounded titles, paths, file hashes, ranges, old text, and
replacement text as untrusted evidence. Ledger, Replay, Trace, and Server SSE
retain only completeness/truncation, counts, preview bytes, versions, latency,
and diagnostic/action/target/result hashes. Without the direct apply tool, the
Agent must choose one alternative, re-read every selected file SHA, apply it
through `apply_patch`, then run diagnostics and relevant behavior checks.
Napier does not automatically combine mutually exclusive alternatives.

When the Agent profile enables both `lsp_code_actions` and
`lsp_code_action_apply`, every returned alternative also receives a separate
same-Run preview ID that expires after five minutes. Applying one ID consumes
it once and invalidates every sibling alternative from that response before
preflight. The apply call accepts no path, title, command, data, or edit body.
It revalidates the selected action and every current file hash, acquires all
target locks, stages and fsyncs every output, creates same-filesystem backups,
and commits through the same reverse-rollback transaction as
`lsp_rename_apply`. Stale state fails before overwrite; partial commit is
reported as rolled back only after the original file set is verified, otherwise
the result is indeterminate.

Coordinated rename and Code Action writes diagnose up to eight supported files
before and after commit using fresh one-shot language-server Sessions, not the
Run's pre-write persistent semantic state. Diagnostics wait for a 300 ms quiet
window so a fast empty syntax batch cannot mask a later semantic error batch.
When `verify_workspace` is enabled, verified commits also run the existing
bounded reverse-dependent test selection. Code Action commands remain
`deny_all` throughout; applying the text edits never invokes
`workspace/executeCommand` or accepts `workspace/applyEdit`.

Within one Agent Run, all seven LSP tools and write-linked diagnostics share one
serialized language-server Session while a bounded workspace snapshot remains
unchanged. Every operation reopens the selected document from freshly
preflighted bytes, rechecks target and Runtime-asset hashes, and compares
before/after workspace snapshots. A write, external drift, timeout,
cancellation, protocol failure, output overflow, idle server exit, operation
limit, or Run settlement closes the Session. The next safe read starts a new
server rather than adopting uncertain state. Limits are four active Sessions
per Runtime, 32 operations per Session, 2 MiB protocol and 16,000 stderr
characters per operation, 8 MiB protocol and 64 KiB stderr per Session, and a
10,000-file/64 MiB workspace freshness snapshot. Truncated snapshots permit
the current operation but disable reuse. The snapshot follows the existing
workspace-delta exclusions for `.git`, `.napier`, and `node_modules`; this is
not a package-install synchronization claim.

Ledger, Replay, SSE, and Trace bind only Session mode, reuse state, operation
number, and Session/workspace/limit hashes. The random Session identity,
paths, source, diagnostics, edits, preview capability, and stderr remain
absent. This is Run-owned process reuse, not a cross-Run editor,
language-server write access, portable filesystem atomicity, Code Action
command execution, complete project/dependency synchronization, or persistent
preview recovery.

When an Agent profile enables both `apply_patch` and `lsp_diagnostics`,
TypeScript and JavaScript writes automatically run LSP diagnostics before and
after the atomic patch. The preflight result must match the patch
`expectedSha256`; timeout, cancellation, Sandbox failure, or drift before
commit leaves the file unchanged. After commit, Napier compares diagnostic
multisets by severity, code, source, and message while ignoring source
location, then reports clean, introduced, improved, unchanged, regressed, or
truncated evidence. A failed or drifted postflight is reported explicitly as a
committed patch with unavailable or stale diagnostics and is never presented as
an ordinary failed write.

The live Agent receives actionable after-write locations and compiler messages.
The Work Ledger and Trace receive only before/after severity counts, diagnostic
delta counts, file/result hashes, and latency. Patch model-call, started, and
completed projections also redact raw paths and patch/output text. Non-code
files and profiles without the explicit LSP tool retain the previous patch
behavior and launch no hidden process.

When the same non-observe Agent also explicitly enables `verify_workspace`,
`apply_patch` and a successfully committed, postcondition-verified
`lsp_rename_apply` or `lsp_code_action_apply` automatically select related
TypeScript/JavaScript tests.
For an ordinary package Napier retains the nearest-`package.json` scope. When
the canonical root manifest declares bounded workspace patterns, it scans the
root graph and resolves relative imports, unique declared workspace package
names/subpaths, and safe `compilerOptions.paths` from root/package
`tsconfig.json` files plus relative JSON `extends` chains. It never loads a
JavaScript config, package script, external config package, or dependency code
to build the graph.

The scan remains capped at 1,000 files, 32 MiB, 5,000 edges, 64 workspace
packages, 128 path-alias applications, and 128 loaded-or-missing resolution
path bindings. Loaded configuration is capped at 4 MiB total and 1 MiB per
file. Each loaded manifest or tsconfig is canonical, no-follow, non-symlinked,
valid UTF-8, and included in the same pre/post selection snapshot; probed
missing paths are bound as missing so later creation is drift. Inherited path
aliases apply to the child project while their targets remain relative to the
declaring config, and exact or more-specific patterns win. Unsupported
`**`/negated workspace globs, duplicate package names, absolute or escaping
aliases, non-relative config inheritance, combined child `extends` + `paths`
overrides, cycles, symlinks, config/source drift, or resource exhaustion make
selection incomplete. Napier associates before/after declaration hashes and
runs at most eight reverse-dependent `.test`/`.spec` files through the fixed
workspace-local Vitest entrypoint. The Sandbox remains read-only and offline
with a 60-second timeout and bounded output.

Only a complete selection, a zero Vitest exit, and unchanged post-run
source/config snapshots produce `passed`. Unresolved reachable workspace code
imports, parse/scan/config/edge limits, or omitted tests produce
`selection_incomplete` and do not execute. Unrelated packages' broken imports
do not poison a proved reverse-reachable subgraph. `no_match` means only that
the complete supported bounded graph found no dependent test; it is not
project-wide verification. Cancellation, verifier unavailability, output
limits, test failure, and external source/config drift remain
distinct. Test paths, symbol names, output, and errors are live-only; Ledger,
Replay, SSE, and Trace retain statuses, counts, latency, exit state, and
hash-bound file/symbol/graph/test/snapshot evidence.

Run the real local-Sandbox smoke from a non-sandboxed Terminal:

```bash
npm run test:live-lsp
npm run test:live-linked-tests
```

The repository includes `examples/lsp-diagnostics/semantic-error.ts` as a
fixed `TS2322` example, `examples/lsp-definition/` as a cross-file definition
example, and `examples/lsp-references/` as a multi-file impact example. The
live suite diagnoses and fixes the first example, resolves
`usage.ts:3:22` to `definition.ts`, and finds six declaration-inclusive
references to `normalizeTitle`; it also creates a temporary missing-import
fixture, selects the preferred import quick fix, commits it through
`lsp_code_action_apply`, and verifies improved diagnostics without executing
the returned command.
macOS rejects nested `sandbox-exec`, so launching the live smoke from an IDE
process that is itself sandboxed fails closed rather than falling back to an
unsandboxed language server.

## Controlled Browser Sessions

The default `observe` Agent can read through one isolated, persistent Chrome
Session owned by its current Run; an explicitly `unrestricted` profile can
add interactive and file actions to that same contract. `start` creates a
fresh ephemeral browser profile; `navigate`, `back`, bounded `wait`, literal
`find`, bounded vertical `scroll`, `snapshot`, `click`, `type`, `select`,
`upload`, `download`, and `screenshot` reuse it according to the active
schema/Policy. `close`, cancellation, failure, the 64-operation bound, or Run
settlement destroys the browser, context, authenticated proxy, temporary HOME,
and active tunnels. AI-mode ARIA snapshots include short `ref` values that
later interactive actions can target without injecting page JavaScript.

`find` scans at most two million visible-text characters, returns at most 20
literal case-insensitive matching lines, and stores only query/match hashes and
counts. `scroll` moves vertically by at most 5,000 pixels, returns bounded
currently visible text, and records only numeric viewport/document positions
plus a text hash/count. Neither action opens the authenticated proxy; page
scripts therefore cannot turn a read-only observation into a hidden network
window.

Chrome never connects to an existing user profile or debugging endpoint.
Every HTTP request and CONNECT tunnel goes through a loopback-only,
randomly-authenticated Napier proxy. The proxy resolves all answers, rejects
mixed public/private DNS, pins one validated public IP for the connection, and
allows only HTTP(S) ports 80/443. Playwright routing independently rejects
loopback, private, link-local, reserved, `.local`, credential-bearing, and
non-HTTP(S) requests even if the browser would normally bypass its proxy.
Proxy outbound is default-deny during Chrome startup and idle time, opens only
around an explicit network-capable Agent action, and destroys active outbound
sockets when that action settles.
Top-level cross-origin navigation is denied unless the current action sets
`allowCrossOrigin: true`; popups, dialogs, service workers, and unsolicited
downloads are closed, dismissed, blocked, or cancelled.

Uploads accept only a canonical, regular workspace file up to 16 MiB and
recheck its hash after selection. Downloads require an explicit
workspace-relative target in an existing non-symlink parent, never overwrite,
stream through exclusive creation, stop at 32 MiB, and bind the resulting
bytes to Ledger evidence. Screenshots are returned as live PNG tool content
only. Page text, URLs, selectors, typed values, paths, PNG bytes, proxy
credentials, and raw Session IDs are absent from Ledger, Replay, SSE, and
Trace; those projections retain bounded counts, sizes, action metadata, and
SHA-256 bindings.

Run the production-path smoke from a host that permits Chrome's own sandbox:

```bash
npm run test:live-browser
```

The smoke never disables Chrome sandboxing. A nested IDE sandbox may reject
Chrome initialization; that result is reported as inconclusive rather than
falling back to `--no-sandbox`.

### Research Source Capture and Citations

The default `observe` Agent exposes `research_source` alongside `web_fetch` and
its read-only Browser surface. After inspecting the active Browser page,
`capture` freezes up to 24,000 normalized visible characters as an immutable
Run-local Source. After reading a static Web Source, `capture_fetch` requires
the exact same-Run Web Source ID and content SHA-256, imports bounded lines
without refetching or trusting model-copied text, and freezes a separate
Research Source capture hash. Both paths return numbered lines, a Research
Source ID, and a capture SHA-256. `cite` requires that exact Research Source ID
and hash, an inclusive range of at most 40 lines, and the exact single-line
report claim. It recomputes the quote and returns a
`[citation:citation_...]` token for placement immediately after the claim.
`list` recovers the current Run's Source and citation tokens during a long
task.

After the Agent writes a report, `verify_report` accepts a workspace-relative
`.md` or `.markdown` path plus the actual complete-file SHA-256. It reads at
most 256 KiB through the canonical non-symlink workspace boundary, requires
every citation token to belong to the current Run, and requires each token to
appear exactly once at the end of its exact claim line. It then rechecks the
file before returning. Unknown, malformed, duplicated, moved, stale-hash, or
claim-drifted citations fail closed. Evidence ledgers list citation IDs rather
than repeating tokens.

Browser capture happens with Browser network access closed and fails if the
page URL changes or the page has no visible text. Fetch import reuses only the
already-normalized same-Run Source and fails on a foreign Run, stale content
hash, invalid provenance, or empty bounded text. Source and citation operations
are serialized per Run, isolated across Runs, bounded to 16 Sources and 64
citations, and cancelled with Run settlement. Source text, title, URL, quote,
claim, and Web Source ID are available to the live Agent only. Durable events
retain the capture, source-set, claim, quote, source-specific Browser or Web
Fetch hashes, line range, format, character/line counts, and truncation state.
Because Source text is deliberately not restart-adopted, automatic recovery
treats `research_source` as unsafe even though its tool effect is read.

The bundled `research-brief` Skill requires primary-source preference,
disconfirming evidence, exact claim-to-range binding, adjacent one-use
citation tokens, runtime report verification, an evidence ledger, and a
verified workspace artifact when the task requests a report. A citation proves
the captured range and claim binding; it does not prove source authority or
logical entailment.

The static citation bridge is covered through the real default Agent path and
the existing fixed-source Research benchmark. Real built-CLI DeepSeek runs
completed `web_fetch fetch -> research_source capture_fetch -> cite` against
both public Node.js release HTML and the W3C dummy PDF while Tool events
retained neither URL, body, Web Source ID, nor credential. The complete regular
suite currently passes 2,134 tests.

`read_file` also emits bounded line hash anchors for the returned range.
`apply_patch hashline_replace` can replace a line by its anchor SHA-256 and
optional line number, so small line edits do not require the model to retype
the old text. Duplicate anchors fail closed unless the read line number is
provided, and the complete-file SHA-256 is still checked before and immediately
before the atomic commit. Workbench summaries render only the line range,
line/file counts, path hash, content hash, and anchor-set hash.

`apply_patch hashrange_replace` does the same for a multi-line source range:
the caller supplies 1-based `startLine`, `endLine`, and the exact `rangeSha256`
from `read_symbol`. Stale or overlapping ranges fail before mutation, making
whole-symbol replacement possible without retyping the old source block.

Edits are limited to 256 KiB and cannot target `.git`, `.napier`, or
`node_modules`, follow a symlink outside the workspace, delete a file, or
create parent directories unless `apply_patch create` explicitly sets
`createParentDirectories: true`. That opt-in creates only missing
workspace-relative parents, rejects protected segments and symlink components,
and records the created-directory count plus directory-set SHA-256. Local
runtimes serialize each target with a recoverable PID lock, write and fsync a
same-directory temporary file, recheck the precondition, and commit with an
atomic link or rename. Trace records the operation, path, byte counts,
before/after hashes, and a path SHA-256 receipt;
Workbench summaries show only the operation, byte/edit counts, path hash, and
content hashes. Researcher, reviewer, and general subagents remain read-only;
an explicitly enabled coder receives a separate private-worktree tool set
described below and never applies its candidate directly to the parent
workspace.

## Reversible Workspace File Lifecycle

`apply_patch` remains the content-editing primitive. Directory creation,
move/rename, and reversible removal use a separate two-tool protocol:

```text
workspace_file_preview
  -> normalize every workspace-relative path
  -> reject protected segments including case aliases, symlinks, unsupported
     entry types, workspace escape, occupied destinations, and scopes over
     2,000 entries or 32 MiB
  -> bind the source tree, destination absence, nearest existing parent
     identity, Thread, Run, and five-minute expiry into a one-use preview ID
workspace_file_apply
  -> accept only that preview ID, never raw paths
  -> acquire deterministic source/destination locks shared with apply_patch
  -> rebuild the complete plan immediately before mutation
  -> create directories or rename on one filesystem without a copy/delete
     fallback
  -> move trash payloads under the protected Napier data root with a
     hash-bound local recovery manifest
  -> append one hash-only workspace.file.mutated event
```

Supported operations are `create_directory`, `move`, `trash`, and `restore`.
Permanent purge, destination overwrite requests, permission changes, root
moves, symlink lifecycle, and arbitrary/root-wide Process Session writes are
not exposed. The separate scoped Process protocol can write only to its
preview-bound existing scopes. Napier rejects a destination observed as
occupied during preview or the final precondition check. An external process
can still race after that check because it does not honor Napier's host-local
lock; postcondition loss is reported as `indeterminate` rather than an
invitation to retry blindly.

Trash manifests retain the original relative path only under the protected
local data root. Agent tool evidence, Trace, Replay, and exports retain path
hashes, content/tree hashes, counts, byte size, reversibility, and
postcondition. The lazy Files panel lists only trash items belonging to the
selected Thread and offers explicit restore to the original path. Restore
fails closed when that path is occupied or trash bytes drifted; no permanent
delete action exists in the panel. Thread and request-sequence guards discard
late list or restore responses after the selected Thread changes.

Run the complete Agent-to-filesystem smoke:

```bash
npm run test:live-files
```

## Isolated Coder Subagent Worktrees

The opt-in `coder` role lets a parent Coding Agent delegate a bounded change
without granting the child direct access to parent workspace writes:

```text
delegate_task(role=coder, writePaths=[1..8 file paths])
  -> snapshot at most 2,000 files / 32 MiB into a private Runtime-owner root
  -> reject symlinks, special files, protected/generated roots, and source drift
  -> overlay read-only parent dependencies, redirect workspace packages to the candidate
  -> run a Pi child with private read/AST tools, path-limited apply_patch,
     and candidate_file delete/move; both rename paths require grants
  -> inherit enabled semantic LSP symbols/definition/references and,
     only as paired capabilities, grant-bound rename/Code Action apply
  -> when the parent enables run_command, add explicit-argv read-only Node
     execution over the private candidate and protected dependency overlay
  -> serialize create/modify/delete/move, semantic reads/applies,
     candidate commands, diagnostics, and fixed verification
  -> bind command attempts independently as fresh/stale and
     succeeded/failed/timed-out/output-capped/error
  -> bind each verification result to the complete private candidate snapshot
  -> derive authoritative add/modify/delete changes and unambiguous renames
  -> ground its typed outcome against surviving candidate bytes
  -> derive a control-safe live-only change window and fresh/pass/fail/stale evidence
  -> delete the private tree and return a five-minute one-use merge preview
subagent_worktree_apply(previewId)
  -> consume the capability and recheck the complete source snapshot
  -> inspect before-present TypeScript/JavaScript paths and, when enabled,
     select old-graph tests
  -> recheck the complete source after those read-only observations
  -> acquire shared multi-file locks and recheck hash + inode + mode state
  -> install additions by no-overwrite hard link, replace staged files by rename,
     and move deletions to same-directory verified tombstones
  -> reverse rollback on partial failure, fsync, and verify nullable postconditions
  -> inspect after-present paths and, when enabled, select new-graph tests
  -> run the complete stable old/new test union once through fixed Vitest
```

The parent workspace is unchanged until the second tool call. A source change
observed during candidate finalization or either apply preflight makes the
candidate stale; when concurrent candidates share a source snapshot, the first
successful merge therefore makes the others stale. An external process can
still race after the last full-source scan because it does not honor Napier's
locks. Lock-local hash/inode checks narrow the remaining external race;
additions use no-overwrite installation, and deletions first move to a
content/identity-verified tombstone so partial failure can restore them. The
live parent result labels each file as add/modify/delete, detects a rename only
when one added and one deleted file have an unambiguous identical digest,
escapes terminal/bidirectional controls, and reports truncation instead of
claiming complete review. The preview is deliberately memory-only and valid in
the same Run, so Runtime restart invalidates it without mutation. PID-bound
owner manifests preserve worktrees owned by another live local Runtime and
allow a later worker to clean directories left by a dead process.

A concurrent coder fork fails closed while a recognized
`.napier-change-*` stage, backup, or tombstone is present, so transaction
recovery bytes are never copied into another candidate.

Parent apply treats the lifecycle as nullable before/after file states.
Before commit, one-shot LSP observes modify/delete paths and related-test
selection, when the parent enables `verify_workspace`, follows the old
dependency graph. Napier then repeats the complete workspace preflight. After a
verified commit, LSP observes add/modify paths and enabled test selection
follows the new graph; a rename therefore contributes its physical source
deletion and destination addition. Napier executes the sorted union once,
dropping test paths intentionally removed by the lifecycle.
In a declared monorepo, changes to the root or a declared workspace package
retain whole-workspace reverse-dependency discovery. A nested standalone
package that is not matched by the root workspaces is scanned from its nearest
package boundary, so unrelated workspace size or broken imports cannot make
that local result incomplete. If the standalone package imports a declared
workspace package outside that scan boundary, Napier recognizes the package
name but conservatively marks the graph incomplete instead of treating the
dependency as external.
Incomplete graphs, unresolved reachable imports, more than eight selected
tests, missing retained tests, verifier failure, cancellation, and
workspace/configuration drift remain explicit non-passing evidence. A
post-merge diagnostic or test failure does not silently roll back a transaction
that already settled.

Candidate LSP always uses a fresh one-shot language server. When the parent
profile also enables `verify_workspace`, the child receives the existing fixed
TypeScript/Vitest/Prettier dispatcher against its private root. Napier binds the
external verifier bytes and root package manifests, grants the Sandbox one
read-only runtime path to the parent `node_modules`, and constructs at most 512
dependency links across 64 scopes. Ordinary dependencies remain external and
read-only; workspace-package links are redirected to corresponding candidate
directories so monorepo tests observe private edits rather than parent bytes.
Unsafe, escaping, missing, replaced, or drifted overlay targets fail closed.
The toolchain receipt binds the fixed entrypoint and package-manager metadata;
it does not recursively hash every transitive dependency byte, so the local
installed dependency tree remains part of the trusted host boundary.

The child inherits each enabled `lsp_symbols`, `lsp_definition`,
`lsp_references`, `lsp_rename`, `lsp_rename_apply`, `lsp_code_actions`, and
`lsp_code_action_apply` capability from the parent profile; an apply tool is
surfaced only with its corresponding preview tool. Read-only semantic calls
bind identical complete candidate snapshots before and after execution.
Rename and Code Action apply reuse the ordinary one-use WorkspaceEdit
coordinators, CAS/staging/fsync/rollback transaction, and before/after
diagnostics, but receive an additional candidate grant filter: rename gets no
apply preview when any target is outside `writePaths`, while Code Action
alternatives get apply IDs only when every target is granted. Code Action
commands remain deny-all. A changed read snapshot, unverified semantic-write
postcondition, or error that leaves candidate bytes changed permanently
invalidates candidate settlement. A no-write preflight failure leaves the
candidate usable but still requires a fresh preview.

When the parent profile also enables `node_debugger` and the Runtime has a
managed `WorkspaceProcessManager`, the child receives the existing Node DAP
tool against only its private candidate. The debugger reuses the authenticated
worker, strict DAP framing, source/program/map and loaded-module freshness,
side-effect-rejected evaluation, bounded output/time, global Process admission,
fixed environment, denied network, and read-only Sandbox policy. A focused
Process adapter can override the workspace root only for the internal private
protocol; ordinary Process starts cannot use that scope. Candidate dependency
roots remain identity-bound read-only runtime paths.

Every launch, stack, scope, variable, evaluation, resume, step, and cancel
action binds identical complete candidate snapshots before and after execution
and revalidates the candidate toolchain. Worktree preview, delegation failure,
timeout, cancellation, and cleanup first terminate and settle every debugger,
then observe candidate bytes again. Cleanup occurs before toolchain drift is
reported so a stale overlay cannot strand a paused target. Changed or
unobservable bytes permanently block merge settlement. Source, program/map
paths, breakpoints, arguments, expressions, stack names, variables, target
output, candidate roots, and protocol bodies remain live-only; durable
Subagent steps and Workspace Process events retain only bounded hashes and
counts.

Patch, candidate debugger, candidate command, and verification calls share one
serial queue.
Verification retains its existing 16-attempt limit. When the parent profile
also enables `run_command`, the child may make at most eight explicit-argv Node
attempts against the private candidate. The command runner uses a fixed
environment, denied network, read-only candidate root, bounded time/output,
bound executable, and the already protected read-only dependency overlay. It
does not evaluate a shell string or expose package scripts, Process Sessions,
Python, environment variables, or parent workspace writes. Complete before and
after snapshots must match; any write despite the Sandbox policy permanently
blocks preview settlement.

Each verification or command attempt records a result hash and complete
candidate snapshot hash. Finalization recomputes that snapshot: later edits
make prior attempts `stale`. Current verification attempts are split into
`passed` and `failed`; current command attempts remain separately classified as
`succeeded`, `failed`, `timed_out`, `output_capped`, or `error`. Command success
is execution evidence only and never implies type or test correctness. A failed
or absent check does not silently block preview creation because the parent may
need to review an expected failure; the live result makes that state explicit
before the separate merge call. Durable delegation, merge, SSE, Replay, and Web
evidence retain only bounded counts plus command/verification-set, toolchain,
old/new graph, selected-test, diagnostic, and result hashes. Argv, cwd, command
and verifier stdout/stderr, diagnostics, test names, paths, candidate bodies,
write grants, Sandbox labels, and preview IDs remain live-only.

This is a filesystem worktree, not a Git branch, shell checkout, container, or
general process sandbox. The child has no shell, general Process Session,
network, Browser, Extension, unrelated persistent Session, or
nested-delegation capability.
Empty-directory operations, directory moves, parent-directory creation during
lifecycle operations, permission edits, symlinks, binary files, ambiguous
renames between files with duplicate content, package scripts, arbitrary
executables, Python, DAP attach, multi-thread debugging, and cross-Run preview
recovery remain unsupported. Pure additions use mode `0644`; a byte-identical
rename preserves the observed source mode. The fixed verifier, optional Node
command, and optional DAP target remain read-only and offline; none grants
general process authority or counts as test verification. Automatic lifecycle
LSP and dependency-graph tests currently cover TypeScript/JavaScript source
extensions; other text formats are explicitly omitted rather than reported as
verified.

Run the opt-in real Agent-to-private-worktree smoke:

```bash
npm run test:live-coder
```

The smoke uses the explicit direct-process test adapter to run real
symbols/definition/references, a grant-bound two-file semantic rename, a third
unmerged JavaScript modification under DAP breakpoint/evaluation/step/
completion, Node inspection, candidate diagnostics/Vitest, old/new
dependency-graph test selection, parent diagnostics, and explicit merge.
`npm run test:live-command` separately exercises the real platform OS Sandbox
on hosts that permit nested sandboxing.

New delegations must return a bounded
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
concerns, usage, and a stable review SHA-256. Live reviewer artifacts also
carry the hash-only model-context envelope for the no-tool request without
copying the task prompt or outcome text. Reviewer failures become inconclusive
artifacts and never rewrite the task, append Ledger events, or stall the
completed delegation. The Trace card uses the globally selected model as the
reviewer candidate, shows both the request envelope hash and review receipt
hash, and disables review until it is independent.
Every parent model request also receives a freshly derived, bounded
`napier.delegation-ledger-projection` system block. It prioritizes active and
recent terminal tasks, binds both the selected projection and complete task
set with SHA-256, and exposes only sanitized labels, state, model, counters,
and prompt/intent/result/error/outcome hashes. Raw delegated prompts, results,
and errors remain outside the projection. Because the block is rebuilt from durable
`SubagentTask` records rather than conversation summaries, it survives
compaction, child recovery, and replay import without accumulating in message
history. Equivalent pending, running, or completed role + canonical-prompt
intents fail closed at `delegate_task`; failed, cancelled, and timed-out work
may be retried. `context.prepared` exposes projection counts and hashes for
Trace; in-loop changes add a hash-only `context.delegation.updated` event
without persisting projection content. Restored coordinators recover their
per-Run total task budget.

## Sandboxed Workspace Verification

Selecting `workspace` and enabling **Sandbox verify** allows the parent Agent
to run one of three reviewed checks: TypeScript typecheck, Vitest test, or
Prettier format check. Napier invokes the current Node executable and the
workspace-local CLI directly; it never evaluates a package script, shell
command, or model-provided executable.

Each verifier receives only `process.spawn` and `workspace.read`. The OS
sandbox mounts or authorizes the workspace read-only and leaves networking
disabled. Ordinary Agent runs use workspace-local entrypoints. A private coder
candidate may instead bind the original workspace as an external toolchain:
the fixed CLI and package metadata are hashed, `node_modules` is mounted
read-only as a runtime path, and stability is rechecked after execution. The
working directory and optional target still resolve only inside the candidate
workspace. Runs default to 60 seconds, cannot exceed 120 seconds, and retain at
most 32,000 characters from each output stream. Timeout, cancellation, output
exhaustion, or toolchain drift terminates or rejects the check without a host
fallback.

`passed`, `failed`, `timed_out`, and `output_capped` are distinct results. A
non-zero exit is preserved as failed verification evidence rather than a tool
transport error. The live Agent result contains bounded stdout/stderr; Work
Ledger, Replay, SSE, and Trace retain only verifier kind/status, exit state,
scope/snapshot/toolchain/result hashes, counts, output hashes, and truncation
flags. Raw output, cwd, target paths, and sandbox labels remain outside durable
evidence. Each result's `scopeSha256` binds the verifier kind, cwd/target path
hashes, verifier/toolchain identity, and a bounded cwd snapshot that excludes
`.git`, `.napier`, and `node_modules`.

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

Each `ExecutionPlan` also carries a Deer Workflow-style phase projection derived
from the step DAG. `phaseWaves` partitions steps into deterministic dependency
waves, `activePhaseIndex` points to the first unfinished wave,
`parallelReadyStepIds` names the currently executable parallel set, and
`phaseProjectionSha256` binds the ID/status-only projection. These fields are
recomputed on every Plan mutation, mirrored in Plan REST headers, included in
Agent plan-tool results and `plan.*` Ledger events, and revalidated by archive
verification when present. They do not copy step descriptions, evidence prose,
blockers, or artifact paths.

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
the current outcome/baseline hashes, and the live request's hash-only
model-context envelope; `napier/demo` fails closed as `inconclusive`. The
review input uses only aggregate counts, replay statuses, Plan projection
hashes, outcome hashes, and policy evidence, so objective text, artifact paths,
blockers, and evidence prose are not copied into the review artifact. The same
review artifact can be passed back into outcome baseline promotion. The Plan
Workbench receipt displays the review request envelope hash beside the review
hash. Reviewed promotion re-verifies the review hash, current outcomes,
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

## TypeScript SDK

`@napier/sdk` is the first supported local embedding entry point for Node
applications. It owns one `LocalAgentRuntime` lifecycle but exposes no Store,
credential registry, or scheduler internals.
TypeScript code can run or continue a normal Agent task, recover an interrupted
Run, define a Workflow from a Plan shape plus typed nodes,
serialize the resulting stable Manifest as JSON, load it again with full hash
validation, execute it in a new or selected Thread, resume the exact Plan, and
run a preview-bound checkpoint experiment:

```ts
import { createNapierClient, loadNapierWorkflow } from "@napier/sdk";

const client = await createNapierClient({
  workspaceRoot: process.cwd(),
  dataRoot: ".napier",
});
try {
  const first = await client.runAgent({
    prompt: "Inspect this workspace and report the highest-risk gap.",
    model: { provider: "napier", id: "demo" },
    signal: abortController.signal,
    onEvent,
  });
  await client.runAgent({
    threadId: first.threadId,
    prompt: "Continue from the existing Ledger evidence.",
    onEvent,
  });

  const defined = await client.defineWorkflow<Request, Report>(definition);
  const workflow = loadNapierWorkflow<Request, Report>(
    JSON.parse(JSON.stringify(defined.manifest)),
  );
  const execution = await client.runWorkflow({
    workflow,
    input: { text: "Produce the report", publish: true },
    signal: abortController.signal,
    onEvent,
  });
  if (execution.pendingDecision) {
    await client.answerWorkflowApproval({
      workflow,
      threadId: execution.threadId,
      planId: execution.planId,
      decisionId: execution.pendingDecision.id,
      expectedDecisionSha256: execution.pendingDecision.contentSha256,
      selectedOptionIds: ["option_1"],
      onEvent,
    });
  }
  await client.resumeWorkflow({
    workflow,
    threadId: execution.threadId,
    planId: execution.planId,
  });
  const preview = await client.previewWorkflowExperiment({
    workflow,
    sourceThreadId: execution.threadId,
    sourcePlanId: execution.planId,
    fromNodeId: "report",
  });
  const experiment = await client.runWorkflowExperiment({
    workflow,
    sourceThreadId: execution.threadId,
    sourcePlanId: execution.planId,
    fromNodeId: "report",
    expectedPreviewSha256: preview.previewSha256,
    confirmSideEffects: preview.requiresSideEffectConfirmation,
    onEvent,
  });
  let sourceMessageSeq = 0;
  const source = await client.runAgent({
    prompt: "Record an Agent message checkpoint.",
    onEvent: (event) => {
      if (event.type === "message.user") sourceMessageSeq = event.seq;
      onEvent(event);
    },
  });
  const messagePreview = await client.previewAgentMessageExperiment({
    sourceThreadId: source.threadId,
    sourceRunId: source.runId,
    sourceMessageSeq,
  });
  await client.runAgentMessageExperiment({
    sourceThreadId: source.threadId,
    sourceRunId: source.runId,
    sourceMessageSeq,
    expectedPreviewSha256: messagePreview.previewSha256,
    onEvent,
  });
} finally {
  await client.close();
}
```

`defineWorkflow()` performs pure Plan/Manifest/Schema preflight before
persisting a definition Thread and source Plan, then derives the normal
evidence-bound Blueprint. `runWorkflow()` validates Manifest and input before
creating an execution Thread. Waiting results expose the exact pending
Decision; `answerWorkflowApproval()` verifies its content hash, Workflow start,
Manifest, Plan, Approval Run, option contract, and expiry before persisting
one answer and resuming. `previewWorkflowExperiment()` is read-only;
`runWorkflowExperiment()` always requires its current preview hash and keeps
write/unknown-effect confirmation fail-closed while returning recovery-ready
target Thread/Plan and candidate Manifest data. `runAgent()` validates its
prompt, model, title, and Thread/Agent binding before mutation;
`previewAgentMessageExperiment()` and `runAgentMessageExperiment()` expose the
same frozen historical-message source and read-only isolated target as
CLI/HTTP/RPC, with an exact preview hash required for every execution.
`resumeAgent()` uses the same interrupted-Run recovery path as CLI. Agent,
Deterministic templates including typed multi-way Switch selection, Tool,
Approval, condition, parallelism, retry, cancellation, recovery, policy,
Sandbox, and Ledger behavior remain the existing Runtime behavior. Runnable
examples are
[`packages/sdk/examples/agent-run.mjs`](packages/sdk/examples/agent-run.mjs)
and
[`packages/sdk/examples/typed-workflow.mjs`](packages/sdk/examples/typed-workflow.mjs).
`close()` rejects new calls, aborts and waits for active Agent, Workflow, or
experiment calls to settle their terminal evidence, then shuts down shared
services idempotently.
This SDK does not yet claim remote RPC, ACP, Desktop, or a browser-safe client.

## Executable Plan Workflows

`defineExecutionPlanWorkflow()` is the low-level executable Manifest compiler
used by the TypeScript SDK and Runtime. Schema-version 1 evolves an
`ExecutionPlanBlueprint` rather than creating a parallel state machine: the
manifest node list must match the Blueprint step order and DAG, every node
input binding must match a required object-schema property, node references
must name direct dependencies, and the declared final schema must equal a
terminal output node schema. The restricted JSON Schema subset is bounded by
depth, node count, object properties, array items, strings, enums, and encoded
bytes before execution.

`ExecutionPlanWorkflowRuntime` creates the normal durable `ExecutionPlan` and a
real `source=workflow` Run for every ready node. The Workflow freezes the target
Thread's Agent revision at start. Agent nodes invoke `AgentRuntime` with
isolated message history and strict JSON output. Deterministic nodes resolve a
bounded recursive template made only of literal JSON, input field selection,
object construction, and array construction. A root `switch` template may
select one required typed input path across 2–16 unique canonical case values
and an optional default; each selected branch is another ordinary bounded
template. It performs no coercion and blocks with `switch_unmatched` when no
case or default exists. Deterministic execution performs no model or tool call
and exposes no JavaScript, JSONPath, interpolation, or expression engine.
Tool nodes invoke one allowlisted stateless built-in directly, with no model
call, after enabled-tool, TypeBox argument, declared `read`/`write` effect,
Agent policy, workspace scope, and freshness checks. Their schema-validated
structured details become the typed node output.

JavaScript nodes provide bounded model-free state inside one Workflow node.
They accept 1–8 ordered cells, at most 16 KiB per cell and 32 KiB total, with
at most 2 seconds per evaluation and 120 seconds for the complete node. The
constructed node input is limited to 8 KiB and injected as the fixed `input`
binding in a fresh existing JavaScript Kernel context. Cells share that
context; the final non-truncated 4,096-character preview must parse as JSON,
fit the ordinary 32 KiB output limit, and pass the declared output Schema.
Each node receives a separate Session, so state never crosses a node, Run,
Thread, retry, or restart.

The frozen Agent revision must explicitly enable `javascript_kernel` and pass
the existing process policy. Execution uses the authenticated private protocol
inside the read-only, network-denied OS Sandbox, then requires a cancelled,
unchanged Session before the Plan step can complete. `process`, `require`,
dynamic import, string code generation, packages, files, environment,
networking, async work, timers, workspace writes, and Napier callbacks remain
unavailable. Public Ledger and Trace evidence retains configuration/worker/
request/result/input/output hashes, counts, duration, and Schemas, never cell
source, constructed input/output bodies, console text, diagnostics, or private
frames. A terminal receipt plus hidden typed output can repair a commit gap;
an interrupted Session is never recreated without explicit `retryBlocked`.
Persistent Python, package-backed kernels, cross-node Session handles, Node
debugger, background Process Sessions, and preview-bound file mutations remain
Run-owned Agent tools rather than gaining implicit Workflow authority.

Manifests may opt into `maxConcurrency` from `1` to `4`; omission preserves
legacy sequential execution. The scheduler starts only dependency-ready
non-Approval nodes, gives each an isolated Plan/output/result snapshot, and
merges settled outcomes in Manifest order. Approval is an exclusive barrier.
One failed branch does not discard an independently completed sibling, while
parent cancellation reaches every active branch. Concurrent node Runs carry a
persisted `workflowPlanId` derived from a package-internal capability, so only
Runs for the same active Plan can coexist. `Thread.currentRunId` remains a
compatibility pointer to one active Run; the Run list and Plan steps are the
complete projection.

New executions may declare up to 16 unique `breakBeforeNodeIds`. The Runtime
normalizes them to Manifest order and records the set in `workflow.started`.
When a selected node becomes ready, `workflow.breakpoint.reached` binds its
Manifest identity, Plan revision, ordinal, and current dependency/input
binding-context hash before the Runtime returns `paused`. No condition,
node Run, model, Tool, or node side effect starts first. An ordinary resume
returns the same durable breakpoint; only `continueBreakpoint=true` records
`workflow.breakpoint.continued` and lets scheduling proceed.

Reach and continuation reconstruct from the Ledger after SQLite reopen.
Duplicate, stale, mismatched, or forged evidence fails closed, and a consumed
continuation remains consumed if cancellation or process loss occurs before
the node starts. This primitive pauses only at node boundaries; it does not
claim mid-node suspension, DAP stepping, arbitrary input mocks, or side-effect
simulation. CLI JSONL, HTTP SSE, the TypeScript SDK, and local stdio RPC share
the same contract, while Web Trace exposes only node IDs, counts, revisions,
event sequence, and hash prefixes.

The Plan Workbench projects an open breakpoint directly from
`workflow.started` plus reached/continued Ledger evidence. It displays the safe
node, ordinal, Plan revision, event sequence, and binding/Manifest hash
prefixes. Continue remains disabled until the operator loads the exact
content-bound Manifest; the file stays in browser memory and is never added to
the Ledger. The browser then posts the ordinary Workflow continuation request
and independently validates the unique continuation event, ordered SSE,
Snapshot, typed result, Manifest/Blueprint binding, and complete event-stream
hash before refreshing the authoritative Thread. Malformed evidence, stale
Plan state, a mismatched Manifest, concurrent consumption, or a rehashed
impossible result fails visible. This is a real continuation control, not a
visual Workflow editor or a browser-side scheduler.

Map nodes select one required, Schema-bounded array from their constructed
input and run up to three item Agents concurrently, with at most 16 items.
One coordinator Run owns the Plan step; item Runs are parent-bound, use the
same frozen Agent revision and optional node model, and execute in the
`workflow_map_read_only` mode. That mode forces `observe`, admits only bounded
workspace read/AST-preview/SQLite tools, and disables writes, verification
processes, stateful sessions, extensions, subagents, and Memory mutation.
Each item has its own deadline and hash-bound input/output evidence. The
aggregate preserves input order and must satisfy the declared array Schema.
Map is exclusive within an outer scheduling wave so its coordinator plus
three children cannot exceed the four-Run Store bound.

Loop nodes provide bounded sequential semantic refinement without introducing
an expression runtime or an unbounded Agent cycle. A Loop declares one typed
`until: { path, equals }` condition over its output Schema, at most eight
iterations, an independent iteration deadline, and a whole-node deadline.
Each child receives the immutable initial input and the previous
schema-validated output, then runs through `workflow_loop_read_only`: normal
model resolution and bounded read tools remain available, while writes,
verification processes, sessions, Extensions, delegation, and Memory mutation
are excluded. The coordinator completes only when `until` matches; exhausting
the limit blocks the node rather than accepting a partial result.

Every completed iteration binds its coordinator/child Run lineage, frozen
Agent revision, model, Loop configuration, iteration input, output Schema,
output hash/bytes, and condition subject. Explicit retry and SQLite reopen
reconstruct the longest continuous valid prefix and execute only the first
unproved iteration. A malformed, reordered, cross-Run, wrong-model, or
tampered prefix fails closed. Loop checkpoints can be rerun with model
replacement through the existing Workflow experiment path, and their child
metrics/tool effects participate in source/target comparison.

Blueprints may declare up to 16 workspace `file` or `directory` Artifacts.
After every node is completed or skipped, the Runtime inspects the canonical
workspace target and computes the existing bounded file or recursive directory
digest. A present `expected` or repaired `missing` Artifact transitions through
`produced` to `verified`; an already verified Artifact is rehashed before every
completion claim. Missing bytes or digest drift make the Workflow `blocked`.
Resume after workspace repair reconstructs completed node output from Ledger,
settles only the Artifact lifecycle, and does not rerun completed model or Tool
work. Cancellation is checked between lifecycle transitions, and a durable
state/event commit gap is repaired by appending the missing standard
`plan.artifact.*` projection.

`plan.artifact.*` remains the authoritative Artifact state evidence.
`workflow.artifacts.settled` and `workflow.artifacts.failed` add bounded
Manifest/Plan/count/set-hash coordination without copying workspace paths,
contents, or diagnostic text into Workflow Trace. URL and `other` Artifacts,
workspace escapes, symbolic links, oversized content, and superseded declared
deliverables cannot satisfy Workflow completion.

Any node may declare `when: { path, equals }` plus a required `skipOutput`.
The path is resolved only against that node's already constructed and
schema-validated input; the comparison is canonical JSON equality with no
coercion or expression evaluation. When it is false, Napier creates no node
Run and consumes no attempt. The existing Plan step becomes `skipped`, the
Manifest fallback passes the normal output Schema, and downstream bindings can
join it exactly like a completed output. `workflow.node.skipped` stores only
condition, subject, input, fallback, output, and schema hashes.

Approval nodes create a leased model-free request Run, bind a fixed
approve/reject question and the upstream input hash, record the existing
operator-decision receipt, and settle the Run with the Thread in `waiting`.
Approval creates a same-revision continuation Run and the standard typed
approval output; rejection, cancellation, invalid selection, or durable
deadline expiry blocks the Plan. The question and choices are Manifest code,
not an evaluated template. The generic Agent continuation path rejects
Workflow-owned decisions.

Resume reconstructs Agent and Deterministic output from bound assistant
evidence, Tool output from the exact terminal tool event, Map output from the
coordinator plus every indexed child Run, and Loop output from one continuous
typed iteration chain. Map recovery verifies item count/order, parent lineage,
restricted Run configuration, per-item input/output/schema hashes, and
aggregate set hashes before accepting output. Loop recovery additionally
recomputes each feedback input and typed termination condition; completed
prefixes survive explicit retry and Store reopen. Unknown iterations are never
claimed as complete. All nodes then verify identity, effect,
input/output/schema hashes, and Run ownership.
Approval recovery additionally binds the unique decision request, request
digest, attempt, expiry, answer, and continuation Run. A restart with only
`tool.started` becomes one `run_interrupted` blocked attempt and is never
rerun automatically. If `tool.completed` committed before Run settlement was
interrupted, the same terminal Run can recover the Plan step without executing
the tool again. A Deterministic node with no terminal output can be
automatically recomputed inside the same Manifest up to `maxAttempts`; a bound
terminal output repairs commit gaps instead of being recomputed. Generic
manual and automatic Run recovery still reject Workflow-owned Runs.
On restart, every in-flight parallel Run is interrupted and every bound Plan
step is reconstructed independently; explicit retry can then reopen the
eligible batch without losing completed siblings.
Skipped-node recovery recomputes the same typed condition and accepts only a
false result with unique matching skip evidence. A Plan skip on an
unconditional node, a now-true condition, a changed fallback, duplicate
evidence, or a non-zero skipped attempt fails closed. A missing terminal skip
event after the Plan transition is repaired without creating or rerunning a
node Run.

`POST /api/threads/:threadId/workflows` exposes the same execution as SSE.
Both HTTP and CLI finish with `ExecutionPlanWorkflowResultFrame`, binding the
typed result to the Thread snapshot and complete event-stream hash. Web Trace
renders only status, counts, concurrency, safe IDs, error codes, and hash
prefixes; raw Workflow input, node output, and diagnostics are not copied into
Trace summaries. JSONL and SSE share the same ordered event writer, which
buffers concurrent callbacks until the authoritative Ledger sequence is
contiguous.

`ExecutionPlanWorkflowExperimentRuntime` adds the first controlled
re-execution path. `POST
/api/threads/:threadId/workflows/:planId/experiments/preview` derives a
read-only rerun subgraph, candidate Manifest, historical tool-effect summary,
and stable preview hash. `POST
/api/threads/:threadId/workflows/:planId/experiments` creates an independent
target only after preview and confirmation checks pass. Reused completed nodes
bind both their original input and output hashes and use synthetic
`workflow_reuse` Runs. Reused skipped nodes preserve `skipped`, use zero Runs
and attempts, and bind their fallback plus source lineage. Revision pinning and
reuse materialization are internal Runtime capabilities, not fields accepted
by ordinary Workflow execution requests. Cancellation or restart before reuse
completes reconstructs remaining reused nodes from source Ledger evidence
instead of executing them as Agent nodes. Source drift fails closed.

The default full-subgraph request preserves the schema-1 preview and its
existing hash semantics. `mode=single_node` produces schema 2: the complete
selected-node descendant set remains `rerunNodeIds`, the actual scheduling
allowlist is `executionNodeIds=[fromNodeId]`, and direct successors become the
bounded `stopBeforeNodeIds` persisted in `workflow.started`. Tool-effect
confirmation is derived only from the execution allowlist. Once the selected
node settles, the ordinary breakpoint machinery records
`workflow.breakpoint.reached` and returns `paused` when a direct successor
exists; selecting a terminal node completes normally. Normal resume remains
paused, while explicit continuation consumes one open direct-successor hold in
Manifest order; all descendants still run through the same scheduler. Recovery
recomputes all three sets from the source Manifest and compares them with
experiment lineage and the target's frozen breakpoint set. Unknown
checkpoints, more than 16 direct successors, drift, partial lineage, or
self-consistently rehashed stop-set changes fail closed.

`mode=step_nodes` produces schema 5. Initial `executionNodeIds` remains
`[fromNodeId]`, while `stopBeforeNodeIds` is every other rerun node in Manifest
order rather than only direct successors. The same 16-breakpoint bound applies.
After a continuation event is durable, breakpoint recovery projects its exact
ready node as a one-node scheduler release. The parallel scheduler must select
that node alone for the next batch; only after it settles can another configured
ready node emit `workflow.breakpoint.reached`. A continued-but-unsettled node
survives cancellation and SQLite reopen without another consent event.

`mode=simulate_node` emits schema 3 and substitutes one Schema-valid selected
output without entering its model or Tool path. `mode=replace_input` emits
schema 4 and substitutes the selected node's complete constructed input before
ordinary execution. Its `executionNodeIds` equals the complete selected-node
descendant set, so effect projection and exact-preview confirmation cover
everything that can execute. Runtime execution, conditions, breakpoints,
Approval recovery, retry, and SQLite reconstruction all consume the same
effective-input helper. Recovery accepts exactly one hidden replacement
request whose node, Plan, Manifest, Schema, canonical hash, and byte count
match the public experiment lineage; missing, duplicate, drifted, or tampered
evidence fails closed.

After target settlement, the Runtime aligns every source and target node by
Manifest order and derives a hash-bound comparison from actual Plan, Run,
Ledger, Evaluation, and Artifact evidence. It distinguishes reused from rerun
nodes; reports current status, model/configuration changes, retry and Run
counts, duration, token/cost usage, added or removed tools, and output
availability/hash changes; and uses `target - source` for every numeric delta.
Only the current completed Plan-step Run can supply a current output hash, so a
reopened or newly failed node cannot inherit a historical successful output.
The complete comparison is delivered in the existing JSONL/SSE terminal frame;
`workflow.experiment.compared` records only bounded counts, deltas, statuses,
and hashes for Ledger and Web Trace.

`AgentMessageExperimentRuntime` is the corresponding controlled re-execution
path for a terminal user-message Run. HTTP exposes
`POST /api/threads/:threadId/agent-experiments/preview` and
`POST /api/threads/:threadId/agent-experiments`. The second route requires the
exact preview hash, streams only newly appended target events, then emits the
authoritative target Snapshot and `agent_message_experiment_result` frame.
The target always uses `agent_experiment_read_only`; Store validates its
source Run, exact message, frozen Prompt Variable evidence, internal Branch
lineage, Agent revision, Skill/Prompt configuration, and parent Run before
creation. Experiment-specific Trace summaries expose only safe IDs, statuses,
metric deltas, models, counts, and hash prefixes.

Every eligible source call now captures its exact model-visible result after
tool settlement into a second local-only CAS. `context.tool_result` contains
only the input-capsule, implementation, argument, result, output, and capsule
hashes plus bounded byte/status metadata. Result capsules use `0700`/`0600`
permissions, reject symlinks and permission drift, cap each object at 1 MiB,
and bound storage to 512 objects / 128 MiB. Capture failure never changes the
original tool outcome. The public Ledger projection for all ten eligible tools
also redacts arguments, paths, rows, source, matches, symbols, and output text
while preserving safe counts, ranges, formats, truncation state, and hashes.

Message experiments accept `toolResultMode=live` by default or
`reuse_source`. Frozen mode requires complete local result coverage for every
source tool call and binds the ordered set into preview schema 2. Candidate
preflight is sequential even when Pi executes the approved batch in parallel:
tool name, current implementation hash, and normalized arguments must match the
next source result exactly. The wrapped tool returns that capsule result
without invoking its real body, preserves source error state, and records
`tool.result_reused` before the normal hash-only terminal event. Divergence,
missing/exposed/tampered capsules, extra calls, or unconsumed source results
settle the target as failed; there is no live fallback. Interrupted experiment
Runs must start a new Branch from the source checkpoint rather than generic
resume.

`ModelInvocationExperimentRuntime` adds a narrower model-call checkpoint that
does not enter `AgentRuntime`:

```text
terminal configured source Run + context turn index
  -> require one context.model_invocation receipt, its preceding
     context envelope, and its following model response
  -> load and revalidate the exact local-only provider Context capsule
  -> bind source response, Agent revision, context, capsule, and candidate model
     into a stable preview hash
  -> require that exact hash for execution
  -> create an isolated model_experiment_single_call Run
  -> call the provider exactly once with completeSimple
  -> project returned text/tool calls without dispatching tools
  -> compare call status, stop reason, latency, usage, cost, text/output hashes,
     and tool names
  -> emit target snapshot + model_invocation_experiment_result
```

Capture occurs immediately before primary Agent turns, context compaction,
Goal evaluation, and Memory extraction. The capsule contains only the Pi
provider fields `systemPrompt`, `messages`, and tool definitions plus safe
reasoning/token/temperature/cache-retention options; tool executors,
credentials, headers, environment, callbacks, and AbortSignals are excluded.
Capture failure does not interrupt the source call and appends only a bounded
`context.model_invocation_unavailable` receipt.

The local CAS is content-addressed, rejects symlinks and exposed permissions,
uses `0700`/`0600` modes, limits each capsule to 8 MiB, and bounds the store to
256 capsules / 128 MiB. Raw capsules never enter portable Replay or Trace.
Durable `model.experiment.*` events exclude provider Context, raw thinking,
candidate text, and tool arguments; the deliberate live result may return
candidate text and canonical tool names. Provider failure and active
cancellation settle comparable failed/cancelled Runs. Generic recovery rejects
these Runs because retry must start from the original checkpoint.

The shared Runtime path is exposed through `napier model-experiment`, HTTP
preview/SSE, the TypeScript SDK, and local stdio RPC methods
`napier/model/experiment/preview` and `napier/model/experiment/run`. RPC
preserves request-bound events, cancellation, admission, and orderly shutdown.
Web Trace validates and projects only safe receipt, status, metric, model, and
hash fields.

The lazy Run Lab model-call desk derives eligible call metadata only from
terminal Runs and strict `context.model_invocation` receipts. It supports an
optional configured provider replacement, fresh preview, explicit
cancellation, call-level comparison, target navigation, and deliberate
CAS-named result download. Its browser protocol independently validates exact
preview/comparison/frame fields and hashes, status/stop consistency, metric
deltas, source/target model and output bindings, streamed event hashes, the
final Snapshot, and complete event-stream hash. Provider Context, raw thinking,
source/candidate text, and tool arguments never render in the desk. Read-only
tool-call Web/RPC integration uses its own stricter call/output protocol;
standalone model/tool result reuse, write/session simulation, batch
experiments, and experiment promotion remain open.

The lazy Run Lab message experiment desk consumes these same routes. It lists
only terminal modern user-message checkpoints by Run/model/sequence metadata,
never prompt text; supports an optional configured-model replacement, live or
frozen source-tool results, fresh preview, explicit in-flight cancellation,
comparison, target navigation, and CAS-named result download. Preview and
comparison show reusable/reused/divergent counts and result-set hashes without
result bodies. The browser independently rechecks exact protocol fields,
preview/comparison/frame hashes, metric and reuse consistency, output-hash
state, tool-set changes, streamed event hashes, final Snapshot binding, and
complete event-stream hash. Self-consistently rehashed semantic drift still
fails closed.

The lazy Plan Workbench experiment desk consumes those same routes rather than
implementing a browser scheduler. Uploaded Manifest text remains browser-local
until preview/execute. The UI renders only statuses, models, metrics, tool
names, output availability, and safe IDs/hashes; it never projects model output
bodies, tool arguments, Evaluation prose, or Artifact paths. Complete result
JSON is available only through the explicit local download action. Preview and
execution responses must be `no-store`, and the browser enforces 2 MiB preview,
6 MiB frame, and 12 MiB stream bounds sized above the Runtime's legal frame
maximum.

The existing Web operator docket can answer or cancel a Workflow-owned
Approval. It deliberately does not launch a detached Agent continuation;
answered gates instruct the user to resume through the original Workflow
Manifest. Approval checkpoints can be reused after verification or rerun into
an isolated `waiting` experiment target, and never accept a model override.

Deterministic Reduce nodes aggregate one required bounded array with `count`,
`sum`, `minimum`, `maximum`, `all`, or `any`. An optional required value path
selects a typed field from every item, so a Map output such as `{ score }` can
be summed without another model call. Empty count/sum/all/any use fixed
identities; extrema require a non-empty input Schema. Reduce has no expression
language, coercion, custom comparator, tool, or side effect. It still receives
a leased Workflow Run, retry/timeout/cancellation behavior, restart recovery,
checkpoint experiment reuse, and hash-only public Trace evidence.

Restricted Python Workflow nodes reuse that managed Kernel and private Process
protocol. A typed `python` node evaluates 1-8 ordered cells in one fresh
read-only, offline Session, receives at most 8 KiB of complete constructed JSON
through immutable `input`, and returns only the final exact JSON value after it
passes the declared output Schema and 32 KiB Workflow bound. Intermediate
Workflow responses suppress presentation bodies so the exact result remains
within the bounded private protocol. The frozen Agent revision must enable
`python_kernel`, and normal process policy still applies.

Completion cancels and settles the Session with an unchanged workspace before
publishing body-free `workflow.python.completed` evidence. The receipt binds
Python runtime/worker identity, configuration, input binding, ordered
request/result sets, exact JSON/output equivalence, Schema, duration, memory,
Run, and attempt. Source, input/output values, console, stderr, paths, and
private frames remain outside public Trace. One terminal receipt plus hidden
typed output can repair a commit gap; a started stateful attempt without that
receipt stays blocked until explicit retry. Checkpoint reuse/rerun, Replay,
CLI JSONL, stdio RPC, SDK, HTTP SSE, and Web Trace all use the ordinary
Workflow Runtime.

Version 1 intentionally supports Agent, bounded Deterministic including root
multi-way Switch templates, bounded stateful JavaScript and restricted Python
Sessions, stateless built-in Tool, bounded read-only Agent Map, bounded
read-only Agent Loop, typed deterministic Reduce, and durable Approval nodes
with bounded parallel dependency-ready DAG scheduling, typed equality guards,
and terminal workspace file/directory Artifact settlement. Package-backed
Python/Notebook Sessions, cross-node Session handles, write-capable Map/Loop,
graph-level branch pruning, compensation, mid-node suspension, adapter
runtimes, and a visual builder remain open. Checkpoint experiments now provide
single-call execution for an explicit
stateless read-only built-in subset, while message experiments can freeze
captured results for that same subset. Workflow experiments can also substitute
one typed checkpoint output before normally executing descendants, or replace
one selected checkpoint's complete typed constructed input before executing
that node and its descendants. Schema-v5 step control executes one real node
per durable Continue across the remaining rerun subgraph. Schema-v6 replaces
the complete top-level Workflow input and reruns the whole graph. Stateful/write
tool stepping or side-effect simulation, Prompt/Skill/Memory replacement,
batch experiments, an interactive root-cause timeline, and Evaluation
promotion remain open. The opt-in DeepSeek
CLI smoke executes and checkpoint-reruns one
real typed node when `DEEPSEEK_API_KEY` is available; default tests use
deterministic providers and perform no network call. The Map-specific live
smoke executes two real concurrent item calls, deterministically reduces their
typed lengths, and verifies zero Reduce model/tool activity plus Replay. The
Loop smoke feeds one typed result into a second real model turn and verifies
the restricted child-Run chain. The JavaScript smoke uses the production OS
Sandbox and has no direct-process fallback. The Python smoke applies the same
fail-closed rule to an exact typed result:

```bash
npm run test:live-map
npm run test:live-loop
npm run test:live-workflow-javascript
npm run test:live-workflow-python
```

## Portable Replay Fixtures

Open **Lab → Portable ledger** to export the current Thread as one versioned
JSON fixture. The bundle includes its Agent profile, Runs, execution plans,
Agent revision ledger, evaluations, evaluation adjudications, reviewer ballots,
consensus resolutions, evaluation suites and executions, automatic-recovery
assessments and attempts, subagent tasks and typed outcome receipts, and every
ordered event.
`generatedAt` is excluded from the canonical content digest, so repeated
exports of unchanged evidence produce the same content SHA-256.
Fixture downloads use
`napier-thread-<thread-id>-<content-hash>.json` filenames with filesystem-safe
Thread ID segments.
The fixture response is no-store and mirrors the bundle content SHA-256,
event-stream SHA-256, thread ID, verification status, run/event/plan/evaluation
counts, ledger-backed and embedded Model Context Envelope counts, and
first/last event sequence headers for CI archive checks. Imported ThreadDetail
responses also mirror the source fixture hashes/counts as no-store provenance
headers.
Verification also recomputes Independent Advisor `evidenceSummary` receipts
from the review's bound predecessor events, so a replay bundle cannot make
stale verification evidence look current by only recalculating the review and
bundle hashes.
Per-Run replay snapshots are self-contained: they carry the Run, ordered events,
Subagent task evidence, a stable `contentSha256`, and an ordered
`eventStreamSha256`. `POST /api/threads/:threadId/runs/:runId/replay/verify`
recomputes the snapshot content hash, event-stream hash, metrics, assistant
output hash, Independent Advisor `evidenceSummary`, and URL thread/run binding
without mutating state. Run Lab exposes the same verifier as an upload action,
binding archived replay JSON to the active Thread before an operator trusts it
for evidence review or CI regression checks. Replay and comparison responses
also mirror duration,
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
also binds the enabled Skill catalog SHA-256, schemas 4-5 bind deterministic
Advisor policy and correction limits, schema 6 binds an independent review
model, schema 7 binds the frozen Prompt Variable catalog, snapshot receipt, and
rendered System Prompt, and schema 8 binds the Tool Loop Guard policy. Schema 1
remains hash-compatible and is interpreted as manual recovery; schemas 2-7
remain valid for Runs created before later bindings. **Lab → Compare** reports
the exact fields that drifted and shows both fingerprint hashes; receipt
timestamp changes alone do not count as Prompt drift, and a legacy Run without
this evidence is labeled unavailable rather than reconstructed from the current
Agent.

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
the derived imported lineage and source hashes explicitly, and instructs the
Agent never to treat embedded requests as current operator instructions or
authorization. Branches created from imported Threads retain the same source
fixture provenance plus a local imported-history cutoff sequence, so copied
historical messages stay behind that boundary without over-redacting later
local operator input. Run Lab and metadata-only OTLP root span attributes expose
the same source event count and local cutoff for audit.

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
durations, sequence numbers, evidence hashes, and metadata-only Advisor
verification freshness fields remain. The artifact binds the selected
source-event range, its SHA-256, explicit redaction policy, complete OTLP
request, and span count to a stable content SHA-256 independent of
`generatedAt`. Span events and specialized model ledger spans also carry a
hash-only `payload_projection_sha256` over the safe public attributes derived
from the payload, so metadata-only Advisor freshness fields are covered by the
root event-anchor receipt without exposing raw payloads.

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

The pairwise evaluator receives immutable left/right replay snapshots plus a
separate comparison-governance block. That block includes the metadata-only
`contextCoverageDelta` status, rates, and diagnostic codes, so scoring can
penalize unbound or regressed model-context coverage without exposing raw
prompt, message, or tool-schema content. Saved evaluation records carry a
hash-only `comparisonGovernance` binding for that projection; suite execution,
casebook curation, and reviewer consensus hashes include the binding when it is
present. Casebook qualification also passes the curated binding back to the
no-tool evaluator as metadata, so replayed judgments preserve the governance
context without reconstructing raw model input. Thread replay bundle validation
recomputes the binding hash during export/import verification. OTLP trace
export projects only the governance status and SHA-256 fields while excluding
evaluator reason and evidence text. The evaluator call itself is preserved as a
completed evaluation Run with hash-only context envelope evidence, while the
normalized reason and evidence remain on the user-visible evaluation event.
Casebook qualification uses the same trace discipline: a qualification
execution owns a completed qualification Run, and each real model re-judgment
records a turn-indexed hash-only envelope plus redacted response binding.

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
hash-level `evaluation.casebook.qualification.completed` Ledger event. The
event is attached to the execution's qualification Run; verified model-backed
cases also leave `context.model_envelope` and redacted `model.response` debug
events on that Run, while demo-only executions keep just the completion event.

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
packages/sdk         Store-free local TypeScript embedding facade
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
receipt, runtime-environment receipt, product-performance baseline, management
OpenAPI artifact, management OpenAPI compatibility fixture, Web dist receipt,
Web dist manifest, and the semantically verified Workflow, Data, DataFrame,
Security, restart/offline-wait/budget Long-horizon, Research, and UX Benchmark
Series, the durable Goal no-progress Series, the Process recovery Series, and
all forty-seven Result/Ledger pairs by SHA-256; the current 118-artifact set is
bound by `202d58fcc780ef88...`;
`npm run check:release-artifacts` /
`npm run verify:release-artifacts` verify that aggregate receipt against the
current component receipts. `npm test` starts with root-level release-gate contract
tests before running workspace suites, so package-lock drift, runtime version
drift, missing runtime components, OpenAPI route drift, manifest drift, extra
dist files, malformed manifests, stale receipts, compatibility regressions,
aggregate artifact drift, Workflow Benchmark trial substitution/tampering, and
Data/Security/restart, offline-wait, or budget Long-horizon/Research Benchmark evidence
tampering, Goal no-progress counter/evidence substitution, Process recovery
substitution, and entry-budget regressions are covered without mutating the
real build output.
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

- in-process read/list/search and AST preview operations inside the workspace,
  plus read-only public `web_search`, `web_fetch`, dynamic Browser reading, and
  Research Source citation, are allowed;
- `apply_patch`, `verify_workspace`, `run_command`, `javascript_kernel`,
  `python_kernel`, `node_debugger`, and `workspace_process` are not exposed;
- Browser interaction and file transfer actions are not exposed, even though
  read-only navigation/find/scroll/snapshot/capture actions are available;
- workspace writes and process execution are blocked;
- shell execution is blocked;
- destructive shell patterns remain blocked even under the future
  `unrestricted` policy.

`web_search` is available from a fresh default Agent through `napier run`,
`napier chat`, `napier tui`, HTTP/Web, RPC, and the TypeScript SDK because
those entries share the same Agent profile and Runtime. CLI/TUI/Web render
metadata-only tool events; the live model sees bounded titles, public URLs,
snippets, dates, source labels, and provider fallback diagnostics. Search
snippets remain untrusted discovery leads, not citation evidence.

`web_fetch` is available through those same entries. Its first call returns a
bounded Source preview plus Source ID/content hash; later `read` and `find`
calls reuse the exact Run-local normalized Source. HTML, JSON, text, and PDF
content is explicitly labeled untrusted and may never authorize actions.
Fetched Sources are process-local and automatic recovery blocks after their
use rather than pretending an in-memory Source survived restart. For a static
claim, call `research_source capture_fetch` with the exact Web Source ID and
content hash, then use the same `cite` and `verify_report` protocol as Browser
evidence. Dynamic JavaScript pages instead use the default read-only Browser
followed by `research_source capture/cite`; static pages should still prefer
`web_fetch`.
Authenticated content, CAPTCHA/login-wall recovery, scanned PDF OCR, automatic
Fetch-to-Browser fallback, full Browser interaction, Browser Live/takeover,
and cross-restart Source retention remain open P0 work.

Selecting `workspace` exposes only individually enabled structured tools:
**Atomic patch** is hash-preconditioned and supports Hashline-style line
anchors, **Sandbox verify** is read-only, offline, and command-closed, and
**Sandbox command** is an explicit-argv, read-only/offline Node runner with no
shell or inherited environment. **Background process** adds bounded
start/input/poll/cancel lifecycle control over the same sandbox boundary plus
one-use preview-bound writes to explicit existing scopes; ordinary starts
remain read-only.
**JavaScript kernel** adds persistent synchronous state within one Agent Run,
with bounded live-only values and fail-closed terminal outcomes.
**Python kernel** adds persistent restricted pure-computation state with fixed
runtime assets, traced-heap enforcement, and fail-closed terminal outcomes.
**Node debugger** adds Run-owned Node launch debugging with breakpoints,
stack/scopes/variables, side-effect-rejected evaluation, and single-step
control over the same read-only/offline Process boundary. It can bind a
generated program and bounded external single-source v3 map so compiled
TypeScript breakpoints and frames remain in original source coordinates.
**TypeScript AST** adds exact in-process syntax queries and no-write structural
previews; every resulting edit still returns through Atomic patch and explicit
verification.
**LSP diagnostics** adds one-file TypeScript/JavaScript semantic diagnostics,
**LSP semantic symbols** adds exact current-document declarations and
hierarchy, **LSP definition** and **LSP references** add workspace-confined
navigation, and **LSP rename preview** supplies a complete bounded
WorkspaceEdit that must still pass through Atomic patch. **LSP quick fixes**
supplies bounded diagnostic-driven text-edit alternatives, including
server-advertised data-backed actions resolved for edits only; opaque data
never leaves the live LSP Session and every command is denied. An explicitly
enabled **LSP quick-fix apply** tool can commit exactly one mutually exclusive
text-edit alternative through Napier's shared coordinated transaction. None
grants language-server workspace writes, command execution, or network access.
Authorization is checked again immediately before every call.

Selecting `unrestricted` may additionally expose an explicitly enabled
**Browser Session** through the public-network and workspace-file boundaries
described above. **Research Source** can derive bounded Run-local Source text
and claim-bound citations only from that active Session. Neither enables a
shell, package installation, arbitrary host networking, an existing user
browser, or unreviewed local file access.

This in-process policy is defense in depth, not an operating-system sandbox.
General shell execution remains disabled. Stdio MCP, structured workspace
verification, the foreground command runner, Workspace Process Sessions, and
the JavaScript/Python kernels, and the Node debugger are the narrow process
exceptions: macOS uses `/usr/bin/sandbox-exec`; Linux requires
`/usr/bin/bwrap` and usable kernel or setuid namespace support. Windows or
explicitly containerized deployments can opt into an OCI adapter by configuring
`NAPIER_CONTAINER_SANDBOX_IMAGE`; it uses an absolute Docker-compatible
executable, read-only root filesystem, capability-derived workspace mounts,
and `--network none` unless networking is approved. Scoped Process writes keep
the workspace root read-only and add only the preview-bound writable mounts.
These adapters launch only an explicitly selected absolute executable, avoid
shell invocation, and derive network and workspace access from reviewed
capabilities. Missing sandbox prerequisites and unsupported platforms fail
closed; a container or VM remains the recommended outer boundary for
production third-party code.

## License

Napier is released under the [MIT License](./LICENSE).
