# Changelog

All notable changes to Napier are recorded here.

## [0.1.0] - 2026-07-25

### Added

- Added controlled single-tool-invocation re-execution for ten built-in,
  stateless, workspace-read-only tools. Eligible Agent calls capture exact
  validated arguments and their tool-definition hash in the same
  permission-restricted, concurrent-capacity-safe local CAS used by model
  capsules; the Ledger, Replay, and public experiment events retain only a
  hash-bound receipt. `napier tool-experiment`, HTTP preview/SSE, and the
  TypeScript SDK can preview-bind the source Run/call, current scoped Workspace
  snapshot, Agent revision, tool Schema, arguments, and completed source output,
  then execute exactly that tool once in an isolated
  `tool_experiment_read_only` Run. Store requires an internal capability and
  rejects direct mode selection. Source/target status, latency, output hashes,
  and output bytes are compared; execution never enters the Agent Loop or
  resolves Extensions, Browser/Process/Kernel/Debugger Sessions, write tools,
  or unknown-effect tools. Real read-file and SQLite tests cover unchanged and
  changed output, stale preview, target failure, cancellation, concurrency,
  exposed permissions, direct Store bypass, portable Replay, and SQL/parameter/
  row privacy. Local stdio RPC adds capability discovery, preview/run,
  request-bound events, stale-preview conflicts, and durably settled active
  cancellation over the same Runtime. A lazy Run Lab read-only tool-call desk
  independently validates preview/comparison/frame hashes, event order, final
  Snapshot identity, and the complete event-stream hash; supports explicit
  cancellation, target navigation, and deliberate CAS-named result download;
  and never renders arguments, Workspace paths, or source/candidate output.
  Real Hono and production-browser coverage execute `read_file`, verify only
  the expected preview/run requests, navigate to the isolated target, and
  prove private path/output markers stay outside the DOM. Write/session tool
  checkpoints, result reuse or simulation, batch execution, and experiment
  promotion remain open.
- Added controlled single-model-invocation re-execution for provider-backed
  Agent calls. Before dispatch, primary Agent turns, context compaction, Goal
  evaluation, and Memory extraction write an exact provider Context plus safe
  sampling options to a permission-restricted, size-bounded local CAS; the
  Ledger records only the local capsule receipt and never exports the capsule
  through Replay or Trace. CLI JSONL, HTTP SSE, TypeScript SDK, local stdio
  RPC, and a lazy Run Lab desk can preview-bind one terminal source turn,
  optionally replace its model, and execute exactly one isolated provider call.
  Returned tool calls are compared but never executed. The browser independently
  validates preview/comparison/result hashes, metric deltas, event order,
  Snapshot and source/target bindings; it supports cancellation, target
  navigation, and deliberate result download without rendering candidate text.
  Call-level status, stop reason, latency, usage, cost, text/output hashes, and
  tool-name deltas remain inspectable, while tool arguments, raw thinking,
  provider Context, and candidate text stay out of durable experiment events.
- Added a lazy Run Lab message experiment desk over the controlled
  historical-message Runtime. It lists only terminal modern user-message
  metadata, supports configured model replacement, preview, explicit
  cancellation, read-only execution, bounded comparison, target navigation,
  and CAS-named result download without rendering source or target bodies.
  The browser independently validates exact preview/comparison/frame fields and
  hashes, recomputes metric and tool-set deltas, binds streamed event hashes to
  the final Snapshot and complete event stream, and rejects self-consistently
  rehashed semantic drift. The desk and its paper-ledger styles remain a
  separate lazy chunk; the main Workbench entry stays under its release budget.
- Added controlled historical user-message re-execution. A preview binds one
  terminal user Run and exact message to its frozen Agent revision, schema-7/8
  configuration, Prompt Variable timestamp/snapshot, Skill catalog, reviewed
  Memory context, complete message history, configured candidate model, and
  current Workspace snapshot. Execution creates an isolated Branch immediately
  before the message, proves copied visible and Goal-continuation context, and
  runs only through `agent_experiment_read_only`: observe policy, read-only
  tools, no subagents, Sessions, Plan/Memory mutation, or writes. Source and
  target status, configuration, output hash, latency, usage, cost, tools, and
  effects are compared through CLI JSONL, HTTP SSE, TypeScript SDK, and local
  stdio RPC. Cancellation, timeout, Provider failure, safe retry, concurrency,
  drift, forged-mode, portable Replay, and privacy-bounded Web Trace tests cover
  the path. The opt-in DeepSeek source-and-rerun smoke is implemented; this
  environment lacked `DEEPSEEK_API_KEY`, so the attempted live gate failed
  before network execution and is not claimed as passed.
- Added typed deterministic Reduce nodes to executable Workflows. A Reduce
  selects one required bounded array and can count, sum, find an extremum, or
  fold Boolean all/any values directly or through a required item field path.
  It performs no model, tool, expression, coercion, or side effect, while still
  using a leased Workflow Run with cancellation, timeout, retry, commit-gap
  recovery, outer-wave concurrency, checkpoint reuse/rerun, SDK, CLI JSONL,
  stdio RPC, HTTP SSE, portable Replay, and privacy-bounded Web Trace. The live
  DeepSeek Map smoke now fans out two real model calls and deterministically
  reduces their typed lengths.
- Hardened persistent Python evaluation under host contention without
  weakening its worker-enforced 1-2,000 ms code deadline. The parent now allows
  a separate bounded five-second scheduling and private-protocol result grace;
  metadata-only Server test diagnostics distinguish transport failure without
  exposing code or output text.
- Replaced Napier's five hand-registered model Provider factories with Pi's
  complete version-pinned `builtinProviders()` catalog. The shared Runtime now
  resolves 38 Provider implementations and 1,116 models across Web, CLI, SDK,
  RPC, Agent, and Workflow paths without copying endpoints, API adapters, auth,
  compatibility, or model tables into Napier. Workbench projection remains
  network-free and bounded to 18 models per Provider and 512 live models total;
  round-robin selection preserves every static Provider before later catalog
  entries. Existing environment/Keychain credential references configure newly
  exposed API-key Providers, while missing credentials still fail closed before
  model execution. Built-in action-union tools now retain `anyOf` validation
  while publishing the top-level object schema required by strict
  OpenAI-compatible function APIs. Registry, bootstrap, credential,
  payload-budget, full-model resolution, performance, real DeepSeek Agent, and
  caller-selected opt-in live smoke coverage prove the path. Dynamic refresh,
  subscription login UI, and custom Provider manifests remain explicit gaps.
- Added verified SQLite chart delivery to the existing `sqlite_query` tool.
  `chart` executes one database-hash-bound parameterized query through the
  unchanged read-only child worker and accepts only a complete 1-50 row result
  with one unique X column and one finite numeric Y column. A pure renderer
  emits deterministic fixed-theme bar or line SVG with bounded dimensions,
  XML-escaped text, finite geometry, and no script, URL, CSS, image, link,
  event handler, foreign object, or model-provided markup. SVG and semantic
  rows remain live-only; Ledger, Replay, SSE, typed Workflow output, and Web
  Trace retain only query/spec/renderer/SVG hashes and bounded metrics. Chart
  generation remains read-only: the Agent dogfood writes the returned SVG
  through `apply_patch`, verifies exact Workspace bytes as a Plan Artifact, and
  preserves a valid portable Replay. Runtime failure/cancellation/drift/
  concurrency tests, public Hono SSE coverage, privacy projection tests, and
  the real process-isolated SQLite smoke cover the vertical path.
- Added `napier chat`, a line-oriented interactive Agent entry that keeps one
  `LocalAgentRuntime` open across durable turns and delegates run/recovery to
  the existing `EmbeddedAgentService`. Bounded slash commands switch model or
  Thread, create the next Thread, resume an interrupted Run, and show local
  status without Store access or shell interpretation. Assistant deltas stream
  to stdout; stderr receives prompts, Run status, and metadata-only tool cards.
  C0/C1 terminal and dangerous bidirectional controls render as visible escapes
  without changing Ledger text, and a pre-aborted parent stops before Runtime
  bootstrap.
  Every turn has an independent timeout, active `SIGINT` cancels only that Run,
  idle `SIGINT` exits with 130, and EOF or parent termination closes the shared
  Runtime. TTY-only admission, ready-before-input ordering, backpressure,
  Provider failure recovery, cancellation, timeout, output failure, privacy,
  and shutdown tests cover the session. A real `node-pty` test runs the built
  CLI for two turns, switches model, checks status and a shared Thread, exits
  cleanly, and reopens SQLite to verify both durable Runs.
- Added sandboxed PTY mode to managed Workspace Process Sessions. An Agent can
  launch the same fixed Node argv through a real pseudo-terminal, observe TTY
  stdin/stdout and fixed `TERM=xterm-256color`, send bounded live-only input,
  perform up to 64 Run-owned resizes, poll ordered merged terminal output, and
  settle or cancel through the existing Process lifecycle. `node-pty` wraps
  only the macOS Sandbox or Linux Bubblewrap launcher; it does not add a shell,
  Workspace write, network, inherited environment, or host executable choice.
  Process schema v4 and `workspace.process.resized` bind I/O mode, size,
  sequence, environment, limits, and resulting session while raw argv, input,
  output, and control sequences remain outside Ledger, Trace, and Replay.
  Pipe close semantics are rejected for PTYs, uncertain resize evidence
  terminates fail-closed, and legacy v1-v3 sessions remain readable. The
  Workbench labels merged output and terminal dimensions and hides the invalid
  close action. Native adapter, Runtime, Agent tool, HTTP, Web projection,
  restart, concurrency, timeout, cancellation, output-cap, privacy, tampering,
  Replay, private-protocol regression, and real external macOS Sandbox dogfood
  cover the complete path.
- Added preview-bound Workflow checkpoint experiments to the TypeScript SDK and
  local stdio RPC. Both entries reuse the existing Experiment Runtime, require
  the current preview hash for every execution, preserve explicit confirmation
  for historical write/unknown effects, stream target Ledger events, and
  return the candidate Manifest, target Thread/Plan, and privacy-bounded
  source/target comparison needed for inspection and recovery. Stable RPC
  conflicts cover stale previews; pre-settlement cancellation and four-request
  admission remain shared with Agent/Workflow calls, while a durable cancelled
  experiment returns its recovery-ready target result. Real SDK and
  built-process tests prove strict preflight, concurrent isolated targets,
  verified ancestor reuse, comparison, explicit retry recovery, and portable
  Replay without exposing Store or adding a second execution loop.
- Added one freshness-bound Workflow Approval answer-and-resume path shared by
  CLI, TypeScript SDK, and local stdio RPC. Waiting executions expose the
  pending Decision; answers bind its content hash, Manifest, Thread, Plan,
  Approval Run, request evidence, option contract, and expiry before the
  decision is persisted and Workflow recovery starts. Stale, mismatched,
  expired, repeated, and losing concurrent answers fail closed. If
  cancellation or output failure follows the durable answer, normal resume
  completes without a duplicate human side effect. Approval validation lives
  in a split Runtime module; built RPC approve/reject, SDK concurrency and
  cancellation recovery, existing CLI JSONL, and portable Replay tests cover
  the full path.
- Extended local stdio JSON-RPC protocol v1 with typed Workflow run and resume.
  Clients pass the same hash-bound Manifest used by CLI/SDK plus Schema-checked
  JSON input or an existing Thread/Plan and explicit blocked-node retry.
  Calls reuse `EmbeddedWorkflowService`, share Agent request admission and
  cancellation, stream request-bound Workflow Ledger events, and return
  completed, waiting, or blocked results without exposing Store. Real built
  process coverage executes/resumes a deterministic Workflow, retries a
  missing-Provider node, verifies Replay, and cancels a real Workflow while
  stdout is deliberately backpressured.
- Added a versioned local stdio JSON-RPC 2.0 Agent entry. `napier rpc` keeps one
  `LocalAgentRuntime` open and routes Agent run, continuation, and interrupted
  recovery through the existing `EmbeddedAgentService`. Request-bound durable
  events stream as hash-bound `napier/event` notifications;
  `$/cancelRequest`, EOF, SIGINT, SIGTERM, `shutdown`, `exit`, and stdout
  failure cancel and await active Runs before Process/MCP/SQLite shutdown.
  Strict protocol-v1 contracts, UTF-8 and 1 MiB line bounds, exact fields,
  ModelRef/resource validation, four-request admission, duplicate-ID rejection,
  serialized stdout backpressure, stable errors, and hash-only internal
  diagnostics protect the process boundary.
  Protocol, lifecycle, cancellation, concurrency, privacy, built subprocess,
  portable Replay, and two-Run manual dogfood coverage prove the path without
  adding a network listener, Store access, or another Agent Loop.
- Added write-linked relevant-test verification for TypeScript and JavaScript
  changes. When a non-observe Agent explicitly enables a write tool and
  `verify_workspace`, `apply_patch` and verified `lsp_rename_apply` commits bind
  changed declaration hashes, scan each changed file's nearest package through
  a bounded static relative-import graph, and execute up to eight exact
  reverse-dependent `.test`/`.spec` Vitest files in the existing read-only,
  offline OS Sandbox. Helper modules are not mistaken for test targets, and
  declaration caps surface explicit truncation. Incomplete selection never
  executes; pass, failure, timeout, output cap, no match, drift, cancellation,
  and unavailable execution remain distinct. A post-run package snapshot
  prevents stale success evidence, and same-event passes satisfy only
  test-specific Model Advisor claims. Agent output retains
  bounded live paths, symbols, and test output while Ledger, Replay, public
  SSE, and Web Trace receive only status/count/hash evidence. Runtime, policy,
  HTTP, Replay, Trace, and opt-in real macOS Sandbox tests cover the vertical
  path.
- Added a checked local product-path performance budget. Three fresh built CLI
  JSONL processes measure median first Run event, first demo token, and terminal
  completion; the same isolated benchmark measures shared Runtime bootstrap,
  production `read_file` p95, 1,000-event SQLite append/projection latency,
  observed RSS, and closed-ledger bytes/event. Strict report reprojection binds
  raw samples, derived metrics, limits, environment, and content hash. The
  reviewed baseline is now part of release artifact audit, while budget
  breaches, artifact tampering, CLI timeout, and pre-cancellation fail closed.
- Added preview-bound direct LSP rename application. `lsp_rename` remains a
  read-only, offline language-server preview, while explicitly enabled
  `lsp_rename_apply` accepts only a fresh same-Run one-use capability. Napier
  revalidates up to 32 files and 256 edits, runs bounded preflight diagnostics,
  acquires every target lock, rehashes all source bytes, stages and fsyncs all
  outputs, and creates same-filesystem hard-link backups before committing.
  Later target failure restores earlier files in reverse order and reports
  `rolled_back` only after complete hash verification; incomplete rollback is
  `indeterminate` with a counted local recovery artifact and no automatic
  retry. Cancellation after commit begins settles the complete commit or
  rollback. Postflight diagnostics restart stale LSP state and cannot hide an
  already committed write. Agent, real HTTP/SSE, policy, concurrency, timeout,
  rollback fault-injection, Replay, Web Trace privacy, and opt-in production
  Sandbox smoke tests cover the path.
- Added bounded read-only Agent Map nodes to typed Plan Workflows. A Map selects
  one Schema-bounded runtime array, uses one coordinator Run, and fans out at
  most 16 items through up to three parent-bound Agent Runs at the frozen Agent
  revision. Item Runs force `observe`, admit only bounded read-only tools, and
  disable writes, verifier processes, stateful sessions, extensions, subagents,
  Plan/operator tools, and Memory metadata mutation. Independent item
  deadlines, Workflow cancellation, strict item/aggregate Schemas, and
  input-order collection bound the execution. The outer scheduler runs Map
  exclusively so the coordinator and workers stay within the four-Run Store
  limit. Ledger evidence binds item indexes, lineage, Manifest/configuration,
  input/output/Schema hashes, and ordered Run/hash sets without exposing raw
  item bodies in Trace. Restart reconstruction accepts only a complete proved
  aggregate; incomplete interruption requires explicit retry. Checkpoint
  experiments include child metrics, tool observations, and Map model
  replacement. Runtime, HTTP SSE, CLI JSONL, SDK Manifest, Web experiment, and
  Web Trace tests cover the shared path, with an opt-in real DeepSeek Map
  smoke.
- Added process-isolated read-only SQLite analysis. `sqlite_query schema`
  inspects bounded table/view columns from a canonical checkpointed workspace
  database; `query` requires that exact database SHA-256 and executes one
  parameterized `SELECT`, `WITH`, or `VALUES` statement. Napier rejects
  symlinks, protected paths, active sidecars, PRAGMA, ATTACH, DDL, DML,
  extension loading, trailing statements, unsafe functions, stale database
  hashes, and source drift. The complete database is copied into a temporary
  read-only snapshot before fixed-source child-process execution, so timeout
  and cancellation can hard-kill native SQLite work. Rows and schema remain
  live-only; Ledger, Replay, SSE, Workflow receipts, and Web Trace retain
  hashes, counts, truncation, duration, worker, runtime, and limit evidence.
  SQLite temporary state is confined to the private snapshot directory. The
  new `data-analysis` Skill guides schema-first, parameterized,
  aggregate-oriented analysis. Agent, typed Workflow Tool node, concurrency,
  drift, privacy, and real SQLite smoke tests cover the complete path.
- Added semantic verification for citation-backed Markdown reports.
  `research_source verify_report` reads a caller-hash-bound `.md` or
  `.markdown` file through the canonical non-symlink workspace boundary,
  requires every citation token to belong to the current Run, and requires
  each token exactly once at the end of its exact claim line. Unknown,
  malformed, duplicated, claim-drifted, stale, escaping, protected,
  unsupported, or oversized reports fail closed; file freshness is rechecked
  before success. Ledger, Replay, SSE, and Web Trace retain only report
  path/file/citation-set hashes plus byte/citation counts. Agent guidance and
  `research-brief` now require report verification and use citation IDs rather
  than duplicate tokens in the Evidence Ledger. Agent integration proves
  Browser capture through `apply_patch`, runtime citation verification, Plan
  artifact verification, and completion against one file; the production
  Chrome smoke exercises the same report verifier.
- Added Browser-backed Research Sources and claim-bound citations. The
  `research_source` Agent tool captures bounded normalized visible text from
  the active same-Run controlled Browser, binds URL/title/line content and
  truncation to an immutable capture hash, and requires that exact Source
  identity for a bounded line-range citation tied to a normalized report
  claim. Sources and citations are serialized, Run-isolated, limited,
  cancellation-safe, and removed at settlement. The tool requires
  `unrestricted`, reports a read effect, and remains unsafe for automatic
  restart recovery because Source bodies are intentionally process-local.
  Source text, URL, title, claim, quote, and live output stay out of Ledger,
  Replay, SSE, and Trace; durable projections retain only bounded IDs, hashes,
  counts, range, truncation, and Browser provenance. The bundled
  `research-brief` Skill now requires primary and disconfirming evidence,
  adjacent citation tokens, an evidence ledger, and verified Markdown artifact
  delivery. Agent integration proves Plan-backed `apply_patch` creation and
  workspace-byte verification; Web Trace fails closed on partial or
  inconsistent capture/citation receipts; the opt-in real Chrome smoke now
  exercises capture, citation, report write/read, screenshot, and close.
- Added Run-owned controlled Chrome Sessions with navigation, back, AI ARIA
  snapshots and refs, click/type/select, canonical upload, exclusive bounded
  download, live screenshot, and explicit close actions. Sessions use fresh
  profiles, Chromium sandboxing, temporary HOME state, same-Run serialization,
  cross-Run isolation, cancellation/settlement cleanup, and bounded admission.
  Every request passes independent Playwright Route checks plus a
  loopback-only authenticated proxy that rejects private/reserved/mixed DNS
  and pins one public IP per HTTP or CONNECT socket. Proxy outbound remains
  closed during startup/idle/read-only views and opens only around preflighted
  network actions. Main-frame cross-origin navigation requires per-action
  authorization; popups, dialogs, service workers, unsolicited downloads,
  overwrite, symlink paths, and automatic recovery are denied. Agent policy
  requires `unrestricted` without enabling a shell. Ledger, Replay, SSE, and
  Web Trace retain only bounded action,
  Session, network, file, screenshot, and hash evidence; page content, URLs,
  selectors, typed values, paths, PNG bytes, proxy credentials, and raw
  Session IDs remain live-only. Tests cover the complete action protocol,
  SSRF, proxy tunneling, auth, cross-origin redirects, cancellation,
  concurrency, limits, file confinement, Agent integration, Trace privacy,
  and an opt-in production-sandbox Chrome smoke.
- Added Run-owned persistent TypeScript language-server Sessions across
  diagnostics, semantic symbols, definition, references, rename, Code Action,
  and write-linked diagnostic flows. Same-Run operations serialize through one
  read-only, offline Sandbox process while target/runtime hashes and bounded
  workspace snapshots remain fresh; writes, drift, timeout, cancellation,
  protocol failure, output exhaustion, idle exit, operation limits, and Run
  settlement close the Session. Direct Runners and stateless Workflow Tool
  nodes retain one-shot execution. Ledger, Replay, SSE, and Trace expose only
  mode, reuse, operation count, and Session/workspace/limit hashes. Tests cover
  reuse, write replacement, queued cancellation, concurrent Run isolation,
  active-session admission, uncertain-state replacement, privacy, and an
  opt-in real OS-Sandbox two-tool smoke.
- Extended `@napier/sdk` with ordinary Agent execution and recovery.
  `runAgent()` starts a new Thread or continues an explicit existing Thread,
  while `resumeAgent()` creates the same evidence-bound recovery child as CLI.
  The Runtime facade validates the 64 KiB prompt bound, model reference, title,
  Thread/Agent ownership, cancellation, and optional interrupted Run ID before
  mutation, then returns assistant text only from the exact returned Run.
  Concurrent Agent calls remain Thread-isolated; closing the SDK cancels and
  waits for active Agent Runs before shared-service shutdown. Tests cover
  one-shot and continuation, malformed preflight, concurrency, active close,
  restart reconciliation plus recovery, portable Replay, and a built external
  Node example.
- Added `@napier/sdk` as a Store-free local TypeScript embedding entry point.
  `createNapierClient()` owns the existing local Runtime lifecycle;
  `defineWorkflow()` preflights a typed Plan and node graph before deriving a
  real source Plan, Blueprint, and stable Manifest; `loadNapierWorkflow()`
  rejects modified serialized Manifests; and `runWorkflow()` /
  `resumeWorkflow()` delegate to the existing Workflow Runtime with unchanged
  AbortSignal, event, policy, Sandbox, retry, recovery, and Ledger behavior.
  Invalid definitions, inputs, titles, or pre-aborted requests fail before
  creating definition or execution Threads. Package tests cover typed
  conditional execution, serialization, portable Replay, idempotent resume,
  closed-client behavior, preflight non-mutation, concurrent Thread isolation,
  blocked-node retry, active-run cancellation before shared-service shutdown,
  and a real external Node application using the built SDK.
- Added typed conditional control to executable Plan Workflows. Any node may
  pair a Manifest-bound `when.path + equals` guard with a schema-valid
  `skipOutput`. The path resolves only inside the node's already constructed
  and validated input, and canonical JSON equality provides no coercion,
  truthiness, interpolation, JSONPath, or executable expression surface. A
  false guard creates no Run and consumes no attempt; the existing Plan step
  becomes skipped and its typed fallback remains available to downstream
  joins. A true guard uses the unchanged Agent, Deterministic, Tool, or
  Approval execution path. Resume rebuilds dependencies and input, recomputes
  the guard, repairs a missing hash-only `workflow.node.skipped` event, and
  rejects unconditional, now-true, duplicate, or drifted skip evidence.
  Checkpoint experiments rerun and reuse skipped nodes without manufacturing
  `workflow_reuse` Runs, preserve explicit lineage across commit gaps, and
  report zero Run/model/tool/token/cost metrics. Runtime and browser comparison
  validators reject forged non-zero skipped observations and result/comparison
  status mismatches. Real CLI JSONL and HTTP SSE execute a missing-provider
  node through its fallback with zero Runs; Workbench Manifest validation and
  Trace enforce safe paths and expose only condition, subject, fallback,
  output, and schema hashes. Tests cover false and true branches, parallel
  join, unavailable runtime paths, commit-gap recovery, duplicate evidence,
  portable Replay, experiment rerun/reuse and recovery, protocol tampering,
  CLI, Server, and Web privacy.
- Added bounded parallel waves to typed Plan Workflows. Manifests can opt into
  `maxConcurrency` from 1 to 4 while omission preserves legacy sequential
  execution. The scheduler selects dependency-ready non-Approval nodes, gives
  each an isolated Plan/output/result context, merges outcomes in Manifest
  order, keeps Approval exclusive, preserves independently completed siblings,
  and propagates cancellation across the batch. AgentRuntime and Store now
  support multiple active same-Thread node Runs only when a package-internal
  capability binds every Run to the same active Plan; persisted
  `workflowPlanId` survives Store synchronization and is remapped and validated
  by portable Replay import. Ordinary Runs, second Workflows, detached control
  messages, Agent milestones, mismatched Plans, legacy unbound Runs, and a
  fifth concurrent node fail closed. Restart recovery reconstructs every
  interrupted branch before explicit retry. Checkpoint experiments preserve
  concurrency, HTTP exposes the bound value, and Web Manifest/Trace enforce the
  same 1–4 privacy-safe projection. A shared `OrderedRunEventWriter` now gives
  CLI JSONL, Workflow SSE, and experiment SSE one contiguous Ledger-sequence
  contract under concurrent callbacks. Runtime overlap, typed join, partial
  failure, cancellation, Approval barrier, restart, cross-Store admission,
  Replay tamper, experiment, CLI, Server, and Web tests cover the vertical
  path.
- Added bounded Deterministic nodes to typed Plan Workflows. A Manifest can now
  bind a pure recursive JSON template that selects typed input fields and
  constructs literal, object, or array output without a model or tool call.
  JavaScript, JSONPath, interpolation, expressions, prototype-sensitive paths,
  and unbounded templates remain unavailable. Each node executes in a leased
  `source=workflow` Run at the frozen Agent revision, schema-checks output,
  stores the recoverable body as hidden assistant data, and records only
  template/input/output/schema hashes plus output bytes in its terminal
  Workflow receipt. Resume repairs terminal commit gaps, fails closed on
  duplicate or tampered output evidence, and automatically recomputes only a
  proved started-only interrupted pure node within `maxAttempts`; Agent, Tool,
  Approval, and unknown-effect retries remain explicit. Checkpoint experiments
  can rerun or reuse verified Deterministic output and reject model replacement
  on the non-Agent node. Real CLI JSONL and HTTP SSE execute model-free
  Deterministic-only Manifests, while Workbench Manifest validation and Trace
  enforce the same bounds and omit template/input/output bodies. Runtime,
  failure, cancellation, timeout-at-commit, restart, tamper, experiment, Web
  privacy, CLI, and Server coverage exercise the complete path. The
  implementation is split across pure model, leased execution, node
  coordination, evidence, recovery, and browser validation modules.
- Added durable human Approval nodes to typed Plan Workflows. A Manifest now
  binds one fixed approve/reject question, typed input context, standard output
  schema, deadline, and retry limit. Execution creates a leased model-free
  `source=workflow` request Run, reuses the existing operator-decision Ledger,
  and returns a hash-bound `waiting` result without holding a process open.
  Approval continues only through a same-Agent-revision child Workflow Run;
  rejection, custom-only answers, cancellation, expiry, and evidence drift
  block the Plan. Generic Agent continuation rejects Workflow-owned decisions.
  CLI `--approve`/`--reject` can atomically answer and resume the exact
  Thread/Plan, HTTP reuses the existing answer route plus Workflow SSE, and Web
  answers or cancels while preventing detached continuation. Restart recovery
  binds the unique decision request, request digest, attempt, recomputed
  deadline, answer, and continuation Run. Controlled experiments can reuse a
  verified Approval or rerun it into an isolated waiting target. Runtime,
  retry, reject, cancel, timeout, restart, duplicate-evidence, experiment, Web
  privacy, real CLI JSONL, and real HTTP SSE tests cover the complete path.
- Added model-free Tool nodes to typed Plan Workflows. Schema-v1 Manifests can
  now mix Agent nodes with 18 allowlisted stateless built-ins, declare the
  expected `read`/`write` effect, and bind literal or field-path values from
  Workflow input and direct dependencies. Each Tool node uses a leased
  `source=workflow` Run and the frozen Agent revision, then checks enabled
  capability, TypeBox arguments, effect, policy, workspace scope, and freshness
  before `tool.started`; schema-validated structured details become its typed
  output. Agent and Workflow execution share an extracted stateless tool
  catalog. Generic tool arguments and text are hash-only in Tool-node evidence.
  Recovery never reruns a start without terminal evidence, but can settle a
  terminal tool event whose Run settlement was interrupted without
  manufacturing a second call. Checkpoint experiments rerun or reuse Tool
  outputs, reject model overrides on Tool nodes, and include actual tool
  metrics. Runtime, restart, effect drift, policy denial, cancellation, timeout,
  field-path failure, experiment, Web Manifest/Trace, real HTTP SSE, and CLI
  JSONL coverage exercise the complete path. Stateful Kernel, debugger, Process
  Session, and preview-bound workspace file mutation tools remain Run-owned
  Agent capabilities.
- Added a lazy Workflow Experiment Desk to the Plan Workbench. A developer can
  load a canonical versioned Manifest, select a source Plan/checkpoint,
  optionally replace the checkpoint model, preview reused/rerun nodes and
  historical tool effects, confirm the exact side-effect-bearing preview, run
  the existing isolated experiment Runtime, inspect aggregate and per-node
  differences, open the target Thread, and download the complete result with a
  CAS filename. The browser independently binds Preview to source
  Thread/Plan/Manifest/node/model overrides and validates multi-Run SSE event
  hashes/order, one terminal Snapshot, comparison/result hashes, target
  identity, event-stream hash, no-store headers, and bounded response sizes.
  Thread or form changes abort and invalidate in-flight work so stale responses
  cannot repopulate another Thread. UI projection excludes output bodies, tool
  arguments, Evaluation prose, Artifact paths, and diagnostics. A shared SSE
  JSON reader replaces duplicate stream decoding without narrowing ordinary
  long-Thread Run streams. Real Server/SQLite/Runtime/Web-client dogfood and
  source-drift, stale-preview, duplicate-Snapshot, missing-terminal, tamper,
  UTF-8 split, privacy, API-boundary, and byte-limit regressions cover the
  vertical path. Review also fixed experiment SSE responses being downgraded
  from `no-store` to `no-cache` by the streaming helper.
- Added source-versus-target comparison for controlled Workflow checkpoint
  experiments. Newly generated results align nodes by Manifest order, classify
  verified reuse versus actual rerun, and report current status, Run/source,
  model/configuration, attempt, duration, token/cost, tool-set, output
  availability/hash, existing Evaluation, and path-free Artifact evidence.
  Every numeric delta is `target - source`; repaired and lost outputs are
  distinguished explicitly. Only the current completed Plan-step Run can
  supply a current output, preventing a reopened or failed node from inheriting
  historical success. Comparison creation groups each Thread event stream once,
  reuses portable Replay metric derivation, rechecks source/target Plan
  revisions, and rejects missing or non-Workflow Run provenance. The complete
  hash-bound comparison is carried by existing CLI JSONL and HTTP SSE terminal
  frames; human CLI prints a concise delta, while
  `workflow.experiment.compared` and Web Trace retain only bounded statuses,
  counts, deltas, and hashes. Legacy schema-v1 experiment results without a
  comparison remain valid. Runtime, cancellation, recovery, nested fork,
  source-drift, semantic tamper, CLI, HTTP, Web privacy, and opt-in DeepSeek
  coverage exercise the vertical path.
- Added controlled typed-Workflow checkpoint experiments. CLI
  `napier workflow --from-node` and HTTP preview/SSE routes derive the selected
  node plus descendants as an isolated rerun subgraph, verify and
  re-materialize completed ancestors as explicit `source=workflow_reuse`
  control Runs, and allow per-rerun-node model replacement without mutating the
  source Plan. Preview summarizes historical read/write/unknown tool effects;
  write, unknown, or unresolved evidence requires explicit confirmation bound
  to the exact current preview hash before target creation. Results carry both
  source and deterministically derived candidate Manifests and end in a
  snapshot/event-stream-bound `workflow_experiment_result`. Cancellation,
  blocked-node retry, restart recovery, nested experiment forks, concurrency,
  stale confirmation, source ambiguity, Replay, tampering, CLI, Server, Web
  Trace, and opt-in real DeepSeek coverage exercise the vertical path. Review
  moved historical Agent-revision pinning and reused-output injection behind a
  package-internal Runtime capability, bound reused source/target input hashes,
  prevented synthetic reuse from degrading into a real Agent retry, and sized
  result limits from the existing Manifest/Workflow bounds. This is controlled
  Workflow-node re-execution, not yet user/model/tool single-step Replay,
  side-effect simulation, batch experiments, or evaluation promotion.
- Added typed executable Plan Workflows. The exported
  `defineExecutionPlanWorkflow()` helper turns an existing
  `ExecutionPlanBlueprint` into a versioned, hash-bound Agent DAG manifest with
  bounded runtime input/output schemas, explicit direct-dependency bindings,
  per-node model, timeout, and attempt limits. Execution reuses the normal
  `ExecutionPlan`, `AgentRuntime`, Run lease, model/tool policy, Sandbox, and
  Work Ledger rather than adding a second scheduler or state database. Each
  node Run freezes the Workflow's starting Agent revision, records
  `source=workflow`, excludes Thread message history and prior-node
  delegation/milestone context, and cannot invoke Plan mutation, milestone, or
  operator-decision tools. Strict JSON output must pass its node schema before
  the Plan step completes. Invalid output, model failure, timeout, cancellation,
  and exhausted attempts become explicit blocked evidence. Resume verifies
  input, schema, Run, output, attempt, and terminal evidence; repairs
  process-exit gaps between Run/Plan/Ledger commits; and requires explicit
  bounded retry for unknown side effects. Generic manual and automatic Run
  recovery reject Workflow-owned Runs. `napier workflow` emits ordered JSONL,
  while `POST /api/threads/:threadId/workflows` emits the same HTTP SSE events;
  both finish with a typed result frame bound to the authoritative snapshot and
  event stream. Web Trace retains only bounded status, counts, safe IDs, error
  codes, and hashes. Runtime, restart, CLI, Server, Web, Replay, tamper,
  concurrency, cancellation, timeout, path, context-isolation, and
  no-mutation regressions cover the vertical path, with an opt-in real
  DeepSeek Workflow smoke. This initial slice is sequential Agent DAG
  execution; later entries add Deterministic, Tool, and Approval nodes.
  Parallel/control-flow constructs, external adapters, artifact settlement,
  and visual editing remain.
- Added Run-owned Node DAP launch debugging. The opt-in `node_debugger` Agent
  tool launches one canonical workspace JavaScript or Node-executable
  TypeScript target through the existing private `WorkspaceProcessManager`
  protocol and read-only/offline OS Sandbox. A controller Worker attaches
  `node:inspector` to the target main thread without opening a TCP listener and
  supports source/exception stops, stack, scopes, bounded variables, target
  argv/output, side-effect-rejected evaluation, continue, step over/in/out, and
  cancellation. Strict bounded `Content-Length` framing plus a random
  per-process authenticator prevents raw target output from forging accepted
  DAP evidence. Source and loaded workspace modules are hash-bound and
  revalidated before every paused-state action; drift, malformed or
  unauthenticated frames, timeout, cancellation, protocol exhaustion, and
  unknown outcomes terminate the complete session. Shared
  `AgentSessionRuntime` closes omitted paused sessions before terminal Run
  events. Paths, source, expressions, argv, stack/scope/variable names and
  values, and target output remain live-only; Ledger, Replay, public SSE, and
  Web Trace retain bounded metadata and hashes. Real Agent and HTTP dogfood,
  protocol/security/failure regressions, and an opt-in OS-Sandbox smoke cover
  the vertical path. Review fixed stale dependency inspection and an
  inaccurate adapter-side output truncation flag. This slice is launch-only;
  attach, source maps, multi-thread/child debugging, debugger UI, and
  cross-restart recovery remain.
- Added a persistent restricted synchronous Python kernel. The opt-in
  `python_kernel` Agent tool starts, evaluates, and cancels a Run-owned
  pure-computation context through the existing private
  `WorkspaceProcessManager` protocol and read-only/offline OS Sandbox. State
  survives model turns, while imports, classes, async/yield, context managers,
  private/dunder and frame access, dynamic compilation, files, subprocesses,
  networking, packages, and inherited environment access remain unavailable.
  A fixed CLT/Xcode or Linux interpreter launches with `-I -B -S -u`; its
  executable, no-site bootstrap dependency set, existing bytecode, native
  extensions, fixed environment, worker, argv, and resource limits are bound
  and rechecked. A host regression proves the bounded asset set covers every
  module file loaded by the worker. Snippets, session lifetime, AST size,
  output, protocol bytes, CPU, child processes, files, descriptors, and traced
  Python heap are independently bounded. Trusted signal and trace handlers
  turn per-evaluation wall timeout and 32 MiB traced-heap excess into
  uncatchable process exits, including around user `except:` blocks. Review
  regressions close an initially unused evaluation timeout, an incomplete
  runtime-asset manifest, a catchable memory guard, and a
  generator-frame-to-worker-globals escape. Code, values, console, cwd,
  stderr, and runtime paths remain live-only; Ledger, Replay, Server SSE, and
  Web Trace retain bounded lifecycle metadata and hashes. Deterministic Agent
  and public HTTP dogfood preserve state in a real Python child, calculate a
  result, close the context, and verify privacy-safe evidence. This is not a
  package environment, Notebook, DataFrame runtime, filesystem bridge, or
  replacement for the OS Sandbox.
- Added real TypeScript/JavaScript AST query and no-write structural edit
  previews. The opt-in `ast_query` tool uses the pinned TypeScript compiler to
  select bounded syntax nodes by kind, name, and ancestor and returns exact
  live-only ranges, signatures, file hashes, and node hashes.
  `ast_edit_preview` binds a replace, remove, insert-before, or insert-after to
  the current file and node hashes, reparses the complete candidate file,
  expands context until the OLD text is unique, rechecks source freshness, and
  returns one exact replacement for the existing CAS `apply_patch` tool.
  Ambiguous comment trivia fails closed instead of silently reassigning JSDoc
  or trailing comments. Canonical path, protected-root, symlink, UTF-8, file,
  traversal, range, replacement, and output limits apply before source reaches
  the Agent; native filesystem errors are converted to path-free live
  diagnostics. Source, paths, names, signatures, and replacements remain
  absent from Ledger, Replay, Server SSE history, and Web Trace. Agent and
  public HTTP dogfood complete query-to-preview-to-CAS application through the
  shared Runtime, while independent dogfood re-queries the written node and
  passes real TypeScript 5.9.3 `tsc --noEmit`. Review regressions cover comment
  ownership and absolute-path error disclosure.
- Added a persistent synchronous JavaScript kernel. The opt-in
  `javascript_kernel` Agent tool starts, evaluates, and cancels a Run-owned
  context through the existing `WorkspaceProcessManager`, fixed secret-free
  environment, and read-only/offline OS Sandbox. State survives multiple model
  turns in one Run; snippets, evaluation time, total session lifetime, V8 old
  space, value preview, console entries, and formatted tool output are
  independently bounded. Synchronous exceptions preserve prior state, while a
  returned Promise/thenable, CPU or result-render timeout, external
  cancellation, malformed protocol, worker exit, or unknown post-write outcome
  terminates the complete kernel. Discarded Promise microtasks drain before
  evaluation return and inside the same VM timeout, preventing post-result
  state drift. Shared-memory Atomics, GC callbacks, WeakRefs, and WebAssembly
  are removed from the context so delayed built-in work cannot cross
  evaluations. A lazily loaded TypeScript AST check rejects actual dynamic
  `import()` before stdin write, closing delayed VM module rejection without
  adding compiler cost to Runtime startup. Run settlement also cancels every
  remaining owned kernel before its terminal event, preventing omitted model
  cleanup from retaining Process slots. Canonical base64 transport keeps every
  accepted 16 KiB source below the Process input limit even under worst-case
  JSON escaping, and the worker independently validates decoded UTF-8 and size.
  Canonical UTF-16LE base64 similarly prevents control-character expansion in
  result frames; a 30 KiB cumulative protocol budget reserves room for a
  structured terminal response before the Process output cap. Console and
  result formatting are constructed inside the VM realm, dynamic string/Wasm
  code generation is disabled, and regression tests cover constructor, `eval`,
  custom-inspector, and `toJSON` escape paths without treating `node:vm` as a
  replacement for the OS Sandbox. A private-protocol marker makes generic
  Process list/output/input APIs and Workbench report output/stdin unavailable;
  only the typed manager can move reversible frames, while operator
  cancellation and the same Process Ledger remain intact. Code, cwd, values,
  and console text remain live-only; Ledger, Replay, Server SSE history, and
  Web Trace retain bounded lifecycle metadata and hashes. Deterministic Agent
  dogfood preserves state through a real child process, returns the final
  calculation, explicitly cancels it, and verifies a privacy-safe Replay.
- Added semantic TypeScript/JavaScript document symbols. The opt-in
  `lsp_symbols` Agent tool issues real `textDocument/documentSymbol` requests
  through the existing exact-version, read-only, offline LSP Sandbox,
  advertises hierarchical support, and accepts the standard flat fallback. It
  validates exact response keys, SymbolKind values, target URI, UTF-16 source
  bounds, selection/parent containment, protocol node/depth limits, a 16 MiB
  pre-materialization aggregate range budget, and source/runtime freshness. The
  live Agent receives bounded names, hierarchy, exact server-provided
  symbol/name ranges, signatures, file/range hashes, and completeness;
  Ledger, Replay, Server SSE, and Web Trace retain only shape, counts, depth,
  display bytes, versions, latency, and hashes. Real Agent dogfood narrowed a
  read to the returned method range, applied a production CAS patch, and
  verified clean diagnostics. Independent dogfood patched the exact semantic
  range through `applyWorkspacePatch` and passed real `tsc --noEmit`. Parser
  and materialization/receipt responsibilities remain split across focused
  modules.
- Added diagnostic-driven TypeScript/JavaScript quick-fix previews. The opt-in
  `lsp_code_actions` Agent tool collects current diagnostics and issues real
  `textDocument/codeAction` requests restricted to `quickfix` through the
  existing read-only, offline, exact-version LSP Sandbox. It exposes at most 16
  text-edit alternatives under aggregate 32-file, 256-edit, 32 KiB preview,
  and 64 KiB Agent-output limits. Command-only, disabled, edit-free, and
  truncated entries are counted as omitted; commands and opaque data attached
  to an edit are dropped before output or persistence and are never executed.
  The shared WorkspaceEdit boundary allows insertion edits but still rejects
  resource operations, annotations, overlap, unsafe targets, drift, timeout,
  and cancellation. Standard `documentChanges` takes precedence when both
  WorkspaceEdit representations are returned. Candidate totals are checked
  before file I/O; edit locations are materialized serially with caching, and
  source versions plus all final target hashes are revalidated. A real
  TypeScript missing-import run returned two alternatives; an Agent selected
  the preferred import, applied it through hash-bound `apply_patch`, changed
  write-linked diagnostics from one error to zero, reran explicit diagnostics
  as clean, and produced a valid path- and content-redacted Replay. Independent
  dogfood applied the real preferred edit through production CAS and passed
  real `tsc --noEmit`. HTTP/SSE and Web Trace expose only bounded counts,
  completeness, latency, and hashes.
- Added workspace-confined TypeScript/JavaScript rename previews. The opt-in
  `lsp_rename` Agent tool drives real `textDocument/prepareRename` and
  `textDocument/rename` requests through the existing exact-version,
  read-only, offline LSP Sandbox. It returns a complete bounded WorkspaceEdit
  with live-only paths, file hashes, exact ranges, old text, and replacements,
  capped at 32 KiB aggregate preview text and 64 KiB formatted output, while
  durable Agent, Ledger, Replay, Server SSE, and Web Trace projections retain
  only completeness, counts, preview bytes, versions, latency, and hashes. Any
  resource operation, annotation, overlap, truncation,
  external/protected/symlinked target, malformed range, source/runtime drift,
  timeout, or cancellation fails closed. The tool never writes; Agents apply
  reviewed edits through existing hash-bound `apply_patch`. Real dogfood
  previewed six edits across three files, applied all three production patches,
  removed every old symbol use, and passed `tsc --noEmit`. The opt-in macOS
  Sandbox smoke remains unavailable from this nested IDE host alongside all
  four pre-existing LSP smoke cases, with no host fallback.
- Added sequence-accurate CLI Thread branching. `napier branch` accepts an
  exact existing source Ledger sequence, optional title, and human or complete
  ordered-JSONL output; its new Thread can immediately continue through
  `napier run --thread`. The branch Run links to the last source Run visible at
  the selected sequence rather than a newer Thread tail, copies only visible
  message events, records bounded `branch.created` lineage, and preserves
  imported provenance. Future or malformed boundaries and pre-aborted CLI
  requests create no branch. CLI and HTTP now share one Runtime domain service,
  removing inline Store orchestration from the oversized Server route.
  Runtime, CLI, Server, concurrency, imported-provenance, and built-subprocess
  tests cover the full path. This is durable message-history branching, not
  controlled model/tool re-execution or side-effect replay.
- Added `napier resume` for continuing a waiting Thread from a requested or
  latest interrupted Run. It reuses `AgentRuntime.resumeInterruptedRun`,
  creates a `source=recovery` child bound by `parentRunId`, and supports the
  same human/ordered-JSONL output, model override, timeout, cancellation,
  credentials, Run lease, and shutdown path as `napier run`. It accepts no new
  prompt and never silently replays unknown tool side effects. Resume-specific
  tests cover parsing, exact parent selection, human and JSONL output,
  non-waiting and missing parents, external cancellation, concurrent recovery
  contention, a real built subprocess, and an opt-in DeepSeek provider smoke.
  CLI option parsing was split from execution while run/resume now share one
  Runtime invocation adapter.
- Added a second fixed Coding outcome case for a multi-file pricing API
  migration. The Agent must inspect the API, run real TypeScript LSP
  References, update two independent call sites, and satisfy hash-bound hidden
  behavior assertions while changing exactly three allowed paths. The public
  `--case` CLI path, offline verifier, deterministic Agent integration, and an
  opt-in DeepSeek smoke cover the case end to end. Dogfooding also fixed
  repeated-tool metrics for generic tools by hashing their structured input
  when no specialized `inputSha256` projection exists, and serializes
  concurrent CLI JSONL events by Ledger sequence before emitting the terminal
  snapshot. Missing or duplicate sequences fail closed. The archived live
  DeepSeek Run remains explicitly inconclusive because this IDE host denied
  both LSP and outcome Sandbox launches; it is evidence of the attempted
  multi-file workflow, not a success claim.
- Added repeated Coding benchmark trials and a behavior-based outcome oracle.
  `--trials 2..10` executes independent sequential CLI Runs and emits a
  CAS-named series that binds every result/Ledger pair, rejects duplicate Runs
  or hash-derived filename drift, and reports completed, scored, passed,
  failed, and inconclusive counts plus latency, cost, token, tool, and
  repetition distributions. `--verify-series` bounds input sizes, confines
  references to the series directory, verifies every pair, and recomputes all
  aggregates. Case schema v2 runs hash-bound hidden assertions through the
  existing read-only, network-denied Node Sandbox; AST equality remains
  evidence rather than the sole success criterion. Sandbox startup denial is
  classified as `inconclusive`, produces no success rate when every trial is
  unscoreable, exits non-zero, and never falls back to host execution. Parent
  cancellation preserves the completed prefix without launching another
  trial. Existing v1 result/Ledger artifacts remain offline-verifiable.
- Added the first outcome-scored Coding benchmark. `npm run bench:coding`
  copies a hash-bound fixture into a temporary workspace, configures a fixed
  Agent revision, and drives the real one-shot CLI JSONL path. Success is
  determined from complete workspace snapshots, an exact changed-path
  allowlist, and a hidden whole-file TypeScript AST projection without
  executing generated code or trusting the assistant summary. CAS-named result
  and privacy-bounded Ledger artifacts retain model/version, cost, latency,
  tool failure/repetition metrics, source event/snapshot hashes, the
  `benchmark.evaluated` event, and receipts for non-delta events while omitting
  prompt, response, reasoning, tool bodies, paths, and credentials. Offline
  verification rejects malformed shapes, unknown-field injection, broken
  receipt chains, inconsistent bindings, and content drift. Case assets are
  hash-bound, path-confined, symlink-free, and size-limited; live providers
  require an explicit credential environment reference. An opt-in DeepSeek
  smoke and one checked-in successful sample exercise the real path, but do not
  claim success rate or superiority. Dogfooding also fixed OpenAI-compatible
  `apply_patch` function schema advertisement and made Pi
  `stopReason: error|aborted` messages settle fail-closed with redacted
  diagnostics instead of becoming successful assistant output.
- Added a one-shot `napier run` CLI with human output and line-delimited
  `StreamFrame` JSONL. It creates a Thread or verifies an explicit existing
  Thread, then delegates execution to the same `AgentRuntime`, model registry,
  policy, Sandbox, SQLite Ledger, and Run lease as Web/HTTP. Event frames are
  followed by a hash-bound final snapshot and terminal done frame; stdout
  backpressure, timeout, pre-aborted signals, SIGINT/SIGTERM, concurrent Run
  rejection, cleanup, and stable redacted error frames are covered. Server and
  CLI now share `createLocalAgentRuntime()` service initialization and Run
  stream frame construction, removing duplicated bootstrap and SSE hashing
  logic from the oversized Server module. A built subprocess smoke and an
  opt-in real DeepSeek JSONL smoke exercise the product entry point. Ambient
  provider keys remain unusable without an active credential reference in the
  selected data root. This slice does not claim an interactive TUI,
  resume/branch commands, RPC, ACP, or Desktop packaging.
- Added workspace-confined TypeScript/JavaScript reference discovery. The
  opt-in `lsp_references` Agent tool sends standard
  `textDocument/references` requests with explicit declaration inclusion
  through the existing read-only, offline, exact-version LSP Sandbox. It
  returns up to 64 canonical workspace locations with live-only paths, ranges,
  hashes, and bounded previews, while omitted or truncated results are
  explicitly incomplete. Durable model-call, Ledger, Replay, OTLP, and Trace
  projections retain only mode, counts, versions, latency, and stable
  source/reference/target-file/result hashes. Definition and references now
  share one position and Location confinement module; Web LSP projections moved
  out of the generic tool Trace module, reducing it from 1,516 to 1,249 lines.
  The shared catalog, policy, safe-recovery gate, Server SSE, fixed multi-file
  example, and opt-in OS-Sandbox smoke expose the same capability. This slice
  does not claim rename, Code Actions, persistent synchronization, complete
  external dependency navigation, or complete impact when results are omitted.
- Added workspace-confined TypeScript/JavaScript definition lookup. The opt-in
  `lsp_definition` Agent tool sends standard `textDocument/definition`
  requests through the existing exact-version, read-only, offline LSP Sandbox
  lifecycle and accepts bounded Location or LocationLink results. Every target
  URI is independently canonicalized; external, virtual, protected, missing,
  symlinked, oversized, and invalid UTF-8 targets are omitted. Relative paths,
  ranges, file hashes, and bounded previews remain live-only, while model-call,
  Ledger, Replay, and Trace projections retain counts, versions, latency, and
  stable set/result hashes. The shared Agent catalog, policy, Tool Loop Guard,
  Context, Server SSE, Web Trace, fixed cross-file example, and opt-in real
  OS-Sandbox smoke expose the same capability. This slice does not claim
  rename, Code Actions, persistent synchronization, or external dependency
  navigation.
- Added write-linked TypeScript diagnostics for `apply_patch`. When a frozen
  Agent revision enables both `apply_patch` and `lsp_diagnostics`, supported
  TypeScript and JavaScript files receive automatic pre-write and post-write
  language-server checks inside the existing read-only, offline Sandbox. The
  patch result reports clean, introduced, improved, unchanged, regressed,
  truncated, unavailable, or drifted compiler evidence with bounded severity
  and delta counts. Preflight failure or cancellation leaves the workspace
  unchanged; postflight failure never hides or reclassifies a committed write.
  Diagnostic identities ignore source movement, while target rehashing detects
  external edits during the LSP run. Patch model-call, input, output, and
  durable detail projections now retain hashes and counts without raw paths,
  patch text, compiler prose, or server errors.
- Added the first real LSP coding-intelligence slice. The opt-in
  `lsp_diagnostics` Agent tool drives `typescript-language-server` 5.3.0 and
  TypeScript 5.9.3 over standard framed JSON-RPC, with initialize, didOpen,
  diagnostics, shutdown, and exit lifecycles. Each invocation is confined to
  one workspace TypeScript or JavaScript file and launches through the existing
  read-only, offline OS Sandbox with separately bound language-server and
  TypeScript runtime assets. Source, paths, diagnostic messages, and server
  logs remain live-only; Ledger and Trace retain language, version, count,
  severity, latency, bounded protocol, runtime, file, diagnostic-set, and
  result hashes. Agent profiles, Context configuration, policy, Server SSE,
  Tool Loop Guard, and the Web Trace projection consume the same tool. The
  diagnostics operation remains one-shot and does not claim references,
  rename, Code Actions, or a persistent editor session.
- Added bounded input streams for explicitly interactive Workspace Process
  Sessions. Agent and operator paths can send serialized UTF-8 messages, append
  a newline, and close stdin while preserving the existing explicit-argv,
  read-only, offline Node Sandbox. Closed stdin remains the default. Each
  message is limited to 32 KiB, each session to 256 KiB and 64 input actions,
  and raw input remains live-only; the Ledger and Trace retain sequence,
  byte-count, cumulative digest, close state, and session binding. The
  Processes Workbench exposes send/close controls with stale-response guards,
  and the live macOS smoke proves state across two writes before normal
  settlement. This is a pipe protocol, not a PTY or persistent language
  kernel.
- Added preview-bound, reversible Workspace file lifecycle operations.
  `workspace_file_preview` and `workspace_file_apply` support bounded directory
  creation, move/rename, reversible trash, and restore without shell access,
  permanent deletion, destination overwrite requests, or cross-device copy
  fallback. Plans are one-use, expiring, Thread/Run-bound, revalidated under
  locks shared with `apply_patch`, and produce hash-only Ledger evidence. A
  lazy Files Workbench lists Thread-scoped local trash and offers explicit
  fail-closed restore. Protected path aliases, destination parent replacement,
  and late cross-Thread Workbench responses fail closed. `npm run
test:live-files` drives the complete Agent lifecycle against real temporary
  workspace bytes.
- Added bounded Workspace Process Sessions as an opt-in Agent capability.
  `workspace_process` starts, cursor-polls, and cancels background Node work
  through the same explicit-argv, read-only, offline OS Sandbox used by
  `run_command`. The manager enforces per-Thread admission, wall/output/chunk
  bounds, parent and operator cancellation, executable drift checks, graceful
  shutdown, and fail-closed restart reconciliation. Output remains ephemeral
  and available to the live Agent and a new lazy Processes Workbench; Ledger,
  Trace, Replay, and exports retain metadata and hashes only. A real macOS
  Agent-to-Sandbox smoke is available through `npm run test:live-process`.
  Snapshot-aware schema v2 sessions now compare the workspace before launch
  and after settlement, classify the execution window as unchanged, changed,
  or indeterminate, and expose at most 256 relative-path entries in the current
  local Runtime. Durable evidence retains only snapshot and path-set digests
  plus counts; paths disappear after restart, schema v1 sessions remain
  readable, and concurrent changes are not attributed to the read-only
  process.
- Added `run_command`, a foreground explicit-argv Node Agent tool
  that launches one absolute runtime directly through the existing macOS or
  Linux OS sandbox with read-only workspace and denied network capabilities.
  It uses a fixed secret-free environment, canonical workspace cwd, bounded
  wall time and stdout/stderr, process-group cancellation, and structured
  success/failure/timeout/output-cap outcomes. Model tool results retain bounded
  output, while Ledger and Trace redact argv and output text into call/result,
  executable, environment, cwd, limit, and stream hashes. Tool Loop Guard
  repetition detection remains stable over the redacted projection. Context
  exposes the capability as an opt-in Agent tool, a real macOS sandbox smoke is
  available through `npm run test:live-command`, and shared sandbox process
  lifetime handling now serves both command execution and
  `verify_workspace`. Python and Git remain outside the public runtime enum
  after live macOS testing showed their Developer Tools shims need a broader
  managed Runtime boundary.
- Hash-only Model Context Envelopes. Every Pi provider request now records a
  debug-only `context.model_envelope` receipt at the actual stream boundary,
  after message conversion and before the model call. The receipt binds System
  Prompt, provider-message set, tool-name set, and tool-definition set hashes
  plus role/count metadata without copying prompt text, messages, tool schemas,
  tool names, or tool outputs. Portable replay validates receipt hashes and
  per-Run turn-index continuity, and the Run replay snapshot verifier now uses
  the same fail-closed binding rules. Each `model.response` binds back to its
  request envelope hash, message-set hash, and tool-definition-set hash.
  Metadata-only OTLP exposes those bindings on the chat span with counts and
  SHA-256 values only. The lazy Trace Workbench now projects the same envelopes
  as a strict hash-only register, shows the bound response sequence/model/stop
  reason when the hashes match, and drops malformed or raw-field-injected
  payloads. Run replay metrics and Run Lab comparisons now count envelope
  coverage, bound responses, and unbound responses, then derive a
  `contextCoverageDelta` status so candidate Runs can be flagged as clean,
  partial, missing, or regressed without exposing raw context. The no-tool
  pairwise evaluator now receives the same governance metadata in a separate
  prompt section so rubric scoring can account for context coverage drift, and
  saved evaluation records bind that governance projection with a hash-only
  receipt consumed by suite, casebook, and consensus hashes. Casebook
  qualification replays the curated hash-only governance binding back into the
  no-tool evaluator instead of rehydrating raw context. Portable Thread replay
  bundle verification now also recomputes the governance binding hash. OTLP
  trace export surfaces evaluation governance only as status plus SHA-256
  attributes while continuing to drop evaluator reason/evidence text. Pairwise
  evaluator model calls now run inside a completed evaluation Run with their
  own `context.model_envelope` and redacted, envelope-bound `model.response`
  evidence, and replay validation requires every envelope to have exactly one
  bound response. Casebook qualification executions now allocate their own
  completed qualification Run, attach the hash-level completion event to it,
  and trace every real qualification evaluator call through the same
  turn-indexed envelope/response binding. Live Agent primary turns now share a
  Run-level envelope turn counter, so goal continuations and advisor
  corrections cannot restart at turn 0 inside the same Run. Context compaction,
  live goal-evaluator auxiliary calls, and memory extraction now also record
  hash-only envelopes plus redacted response bindings, while token/cost
  accounting remains on `context.compaction.*`, `goal.evaluated`, or
  `memory.extraction.*` to avoid double counting.
- Embedded reviewer envelopes now have first-class replay metrics. Run metrics
  expose `embeddedModelContextEnvelopeCount` separately from candidate
  `model.response` coverage, replay verification fail-closes on malformed
  embedded receipts, Run comparison headers export the delta, and Run Lab shows
  the same count without mixing auxiliary reviewer calls into primary response
  binding coverage.
- Thread replay bundle validation now fail-closes on malformed embedded
  `modelContextEnvelope` receipts before import, and verification classifies
  those failures as `context_mismatch` even when the forged bundle's top-level
  event/content hashes are internally consistent. The scan now walks the full
  bundle content tree, so future non-event artifacts with embedded envelope
  receipts inherit the same portable replay guard without adding one-off
  validators.
- Thread replay bundle verification now returns and headers-export both
  ledger-backed and embedded Model Context Envelope counts, and Run Lab fixture
  verification renders those counts beside the local replay diagnostics.
- Thread replay bundle exports now self-verify before download and expose the
  same plan/evaluation/envelope coverage counts in no-store headers, so the
  export boundary carries the same metadata-only replay receipt as the verify
  endpoint.
- Run replay snapshot verification now mirrors the same envelope coverage
  counters in its response body, no-store headers, and Run Lab replay verifier
  receipt, while embedded-envelope validation scans both ordered events and
  subagent evidence included in the snapshot.
- Run comparison governance now carries embedded envelope counts and deltas in
  `contextCoverageDelta`, giving pairwise evaluators visibility into auxiliary
  reviewer coverage drift without changing candidate `model.response`
  coverage-rate semantics.
- Imported Thread provenance now preserves the source replay bundle's
  ledger-backed and embedded Model Context Envelope counts, verifies the bundle
  before import, and reinjects those counts into the imported-ledger boundary
  plus Run Lab fixture card as metadata-only evidence.
- Run Lab fixture receipts now show the same event/run/plan/evaluation and
  ledger-backed/embedded envelope coverage after export, verify, and import, so
  operators do not have to run a separate preflight just to inspect portable
  replay coverage.
- Imported ThreadDetail responses now mirror source replay provenance in
  no-store headers: source Thread/API version, content and event-stream hashes,
  source event count, optional source envelope counts, and imported-at time.
- Branches created from imported Threads now retain the same source replay
  provenance, and the live imported-ledger boundary describes derived
  historical lineage rather than assuming current Thread sequence numbers match
  the original fixture.
- Imported provenance now separates source replay event count from the local
  imported-history cutoff sequence, preventing branch-local operator messages
  from being over-redacted as historical fixture data.
- Imported provenance observability now carries the same local cutoff into
  metadata-only OTLP root span attributes, and Run Lab renders source event
  count plus the local imported-history cutoff beside the fixture hashes.
- Persisted imported Thread provenance is now validated during SQLite state
  restore, including source hashes, optional envelope counts, and the local
  imported-history cutoff bound against the Thread event count.
- Replay imports now append a local `thread.imported` lifecycle receipt after
  the source fixture events. The receipt records only source IDs, SHA-256
  hashes, event/envelope counts, import time, and the local cutoff sequence, so
  the Work Ledger itself explains why imported history is untrusted without
  persisting the raw replay bundle again.
- SQLite restore now cross-checks any persisted `thread.imported` ledger
  receipt against `ThreadRecord.importProvenance`, failing closed on payload,
  timestamp, category, visibility, or cutoff drift while remaining compatible
  with older imported Threads that predate the ledger receipt.
- Metadata-only OTLP root spans now include the `thread.imported` receipt
  sequence and payload SHA-256 when that ledger receipt is present and aligned,
  giving trace consumers proof that imported lineage attributes are
  ledger-backed without exposing the replay bundle.
- OTLP span events now include a generic `napier.event.payload_sha256` receipt,
  and the trace verifier binds any exported import receipt back to the root
  `thread.imported` span event, failing closed on hidden or drifting receipt
  evidence even after the artifact hash is recomputed.
- OTLP span events and specialized model ledger spans now also carry
  `payload_projection_sha256`, a hash-only digest of the safe public attributes
  projected from the payload. The root event-anchor set covers that digest, so
  Advisor verification freshness metadata cannot be changed independently of
  the anchored Trace receipt.
- OTLP artifact verification now also binds top-level trace headers back to the
  root span, covering Thread ID, Run scope, event count, and event-stream
  SHA-256, so a recomputed artifact hash cannot hide root/header projection
  drift.
- OTLP artifact verification now reconstructs a metadata-only event-sequence
  projection from span events and specialized model spans, requiring the
  projected ledger sequences to match the artifact event range count and
  boundaries without duplicates.
- Specialized OTLP model spans now carry `napier.ledger.payload_sha256`, and
  verification binds their `napier.ledger.event_id` back to the deterministic
  model span ID plus completion-only chat semantics.
- OTLP root spans now expose `napier.event_anchor_set.sha256`, a hash-only set
  over projected event IDs, sequences, types, categories, visibility, and
  payload hashes. Verification recomputes it from span events and specialized
  ledger spans to catch self-consistent span-level drift.
- OTLP export and verification APIs now mirror that event-anchor-set hash in
  no-store headers and verification bodies, and `trace.otlp.exported` ledger
  receipts persist the same hash-only event-anchor evidence.
- Trace event summaries now project `trace.otlp.exported` receipts through a
  strict hash-only view that includes the event-anchor short hash without
  rendering any raw prompt, completion, or payload text.
- Malformed `trace.otlp.exported` receipts now fail closed to a fixed Trace
  summary instead of falling back to generic payload text fields.
- Trace event summaries now project `thread.imported` receipts through a
  bounded import provenance view that shows only source hashes, event counts,
  local cutoff, and envelope coverage counts.
- Trace event summaries now project `message.*` and `system.note` receipts
  through a bounded message view, so user prompts, assistant answers/reasoning,
  run-control text, and system note text stay out of the event list while role,
  model, token/cost counts, text byte counts, and optional hashes remain visible.
- Trace event summaries now project `agent.*` receipts through a bounded agent
  view, so milestone titles/summaries/open-loop text and Agent profile prose
  stay out of the event list while phase, counts, revision IDs, and hashes
  remain visible.
- Trace event summaries now project `schedule.*` and `channel.*` receipts
  through bounded automation views, so schedule/channel names, queued prompts,
  delivery errors, raw inbound body text, and arbitrary payload prose stay out
  of the event list while IDs, statuses, attempts, revisions, counts,
  fingerprints, and SHA-256 evidence remain visible.
- Trace event summaries now project `credential.*` and `extension.*` receipts
  through bounded governance views, so credential labels/errors, extension
  names/descriptions, capability labels, MCP tool names, rollout names, and
  package-change labels stay out of the event list while safe IDs, statuses,
  counts, booleans, and SHA-256 receipts remain visible.
- Trace event summaries now project `skill.*`, `prompt.*`, `inspector.*`,
  `receipt.*`, `receipt_trust.*`, and `branch.*` receipts through bounded
  governance views, so Skill names/paths, package publisher prose, prompt or
  inspector descriptions, receipt publishers/errors, and future branch prose
  stay out of the event list while lineage IDs, status/count metadata, booleans,
  and SHA-256 receipts remain visible.
- Trace Workbench now includes a summary-boundary coverage card and per-event
  source badges, classifying event-list summaries as bounded, fixed receipt,
  category-only, or generic fallback so new raw-payload fallbacks are visible
  during review instead of relying on code inspection alone.
- Run Lab comparisons now derive the same Trace summary-boundary coverage for
  baseline and candidate Runs, highlighting generic fallback deltas and the
  candidate event types still using generic summaries.
- Trace summary coverage and Run Lab coverage deltas now emit stable
  `contentSha256` receipts in the Web projection, so UI-visible privacy posture
  can be copied, compared, and regression-reviewed without raw event payloads.
- Trace summary coverage receipts now have fail-closed Web verifiers that reject
  malformed counts, status/delta drift, generic event-type drift, and
  `contentSha256` mismatches before treating the coverage evidence as valid.
- Trace Workbench and Run Lab now run those verifiers before presenting coverage
  receipt state, surfacing hash-only verification status and diagnostic codes
  next to the summary-boundary evidence.
- Trace summary-boundary classification is now shared through contracts and
  bound into runtime Run comparisons, HTTP no-store headers, and evaluator
  governance receipts so generic event-list fallback regressions can influence
  review without relying on Web-only projection state.
- Trace summary-boundary governance now appears in OTLP event attributes and
  the Run Lab evaluation hash strip as status plus SHA-256 evidence, closing the
  observability loop without exposing evaluation prose or raw event payloads.
- Thread Replay Bundle validation now recomputes pair-evaluation governance
  from the referenced left/right Run events, rejecting context coverage or trace
  summary-boundary receipt drift even when the governance `contentSha256` is
  recalculated.
- LocalStore save and SQLite restore now reuse the same pair-evaluation
  governance source-binding check, so persisted `comparisonGovernance` must
  match the referenced left/right Run ledger evidence before it can be accepted
  from either the live API path or `workspace_state`.
- Governed Run evaluations now also bind `leftSnapshotSha256` and
  `rightSnapshotSha256` back to the referenced local Run event streams during
  live save, SQLite restore, and Thread replay bundle validation. Imported
  historical evaluations keep their source bundle snapshot hashes and remain
  protected by import provenance instead of being rehashed after ID remapping.
- Ledger `evaluation.completed` events now fail closed unless their payload
  exactly matches the saved `RunEvaluationRecord`, keeping Trace projections,
  Thread replay bundles, and SQLite restore aligned with the authoritative
  evaluation state.
- Plan artifact Ledger events now share one runtime payload builder across the
  Agent tool and HTTP API, and validation rejects the latest `plan.artifact.*`
  event for an artifact when it drifts from the artifact manifest during
  SQLite restore, Thread replay bundle validation, or Plan archive verification.
- Plan artifact validation now separates artifact bindings from event-time
  scheduling projection metadata, so a normal flow can verify an artifact and
  then complete a step without making replay export fail closed, while path,
  evidence, digest, size, and source Run drift still fail closed.
- Plan artifact Ledger events now include runtime-generated `pathSha256` and
  `evidenceSha256` companions, and the bounded Trace summary renders those
  hashes instead of artifact paths or evidence prose.
- DeepSeek is now registered as a first-class live model provider via
  `DEEPSEEK_API_KEY`, with built-in price-table accounting for
  `deepseek-v4-flash`/compatible DeepSeek usage so cost gates do not fall back
  to provider-reported zero-cost runs.
- The Context credential form now suggests provider-specific labels,
  environment-variable names, and Keychain service names for OpenAI, DeepSeek,
  Anthropic, Google, and OpenRouter without overwriting custom locators.
- The Context runtime model selectors now group options by provider and show
  configured/total counts, making unavailable live providers visible before a
  Run is started.
- Evaluation Suite creation now uses the same provider-grouped evaluator model
  selector, and executable Casebook qualification filters that catalog to
  configured candidates before replaying gold-set evidence.
- The composer, resume, Run Lab evaluation, Evaluation Suite gate, and Plan
  Workbench model-review actions now consume the same model-availability
  projection, disabling model-call paths before an unconfigured provider can
  trigger a server request.
- Agent Profile saves now use that projection too, preventing an unconfigured
  live provider from being persisted as the revisioned default model.
- Trace Subagent outcome review now receives the active reviewer model's
  availability state and disables independent review before an unconfigured
  provider can trigger a review request.
- Agent Profile saves now also validate the Independent Advisor review model,
  requiring a configured live reviewer distinct from the primary runtime model.
- The Agent Profile API, rollback path, and runtime profile normalization now
  reject Advisor reviewers that are `napier/demo`, unknown, or equal to the
  effective primary model before persisting a revision.
- Server-side prompt, resume, model-call, and model-persistence entry points
  now reuse the configured-live model projection, rejecting unconfigured live
  providers before durable state is written or auxiliary model calls start.
- Run Evaluation creation and Evaluation Suite execution now re-check evaluator
  model availability so credential drift fails closed before evaluation
  receipts are generated.
- Due schedule execution now re-checks the effective model before creating a
  Run, settling credential drift as `schedule.failed` ledger evidence.
- Inbound delivery execution now re-checks the effective model before creating
  a Run, routing credential drift through retry or dead-letter evidence.
- Direct runtime prompt calls now fail known-but-unconfigured live providers
  with stable `run.failed` evidence before invoking the provider stream.
- Runtime, schedule, inbound delivery, and server model checks now share the
  same `ModelRegistry.resolveConfigured()` executable-model contract.
- Added an opt-in `npm run test:live-deepseek` smoke that creates a temporary
  credential locator and Run, calls DeepSeek only when explicitly enabled, and
  asserts model envelope, response, assistant-message, and completion Ledger
  evidence without persisting the raw key.
- `search_files` now returns complete-file and matched-line SHA-256 evidence so
  literal search results can feed `read_file` and Hashline edits directly.
- Trace tool summaries now surface `search_files` match counts and match-set
  hashes without exposing matched text or paths.
- Added a read-only `list_symbols` workspace tool for bounded directory-level
  TypeScript, JavaScript, Python, and Go symbol maps. It returns symbols to the
  Agent while Trace renders only file/symbol/skipped counts, line/byte counts,
  truncation state, and root/language/file-set/symbol-set hashes.
- Added a read-only `inspect_data` workspace tool for JSON, JSONL, CSV, TSV,
  and Markdown table files. It returns bounded schema/sample evidence to the
  Agent while Trace renders only format, row/column counts, truncation state,
  and path/file/column-set/sample hashes.
- `inspect_data` and Plan artifact data profiles now project JSON array rows as
  `column_1..N`, so matrix-style JSON outputs remain inspectable without
  storing raw columns or sample rows in Ledger receipts.
- `inspect_data` and Plan artifact data profiles now recognize JSON table
  envelopes with `columns` plus `rows` or `data`, projecting them as named
  columns while preserving hash-only receipt storage.
- `inspect_data` and Plan artifact data profiles now parse the first Markdown
  table in `.md` / `.markdown` artifacts through the same no-store sample and
  hash-only Ledger receipt boundary.
- Plan artifact data profiles can now be downloaded from Workbench as
  path-free JSON using artifact and sample SHA-256 evidence in the filename.
- Downloaded Plan artifact data profile JSON can now be uploaded back through
  Workbench for no-store verification against freshly recomputed workspace
  bytes and self-declared column/sample hashes.
- Data profile verification now appends a hash-only
  `artifact.data_profile_verified` Ledger receipt with status, diagnostic
  count/hash, declared/recomputed/observed profile hashes, and no raw columns,
  samples, or diagnostics.
- The data profile verifier response now mirrors the appended Ledger event
  ID/sequence/hash, and Workbench refreshes the active Thread after upload
  verification so the Trace immediately exposes the replayable receipt.
- `inspect_data` and Plan artifact data profiles now normalize duplicate or
  blank tabular headers into unique names such as `name_2` or `column_3`, so
  bounded samples do not silently overwrite earlier columns.
- `inspect_data` and Plan artifact data profiles now preserve rows wider than
  their declared header by completing the projected column set with `column_N`
  names before hashing sample evidence.
- Added a read-only `inspect_code` workspace tool for TypeScript, JavaScript,
  Python, and Go files. It returns bounded symbol outlines to the Agent while
  Trace renders only language, symbol/line/byte counts, truncation state, and
  path/file/symbol-set hashes.
- Added a read-only `read_symbol` workspace tool that expands a hash-anchored
  symbol line into a bounded source range with line anchors for follow-up
  Hashline edits. Trace renders only kind, range/count metadata, truncation
  state, and path/file/name/line/signature/range/anchor hashes.
- Added `apply_patch hashrange_replace`, allowing whole-symbol or other
  multi-line source replacement by `read_symbol` range SHA-256 while retaining
  complete-file preconditions, overlap checks, atomic writes, and hash-only
  Trace summaries.
- Runtime prompts now inject a concise `workspace_tool_protocol` whenever
  workspace tools are enabled, guiding Agents to inspect current evidence,
  prefer symbol/range hashes for code edits, use complete-file SHA-256
  preconditions, and re-run `verify_workspace` after relevant writes before
  claiming checks passed.
- Runtime prompts now also inject a concise `plan_tool_protocol` whenever Plan
  tools are enabled, guiding Agents to create focused durable plans, start and
  settle steps with evidence, verify planned artifacts through
  runtime-computed digests, and avoid claiming completion before required
  steps and artifacts are settled.
- `apply_patch create` can now explicitly opt in to creating missing
  workspace-relative parent directories for new artifact paths. The operation
  keeps protected-segment and symlink checks, records created-directory count
  and set hash evidence, and Workbench Trace renders only hash-only directory
  receipts.
- Trace tool summaries now surface `verify_workspace` kind/status, exit code,
  output hashes, and truncation flags without exposing verifier output or paths.
- `verify_workspace` results now include a hash-only scope receipt over cwd and
  target path hashes, verifier bytes, target snapshot, and a bounded cwd
  snapshot, so passing-check claims can be tied to the code state that was
  actually verified.
- Trace tool summaries now surface `apply_patch` operation, edit/byte counts,
  path hash, and before/after hashes without exposing path or patch text.
- Trace tool summaries now surface `list_files` and `read_file` hash receipts
  without exposing listed paths or file contents.
- Model Advisor evidence now treats only `verify_workspace` results with
  structured `passed` status as proof for passing-check claims.
- Model Advisor verification-claim suppression now also requires the passed
  verifier to be later than the latest workspace write, so code edits after a
  green check make the claim stale until the Agent verifies again.
- Model Advisor verification-claim suppression now also covers
  plan-complete, artifact-verified, and goal-complete claims, requiring current
  `plan.step.*`, `plan.artifact.verified`, or satisfied `goal.evaluated`
  Ledger evidence after the latest workspace write before the final answer can
  claim those states without a deterministic notice.
- Artifact-verified claim suppression now treats later non-verified artifact
  events as invalidation evidence. `plan.artifact.missing`, `produced`, or
  `superseded` after the latest verified receipt makes the claim stale until
  the artifact is verified again.
- Plan-complete claim suppression now also treats later non-completed Plan
  events as invalidation evidence, so artifact drift or reopened work makes the
  completion claim stale until the Plan reaches completed again.
- Goal-complete claim suppression now treats later unsatisfied `goal.evaluated`
  events as invalidation evidence, so a previous satisfied verdict cannot
  support completion claims after the evaluator reports remaining work.
- Recovery-complete claim suppression now requires fresh
  `run.recovery.completed` or `run.recovery.auto.completed` Ledger evidence
  after the latest interruption or recovery invalidation.
- Evaluation-complete and evaluation-pass claim suppression now distinguishes
  completed pairwise evaluations from passed suite or casebook qualification
  gates, and treats later workspace writes or failed/inconclusive gate evidence
  as stale.
- Trace Model Advisor summaries now expose verification current/stale metadata
  plus plan/artifact/goal/recovery/evaluation completion freshness and the
  latest evidence sequence numbers without rendering diagnostic prose or
  candidate text.
- Independent Model Advisor review receipts now persist the same metadata-only
  evidence summary, allowing the Trace review card to explain checks,
  plan/artifact, goal, recovery, and evaluation completion freshness without
  reopening prompt or candidate text.
- OTLP export now projects Advisor checks and completion freshness summaries as
  metadata-only event attributes, preserving candidate text, prompts, guidance,
  and diagnostic prose redaction.
- Plan Workbench now downloads produced or verified file artifacts through a
  workspace-confined no-store endpoint. The server rehashes bytes, rejects
  verified digest drift, records a hash-only `artifact.exported` Ledger event,
  renders that event through a bounded Trace summary, and saves attachments
  with safe artifact IDs plus content-hash prefixes. Workbench fallback
  filenames now use the same safe hash-addressed form when a browser response
  lacks a usable attachment name.
- Verified file artifact downloads can now be uploaded back through a no-store
  verifier. The server hashes the uploaded bytes, compares SHA-256 and byte
  count with the current verified Plan artifact digest, appends hash-only
  `artifact.file_verified` receipts, and Workbench renders the returned
  valid/drifted receipt beside the artifact card.
- Plan Workbench now previews small UTF-8 produced or verified file artifacts
  through the same workspace and digest boundary. Preview responses are
  no-store and hash-bound, while `artifact.previewed` Ledger events and Plan
  archives persist only content/text hashes, byte count, and line count.
- Plan Workbench now profiles produced or verified TSV, CSV, JSON, JSONL, and
  NDJSON file artifacts using the shared `inspect_data` parser. The no-store
  response shows columns and capped sample rows, while
  `artifact.data_profiled` Ledger receipts persist only format, counts,
  truncation state, content hash, column-set hash, and sample hash.
- Plan Workbench now previews produced or verified directory artifact manifests
  with artifact-relative entries and file hashes in the no-store response while
  recording only digest, byte, entry, file, and directory counts in
  `artifact.directory_manifested` Ledger receipts.
- Downloaded directory manifest JSON can now be uploaded back through Workbench
  for no-store verification; the resulting
  `artifact.directory_manifest_verified` receipt records only status, diagnostic
  count/hash, declared/recomputed/observed directory hashes, entry-set hashes,
  and aggregate counts.
- Plan Workbench now runs non-mutating drift checks for verified file and
  directory artifacts. The server observes workspace bytes, returns
  `current`/`drifted`/`missing`, and records a hash-only
  `artifact.drift_checked` event before the operator chooses Mark drifted.
- Drift check result cards now offer the next safe recovery action inline:
  `current` results can recheck bytes, while `drifted` and `missing` results
  can mark the artifact drifted without leaving the evidence card.
- Replan signals now show an inline draft-change summary before Apply:
  superseded steps/artifacts, added steps/artifacts, dependency rewrites, and
  the expected Plan revision are visible without opening model review.
- Latest replan ledger cards now show the applied structural changes and
  replan component hashes, so operators can inspect what changed after Apply
  without reopening the archived Plan event.
- Plan Workbench now renders a compact applied replan history when a Plan has
  multiple recovery cycles, showing each revision span, strategy, structural
  change count, and replan hash without reason or evidence prose.
- Step and artifact cards now show latest-replan impact badges for added,
  superseded, and dependency-updated entities so operators can continue after
  recovery without manually matching IDs from the replan summary.
- Latest replan cards now include recovery progress for replacement work,
  counting settled added steps and verified added artifacts from current Plan
  state without introducing a second recovery status source.
- When that recovery progress has the active ready step, the card now offers
  `Run recovery step` inline while still using the existing Plan continue path.
- The same recovery progress card now explains the next bounded action for
  complete, running, blocked, produced, expected, waiting, and runnable recovery
  states without creating another recovery status source.
- Thread replay bundles and Run replay snapshots now enforce that
  `artifact.exported`, `artifact.previewed`,
  `artifact.file_verified`, `artifact.data_profiled`,
  `artifact.data_profile_verified`, `artifact.directory_manifested`,
  `artifact.directory_manifest_verified`, and `artifact.drift_checked` receipts
  remain hash-only, so recomputed portable replay hashes cannot hide raw
  artifact paths, directory entries, preview text, uploaded file contents,
  columns, sample rows, or data/manifest verification diagnostics in exported
  evidence.
- SQLite restore now applies the same hash-only artifact receipt boundary to
  persisted Thread events, rejecting locally modified ledger rows that smuggle
  raw preview text back into startup state.
- LocalStore append now applies that artifact receipt boundary before mutating
  Thread projections or committing events, preventing malformed preview/export
  receipts from entering the Work Ledger in the first place.
- Thread replay bundle validation now recomputes Independent Advisor
  `evidenceSummary` from predecessor Run events, so a forged current/stale
  summary fails even if review and bundle hashes are recalculated.
- Run replay snapshot validation now applies the same Independent Advisor
  `evidenceSummary` binding, so single-Run archives cannot forge verification
  freshness after recalculating review, event-stream, and snapshot hashes.
- The Plan Workbench now exposes artifact manifest actions for Mark produced,
  Verify bytes, Recheck bytes, Mark drifted, and Mark missing. Verify/Recheck
  bytes calls the existing
  `observeWorkspace` path so the server computes the digest and size before
  appending `plan.artifact.*` evidence.
- Verified Plan artifacts can now be rechecked from the Workbench or Agent tool:
  matching workspace bytes append a fresh `plan.artifact.verified` receipt,
  while digest drift first fails closed and then Mark drifted can append
  server-confirmed `plan.artifact.missing` evidence, mark the Plan blocked, and
  surface the existing `artifact_drift` recovery recommendation.
- Verified Plan artifact cards now show the server-computed byte count beside
  the digest while retaining the full SHA-256 as hoverable audit context.
- Trace event summaries now project `model.response` receipts through a
  metadata/hash-only view, so raw assistant text, reasoning, tool arguments,
  and malformed payload text cannot leak through the event-list fallback.
- Trace event summaries now project non-response `model.*` receipts through a
  bounded model view, so hidden text/thinking deltas and future model payload
  text stay out of the event list while byte counts, redaction flags, tool-loop
  counters, and hashes remain auditable.
- Trace event summaries now project `tool.*` receipts through a bounded
  metadata view, so raw tool input, output, details, policy prose, and malformed
  text fields cannot leak through the event-list fallback.
- Trace event summaries now project `goal.*` and `memory.*` receipts through
  bounded governance views, so goal objectives, evaluation reason/evidence,
  memory content, and extraction error text stay out of the event list.
- Trace event summaries now project `operator.decision.*` and `run.control.*`
  receipts through bounded control views, so decision questions/options,
  custom answers, and live control text stay out of the event list.
- Trace event summaries now project non-control `run.*` receipts through a
  bounded run view, so failure messages, recovery prompts, interruption
  reasons, and automatic recovery errors stay out of the event list while run
  status, source/mode, budget numbers, safe IDs, and hashes remain visible.
- Trace event summaries now project `subagent.*` receipts through a bounded
  delegation view, so subagent prompts, step text, tool arguments, final
  results, diagnostics, and errors stay out of the event list.
- Trace event summaries now project `model.advisor.*` receipts through a
  bounded advisor view, so deterministic diagnostics, independent reviewer
  guidance, correction prompts, and correction responses stay out of the event
  list while verdict/status, counts, and hashes remain auditable.
- Trace event summaries now project known `context.*` receipts through a
  bounded context view, so compaction summaries, failure messages, prompt
  variable names/values, and Skill catalog names stay out of the event list
  while counts, sequence ranges, and SHA-256 receipts remain visible.
- Trace event summaries now project `evaluation.*` receipts through a bounded
  evaluation view, so evaluator reasons/evidence, rubric names, reviewer notes,
  casebook names/descriptions, and suite names stay out of the event list while
  verdicts, statuses, counts, rates, safe IDs, and hashes remain auditable.
- Trace event summaries now project `plan.*` receipts through a bounded plan
  view, so plan objectives, step titles, step/artifact evidence, blockers, and
  artifact paths stay out of the event list while plan status, phase counts,
  safe IDs, revision counters, and SHA-256 receipts remain visible.
- Import provenance fields that appear on the OTLP root span are now mirrored
  through the `thread.imported` span event's safe payload projection and
  verified field-by-field, so source IDs, source hashes, cutoff sequence,
  envelope counts, and import time cannot drift independently from the receipt.
- ThreadDetail no-store responses now mirror the same aligned
  `thread.imported` receipt sequence and payload SHA-256 in
  `X-Napier-Import-Receipt-*` headers, keeping API clients and OTLP consumers
  on the same hash-only provenance contract.
- Run Lab now surfaces the aligned import receipt sequence and payload hash on
  imported Thread fixture cards, using the no-store ThreadDetail header
  projection instead of recomputing or exposing replay content in the browser.
- Portable Thread replay validation now cross-checks `thread.importProvenance`
  and any `thread.imported` receipt inside exported fixtures, failing closed on
  unknown provenance fields or receipt/projection drift even when the bundle's
  top-level content and event-stream hashes are self-consistent.
- Deer Workflow-style Plan phase projection. Execution Plans now derive
  deterministic `phaseWaves`, `activePhaseIndex`, `parallelReadyStepIds`, and a
  `phaseProjectionSha256` from the existing step DAG on every mutation. Agent
  plan-tool results, `plan.*` Ledger events, Plan REST headers, archive
  validation, Blueprint outcome projections, and the lazy Plan Workbench all
  expose the same ID/status-only phase evidence without copying objective,
  evidence, blocker, or artifact-path text.
- Durable Tool Loop Guard. Agent profiles now carry an enabled/threshold/exempt
  policy that is normalized into immutable revisions and schema-8 Run
  fingerprints. The runtime detects consecutive single-tool turns only when
  canonical argument and terminal-result hashes are both identical, records a
  hash-only `model.tool_loop.detected` receipt, and injects a
  compaction-resistant redirect into the next Pi turn. Repeating the same call
  again writes a hash-only `tool.blocked` receipt and returns guidance before
  another side effect executes. Portable replay recomputes context and trigger
  evidence from the exact Agent revision, metadata-only OTLP excludes arguments
  and results, and lazy Context/Trace registers configure and inspect the guard.
- Frozen Prompt Variables. Agent profiles can define strict `literal`,
  `current_date`, and `skill_catalog` values for single-pass, non-recursive
  System Prompt rendering. Every Run freezes catalog, value, unresolved-name
  set, and rendered Prompt SHA-256 evidence without copying values into the
  Ledger. Schema-7 fingerprints, portable replay, metadata-only OTLP, Skill
  catalog de-duplication, and a lazy typed Context editor complete the
  reproducible prompt boundary; schema 8 retains all schema-7 bindings.
- Independent Model Advisor. Agent profiles can now bind an optional review
  model that must differ from the primary model. Every final candidate is
  reviewed through a zero-tool strict-JSON call using the current turn prompt
  and metadata-only Run evidence. Durable receipts retain verdict, score, risk,
  typed issue codes, usage, model identities, and candidate/prompt/evidence/
  response/issue-set SHA-256 values plus the live request's hash-only
  model-context envelope, without copying candidate text or free-form reviewer
  guidance into the review receipt. Observe mode records the second opinion;
  enforce mode combines non-accept reviews with deterministic blockers in the
  existing bounded tool-free correction state machine. Trace now renders the
  Advisor request envelope hash beside the review receipt hash, and OTLP exports
  that envelope hash as metadata-only telemetry. Reviewer usage now
  participates in live budget enforcement and final Run settlement. Schema-6
  Run fingerprints bind the review model while schemas 1-5 remain verifiable;
  portable replay rejects malformed review receipts, metadata-only OTLP exposes
  only safe review metadata, and the lazy Trace panel renders an independent
  review register without increasing the main-entry dependency surface.
- Durable Agent Milestones. Standard live Runs now expose the non-terminating
  `record_run_milestone` tool for immutable planning, execution, verification,
  and delivery snapshots with bounded completed items and open loops. The Store
  requires the active Thread Run, enforces 32-per-Run and 128-per-Thread limits,
  predecessor-links each snapshot, and automatically binds the actual same-Run
  Ledger range since the previous milestone into event count and event-stream
  SHA-256 evidence. Pi rebuilds and reinjects the newest bounded projection on
  the next turn without adding conversation messages; milestones inside an
  imported source range receive hash-only context so external prose cannot
  become system instructions, while later local milestones regain bounded
  text. Portable replay rejects malformed milestone chains and recomputes
  evidence/content hashes after identity remapping. A no-store read-only
  management endpoint and lazy Paper Ledger Trace register expose the local
  projection, while metadata-only OTLP omits title, summary, completed, and
  open-loop text. The generated management OpenAPI and additive compatibility
  baseline now contain 229 operations.
- Durable Operator Decision gates. Live Agents can now invoke the terminating
  `request_operator_decision` tool as the only call in a turn, durably commit a
  bounded 2-4 option question, complete the origin Run into a waiting Thread,
  and stop without another provider request. Answer and Continue are separate
  append-only transitions, so an answered gate survives process failure before
  explicit continuation creates a child Run with the origin model, Agent
  revision, and `parentRunId`. Store authorization prevents ordinary Prompts
  from bypassing an open gate; pending/answered gates can also be cancelled,
  and terminal Run outcomes settle unpreserved requests. Strict no-store
  list/answer/cancel management APIs, hash-verified continuation SSE, a lazy
  accessible Paper Ledger decision docket, portable Run-ID remapping, and
  metadata-only OTLP privacy coverage complete the runtime-to-Workbench flow.
  The generated management OpenAPI and additive compatibility baseline now
  contain 228 operations.
- Persistent Workflow Blueprint Library. Verified
  `napier.execution-plan-blueprint` artifacts can now be saved as
  `ExecutionPlanBlueprintRecord` entries, listed with no-store active/archived
  count and set-hash headers, archived/restored, and replayed into a new Plan
  through `POST /api/threads/:threadId/plans/from-blueprint-record`. Store,
  server, and Web API coverage prove deduplication by blueprint SHA-256,
  hash-only Ledger events, and normal Plan creation gates for saved records.
  The Plan Workbench now exposes a Template shelf for saving the current
  verified blueprint, browsing active/archived records, archive/restore
  actions, source qualification, and create-from-template replay inside the
  lazy Plan chunk. `GET /api/plan-blueprints/:recordId/qualification` now
  verifies saved-template usability without mutation, distinguishing
  `qualified`, `archived`, `source_missing`, `source_drift`, and `invalid`
  states while exposing expected/actual source hashes only. Creating a Plan
  from a saved template now fails closed unless the final Store-side
  qualification is `qualified`, and the `plan.created` event carries only the
  qualification status plus report/diagnostic hashes. `POST
/api/threads/:threadId/plans/from-blueprint-record/preview` now returns a
  no-store Plan projection plus qualification state before mutation, and the
  Workbench Template shelf exposes that preview receipt beside Qualify/Create.
  Preview responses include a stable `previewSha256` over Plan shape and
  hash-only evidence; create requests may provide `expectedPreviewSha256`, and
  stale or mismatched previews fail closed with the current preview report. The
  Store now commits create-from-template Plan state and the `plan.created`
  replay evidence event in a single Ledger revision, preventing Plan/history
  divergence after partial failures. Successful create responses now mirror the
  atomic replay event id, seq, and SHA-256 headers for immediate machine
  verification, and `POST
  /api/plan-blueprints/:recordId/replays/events/verify` can validate that
  single event anchor without returning the raw Ledger event payload. The
  Workbench Template shelf now consumes those headers after template replay,
  verifies the single event anchor, and renders the verification status in the
  creation receipt along with the verifier receipt hash. Missing, malformed, or
  unverifiable replay event anchors are now rendered as invalid receipt
  diagnostics rather than silently appearing as ordinary Plan creation. The
  qualification/preview/create/history/history-verification receipt projections
  are now isolated in pure Web ViewModel mappings with contract tests for
  source-drift, ready/blocked preview, valid, missing-anchor, verifier-failure,
  latest-replay, empty-history, and observed-count paths.
  The Web API client now preserves hash-verified non-error JSON payloads on
  `NapierApiError`, so the Workbench can render a returned 409 preview report
  instead of collapsing it into a generic error string.
  `GET /api/plan-blueprints/:recordId/replays` now derives a hash-only
  `napier.execution-plan-blueprint-replay-history` receipt from Ledger
  `plan.created` events, including replay/thread/plan counts, event-set hash,
  objective hash, qualification hashes, and latest preview hash. The Template
  shelf exposes this as an on-demand History action without storing additional
  replay state. `POST /api/plan-blueprints/:recordId/replays/verify` now
  verifies uploaded replay-history receipts against the current Ledger-derived
  projection with declared/recomputed/observed hashes and low-cardinality
  diagnostics. The Template shelf now downloads replay-history JSON artifacts
  as
  `napier-blueprint-replay-history-<safe-record-id>-<content-hash>.json` and
  can upload them back for no-store verification.
- Blueprint replay outcome artifacts. `GET
/api/plan-blueprints/:recordId/replays/outcomes` now joins immutable
  `plan.created` replay anchors to current durable Plan projections and emits a
  stable `napier.execution-plan-blueprint-replay-outcomes` receipt with
  active/completed/blocked/cancelled/invalid counts, completion basis points,
  per-replay outcome hashes, replay-history hash, and outcome-set hash. The
  report binds hashed step/artifact evidence projections while omitting
  objective, path, blocker, and evidence prose. `POST
/api/plan-blueprints/:recordId/replays/outcomes/verify` performs bounded
  strict no-store verification against the current Ledger and Plan state, so
  stale delivery receipts fail closed after an outcome changes. The Template
  shelf now exports outcome JSON separately from replay history as
  `napier-blueprint-replay-outcomes-<safe-record-id>-<content-hash>.json`, then
  uploads it back with pure ViewModel receipts and contract tests for
  latest-outcome and observed-count behavior.
- Blueprint outcome baselines. `POST
/api/plan-blueprints/:recordId/replays/outcomes/baselines` now promotes the
  current verified outcomes receipt into an append-only hash-only baseline with
  replay/outcome hashes, aggregate counts, a policy threshold set, and an
  explicit supersession chain. Promotion fails closed unless the uploaded
  artifact matches the current Store projection and satisfies the policy,
  which defaults to 100% completed, zero blocked, and zero invalid replays.
  `GET /api/plan-blueprints/:recordId/replays/outcomes/qualification` now
  recomputes current outcomes against the latest baseline and returns
  `qualified`, `missing_baseline`, or `policy_failed` with current/baseline
  hashes and low-cardinality diagnostics. The Template shelf can promote and
  qualify outcome baselines, and Web ViewModel tests cover both receipt types.
- Adaptive blueprint template selection. `POST
/api/threads/:threadId/plan-blueprints/selection` now recomputes source
  qualification, outcome-baseline qualification, and target-Thread preview
  readiness for every saved template, then returns a no-store
  `napier.execution-plan-blueprint-selection` receipt. The deterministic rank
  favors completion basis points, replay evidence volume, baseline recency, and
  record freshness, while exposing only record IDs, preview hashes,
  baseline/outcome hashes, low-cardinality diagnostics, and a selection-set
  SHA-256. The Template shelf adds a Select best action with a pure ViewModel
  receipt so blocked or unqualified libraries fail visibly.
- Blueprint outcome model review. `POST
/api/plan-blueprints/:recordId/replays/outcomes/review` now returns a no-store
  `napier.execution-plan-blueprint-outcome-review` artifact that scores current
  replay outcomes against reusable delivery criteria with an explicit evaluator
  model. The review binds verdict, score, risk, criteria scores,
  input/prompt/response/schema hashes, current outcome hashes, and baseline
  hashes, plus the live request's hash-only model-context envelope, while
  keeping objective text, artifact paths, blockers, and evidence prose out of
  the artifact. `napier/demo` fails closed as inconclusive, and the Template
  shelf exposes Review outcomes through a ViewModel receipt that includes the
  review request envelope hash.
- Reviewed blueprint outcome baseline promotion. Outcome baseline promotion can
  now carry a current outcome review artifact plus an optional score/risk gate.
  The Store rehashes the review, verifies it against current replay outcomes,
  source qualification, and outcome qualification status, and only appends the
  superseding baseline when verdict, score, and risk pass. Server responses
  mirror review gate, review hashes, verdict, score, risk, and model headers,
  while the Template shelf exposes a separate Promote reviewed action and
  receipt so model-reviewed baselines remain distinguishable from plain policy
  baselines.
- Blueprint portfolio calibration. `GET
/api/plan-blueprints/portfolio/calibration` now returns a no-store
  `napier.execution-plan-blueprint-portfolio-calibration` receipt over the
  whole Template shelf. The Store groups saved templates by hashed workflow
  shape, aggregates qualification status, reviewed baseline coverage, replay
  outcomes, and top record IDs, and exposes only family hashes, counts, and a
  portfolio-set SHA-256. Server headers mirror the calibration counters, and
  the Template shelf adds a Calibrate action backed by pure ViewModel receipt
  tests.
- Portfolio-aware blueprint selection. Adaptive template selection now binds
  the current portfolio-set SHA-256 into
  `napier.execution-plan-blueprint-selection`, projects each candidate's
  workflow-family hash and family aggregate evidence, and uses family
  completion, reviewed-baseline coverage, and outcome-qualified family count as
  deterministic tie-breakers before replay volume and record freshness. Server
  headers and Template shelf receipts expose the selected family hash without
  leaking objective, step, artifact, blocker, or evidence prose.
- Blueprint recommendation policy templates. `POST
/api/threads/:threadId/plan-blueprints/selection` now accepts `policyTemplate`
  as `balanced`, `delivery_first`, or `portfolio_first`. Selection keeps source
  qualification as a fail-closed gate, then hashes the chosen policy and uses
  its weights for outcome completion, portfolio-family completion,
  reviewed-baseline coverage, and replay-evidence recommendation scores.
  Server headers and Template shelf receipts now expose the policy template,
  policy SHA-256, candidate recommendation score, and selected recommendation
  score without copying objective prose into the artifact.
- Blueprint recommendation policy backtesting. `GET
/api/plan-blueprints/portfolio/recommendation-policy-backtest` now compares
  `balanced`, `delivery_first`, and `portfolio_first` against the current
  Template shelf's historical replay outcomes without target-Thread preview or
  Ledger mutation. The no-store receipt binds the policy-set SHA-256,
  portfolio-set SHA-256, divergent selection count, per-policy selected
  record/family IDs, average recommendation score, and hash-only candidate
  evidence. Server headers mirror the receipt hashes and counts, and the
  Template shelf adds a Backtest policies action with a pure ViewModel receipt.
- Per-family blueprint recommendation policy overrides. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides` now persists a
  hash-only override for a workflow-family SHA-256 and policy template, guarded
  by optional `expectedPortfolioSetSha256` CAS so stale backtest/calibration
  evidence fails closed with 409. Default selection applies policy precedence
  as explicit request, family override, then `balanced`, and selection
  receipts/headers now expose override-set SHA-256, selected policy source, and
  family override hash. The Template shelf can apply the top backtested policy
  as a family override through a pure ViewModel receipt.
- Blueprint recommendation policy override drift review. `GET
/api/plan-blueprints/portfolio/recommendation-policy-overrides/drift-review`
  now emits a no-store hash-only receipt that compares each persisted family
  override against current portfolio/backtest evidence. It returns keep/retire
  recommendations, aligned/retire/missing-family counts, review-set SHA-256,
  override/best policy hashes, selected record IDs, and low-cardinality
  diagnostics. Server headers mirror the drift counters and hashes, and the
  Template shelf adds a Review override drift action backed by pure ViewModel
  receipt tests.
- Blueprint recommendation policy override retirement. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retire` now
  removes a stale family override only when the request supplies matching
  family, override, override-set, drift review-set, and portfolio-set SHA-256
  evidence from a fresh drift review. Aligned overrides and stale evidence fail
  closed with 409. The retirement receipt exposes the retired override/policy
  hashes, drift review-set SHA-256, and remaining override-set SHA-256, and the
  Template shelf can retire the highlighted drifted override from the
  ViewModel-projected receipt.
- Blueprint recommendation policy override retirement history. `GET
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements`
  now returns an append-only no-store history receipt for removed family
  overrides. The receipt binds current override-set SHA-256, retirement-set
  SHA-256, latest retirement timestamp, and the persisted retirement receipts,
  so retired defaults remain auditable after the live override set changes.
  Server headers mirror the history counters/hashes, and the Template shelf can
  audit retirement history through a pure ViewModel receipt.
- Blueprint recommendation policy override retirement history verification.
  `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/verify`
  now accepts an exported retirement history and returns a no-store verification
  receipt with declared/recomputed/observed content, portfolio-set,
  current-override-set, and retirement-set hashes. The runtime validates every
  embedded retirement receipt, distinguishes tampered files from stale durable
  state, mirrors verification evidence in response headers, and the Template
  shelf now downloads retirement history JSON and uploads it back through a pure
  ViewModel receipt.
- Cross-Ledger policy override retirement proof bundles. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/verify`
  now accepts multiple exported retirement histories, validates each
  self-contained, and returns a no-store proof-bundle receipt with
  aligned/divergent/invalid status, valid/invalid counts, distinct
  portfolio/current-override/retirement-set counts, and bundle-set hashes.
  Response headers mirror the proof counters and hashes, while the Template
  shelf can upload multiple retirement history JSON files at once through a
  pure ViewModel receipt.
- Signed policy override retirement proof bundles. `POST
/api/plan-blueprints/portfolio/recommendation-policy-overrides/retirements/proof-bundle/sign`
  now recomputes uploaded retirement histories, refuses invalid bundles, and
  signs aligned or divergent proof-bundle receipts with existing Ed25519
  receipt trust anchors. The trusted envelope binds the proof-bundle content
  hash, receipt artifact hash, signer key id, and signature statement hash,
  appends a hash-only `receipt.signed` Ledger event, and can be verified through
  the generic receipt trust endpoint. The Template shelf adds **Sign bundle**,
  refreshes signing-capable anchors before signing, downloads the signed JSON
  envelope, and renders envelope/source proof hashes through a pure ViewModel
  receipt.
- Public receipt trust anchor directories. `GET
/api/receipt-trust/anchors/directory` now exports a stable
  `napier.receipt-trust-anchor-directory` containing public verifier labels,
  key IDs, SPKI public keys, trust/revocation state, per-anchor hashes, and an
  anchor-set SHA-256 without signing-source locators. `POST
  /api/receipt-trust/anchors/directory/verify` validates uploaded directories
  without Ledger mutation, and `POST /api/receipt-trust/verify` can verify a
  signed envelope against an uploaded directory instead of local workspace
  anchors. The Receipt trust desk can download and verify directory JSON files
  for cross-Ledger signed policy-retirement proof audits.
- Receipt trust anchor directory freshness and rotation policies. Directory
  verification requests can now include `maxAgeMs`,
  `expectedAnchorSetSha256`, `minimumTrustedCount`, and
  `requiredTrustedKeyIds`; policy violations make the uploaded directory
  verification `invalid` with policy hash, directory age, and bounded
  diagnostics. `POST /api/receipt-trust/verify` accepts the same
  `directoryPolicy` and fails closed before signature trust evaluation when an
  external directory is stale, from an unexpected anchor set, under-populated,
  or missing a required trusted signer. Server headers and the Receipt trust
  desk expose directory verification hash, policy hash, and directory age so
  cross-Ledger signed policy-retirement proof audits can bind trust freshness
  to receipt validation.
- Allowlisted hosted receipt trust directory discovery. `POST
/api/receipt-trust/anchors/directory/discover` now retrieves a public
  directory from an exact HTTPS origin configured through
  `NAPIER_RECEIPT_TRUST_DIRECTORY_ORIGINS`, with public-endpoint validation,
  manual redirects, an eight-second timeout, a 2 MiB streaming limit, strict
  JSON media type, and exact HTTP 200 requirement. The no-store
  `napier.receipt-trust-anchor-directory-discovery` receipt binds URL/origin
  hashes, raw response hash/size, policy verification, and the accepted public
  directory without returning the URL or mutating Ledger state. The Receipt
  trust desk can discover a directory with a 24-hour/minimum-trusted-key policy
  plus optional anchor-set pin and use it for subsequent signed JSON
  verification.
- Durable receipt trust directory subscriptions. Hosted verifier sources can
  now be promoted only after a valid bounded discovery, with their raw URL
  retained exclusively in the local workspace snapshot and URL/origin hashes
  used in public projections and Ledger events. Each subscription carries a
  policy hash, refresh interval, next refresh time, revision, and last-good
  discovery. Expiring Store claims drive production background refreshes;
  immediate refresh and pause/resume APIs use revision CAS. Valid rotations
  atomically promote the new directory, while invalid, failed, concurrent, or
  stale refreshes preserve the prior last-good trust set and record bounded
  rejection/failure evidence. Subscriptions now retain a bounded hash-only
  transparency chain of accepted observations; returning to a previously seen
  non-current directory is rejected as `rollback_rejected` without replacing
  last-good trust. Server headers, Ledger events, and the Receipt trust desk
  expose transparency entry count and tail hash for audit binding.
- Receipt trust directory subscription quorum receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum` now evaluates
  active last-good subscriptions without mutation. The default 2-of-2 policy
  now also requires two distinct source origins, groups sources by anchor-set
  SHA-256, and returns a stable no-store receipt with
  source/candidate/agreement counts, agreement weight, distinct-origin count,
  policy hash, diagnostics, selected directory hash, selected anchor-set hash,
  metadata publisher count/set hash, and hash-only source evidence. Policies
  can now pin required source-origin hashes, assign bounded per-origin weights,
  require metadata publisher counts, and pin required metadata publisher hashes
  from signed directory metadata envelopes supplied with the no-store quorum
  request. The Receipt trust desk exposes a quorum action and renders agreement
  status next to durable directory subscriptions.
- Receipt trust directory quorum promotion receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion` now
  evaluates the same no-store quorum request, requires an `agreed` result, and
  returns a self-contained promotion receipt containing the quorum, selected
  subscription-set hash, selected anchor-set/directory hashes, and selected
  signed metadata envelopes whose hashes match trusted source metadata evidence.
- Signed receipt trust directory quorum promotion baselines. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines`
  now promotes an agreed verifier-key quorum into append-only local trust state
  by signing the recomputed promotion receipt as
  `receipt_trust_anchor_directory_quorum_promotion`. Baseline idempotency binds
  the selected verifier set and signer key rather than one-time metadata
  verification timestamps, while headers expose baseline, envelope, receipt,
  selected set, and signer hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/verify`
  verifies uploaded baselines against local or uploaded public trust
  directories and returns a no-store verification receipt with status,
  diagnostics, selected-set hashes, and trust-directory evidence. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/import`
  now CAS-imports verified archives into local append-only trust state when
  `expectedCurrentBaselineSha256` matches the current latest baseline hash.
  Import requests can include an optional `importPolicy`; accepted imports now
  return a hash-bound `policyReview`, expose policy/review SHA-256 headers, and
  reject activation before persistence when local freshness, quorum strength,
  source-origin, publisher, signer, anchor-set, or directory pins are not
  satisfied. The Web Receipt Trust Desk now includes a baseline activation
  workbench that lists the latest signed quorum baseline, compares selected
  source origins against active last-good directory subscriptions, verifies the
  baseline against local or active external trust anchors, and imports uploaded
  archives with a derived policy while surfacing verification and policy-review
  hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decision`
  now signs the recomputed baseline verification, policy review, and
  source-alignment projection as a
  `receipt_trust_anchor_directory_quorum_activation_decision` trusted receipt,
  returning a portable approved/rejected envelope and hash-only Ledger event.
  Signed activation decisions are now persisted as bounded local records keyed
  by envelope hash. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions`
  exports a stable activation-decision history with aggregate set hashes and
  signed records, while `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-decisions/verify`
  verifies uploaded histories against the current local projection with
  `valid`, `divergent`, and `invalid` diagnostics. The Receipt Trust Desk can
  export the durable history and verify uploaded history JSON from the
  activation workbench. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection`
  now exports the active verifier-set selection state, and `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/apply`
  CAS-applies an approved activation-decision record into that active
  selection. The selection binds the public selected directory, baseline hash,
  decision record hash, and previous selection hash without importing private
  signing material; stale selection hashes fail closed and duplicate applies
  are idempotent. The Web workbench adds **Apply activation** and renders the
  active verifier selection receipt. `POST /api/receipt-trust/verify` now uses
  the active selection directory as the default verifier-key source when the
  request does not upload an explicit directory, while uploaded directories
  retain precedence. Verification responses and headers disclose whether the
  trust source was `active_selection` or `uploaded`, plus active selection
  ID/hash evidence when applicable; the Web verifier receipt renders that
  source beside the signature result.
- Active verifier selection drift audits and rotation reviews. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/drift-audit`
  now compares the applied verifier-set selection with the current subscription
  quorum without mutation, returning `missing_selection`, `aligned`,
  `directory_drift`, `anchor_set_drift`, or `quorum_unavailable` plus
  hash-only selection/quorum evidence. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review`
  preflights a candidate activation-decision record against the current
  selection CAS hash and live source alignment, returning `eligible`,
  `already_active`, `blocked`, `stale_selection`, or `missing_decision` before
  the existing apply endpoint can mutate trust state. The Receipt Trust Desk
  adds **Audit drift** and **Review rotation** receipts, with runtime, server,
  and Web API coverage for the new projections.
- Active verifier selection transparency checkpoints. `GET
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint`
  now exports the applied selection rotation chain as a compact hash-only
  checkpoint over selection entries, activation-decision hashes, baseline
  hashes, selected directory/anchor-set hashes, policy-review hashes, and
  source-alignment hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/verify`
  validates uploaded checkpoints no-store against current local selection
  history and returns `valid`, `divergent`, or `invalid`. The Store now keeps a
  bounded append-only applied-selection history, migrates legacy current
  selections into the history tail, and the Receipt Trust Desk adds
  **Export checkpoint** and **Verify checkpoint** receipts.
- Signed active-selection checkpoint envelopes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/sign`
  now signs the current checkpoint as
  `receipt_trust_anchor_directory_quorum_activation_selection_checkpoint`
  using existing Ed25519 receipt trust anchors. The generic receipt verifier
  accepts the new receipt kind, including active-selection-backed verifier-key
  lookup, and the Receipt Trust Desk adds **Sign checkpoint** with signed JSON
  download.
- Hosted signed active-selection checkpoint discovery. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/discover`
  now fetches a signed checkpoint envelope through the allowlisted hosted JSON
  boundary, verifies the trusted receipt with uploaded, active-selection, or
  local verifier keys, compares the checkpoint to local selection history, and
  enforces freshness, required signer, expected checkpoint/selection-set/tail
  hashes, minimum selection count, and rollback rejection gates. The response
  is no-store and hash-bound, exposing source URL/origin, response, policy,
  envelope, checkpoint, current tail, and diagnostics as evidence hashes. The
  Receipt Trust Desk adds **Discover checkpoint** with URL and checkpoint-hash
  pin inputs, and Web ViewModel/API tests cover the generated policy and
  wrapper.
- Durable checkpoint registry subscriptions. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions`
  now manages hosted signed-checkpoint registries with active/paused status,
  revision CAS, scheduled refresh leases, last-good preservation, and bounded
  transparency history over discovery, envelope, checkpoint, selection-count,
  selection-set, and chain-tail hashes. Manual refresh and pause/resume endpoints
  mirror the directory subscription model; invalid or failed observations cannot
  replace last-good checkpoint evidence. The Receipt Trust Desk can subscribe,
  refresh, and pause checkpoint registries, and Server/Web tests cover the new
  wrappers and receipts.
- Checkpoint registry quorum receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum`
  now evaluates durable signed-checkpoint registries without mutation,
  requiring configurable source, agreement, distinct-origin, freshness,
  checkpoint, selection-set, chain-tail, source-origin, and signer-key policy
  gates. The receipt groups eligible last-good observations by checkpoint
  SHA-256 and returns `agreed`, `insufficient_sources`, `split`,
  `policy_failed`, or `stale` with hash-only source/candidate/agreement
  evidence and headers. The Receipt Trust Desk adds **Evaluate checkpoint
  quorum**, and Server/Web tests cover the agreed independent-origin path.
- Signed checkpoint-registry quorum baselines. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines`
  now archives an `agreed` signed-checkpoint registry quorum as a trusted
  receipt envelope with kind
  `receipt_trust_anchor_directory_quorum_activation_selection_checkpoint_registry_quorum`.
  Baselines bind selected checkpoint, selection-set, chain-tail,
  subscription-set, source-origin-set, signer-set, signer key, and
  supersession evidence; duplicate promotion is idempotent by selected registry
  evidence plus signer. The Receipt Trust Desk adds **Promote checkpoint
  quorum**, downloads the signed baseline JSON, and tests verify generic
  receipt-trust validation.
- Checkpoint-registry quorum baseline verification and import. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/verify`
  now performs no-store verification of uploaded signed checkpoint-registry
  quorum baselines against local anchors or an uploaded trust directory,
  returning baseline/signature/integrity diagnostics plus baseline, envelope,
  quorum, selected checkpoint, source-set, signer-set, and trust-directory
  hashes. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/transparency-checkpoint/subscriptions/quorum/baselines/import`
  CAS-imports trusted baselines with `expectedCurrentBaselineSha256`, appends
  a local supersession record and hash-only Ledger event, and returns
  idempotent already-archived results for duplicate imports. The Web API and
  Receipt Trust Desk can verify/import checkpoint quorum baseline archives.
- Rotation review checkpoint-registry gates. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-review`
  now accepts an optional `checkpointRegistryQuorumPolicy`. When supplied, the
  no-store rotation review embeds the current checkpoint-registry quorum
  receipt and blocks with `checkpoint_registry_quorum_not_agreed` unless the
  quorum status is `agreed`. The Receipt Trust Desk automatically applies the
  default checkpoint-registry quorum gate to Review rotation whenever checkpoint
  subscriptions exist, making split or stale external checkpoint registries
  visible before verifier-set rotation.
- Automated verifier rotation proposal receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal`
  now recomputes the ordinary rotation review, consumes the latest or requested
  checkpoint-registry quorum baseline as a fail-closed prerequisite, and
  compares the baseline's checkpoint, selection-set, and chain-tail hashes with
  the current activation-selection transparency checkpoint. The no-store
  receipt returns `proposed` only when review, baseline precondition, and
  checkpoint transparency alignment all pass; otherwise it reports
  `missing_checkpoint_registry_baseline`, `already_active`,
  `stale_selection`, or `blocked` diagnostics without mutating state. The Web
  API and Receipt Trust Desk expose **Propose rotation** beside Review
  rotation.
- Signed verifier rotation proposal receipts and apply gate. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/sign`
  now signs only freshly recomputed `proposed` rotation proposals as trusted
  receipt envelopes. Active verifier-set replacement through the activation
  selection apply endpoint now requires that signed fresh proposal envelope,
  verifies it against the current active selection directory, recomputes the
  proposal, and rejects stale envelopes with mismatch diagnostics before any
  trusted state mutation. The Receipt Trust Desk adds **Sign proposal** and
  carries the signed envelope into Apply activation.
- No-store signed rotation proposal preflight. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/preflight`
  now runs the same signed-proposal gate without mutating state, returning a
  hash-bound `accepted`, `rejected`, or `not_required` receipt with proposal,
  envelope, trusted-verification, CAS, and checkpoint-baseline evidence. The
  Receipt Trust Desk exposes **Preflight proposal** before Apply activation.
- Hosted signed rotation proposal discovery. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/discover`
  now fetches a hosted trusted receipt envelope from the allowlisted discovery
  boundary, runs signed proposal preflight, and applies operator policy pins
  for envelope/proposal hashes, activation decision, expected selection CAS,
  signer key IDs, and maximum envelope age. The no-store discovery receipt
  returns hash-only source and policy evidence plus diagnostics without
  mirroring raw hosted URLs.
- Durable hosted rotation proposal subscriptions. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions`
  now persists allowlisted hosted signed-proposal sources with raw URLs kept
  local-only, hash-only public evidence, policy-bound last-good discovery, and
  bounded transparency entries over discovery, envelope, proposal, and
  preflight hashes. Manual and leased background refreshes share the same
  claim/settle path and return `accepted`, `unchanged`, `rollback_rejected`,
  `rejected`, or `failed`, preserving last-good across invalid or failed
  hosted observations; status updates can pause or resume a subscription
  without exposing the source URL.
- Signed rotation proposal subscription approval receipts. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/sign`
  now signs the subscription's current last-good proposal as a trusted receipt
  only after revision/content pins, optional discovery/envelope/proposal pins,
  and the live signed-proposal preflight all pass. The approval receipt binds
  subscription, source, policy, discovery, envelope, proposal, current preflight,
  activation-decision, proposal signer, and optional expiry evidence without
  exposing the hosted source URL.
- Approval-gated rotation proposal apply. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply`
  now verifies the signed approval envelope with the current active verifier
  directory, rechecks subscription CAS and last-good proposal binding, reruns
  the current proposal preflight, and only then applies the activation decision.
  Successful apply events carry approval/proposal/subscription/current-preflight
  hashes only.
- Unattended approval-gated rotation apply scheduling. Approval signing accepts
  `queueForApply` plus optional `applyAfter`, stores the approval envelope as
  local-only pending state on the rotation proposal subscription, keeps the
  public subscription hash stable, and lets the leased background worker claim
  due approvals, rerun the approval apply gate, CAS-apply the activation
  decision, and settle success or failure with hash-only events.
- Multi-approval verifier rotation policy review and apply. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-review`
  evaluates approval envelopes against `minimumDistinctSignerCount` and
  optional `requiredSignerKeyIds`, collapsing duplicate signer approvals while
  requiring every accepted approval to pass the existing apply gate. `POST
/approval/policy-apply` requires an accepted review before CAS-applying the
  rotation and returns a policy-bound apply receipt.
- Signed multi-approval policy baselines. `GET/POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/approval-policy-baselines`
  now exposes append-only signed policy baselines for verifier rotation
  approvals. Promotion signs an accepted policy review as a trusted receipt;
  verification supports local or uploaded trust directories, and CAS import
  preserves the archived envelope while assigning local baseline identity and
  supersession.
- Policy-baseline-gated unattended verifier rotation scheduling. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/policy-apply/queue`
  now queues policy apply only when the current multi-approval review is
  accepted and the supplied signed approval policy baseline matches the review
  binding hashes. The leased worker claims due queues, reruns the policy review
  and baseline gate, executes the existing CAS apply, and settles success or
  failure as local-only pending state plus hash-only Ledger events.
- Generated management-plane OpenAPI route artifact. `npm run
write:management-openapi` now scans `apps/server/src/app.ts`, emits
  `docs/artifacts/management-openapi-0.1.0.json` with all `/api` routes,
  OpenAPI path parameters, source SHA-256, and route-set SHA-256 evidence.
  `npm run check:management-openapi` fails on route drift. `GET /api/health`
  now has the first promoted endpoint response schema, binding its `200`
  response to `#/components/schemas/HealthResponse`. `GET
  /api/receipt-trust/anchors` and `POST /api/receipt-trust/anchors` now
  promote `ReceiptTrustAnchorList`, `CreateReceiptTrustAnchorRequest`, and
  `ReceiptTrustAnchor` schemas, including a required JSON request body and the
  real `201` create response for trust-anchor enrollment clients. `GET
  /api/receipt-trust/anchors/directory` and `POST
  /api/receipt-trust/anchors/:anchorId/revoke` now promote the public anchor
  directory, revoke request, and returned anchor schemas so external verifier
  management clients can depend on the full anchor lifecycle contract. `POST
  /api/receipt-trust/anchors/directory/verify` and `POST
  /api/receipt-trust/anchors/directory/discover` now promote no-store
  directory verification and hosted discovery schemas, including verification
  policy, hash diagnostics, and discovery response evidence. `POST
  /api/receipt-trust/anchors/directory/signed-metadata` and `POST
  /api/receipt-trust/anchors/directory/metadata/verify` now promote
  publisher metadata signing envelopes and metadata verification receipts,
  including signature evidence, trust-directory policy, and binding
  diagnostics. `POST /api/receipt-trust/verify` now promotes a generic trusted
  receipt verification request and response schema, covering uploaded
  directories or the active verifier selection as trust sources. `GET/POST
  /api/receipt-trust/anchors/directory/subscriptions` plus subscription update
  and refresh routes now promote durable trust-directory subscription schemas,
  including public transparency history, refresh receipts, CAS revision
  requests, and hash-only source URL evidence. `POST
  /api/receipt-trust/anchors/directory/subscriptions/quorum` now promotes the
  multi-source quorum request and response schemas, including source weights,
  metadata publisher evidence, selected directory hashes, and candidate set
  diagnostics.
- Management OpenAPI compatibility fixture. `npm run
write:management-openapi-compatibility` now emits
  `docs/artifacts/management-openapi-compatibility-0.1.0.json`, a published
  operation baseline that allows additive routes but rejects removed operations
  or drift in operation ids, tags, path parameters, request-body presence,
  promoted schema refs, and response status sets. The top-level release
  artifact receipt now binds both OpenAPI artifacts alongside runtime,
  package-lock, Web dist, and manifest evidence.
- Hashline-style workspace edits. `read_file` now returns bounded line
  SHA-256 anchors for the selected range, and `apply_patch hashline_replace`
  can replace anchored lines without retyping old text while still requiring
  the complete-file SHA-256, per-target write lock, atomic commit,
  protected-path checks, and fail-closed duplicate-anchor diagnostics.
- Deterministic Model Advisor notices. Assistant turns now run a hash-only
  stream-lint pass before the user-visible message is recorded. The first
  advisory rules flag unverified tests/build/checks-passed claims and
  destructive command references, recording rule IDs, severity, counts, text
  SHA-256, diagnostic-set SHA-256, and tool-evidence counts without copying the
  matched text or mutating the assistant response.
- Configurable Model Advisor policy. Agent profiles now carry a revisioned
  `modelAdvisor` policy with observe/enforce/off mode and an enabled rule set.
  The Context Workbench exposes the controls, server profile updates validate
  them, and schema-4 Run configuration fingerprints bind the effective advisor
  policy alongside the Skill catalog hash for replay drift detection. Enforce
  mode records `model.advisor.blocked` and fails the Run before
  `message.assistant` when blocker-level diagnostics match.
- Bounded Model Advisor correction. Enforce policies can allow zero to three
  tool-free rewrite attempts before failing closed. Each attempt records
  hash-only request and outcome receipts that bind the predecessor response,
  diagnostic set, corrective prompt, and corrected response without persisting
  the corrective prompt. Enforce-mode candidate text, reasoning, and deltas are
  reduced to hash-and-size debug evidence and withheld from the Web stream until
  a candidate passes. Schema-5 Run fingerprints bind the correction budget
  while schema-4 Runs retain a zero-attempt interpretation.
- Post-apply replay receipts for unattended verifier rotation. `POST
/api/receipt-trust/anchors/directory/subscriptions/quorum/promotion/baselines/activation-selection/rotation-proposal/subscriptions/:subscriptionId/approval/apply/replay`
  now emits a no-mutate receipt that verifies the approval against the
  approval-bound previous verifier selection, compares current active selection
  to the approved activation decision, and returns `aligned`, `divergent`, or
  `invalid` with hash-only diagnostics.
- Publisher-signed receipt trust directory metadata. `POST
/api/receipt-trust/anchors/directory/signed-metadata` now emits a
  `receipt_trust_anchor_directory_metadata` trusted receipt over the current
  public anchor directory, binding publisher, directory hash, anchor-set hash,
  public key counts, optional source hashes, and optional expiry. `POST
/api/receipt-trust/anchors/directory/metadata/verify` verifies both the
  Ed25519 envelope and the supplied directory binding with either local anchors
  or an uploaded trust directory. The Receipt trust desk can export signed
  metadata and verify uploaded metadata against the active external directory.
- Reusable workflow blueprints for Durable Plans. `GET
/api/threads/:threadId/plans/:planId/blueprint` distills a Plan archive into
  `napier.execution-plan-blueprint`: objective, step DAG, artifact
  declarations, source Plan revision, archive hash, and event-stream hash,
  without runtime evidence prose or status. `POST
/api/threads/:threadId/plans/blueprints/verify` performs no-store stable-hash
  validation, and `POST /api/threads/:threadId/plans/from-blueprint` creates a
  new Plan through the normal creation gate while recording only
  blueprint/source hashes. The Plan Workbench now exposes export, upload
  verification, and create-from-verified-blueprint actions in its lazy chunk.
  Blueprint downloads now use
  `napier-plan-blueprint-<safe-plan-id>-r<revision>-<content-hash>.json`
  filenames across direct API attachments and Workbench exports.
- Durable Plan archive export and no-store verification. `GET
/api/threads/:threadId/plans/:planId/archive` now emits a
  `napier.execution-plan-archive` artifact containing the current
  `ExecutionPlan`, ordered plan-scoped Ledger events, a stable content hash,
  and event-stream hash. `POST
/api/threads/:threadId/plans/:planId/archive/verify` recomputes the hashes,
  validates plan/event ownership, binds the archive to the URL Thread and Plan,
  and returns low-cardinality diagnostics without mutating state. The Plan
  Workbench exposes export and upload verification actions inside its lazy
  chunk, with runtime/server/Web tests and no-store headers covering archive
  hash, event count, step/artifact/replan counts, and path mismatch. Archive
  downloads now use
  `napier-plan-<safe-plan-id>-r<revision>-<content-hash>.json` filenames across
  direct API attachments and Workbench exports.
- Trace Workbench is now a lazy chunk. Event rendering, delegation cards,
  OpenTelemetry export, and archived trace verification load only when the
  Trace tab is opened, keeping OTLP archive tooling outside the main Workbench
  entry while preserving the same default tab behavior.
- Plan Workbench is now a lazy chunk. Plan DAG rendering, artifact manifests,
  replan draft review, and replan draft application load only when the Plan tab
  is opened, removing Plan-specific API clients and review state from the main
  Workbench entry while preserving the same replan CAS behavior.
- Run Lab is now a lazy Workbench chunk. The main Workbench entry keeps only the
  tab shell, while replay export/verification, fixture transfer, comparison,
  evaluation, and nested Evaluation Suite controls load on demand. This restores
  main-entry budget headroom for future Agent inspection features without
  changing Lab behavior.
- No-store OpenTelemetry trace artifact verification through
  `POST /api/threads/:threadId/trace/otlp/verify`. The endpoint strictly parses
  a single exported artifact, replays the existing OTLP envelope/span graph,
  redaction, count, source-hash, and stable content-hash validation without
  mutating Ledger state, binds the artifact to the URL thread, and returns
  `valid` / `invalid` plus low-cardinality diagnostics. Runtime, server, and
  Web coverage now proves valid archive verification, tamper rejection,
  path-mismatch rejection, and no-store response headers that mirror trace
  hash, event-stream hash, span/event counts, and diagnostic hashes.
- Trace Workbench archived-artifact verification. The OpenTelemetry export card
  now accepts a local OTLP artifact JSON file, submits it through the same
  hash-verified no-store management client, and renders a compact valid/invalid
  receipt with diagnostics, trace hash, and span/event counts without mutating
  the active Thread.
- Self-contained Run replay snapshot verification through
  `POST /api/threads/:threadId/runs/:runId/replay/verify`. Per-Run replay
  snapshots now carry Subagent task evidence and a stable `contentSha256`
  independent of `generatedAt`; the verifier recomputes event-stream hashes,
  metrics, assistant-output hashes, configuration binding, stable content hash,
  and URL thread/run identity without mutating state. Server/Web wrappers and
  tests cover valid snapshots, tamper rejection, and path mismatches, while
  replay headers now mirror snapshot hash and subagent counts.
- Run Lab archived replay verification. The Lab now accepts a local per-Run
  replay JSON snapshot, binds it to the active Thread plus embedded Run ID via
  the no-store verifier, and renders a valid/invalid receipt with diagnostics,
  snapshot hash, event count, and Subagent count without mutating state.
- Run Lab replay downloads now include the stable snapshot content hash prefix
  in the filename, making local replay archives content-addressable before
  upload verification.
- Direct Run replay API attachment headers now use the same
  `napier-<runId>-replay-<content-hash>.json` filename shape as Run Lab, so
  browser saves and scripted captures preserve the replay content receipt.
- Portable Thread fixture downloads now share a tested
  `napier-thread-<safe-thread-id>-<content-hash>.json` filename projection
  across Run Lab and direct API attachment headers.
- OpenTelemetry trace artifact downloads now share a tested
  `napier-otel-<safe-scope-id>-<content-hash>.json` filename projection across
  Trace Workbench and direct API attachment headers.
- No-store `POST /api/threads/import/verify` preflight for portable Thread
  replay bundles. The endpoint reuses the same fail-closed bundle validator as
  import, returns `valid` / `invalid` plus low-cardinality diagnostics without
  mutating state, and mirrors content hash, verification status, diagnostic
  hash, bundle hash, event-stream hash, and resource counts in headers. Web now
  exposes a typed `verifyThreadReplayBundle` wrapper, and runtime/server
  coverage proves valid fixture verification, tamper rejection, and no-mutation
  behavior before import.
- Run Lab now surfaces the portable Thread fixture preflight as a separate
  upload action beside import. Operators can verify archived fixture JSON,
  inspect valid/invalid diagnostics and resource counts, and keep the active
  Thread unchanged until they explicitly choose the mutating import path.
- TypeScript monorepo with contracts, runtime, server, and web workspaces.
- Pi-powered provider registry and live agent-loop adapter.
- Deterministic zero-key demo model using the production event path.
- Authoritative SQLite WAL with `synchronous=FULL`, atomic workspace/event
  commits, thread-sequence primary keys, and revision compare-and-swap for
  bounded multi-instance retries.
- SQLite ledger schema version 2 with an online migration-history table,
  v1-to-v2 backfill under `BEGIN IMMEDIATE`, health reporting, and
  post-migration `quick_check` evidence. Health responses now expose no-store
  response hashes plus service/status, Ledger schema version, quick-check,
  migration-count, migration-list hash, latest migration headers, public Node
  runtime version/platform/arch, and SQLite/OpenSSL/libuv/V8 component evidence
  for CI readiness probes.
- The health readiness body is now a shared `HealthResponse` contract consumed
  by both the server and Web API wrapper, with Web contract coverage for the
  typed `/api/health` JSON path.
- Thrown management API errors, explicit management JSON errors, and unknown
  `/api/*` routes now return no-store, hash-bound JSON projections, with
  headers for response content SHA-256, HTTP status, stable error code, and
  error-message SHA-256 without copying the error text into headers.
- Server contract tests now statically guard no-store response header helpers
  and JSON route returns so helper regressions cannot omit
  `X-Napier-Content-SHA256` unnoticed.
- Web API clients now verify failed JSON response body and error-message hashes
  before wrapping trusted failures as `NapierApiError`, preserving the server
  message plus status, code, response hash, and message hash for operator
  diagnostics and future UI branching. Common UI error banners now use a shared
  formatter for those diagnostic handles.
- JSON API wrappers now share one request helper so future management-plane
  header parsing changes stay centralized; successful JSON responses with
  `X-Napier-Content-SHA256` are verified before parsing, accepting exact
  response-body hashes or independently recomputed canonical stable projections
  for `contentSha256` / `reviewSha256`. Stable projection coverage now includes
  generated/exported timestamp exclusion, execution ID/runtime timestamp
  exclusion, review receipts, Casebook artifacts, and Extension deployment
  previews that summarize nested previews by SHA-256. SSE Run requests keep
  their separate streaming path. Web contract tests cover success JSON hash
  verification, recomputed stable artifact/review/execution/preview digests,
  success/error hash drift rejection, header-backed `NapierApiError`, and
  missing-metadata fallback behavior.
- Web JSON responses now require `X-Napier-Content-SHA256`; missing success or
  error body evidence fails closed instead of returning or displaying
  unverified text. Error responses without code/message metadata still keep a
  status-based fallback once the body hash is verified.
- Web static boundary tests now also require every production `requestJson`
  call site to target `/api/*`, preventing the hash-verified management client
  from being reused for static files or external URLs.
- Management JSON responses now mirror the hash semantic as
  `X-Napier-Content-SHA256-Mode: body|stable`, emitted through a centralized
  server helper. Static server tests reject direct content-hash header writes,
  and the Web verifier treats explicit mode values as constraints instead of
  accepting an ambiguous body/stable fallback. Unsupported explicit mode values
  now fail closed before response or error text is trusted.
- Body-mode Web JSON success and error responses are now hash-verified before
  `JSON.parse`. Malformed JSON with a mismatched body hash reports
  `NapierContentHashError`; malformed JSON after a verified body hash reports a
  structured parse error carrying the verified digest.
- Streaming Run clients now dispatch SSE frames through a shared record parser,
  flush a final record even when the server closes without a trailing blank
  line, report malformed successful frames as `NapierStreamFrameParseError`
  with path, frame SHA-256, and line count, reject JSON-valid frames that
  violate the `StreamFrame` union with `NapierStreamFrameContractError`, and let
  consumer callback failures propagate without being mislabeled as parse
  failures. Runtime `error` frames remain valid protocol frames for UI
  surfacing, but now carry a stable public message, `run_failed` code, and
  SHA-256 diagnostic handle instead of streaming raw exception text. Prompt and
  resume SSE responses now expose thread/run intent headers plus stream error
  code, diagnostic type, and public error-message hash before the body starts.
  The Web streaming client verifies those headers before reading the SSE body
  and rejects streams that close without a terminal `done` or `error` frame, or
  that emit additional semantic frames after a terminal frame. If an SSE
  `event:` name is present, Web also requires it to match the JSON `frame.type`;
  event frames must carry an SSE `id:` equal to `frame.event.seq`, and non-event
  frames must not carry `id:`. Stream-local event sequence values must also
  strictly increase so duplicate or reordered events fail before UI dispatch,
  and event frames now require a positive safe-integer sequence plus known
  `EventCategory` and `EventVisibility` values.
  Event and snapshot frames must bind back to the declared stream thread, and
  event/`done` frames must keep one Run identity so cross-thread or mixed-run
  frames fail before UI callbacks. `StreamFrame.done` now carries only terminal
  Run statuses (`completed`, `failed`, `cancelled`, or `interrupted`), and the
  server writes done frames through the same terminal-status guard. Event frames
  now carry `eventSha256`; the server computes it from `RunEvent`, and the Web
  client recomputes it before dispatch so event-body drift fails closed with
  hash-only diagnostics. Snapshot frames now require `thread.id`, known
  `thread.status`, a matching `thread.eventCount`, and same-thread valid
  RunEvent records with contiguous increasing sequence values before replacing
  the Workbench projection. They also require the Workbench-owned `agent`,
  `contextCheckpointCalibration`, and top-level collection projections to
  prevent partial snapshots from reaching renderers, with `agent.id`,
  `thread.agentId`, `thread.runIds`, `currentRunId`, and `runs[]` checked for
  one-thread/one-agent consistency. Snapshot frames now carry `detailSha256`,
  and the Web client recomputes the hash before replacing the Workbench
  projection. Successful `done` streams must now carry `threadId`,
  `snapshotSha256`, `eventCount`, and `eventStreamSha256`, include that final
  snapshot before the terminal frame, and bind the same thread, Run ID, terminal
  status, snapshot hash, event count, and ordered event-stream hash; done-only,
  wrong-thread, missing-run, status-drift, done/snapshot hash-drift,
  event-count drift, or event-stream hash-drift streams fail closed. Final
  snapshots must also include every already-streamed event with the same
  `eventSha256`, so stale snapshots, truncated event lists, or event body drift
  fail before UI callbacks. Runtime `error` frames now carry `threadId`, so
  wrong-thread error frames fail closed while still exposing only the public
  message, `run_failed` code, and diagnostic SHA-256 instead of raw exceptions.
  Web and server contract coverage now includes frame parsing, hash-only
  bad-frame diagnostics, invalid-frame contract rejection, runtime error frame
  dispatch with diagnostic hashes, prompt/resume intent and error-protocol
  headers, SSE event/frame type matching, SSE id/sequence matching, monotonic
  event-sequence rejection, stream thread/run identity rejection, invalid event
  field rejection, event hash drift rejection, invalid or incomplete snapshot
  rejection, missing-final-snapshot rejection, non-terminal `done` rejection,
  snapshot/done run-status mismatch rejection, done/snapshot hash mismatch
  rejection, done/event-count mismatch rejection, snapshot hash drift rejection,
  snapshot/streamed-event mismatch rejection, missing terminal-frame rejection,
  terminal ordering rejection, hash-bound pre-stream `NapierApiError` wrapping,
  pre-stream hash drift/missing-hash rejection, and missing readable bodies.
- Web contract tests now statically guard direct `fetch` usage so future UI
  code cannot bypass the hash-verified JSON helper or the dedicated SSE client.
- Web contract tests are now included in the Web TypeScript project, so the
  production Web build typechecks API-client and streaming-client contracts
  before emitting the bundle.
- `npm run check:runtime-environment` now audits the current Node runtime before
  build output is trusted, verifying `package.json#engines.node`, observed
  platform/arch, and required SQLite/OpenSSL/libuv/V8 component versions.
- `npm run write:runtime-environment-receipt` now writes a
  `napier.runtime-environment-audit` artifact, while
  `npm run check:runtime-environment-receipt` /
  `npm run verify:runtime-environment-receipt` verify the stored runtime
  evidence against the current Node process and `package.json` hash.
- `npm run check:package-lock` now audits `package-lock.json` before build
  output is trusted, verifying lockfile version, root/workspace package
  metadata, workspace links, dependency-map mirroring, and external package
  integrity coverage. Its root-level contract tests cover dependency drift,
  missing integrity, missing workspace links, and JSON receipt output.
- `npm run write:package-lock-receipt` now writes a
  `napier.package-lock-audit` artifact, while
  `npm run check:package-lock-receipt` / `npm run verify:package-lock-receipt`
  verify the stored receipt against the current package metadata and lockfile
  hashes before build output is trusted.
- `npm run check` now runs a Web dist release gate after the production build:
  it recomputes every `apps/web/dist` SHA-256 against
  `docs/artifacts/web-dist-0.1.0.sha256`, rejects missing or extra files, and
  enforces the 150 KiB main-entry budget from the actual module script in
  `index.html`.
- The Web dist release gate now exports a reusable auditor with root-level
  Vitest contract coverage for passing manifests, hash drift, unlisted files,
  malformed manifests, unsafe entry paths, and entry-budget regressions. Root
  `npm test` runs those checks before workspace suites.
- `npm run check:web-dist -- --json` now emits a `napier.web-dist-audit`
  receipt containing relative paths, file counts, main-entry budget evidence,
  manifest SHA-256, canonical dist-content SHA-256, and errors for CI capture.
- `npm run update:web-dist-manifest` now regenerates
  `docs/artifacts/web-dist-0.1.0.sha256` from the current Web dist using the
  same canonical ordering and SHA-256 formatter as the release gate, while
  `npm run check:web-dist-manifest` fails CI when the stored manifest is stale.
- `npm run write:web-dist-receipt` now writes a passing
  `napier.web-dist-audit` receipt artifact for CI capture. Custom receipt
  targets must stay repo-relative, and failed audits remove any stale target
  instead of leaving an old success receipt in place.
- `npm run check:web-dist-receipt` / `npm run verify:web-dist-receipt` now
  validate the stored Web dist audit receipt against the current build,
  including schema, manifest hash, canonical dist-content hash, entry budget,
  and exact receipt projection drift.
- `npm run write:release-artifacts` now writes a top-level
  `napier.release-artifacts-audit` receipt that binds the package-lock receipt,
  runtime-environment receipt, Web dist receipt, and Web dist manifest by
  SHA-256. `npm run check:release-artifacts` /
  `npm run verify:release-artifacts` verify the aggregate receipt against the
  current component evidence, with root-level contract tests for aggregate
  drift and component receipt drift.
- Root formatting now ignores generated Web dist files and SHA manifest
  artifacts so audit manifests remain verifier inputs rather than Prettier
  parse targets.
- Automatic legacy `workspace.json`/JSONL migration with contiguous-sequence
  validation, recoverable event-first crash repair, fail-closed missing
  evidence detection, and non-authoritative compatibility projections.
- Atomic first-run onboarding bootstrap and lease-aware restart reconciliation
  that leaves active work owned by another local runtime instance untouched.
- Thread creation, branching, durable goals, run cancellation, and SSE streams.
- Bounded strict JSON parsing for Thread creation, Branch creation, Goal
  updates, Resume, Prompt, and Trace export requests before runtime state
  mutation, evidence copying, trace projection, or model execution.
- Bounded strict JSON parsing for schedule and inbound-channel administration,
  rejecting unknown fields, malformed trigger wrappers, invalid status values,
  and out-of-range retry policies before any automation state mutation.
- Bounded strict JSON parsing for Memory proposal/review and credential
  reference administration, rejecting unknown wrappers, malformed resource IDs,
  invalid enums, overlarge Memory content, invalid review intervals, and
  malformed credential sources before persistence.
- Bounded strict JSON parsing for Run Evaluation, adjudication, reviewer
  ballot, consensus preview/resolve, and Evaluation Suite create/update APIs,
  rejecting unknown wrappers, malformed run IDs, invalid verdicts, malformed
  rubrics, and out-of-range quality gates before model judging or gate state
  mutation.
- Bounded strict JSON parsing for Evaluation Casebook create/update, curation,
  removal, and qualification APIs, rejecting unknown wrappers, malformed
  source references, invalid evaluator models, malformed gates, and oversized
  bodies before revision changes, qualification execution, or Ledger events.
- Bounded strict JSON parsing for Agent profile update and rollback APIs,
  rejecting unknown wrappers, malformed audit threads, unsupported tool/skill
  sets, invalid thinking/tool policies, and out-of-range Run/Subagent/automatic
  recovery limits before revision state mutation.
- Bounded strict JSON parsing for MCP Extension proposal, review, enablement,
  connect/disconnect, and tool review APIs, rejecting unknown wrappers,
  malformed transports, invalid capabilities/effects, malformed routing hints,
  and invalid Agent/Thread IDs before Extension trust or tool exposure changes.
- Bounded strict JSON parsing for Receipt Trust anchor administration, signed
  gate/qualification receipt export, and qualification baseline promotion
  requests before trust-anchor mutation, signing, or baseline state changes.
- Bounded strict JSON parsing for Extension publisher anchors, Skill/Prompt/
  Inspector/Extension package signing, lockfile export, rollout publishing and
  application, and signed channel-index export before package governance state
  changes or signature generation.
- Directory artifact verification in the internal Plan tool surface, computing
  a canonical manifest digest from sorted relative paths, nested directory
  markers, file byte counts, and per-file SHA-256 values under the existing
  workspace and 32 MiB verification bounds.
- Public Plan artifact updates can request server-side `observeWorkspace`
  verification for files or directories; observed verification computes the
  digest from local workspace bytes, rejects simultaneous self-reported
  `sha256`/`sizeBytes`, and preserves the normal Ledger event path.
- Strict goal evaluation with bounded auto-continuation and repeated-evidence
  breakers.
- Revisioned parent-Run limits for model turns, total tokens, provider-reported
  cost, and wall time, snapshotted with the Agent revision before execution.
- Shared Run accounting across the primary Pi loop, Context compactor, Goal
  evaluator, Memory extractor, and Subagents, including delta-safe delegated
  usage.
- Model-specific token accounting with raw provider `usage` preserved beside
  hash-bound `usageAccounting` projections; Run token budgets now use
  calibrated `budgetTokens` for model responses and fall back to raw totals for
  legacy or delegated usage.
- Provider price-table cost calibration in the same `usageAccounting`
  projection, including reported cost, estimated cost, `budgetCostUsd`,
  price-table ID/SHA-256, and fail-closed budget checks for zero-cost provider
  reports on known providers.
- Refreshable usage price-table catalogs with per-table hashes, catalog
  verification for tampering, duplicate providers, and missing required
  providers, no-store REST download/verify APIs, and Context Inspector catalog
  evidence.
- Usage price-table catalog and verifier responses now expose no-store content
  hashes, provider/table counts, provider-set hashes, diagnostic counts,
  diagnostic-set hashes, verifier status, and catalog hashes for polling both
  valid and invalid uploads.
- Context checkpoint calibration reports derived from Ledger events, with
  verified/drifted/malformed sample classification, coverage and compression
  metrics, fallback omission counts, no-store REST access, and
  content, event-stream, checkpoint-status count, failure-count,
  coverage/compression, fallback-omission, and latest-checkpoint headers.
- Deterministic replacement-plan draft evaluation for replan recommendations,
  including strategy-aligned checks, replacement-work counts, score/risk
  projection, and `evaluationSha256` evidence in both Workbench and Agent tool
  output.
- Fail-closed `run.budget.exhausted` evidence with first-reason semantics,
  pre-tool side-effect blocking, distinct operator cancellation, and optional
  Memory extraction skip when no budget remains.
- Workspace-confined file inspection tools with canonical realpath checks,
  external-symlink rejection, complete-file SHA-256 metadata, UTF-8 validation,
  and fail-closed policy checks.
- Hash-preconditioned `apply_patch` for bounded UTF-8 file creation and unique
  exact replacement, with protected-path rejection, multi-runtime PID locks,
  stale-owner recovery, pre-commit CAS rechecks, fsync, and atomic link/rename.
- Structured patch evidence in Trace containing path, operation, byte counts,
  edit count, and before/after SHA-256 without enabling general shell, deletion,
  parent-directory creation, or Subagent writes.
- Sandboxed `verify_workspace` dispatch for fixed local TypeScript, Vitest, and
  Prettier CLIs with canonical workspace targets, no package scripts or shell,
  read-only workspace access, disabled networking, and a fixed environment.
- Structured verification evidence for passed, failed, timed-out, and
  output-capped outcomes, including exit state, duration, truncation flags,
  bounded stdout/stderr, and independent output SHA-256 digests.
- Bundled standard Agent Skills for research, software delivery, and artifacts.
- Ed25519 signed Skill package baselines that freeze hash-only Skill catalog
  evidence, including requested/loaded/missing names, diagnostics hash, file
  paths, sizes, and SHA-256 values without copying Skill instructions, plus
  workspace qualification that detects catalog drift or missing Skills.
- Auditable memory proposals, approval workflow, agent scoping, and
  prompt-injection-resistant context injection.
- Automatic live-model memory extraction that never bypasses human review.
- Correction-aware live-model extraction over a 40-fact/6,000-character
  reviewed replacement inventory, with inventory SHA-256 evidence,
  pending-target exclusion, strict target allowlisting, and inherited
  scope/Agent semantics.
- Fail-closed rejection of malformed, unavailable, duplicate, or repeated
  `supersedesMemoryId` / `consolidatesMemoryIds` targets before extracted
  proposals are persisted.
- Manual and model-assisted 2–8 source Memory consolidation with canonical
  source IDs, correction/consolidation mutual exclusion, same-scope/Agent
  enforcement, and overlapping pending-replacement rejection.
- Atomic consolidation approval that activates one synthesized fact and
  archives every validated source with a shared reverse link in one SQLite
  workspace commit; rejected or pending proposals leave all sources unchanged.
- Configurable 1–3,650 day Memory review intervals with 90-day defaults,
  pre-prompt automatic expiry, explicit stale/refresh transitions, and
  `memory.stale` Ledger evidence.
- Per-Run deduplicated Memory usage evidence with durable use count, last-used
  time, and last-used Run ID.
- Append-only Memory correction proposals with scope-preserving
  `supersedesMemoryId`, competing-correction rejection, atomic replacement
  approval, bidirectional links, and non-restorable superseded history.
- Memory list, proposal, and review responses now expose no-store hashes,
  per-status counts, lifecycle status/revision headers, review metadata, use
  counts, Agent scope, and supersession/consolidation headers.
- Paper Ledger Memory governance UI with review-period controls, correction
  tickets, 2–8 source selection, consolidation tickets, review queue,
  lifecycle actions, usage registers, and multi-source provenance.
- Isolated researcher, reviewer, and general subagents with read-only tools,
  bounded concurrency, total/turn/time budgets, cancellation, and durable task
  records.
- Typed Subagent outcomes. New delegated completions must return one strict JSON
  object with a summary, categorized severity-ranked items,
  workspace-relative line evidence, and explicit unknowns. The runtime records
  accepted/rejected outcome evidence and binds successful results to the task,
  role, model, immutable role instructions, prompt, raw result, canonical item
  set, and stable receipt SHA-256. Replay verification checks that binding, and
  fixture import remaps task IDs while recomputing receipt hashes.
- Workspace-grounded Subagent evidence. Outcome file and line references now
  resolve through the same realpath, UTF-8, and size boundary as `read_file`.
  Successful receipts bind each observed file SHA-256, exact range SHA-256,
  byte size, line count, and aggregate evidence-set SHA-256; missing,
  out-of-range, escaping, oversized, or non-text references fail the
  delegation. Grounded receipts use schema 2 while existing schema-1 receipts
  remain valid and importable.
- No-store Subagent evidence drift verification. `POST
/api/threads/:threadId/subagents/:taskId/outcome/verify` revalidates a stored
  schema-2 receipt against current workspace bytes and reports aligned,
  divergent, missing, or legacy-unavailable references with expected/observed
  file and range hashes plus hash-only diagnostics. The task-scoped operation
  appends no Ledger event, returns a stable content SHA-256 with count/status
  headers, and has a promoted OpenAPI response schema with no request body.
  Trace delegation cards load the verifier on demand and render current,
  drifted, missing, and legacy states without exposing file content or raw
  filesystem errors.
- Bounded typed Subagent outcome repair. A structurally malformed final
  candidate can consume one remaining Subagent turn in a dedicated zero-tool
  Agent that only rewrites the strict outcome JSON. Hash-only request and
  outcome receipts bind task/role/model, original task and immutable
  instruction hashes, predecessor/result hashes, diagnostic, repair
  prompt/instruction hashes, and the accepted outcome receipt. Grounding
  failures, oversized candidates, exhausted turns, timeout, and cancellation
  remain fail-closed without repair. Terminal candidate steps now persist only
  SHA-256 and byte counts, preventing rejected raw output from leaking through
  `subagent.step`; cross-workspace fixture import validates and rebinds the
  repair receipt chain.
- Independent Subagent outcome review. `POST
/api/threads/:threadId/subagents/:taskId/outcome/review` requires an explicit
  reviewer model different from the worker and invokes it with no tools,
  bounded retries, and a fixed timeout. The strict review scores task
  alignment, evidence grounding, uncertainty honesty, and actionability,
  returning accept/revise/reject/inconclusive, score, risk, reason, concerns,
  usage, and hashes binding both models, the outcome receipt, criteria, input,
  prompt, response, schema, and the live review request's hash-only
  model-context envelope. Provider or parse failures become
  `inconclusive` without exposing raw errors. The operation is no-store,
  promoted into OpenAPI, and available from Trace using the globally selected
  model. Trace shows the request envelope hash beside the review receipt hash;
  the operation cannot mutate or stall the settled delegation.
- Compaction-immune delegation ledger projection. Every parent provider
  request now receives a freshly derived bounded system block from durable
  Thread Subagent tasks, including sanitized task labels, state/model/counter
  metadata, prompt/intent/result/error/outcome hashes, and separate
  selected-projection and full-task-set SHA-256s without raw prompts, results,
  or errors. The block
  refreshes after tool turns and is rebuilt across later Runs, child recovery,
  and replay import without entering conversation history. `context.prepared`
  and hash-only `context.delegation.updated` events carry projection counts and
  hashes for Trace without persisting projection content. `delegate_task` now
  rejects equivalent pending/running/completed role + canonical-prompt intents
  while permitting failed/cancelled/timed-out retries, and restored
  coordinators recover their per-Run total from durable tasks.
- Durable live Run control inbox. The Pi loop now drains one steering message
  after a completed turn or one follow-up when it would otherwise stop, while
  preserving the original Run budget and never aborting in-flight tools.
  Queue acceptance appends bounded `run.control.queued` evidence; delivery
  atomically commits `run.control.delivered` plus the exact `message.user`, and
  completion/failure/cancellation/restart atomically settles undelivered items
  as `run.control.cancelled`. Public projections expose only mode/status,
  text SHA-256/size, timestamps, event anchors, reason, and stable content hash.
  Strict promoted queue/list/cancel APIs add no-store identity/count/hash
  headers, ThreadDetail includes the ordered projection, and the running
  Workbench composer now switches between Steering and Follow-up while keeping
  Stop available. Queue cardinality is bounded, demo runs reject unsupported
  control, recovery summaries are hash-only, and OTLP remains metadata-only.
- Shared Agent-profile and Subagent-coordinator limit normalization without a
  second silent runtime clamp.
- Auditable delegation events and dedicated Trace workcells that preserve
  returned evidence, failures, usage, and terminal state across restarts.
- Reviewed MCP extension registry with provenance digests, capability approval,
  per-tool schema/effect review, Agent enablement, and fail-closed revocation.
- MCP Extension list/proposal/review/enable/connect/disconnect/tool-review
  responses now expose no-store hashes, trust/connection/revision headers,
  capability/tool/enabled-Agent counts, and package-binding hashes for polling.
- Reviewed MCP tool routing hints as local operator-authored metadata, surfaced
  to the Agent separately from untrusted MCP server descriptions and cleared on
  tool rejection.
- Deferred MCP schema search through a read-only `mcp_schema_search` tool that
  loads only matched approved external tool schemas into the next Agent turn.
- Ed25519 Extension publisher anchors with environment-backed local signers,
  verify-only SPKI enrollment, canonical key IDs, private-key match checks,
  bounded workspace cardinality, irreversible revocation, and SQLite migration.
- Versioned signed MCP package manifests freezing publisher identity, normalized
  transport, requested capabilities, sorted tool schemas/effects, reviewed
  routing hints, creation/expiry metadata, stable manifest content SHA-256,
  complete manifest artifact SHA-256, and an independently hashed signature
  envelope.
- Canonical stdio executable evidence using no-follow regular-file handles,
  256 MiB bounds, streamed SHA-256, canonical-path and symlink rejection, and
  size/mtime/inode drift checks before and after hashing.
- Trusted package import that enforces a 4 MiB JSON boundary, nested strict
  validation, current publisher trust, duplicate package/name rejection, and a
  fresh pending Extension with no inherited capability, tool, or Agent approval.
- Signed Extension package downloads now use
  `<safe-package-name>-<envelope-hash>.napier-extension.json` filenames across
  Workbench and direct API attachment headers, binding local archives to the
  signed envelope receipt.
- Reviewed in-place signed package updates with server-recomputed deep
  publisher/version/transport/capability/tool/schema/effect/routing-hint/
  executable diffs, package-binding SHA-256 compare-and-swap, and independent
  confirmation for publisher/key changes and SemVer rollback or opaque version
  transitions.
- Bounded append-only package supersession history with signed-envelope replay,
  sequence, hash-chain, successor, package-name, restart, and legacy SQLite
  migration validation while preserving the installed Extension ID.
- Atomic update settlement that disconnects the old transport and clears source,
  capability, tool, and Agent approval before the candidate can be exposed,
  plus a semantic no-op for an identical envelope.
- Signed manifest dependencies with canonical normalized package names,
  32-entry bounds, exact/wildcard/caret/tilde/comparator-intersection SemVer
  ranges, strict opaque-version rejection, dependency diff evidence, and
  explicit schema-2 emission while preserving schema-1 dependency-free
  artifacts.
- Dependency-aware package deployment for up to eight envelopes and 16 MiB,
  including automatic install/update classification, missing/version/cycle
  rejection, dependency-first ordering, set-wide risk confirmation, stable
  whole-plan SHA-256, and one SQLite-CAS all-or-nothing commit.
- Self-contained signed Extension package lockfiles that export installed
  dependency-closed package sets with complete signed envelopes, canonical
  package/dependency rows, stable generation-time-independent content hashes,
  offline trust verification, and replay through the normal deployment gates.
- Policy-bound signed package rollout channels that pin a named lockfile
  revision to allowed package names, publisher key IDs, package-count limits,
  trusted-publisher checks, and dependency-closure checks before reusing the
  normal deployment CAS path.
- Signed Extension package channel indices that summarize active rollout
  channels with channel hashes, lockfile hashes, package/dependency counts,
  package-envelope set hashes, optional lockfile locators, and policy hashes
  under an Ed25519 registry signature without embedding lockfile envelopes or
  local approval state.
- Final-graph validation on single import/update plus recursive dependency
  trust/range checks during Agent tool assembly, connection, policy, and actual
  MCP call, with revocation settlement cascading to dependent clients.
- Connect-time signature/configuration/executable revalidation, exact discovered
  tool catalog matching, signed-effect enforcement during local review, and
  SQLite-backed publisher/configuration checks immediately before policy and
  actual MCP tool execution.
- Publisher revocation settlement that atomically clears enablement and
  connection state for bound Extensions, closes local clients through the REST
  control plane, and blocks already exposed Agent tool closures.
- Dependency-free Streamable HTTP MCP client with session negotiation,
  response limits, redirect denial, endpoint screening, and untrusted-output
  labeling.
- Sandboxed stdio MCP JSON-RPC client with absolute executable enforcement,
  explicit environment mapping, bounded protocol lines, cancellation,
  deterministic shutdown, and stderr suppression.
- macOS `/usr/bin/sandbox-exec` adapter with private temporary HOME,
  capability-derived network/workspace rules, no shell invocation, and
  fail-closed unsupported platforms.
- Linux `/usr/bin/bwrap` adapter with an empty mount namespace, default network
  isolation, capability-derived workspace mounts, explicit executable binding,
  private writable `/tmp`, argument-boundary protection, and no ambient
  environment.
- Opt-in OCI/container sandbox adapter for Windows or explicitly containerized
  deployments, with configured image selection, no-new-privileges,
  capability-derived mounts/networking, and env-name-only command arguments.
- Isolated process groups for sandbox wrappers, with descendant cleanup on
  cancellation, timeout, output exhaustion, normal exit, and forced shutdown.
- Minimal macOS Node runtime rules for root-directory data and literal ancestor
  metadata without widening descendant workspace access.
- Lease-gated Run creation and finalization with worker-only raw tokens,
  SHA-256-at-rest ownership, renewable heartbeats, deterministic trigger IDs,
  and stale-worker rejection.
- ThreadDetail snapshots now return no-store content hashes and run/event/plan/
  evaluation/subagent/recovery count headers for operator polling.
- Thread create, replay import, goal set/clear, and branch responses now reuse
  the ThreadDetail projection headers; stop controls expose no-store receipts,
  and resume streams expose thread/run intent headers under SSE no-cache.
- Thread event projections now return no-store content hashes, requested
  `after` sequence, event count, and first/last returned sequence headers for
  incremental polling.
- Durable interval and five-field UTC cron schedules with anchored advancement,
  bounded claims, heartbeat renewal, overlap skips, misfire policies,
  trigger-level deduplication, and lifecycle evidence. Schedule list/create/
  update APIs are no-store and expose projection/list hashes, status, revision,
  next-run, and active/paused count headers without copying prompts into Ledger
  events.
- Authenticated inbound webhook channels with one-time bearer tokens, bounded
  JSON bodies, uniform public authorization failures, hashed idempotency keys,
  durable delivery receipts, and exactly-once Run creation.
- GitHub webhook channel adapter that keeps Napier bearer/HMAC authorization,
  derives deduplication from `X-GitHub-Delivery`, normalizes repository/action
  metadata into Agent work, and exposes only a delivery fingerprint instead of
  the raw delivery ID.
- Slack Events API channel adapter that keeps Napier bearer/HMAC authorization,
  derives deduplication from `event_id`, normalizes team/app/channel/user/text
  metadata into Agent work, and exposes only an event fingerprint instead of the
  raw Slack event ID.
- Linear webhook channel adapter that keeps Napier bearer/HMAC authorization,
  hashes webhook ID, timestamp, entity type/action, and entity ID for
  deduplication, normalizes issue/project metadata into Agent work, and exposes
  only an event fingerprint instead of the raw webhook identity tuple.
- No-store inbound adapter preview API that parses sample headers/body through
  the selected channel adapter and returns receipt/body/message hashes,
  idempotency fingerprint, bounded message preview, and matching
  adapter/hash/fingerprint response headers without creating deliveries, Runs,
  or Ledger events. Automations now shows the adapter preview receipt hash
  alongside the message hash.
- Server-owned inbound adapter catalog exposed through Bootstrap and
  `/api/channels/adapters`, including labels, idempotency source, required
  headers, sample headers/body, and security notes so the Automations UI no
  longer hardcodes adapter examples; both surfaces expose the catalog SHA-256
  for drift checks.
- Inbound delivery projections and Ledger events now include the channel
  adapter ID, channel revision, raw inbound body SHA-256, and adapter catalog
  SHA-256, binding accepted/started/completed/retry evidence to the parser
  input and channel configuration without storing raw webhook bodies. Accepted
  and duplicate inbound receipts are no-store and mirror content hash,
  duplicate flag, channel/thread/delivery/trigger identity, optional Run ID,
  delivery status, revision, fingerprint, and public hash evidence in response
  headers.
- No-store inbound delivery list projection with content hash, delivery total,
  channel ID, delivery-list hash, delivery-ID set hash, and per-status count
  headers for Automations polling and CI checks.
- No-store inbound delivery qualification endpoint for checking whether a
  delivery has body/catalog hash evidence and whether its adapter catalog hash
  still matches the current server-owned catalog, with a stable receipt hash
  surfaced directly on Automations delivery rows and channel/delivery identity,
  status, diagnostic-count, current-catalog, and optional hash-evidence response
  headers for machine checks.
- Optional HMAC-SHA256 webhook body signatures using the one-time channel
  token as the signing key, with timestamp-skew enforcement, no raw signing
  secret persistence, and Ops Workbench controls for requiring signed bodies.
- Built-in inbound webhook policy templates (`legacy_bearer`,
  `signed_standard`, `signed_strict`, and `custom`) with strict API parsing,
  public template labels, and automatic custom derivation after policy edits.
- Revisioned inbound webhook signature policies that let Ops require or relax
  HMAC verification and tune timestamp tolerance through bounded API and
  Workbench controls without exposing tokens or rewriting delivery evidence.
- Atomic webhook token rotation with immediate previous-token revocation,
  fingerprint-only ledger evidence, inline confirmation, and one-time
  replacement display. Channel create/status/retry-policy/signature-policy and
  token-rotation responses are no-store and expose channel projection hashes,
  status, revision, policy template, and token fingerprint headers without
  hashing raw one-time tokens.
- Channel list responses are no-store, token-free, and expose a content
  SHA-256 plus total/active/disabled channel count headers for operator
  polling and CI smoke checks.
- Bootstrap is now no-store and content-hash-bound as a whole response while
  still mirroring channel-list digest/count headers and adapter catalog
  digest/count/adapter-ID set headers for decomposed drift checks.
- `/api/channels/adapters` now mirrors the same no-store adapter catalog digest,
  adapter count, and adapter-ID set hash headers used by Bootstrap for drift
  checks.
- Delivery-derived channel trigger IDs that preserve stable deduplication
  without indirectly exposing the full idempotency-key digest.
- Revisioned per-channel retry policies with one-to-ten attempt bounds,
  configurable base delay, immutable delivery policy snapshots, pre-Run
  exponential backoff, due-time sweeps, and attempt-specific trigger IDs.
- Versioned dead-letter JSON exports with retry disposition, message hashes,
  stored body/catalog SHA-256 evidence, current catalog comparison status,
  top-level qualified/missing/drift summary counts, canonical content SHA-256,
  no queued message/authentication material, matching response hash/count
  headers, channel/thread identity, delivery-ID set hashes, retry-disposition
  counts, and Ledger audit events with the same counts. Dead-letter exports now
  use `napier-dead-letters-<safe-channel-id>-<content-hash>.json` filenames
  across Automations and direct API attachment headers. Operators can upload the
  artifact to a no-store verifier that recomputes the canonical hash and checks
  delivery and qualification summaries while mirroring declared/recomputed
  hashes and observed counts. A two-phase retry preview/apply flow binds
  explicit replay confirmation to the preview SHA-256 and top-level delivery ID
  set summaries repeated in the apply receipt. Preview/apply responses now
  mirror channel identity, verification status, candidate/diagnostic counts,
  retry/skipped counts, and public set hashes in response headers. A no-store
  retry history projection now lists prior bulk apply events with event IDs, seq
  boundaries, event-set hashes, apply result hashes, counts, and public hash
  summaries for operator audit. Retry-history downloads expose direct-download
  content-disposition plus channel/thread identity, content/event-set hash,
  event-count, first/last seq headers, and
  `napier-dead-letter-retry-history-<safe-channel-id>-<content-hash>.json`
  filenames across Automations and direct API attachment headers. The projection can be posted back to
  a no-store verifier that recomputes the current Ledger-derived hashes and
  reports drift while exposing status and observed content/event-set/count/seq
  headers for machine checks.
  Automations exposes download, upload, and verification controls from the
  retry-history card.
- Fail-closed manual retry for failed or restart-unknown deliveries, including
  explicit side-effect confirmation, replayable requested/started/terminal
  events, and no-store retry response headers for content hash, status, attempt
  counts, revision, channel/thread/delivery/trigger identity, optional Run ID,
  fingerprint, public evidence hashes, and next-attempt timing.
- Active-only delivery polling that refreshes accepted, running, and retrying
  UI projections, then stops automatically at terminal state.
- Background schedule and channel workers with bounded sweeps, restart
  reconciliation, caught background failures, and graceful shutdown.
- Schedule and channel REST APIs that expose fingerprints and receipts without
  serializing raw lease tokens, bearer tokens, idempotency keys, queued
  messages, or model overrides.
- Extension management API and Paper Ledger inspector covering proposal,
  approval, discovery, tool review, and enablement as replayable events.
- Lazy-loaded Extensions Workbench with HTTP/stdio transport selection,
  absolute-executable validation, one-argument-per-line parsing,
  workspace-scoped cwd, secret-free environment source mappings, derived
  capability review, per-tool routing-hint review controls, and persisted
  approved-state rendering across reloads.
- Paper Ledger Publisher & Package Desk with signer/public-key enrollment,
  two-step revocation, eligible-catalog signing and JSON download, offline file
  verification, trusted file import, stamped hash receipts, package provenance
  cards, keyboard-native controls, and 285px Inspector containment.
- Paper Ledger package revision ticket with current/candidate identity,
  version-direction stamps, frozen change tags, capability/tool/routing-hint
  deltas, review-reset warning, risk confirmations, package history counts,
  and keyboard-native apply/discard controls.
- Paper Ledger Atomic Package Deployment ticket with multi-file selection,
  install/update stamps, signed dependency rows, resolved-source evidence,
  dependency-first order, set-wide risk confirmations, no-op blocking, and
  285px Inspector containment.
- Paper Ledger lockfile export and verification flow that downloads the current
  signed package graph, accepts a lockfile in deployment file selection, unfolds
  it into envelopes, and preserves the deployment CAS/review-reset boundary.
- Paper Ledger rollout channel desk for publishing the current signed graph to
  a named lane, previewing its policy-bound lockfile as an atomic deployment,
  and applying it without inheriting source/tool/Agent approval.
- Paper Ledger channel index registry controls for signing/downloading
  summary-only rollout indices, verifying them offline, and displaying
  stamped index/envelope/channel-count receipts.
- Publisher/package REST APIs with bounded verification/import bodies,
  no-store verification/update/deployment/rollout previews, lockfile export and
  verification endpoints, hash-addressed rollout lockfile retrieval, rollout
  publish/apply endpoints, channel-index sign/verify endpoints,
  digest/key/content download headers, semantic 400/409 failures,
  cross-workspace package portability, and hash-only Ledger events that omit
  manifests, schemas, dependencies, signatures, public keys, private locators,
  and binaries.
- Extension package verify, update preview/apply, deployment preview/apply,
  lockfile verify, rollout list/publish/preview/apply, and channel-index verify
  responses now expose no-store content or artifact SHA-256 headers plus
  status, revision, CAS, package, dependency, install/update, and envelope-count
  headers for operator polling without expanding package bodies into headers.
- Extension package lockfile export and hash-addressed retrieval now also
  mirror dependency counts plus package-envelope, normalized package-name, and
  publisher-key set hashes without exposing manifests or signatures in headers.
- Skill package verify/qualify/install/list, Skill content preview/apply,
  Prompt package verify/qualify, and Inspector package verify/qualify responses
  now expose no-store content or artifact SHA-256 headers plus status, count,
  catalog, observed-drift, review, and key metadata headers without mirroring
  Skill instructions, Prompt text, or Inspector UI/source content.
- Restart reconciliation that marks orphan runs `interrupted`, closes in-flight
  subagents, repairs Thread state, and emits idempotent recovery evidence.
- Lease-gated branch materialization, preventing another local instance from
  mistaking an in-progress branch projection for abandoned work.
- Explicit SSE run recovery with parent-run linkage, unknown-side-effect
  warnings, durable evidence projection, and a dedicated Workbench checkpoint.
- Agent-level `manual | safe_read_only` recovery policy with bounded attempts
  and backoff, append-only profile revisions, rollback support, and schema-2
  Run fingerprint binding while preserving schema-1 hashes as manual-only.
- Metadata-only automatic-recovery assessments that bind the interrupted
  configuration and Run-local event stream, fail closed on unmatched
  `tool.started`, write/delegation tools, unknown effects, demo models,
  imported provenance, malformed chains, or exhausted attempt budgets, and
  reject report tampering through canonical SHA-256 validation.
- SQLite-CAS recovery claims with hashed worker-only tokens, renewable
  heartbeats, expired pre-Run claim takeover, deterministic root/attempt
  triggers, multi-instance deduplication, bounded restart-chain attempts, and
  durable claimed/running/terminal attempt hashes.
- Snapshot-bound automatic recovery execution using the interrupted Run's
  exact Agent revision and model under `safe_read_only_recovery`, forced
  `observe`, local list/read/search only, and no plan tools, Extensions,
  Subagents, verification processes, or Memory extraction.
- RecoveryService lifecycle integration, no-store Thread recovery REST,
  content hash plus assessment/attempt count headers, hash-only
  `run.recovery.auto.*` evidence backfill, graceful shutdown, and retained
  independent manual Resume behavior.
- Paper Ledger interruption controls in Context plus a live Ops recovery
  register with qualified/blocked/completed counts, canonical reason copy,
  source/event digests, narrow-layout containment, and keyboard-native order.
- Immutable replay snapshots with event-stream SHA-256, aggregate usage,
  output hashes, structured event/tool deltas, JSON export APIs, and no-store
  response headers for content hash, event-stream hash, run/thread IDs, event
  count, event sequence boundaries, duration, model/message/tool/subagent
  counts, token/cache totals, cost USD, and output-text hash.
- Prompt-redacted per-Run configuration fingerprints binding the actual model
  override, Agent revision, policies, canonical capability sets, effective
  limits, and system-prompt SHA-256 to an independent canonical content hash.
- Run Lab configuration-drift comparison with changed fields, capability
  additions/removals, both fingerprint hashes, and explicit unavailable state
  for legacy Runs rather than reconstructed history. Comparison responses are
  no-store and mirror content hash, left/right Run IDs, event-stream hashes,
  event counts, left/right Run metrics, right-minus-left metric deltas,
  event-type delta hashes, added/removed tool-set hashes, configuration delta
  status, changed-field and capability-set count/hash headers, output-changed
  status, and available configuration hashes.
- Fail-closed fingerprint validation in SQLite restore and full-thread fixture
  import, including exact-key and duplicate Run revision/limit consistency.
- Versioned full-thread replay fixtures covering Agent configuration, Runs,
  plans, evaluations, evaluation suites and executions, subagents, and ordered
  events, with independent canonical content/event-stream SHA-256 digests and
  a 10 MiB import boundary. Fixture exports mirror no-store content/event-stream
  hashes, thread ID, run/event counts, and event sequence boundaries in headers.
- Atomic fixture import with complete resource-ID remapping, recursive event
  payload reference rewriting, suite/execution/evaluation reference remapping
  and digest recomputation, trigger/lease removal, provenance retention, and
  fail-closed conversion of in-flight Runs, plan steps, and subagents.
- Portable automatic-recovery assessments and attempts with remapped
  Agent/Thread/root/source/child/attempt IDs, recomputed Run-local event,
  assessment, trigger, and attempt hashes, closed imported claims, and
  unconditional imported-history exclusion from new automatic recovery.
- Imported-history prompt boundaries that label the original sequence range as
  untrusted historical data and bind it to both source hashes.
- Public fixture attachment/import APIs and a Paper Ledger portable-ledger card
  with accessible file input, source digest, count register, transfer receipt,
  and automatic navigation to the imported Thread.
- Strict Thread replay import wrapper parsing that rejects unknown fields,
  missing bundles, and empty titles before fixture validation or state import.
- OpenTelemetry-compatible OTLP/JSON artifacts for complete Threads or single
  Runs, with deterministic 128-bit trace IDs, 64-bit span IDs, nanosecond
  timestamps, one Thread root, Run children, GenAI model/tool/Subagent spans,
  and metadata-only Ledger events.
- Strict OTLP validation for envelope keys, semantic-convention schema,
  AnyValue types, ID uniqueness, parent references, cycle freedom, child/event
  temporal containment, counts, source event hashes, artifact size, and stable
  content SHA-256.
- Privacy-safe trace projection that excludes prompts, completions, reasoning,
  tool I/O, Subagent text, review/evidence/error prose, credential labels,
  arbitrary user IDs, and key locators while retaining allowlisted resource
  IDs, status, model/tool metadata, usage, cost, durations, and hashes.
- No-store Trace export REST with content/trace/event-stream/span headers and
  `trace.otlp.exported` Ledger evidence containing only scope, IDs, counts, and
  hashes; streaming deltas and prior exports are excluded for deterministic
  repeated output.
- Trace export responses now also mirror Thread/Run IDs, event seq range,
  event counts, redaction mode, content-capture status, and excluded metadata
  counts in headers while keeping OTLP span details in the artifact body only.
- Paper Ledger Trace export card with complete-Thread or single-Run scope,
  OTLP download, span/event counts, artifact digest receipt, keyboard-native
  controls, and explicit metadata-only safety copy.
- Independent no-tool rubric evaluation with strict JSON parsing, preserved
  rubric snapshots, hash-bound evidence, fail-closed verdicts, and no-store
  evaluation list count/hash headers.
- Revisioned Evaluation Suites over one terminal baseline and 1–8 distinct
  terminal candidates, with immutable rubric/model/gate snapshots and
  semantic-change-only revision advancement.
- Quality gates for minimum conclusive pass rate, minimum candidate score, and
  explicit inconclusive policy, including fail-closed all-inconclusive
  batches.
- Per-case pair-evaluation SHA-256 and canonical batch content SHA-256 binding,
  with aggregate tamper validation, referenced-evaluation retention, SQLite
  restart recovery, and atomic fixture round trips.
- Evaluation Suite REST APIs and Ledger events for create, update, list, and
  execute operations without duplicating rubric descriptions into event
  payloads.
- Evaluation Suite create/update/execution responses now expose no-store
  suite/execution hashes, IDs, revisions, candidate/case counts,
  passed/failed/inconclusive aggregates, status, and pass-rate headers.
- Lazy Run Lab Evaluation Suite docket for baseline/candidate selection,
  thresholds, revision editing, execution status, score aggregates, and batch
  digests; only the current revision may present a current gate result.
- Self-contained `napier.evaluation-gate-receipt` artifacts containing the
  current suite snapshot, current-revision execution, and complete ordered
  pair evaluations under a stable canonical content SHA-256.
- Explicit `not_run` receipts after semantic suite revisions, strict receipt
  envelope/case/aggregate/hash validation, no-store attachment responses, and
  `X-Napier-Content-SHA256` for CI correlation.
- Evaluation Suite list, execution list, and gate receipt responses now expose
  no-store response hashes plus suite, execution, case, revision, candidate, and
  gate-state headers for machine polling. Gate receipt downloads now use
  `napier-gate-<safe-suite-id>-r<revision>-<content-hash>.json` filenames
  across direct API attachments and Workbench exports.
- Run Lab case evidence with verdicts, baseline/candidate means, pair hashes,
  five-entry execution history, and receipt download without moving those
  controls into the main browser chunk.
- Append-only human evaluation adjudication with one truth record per
  immutable pair evaluation, sequential revisions, semantic no-ops, bounded
  notes, evaluation SHA-256 binding, independent revision hashes, and no-store
  list headers for adjudication/revision counts.
- Reviewer ballot and consensus REST projections now expose no-store response
  hashes, ballot/revision counts, consensus status, reviewer/agreement counts,
  and consensus-resolution counts for CI polling.
- Evaluation create, adjudication write, reviewer ballot write, and consensus
  resolve responses now expose no-store hashes, IDs, revisions, verdict/status,
  reviewer/agreement counts, and report/resolution hashes for polling.
- Evaluator calibration reports grouped by provider/model and canonical rubric
  SHA-256, with exact agreement rates, complete 4×4 verdict confusion matrices,
  stable report hashes, no-store responses, digest headers, and sample/
  agreement/group count headers.
- Adjudication persistence validation, reviewed-evaluation retention,
  backward-compatible SQLite field migration, and fail-closed duplicate,
  cross-Thread, stale-hash, timestamp, or revision-tamper rejection.
- Portable adjudication fixtures with bounded schema validation, adjudication
  and evaluation ID remapping, recomputed evaluation/revision SHA-256 evidence,
  recursive Ledger reference rewriting, and legacy fixture compatibility.
- Evaluation adjudication/calibration REST APIs with `201` creation, `200`
  revision/no-op semantics, strict raw JSON validation, and hash-only
  `evaluation.adjudication.reviewed` Ledger events that omit review notes.
- Paper Ledger calibration register with review coverage, evaluator/rubric
  cohorts, matrix drill-down, inline truth revisions, agreement state, report
  digest, case-level expected verdicts, keyboard semantics, and reload
  persistence inside the lazy Run Lab chunk.
- Workspace-wide Evaluation Casebooks that curate only human-reviewed
  evaluations across Threads into revisioned, hash-bound gold sets.
- Append-only Casebook case registries with sorted revision manifests,
  semantic curation no-ops, explicit truth refresh, historical removal
  preservation, bounded case/revision counts, and linear evidence storage.
- Case snapshots binding complete model evaluation, selected adjudication
  revision, source IDs, rubric/evaluation/adjudication hashes, timestamp, and
  independent canonical case SHA-256.
- Casebook calibration through the shared sample/cohort/confusion-matrix
  protocol, plus 10 MiB `napier.evaluation-casebook` artifacts with stable
  generation-time-independent hashes and no-store digest headers.
- Strict Casebook transition and artifact validation covering duplicate,
  unreferenced, conflicting, non-canonical, future-timestamp, and tampered
  evidence, with atomic SQLite persistence and CAS retries.
- Online deduplicating migration from the development embedded-case revision
  shape to the append-only registry/manifest representation, persisted once
  without deleting historical evidence.
- Casebook REST APIs and hash-only Ledger events for create, metadata revision,
  curate, refresh, remove, calibration, list, detail, and export operations.
- Casebook create/update/curate/remove and qualification execution responses
  now expose no-store Casebook or execution hashes, revision/case counts,
  audit Thread IDs, status, sample/agreement/inconclusive/unverified counts,
  and agreement-rate headers.
- Paper Ledger Casebook archive with cross-Thread curation, stale-truth refresh,
  two-step removal, cohort agreement, revision history, artifact download, and
  reload-persistent state inside the lazy Run Lab chunk.
- Executable Casebook qualification over the current revision, with selectable
  evaluator, minimum exact-agreement gate, explicit inconclusive policy, and
  no-tool re-judging that does not create ordinary pair-evaluation history.
  Each execution is still represented as a completed qualification Run, so its
  model calls and final hash-level completion event remain replayable.
- Per-case source replay reconstruction and dual snapshot-hash verification;
  missing or drifted evidence bypasses the evaluator and forces the
  qualification execution to fail closed as `inconclusive`.
- Canonical qualification execution hashes over revision, audit Thread, model,
  gate, case order, expected/actual verdicts, scores, evidence state, counts,
  agreement rate, and final status, with strict structural/tamper validation.
- SQLite-backed qualification history with current-revision save protection,
  latest-20 retention per Casebook, legacy missing-field migration, restart
  validation, and hash-only completion Ledger events.
- Self-contained `napier.evaluation-casebook-qualification-receipt` artifacts
  that cannot borrow an execution from a prior Casebook revision, including
  explicit `not_run`, no-store attachment responses, and digest headers.
- Evaluation Casebook list/detail, calibration, export, qualification history,
  qualification receipt, and baseline-list responses now expose no-store hashes,
  case/revision counts, qualification status totals, and baseline digests for
  machine polling.
- Paper Ledger qualification desk with keyboard-operable model/gate controls,
  case-level verdict and source-hash evidence, revision-aware execution
  history, receipt download, reload persistence, and corrected vertical
  Inspector scrolling.
- Independent multi-reviewer ballot lanes per immutable evaluation, with
  normalized reviewer IDs, display-name snapshots, bounded notes, append-only
  revisions, semantic no-ops, evaluation binding, and canonical revision
  SHA-256.
- Consensus reports with 2–9 reviewer quorum, 50%–100% exact-agreement gates,
  unique-leader enforcement, explicit inconclusive policy, four-verdict
  distributions, stable generation-time-independent hashes, and no-store
  preview responses.
- Atomic consensus resolution that recomputes current votes, appends
  `reviewer_consensus` provenance to Human Truth, persists the exact report and
  adjudication revision in one SQLite commit, and deduplicates repeated report
  hashes.
- Privacy-safe reviewer Ledger events that retain reviewer lane IDs, verdicts,
  revision numbers, and hashes while omitting display names and private ballot
  rationales; direct adjudication rejects client-supplied provenance fields.
- Portable reviewer ballots and consensus resolutions with collision-free ID
  remapping, ordered ballot/report/adjudication/resolution hash recomputation,
  missing-provenance rejection, and backward-compatible optional fixture
  fields.
- Consensus-derived Casebook cases that freeze exact ballot histories and the
  matching resolution, making panel-reviewed gold-set artifacts
  self-contained and fully covered by the case SHA-256.
- Paper Ledger reviewer sign-off desk with roster editing, verdict
  distribution, quorum/agreement controls, readiness states, explicit truth
  resolution, provenance labels, keyboard flow, and reload persistence.
- Workspace-global Ed25519 receipt trust anchors with canonical SPKI public
  keys, SHA-256 key IDs, environment-backed local signing or verify-only
  import, bounded registries, duplicate rejection, and irreversible
  revocation.
- `napier.trusted-receipt-envelope` artifacts for Evaluation Suite gates and
  Casebook qualification receipts, with domain-separated statements binding
  stable content SHA-256, complete artifact SHA-256, signer, and signing time.
- Deep offline receipt verification that replays nested gate/qualification
  validators before classifying signatures as `trusted`, `revoked`,
  `unknown_key`, or `invalid`, including time-metadata and signature tamper
  rejection.
- Append-only passing qualification baselines that freeze the complete signed
  envelope, exact Casebook revision and execution, supersede prior pins,
  preserve referenced execution history, and become stale or revoked without
  borrowing old qualification results. Baseline promotion responses now expose
  no-store result hashes, created flags, baseline/execution hashes, receipt
  artifact hashes, envelope hashes, and signer key IDs for release gating.
- Strict trust REST APIs with no-store signed downloads, digest/key headers,
  bounded verification uploads, semantic conflict status codes, and
  privacy-safe Ledger events that omit key locators, public-key bytes, private
  keys, signatures, and receipt bodies.
- Evaluation Casebook artifact and qualification receipt downloads now use
  `napier-casebook-<safe-casebook-id>-r<revision>-<content-hash>.json` and
  `napier-casebook-qualification-<safe-casebook-id>-r<revision>-<content-hash>.json`
  filenames across direct API attachments and Workbench exports.
- Receipt Trust anchor list/create/revoke and verifier responses now expose
  no-store hashes, anchor state/count headers, key IDs, verification status,
  signature validity, and integrity validity for machine audit.
- Paper Ledger receipt trust desk with local-signer and verify-only enrollment,
  selectable signing identity, two-step revocation, JSON envelope verification,
  signed Suite/qualification receipt downloads, and stamped baseline state.
- Incremental context compaction with verified source/summary hashes, recent
  raw-message retention, reusable parent checkpoints, no-tool strict-JSON
  summaries, explicit fallback evidence, hash-bound calibration reports, and
  Goal evaluator reuse.
- Context Inspector checkpoint cards for coverage, continuity summary,
  decisions, open loops, artifacts, both evidence hashes, calibration hash,
  coverage rate, compression, and fallback counts.
- Repository-root workspace inference for npm workspace production starts,
  while preserving explicit `NAPIER_WORKSPACE` overrides.
- Dependency-aware durable execution plans, evidence-gated step transitions,
  same-Thread run ownership, first-wins terminal outcomes, and restart
  reconciliation for unknown in-flight work, plus persisted critical-path,
  ready-step, and blocked-step projections.
- Internal planning tools and artifact manifests with workspace confinement,
  actual file observation, runtime-computed SHA-256, and bounded hashing.
- Plan APIs and a Paper Ledger Plan Workbench for DAG progress, critical-path
  scheduling, verification criteria, blockers, evidence, artifact status, and
  source hashes.
- Bounded strict JSON parsing for Plan creation, step transition, and artifact
  settlement APIs, rejecting unknown fields and malformed IDs, status values,
  digests, sizes, or oversized bodies before runtime state mutation.
- Governed Plan replanning with revision compare-and-swap, explicit
  recover-blocked/scope-change/artifact-drift strategies, dependency
  redirection, superseded stale steps/artifacts, appended replacement work, and
  hash-bound replan history exposed through REST, Agent tools, Ledger events,
  and the Plan Workbench.
- Hash-bound Plan replan recommendations for blocked critical paths and missing
  artifacts, exposed in the Plan projection, Agent tool results, and Workbench
  signal cards with the expected revision for the next replan CAS.
- Generated `napier.plan-replan-draft.v1` replacement-plan drafts attached to
  replan recommendations, including blocked-step recovery steps, downstream
  dependency rewrites, missing-artifact restore steps, and replacement artifact
  manifests plus deterministic score/risk evaluation that still require normal
  replan CAS before mutation.
- Model/thinking-specific replan policy templates in Agent planning-tool
  output, with conservative/balanced/expansive postures, bounded checklists,
  review instructions, and canonical template SHA-256 evidence.
- No-store replan draft model-review artifacts for active recommendations,
  binding model score/risk/verdict to the recommendation SHA-256, draft hash,
  deterministic evaluation hash, prompt hash, response hash, and final review
  hash without mutating Plan state or bypassing replan CAS. Live review
  artifacts also bind the request's hash-only model-context envelope without
  copying plan or draft text. The Plan Workbench renders the request envelope,
  review receipt, and response hashes beside explicit draft application through
  normal replan revision CAS.
- Plan list, create, replan, step transition, artifact settlement, and replan
  draft review responses now expose no-store hashes, plan status/revision
  headers, step/artifact/replan counts, scheduling projection counts, and active
  recommendation/review digests for machine polling.
- Pi-compatible credential references for environment-variable names and
  macOS Keychain service/account locators, with transient resolution,
  availability checks, fail-closed missing references, and metadata-only
  audit events.
- Credential list/create/check/status and macOS Keychain write responses now
  expose no-store hashes, status/availability counts, provider/source-type
  headers, revision headers, and last-check timestamps without mirroring secret
  locators or secret bytes into headers.
- Bounded macOS Keychain credential writes that accept a secret once, call the
  Keychain vault adapter, persist only the provider locator, and keep Ledger
  events secret-free.
- Revisioned Agent configuration persistence and validation for default model,
  thinking level, policy, tools, skills, delegation roles, and bounded
  parent-Run/Subagent budgets.
- Canonical, hash-bound Agent profile snapshots for every semantic revision,
  including changed-field provenance, System Prompt SHA-256, source, and
  tamper validation without copying Prompt text into Ledger events.
- Schema-3 Run configuration fingerprints that bind the enabled Skill catalog
  SHA-256, plus `context.skills` Ledger evidence containing Skill names,
  relative paths, byte counts, diagnostics hashes, and file SHA-256 values
  without copying Skill instructions.
- Automatic recovery Skill-catalog drift blocking: schema-3 interrupted Runs
  recompute the current enabled Skill manifest before recovery and abandon the
  claim without creating a child Run when the hash has changed.
- Skill package signing, verification, and workspace qualification APIs backed
  by the Extension publisher trust domain, with no-store responses, digest
  headers, and hash-only Ledger events.
- Extension publisher anchor list/create/revoke responses now expose no-store
  hashes, trusted/revoked/signing-capable counts, key IDs, anchor IDs, and
  status headers for package-provenance polling.
- Reviewed Skill package installation baselines that persist only qualified
  signed catalogs, require explicit active-baseline replacement confirmation,
  require separate publisher/key and loaded Skill-set change confirmations, and
  record hash-only install/replacement Ledger evidence.
- Reviewed Skill content preview/apply APIs that validate bounded `SKILL.md`
  text, fix the target to `skills/<name>/SKILL.md`, require a stable review
  SHA-256 plus explicit install/replacement confirmation, expose hash-only
  byte/line diff metadata and frontmatter/body hashes, write through the
  hash-preconditioned atomic workspace writer, and keep Ledger evidence
  hash-only.
- Prompt package signing, verification, and Agent qualification APIs backed by
  the Extension publisher trust domain, freezing Agent revision SHA-256 and
  System Prompt SHA-256 without copying prompt text into envelopes or Ledger
  events.
- Inspector package signing, verification, and Workbench qualification APIs
  backed by the Extension publisher trust domain, freezing the Inspector
  catalog SHA-256, panel IDs, panel capabilities, and default panel with
  hash-only Ledger events.
- CAS-protected migration of legacy SQLite state to one persisted `migrated`
  baseline, with duplicate, missing-current, future-revision, and hash-drift
  validation at startup.
- Append-only Agent rollback that verifies model availability, previews exact
  field differences, requires a second confirmation, and restores historical
  values only by creating a new revision with `agent.rolled_back` evidence.
- Agent profile update, revision-history, and rollback responses now expose
  no-store response hashes, Agent revision headers, profile revision hashes,
  System Prompt hashes, changed-field counts, and rollback source hashes.
- Optional Agent revision ledgers in schema-version-1 portable fixtures, with
  backward-compatible validation, Agent ID remapping, hash recomputation, and
  atomic import.
- Context Workbench profile editing and credential-reference registration,
  checking, enablement, and disablement without any secret-value input.
- Paper Ledger configuration history cards with source/current status,
  changed-field tickets, profile/prompt digests, rollback provenance, and
  reload-persistent confirmation flow.
- Context Workbench Atomic patch and Sandbox verify capability selection with
  policy guidance, plus Software Delivery skill instructions that require
  fresh read hashes, exact replacements, and evidence-aware verifier outcomes.
- Context Workbench parent-Run budget controls for model turns, total tokens,
  maximum USD cost, and wall time, with reload-persistent revisioned values.
- Context Workbench Skill package baseline desk for signing, verifying,
  qualifying, and installing reviewed hash-only Skill catalog baselines with
  separate replacement, publisher/key, and Skill-set risk confirmations.
- Context Workbench Skill content desk for loading or pasting `SKILL.md`,
  previewing action/review hashes and byte/line deltas, requiring
  install/replacement confirmation, and applying reviewed content writes with
  hash-only receipts.
- Context Workbench Prompt package desk for signing, verifying, and qualifying
  hash-only Agent prompt baselines against the current revision.
- Lazy-loaded Evaluation Suite, Memory, Extensions, Context, and Automations
  inspectors that preserve the production main entry at 120.81 kB
  uncompressed; their chunks remain at 50.81 kB, 8.66 kB, 35.34 kB, 57.05 kB,
  and 30.04 kB respectively.
- Paper Ledger Automations register for creating and pausing schedules,
  selecting webhook adapters, creating and disabling channels, dismissing
  one-time token tickets, previewing adapter mappings, revising delivery policy,
  inspecting attempts, confirming safe retries, and exporting hash-bound dead
  letters.
- Paper Ledger workbench with conversation, Trace, Run Lab, Plan, Goal, Memory,
  Extensions, Automations, and Context views.
- Per-run selection across server-discovered, configured model providers.
- Unit coverage for policy boundaries, sandbox argument derivation, event
  ordering, and complete demo runs.
- Transaction fault-injection, simultaneous bootstrap, legacy migration,
  schema-history migration, authorization-material persistence, and
  concurrent-writer coverage for the SQLite ledger.
- Scripted Pi provider coverage for incomplete → continuation → verified goal
  completion.
- Production static serving and a Preact compatibility build under the 150 kB
  main-entry budget.

### Changed

- Made the compatibility `Thread.currentRunId` projection deterministic for
  same-millisecond concurrent Workflow Runs by using persisted Thread Run order
  after start time instead of random Run ID ordering.
- Recovered Web main-entry budget by moving the large Plan Workbench copy block
  into the lazy Plan chunk. The checked Web dist audit now reports the main
  entry at 140.15 KiB while keeping Plan tests and release receipts current.
