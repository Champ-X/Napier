# Napier Architecture

Reviewed on **2026-09-09** against source baseline `02ff34a5`. This reference
covers the current architecture and links to its implementation. Check results
and open issues live in [Current gaps](next-stage-gap-matrix.md); setup and
commands live in [Local development](local-development.md).

The former implementation narrative, completed plans, and dated measurements
are available through the [Git history index](archive/README.md). They are not
current acceptance results or an active roadmap.

## Product Thesis

Napier is a local Agent workbench built around a durable, ordered evidence
ledger. Conversation, task progress, approvals, artifacts, and execution traces
are projections of shared records. Web, CLI, RPC, and SDK use the same Runtime.

The system combines mutable domain snapshots with append-only events and
incremental projections. It is not pure event sourcing: events alone do not
reconstruct every workspace entity or the state of external tools.

## Layers

| Package                 | Responsibility                                                                        | Napier package dependencies |
| ----------------------- | ------------------------------------------------------------------------------------- | --------------------------- |
| `@napier/contracts`     | Serializable domain types, versioned events, tool and transport contracts             | None                        |
| `@napier/runtime`       | Kernel, Agent execution, model routing, tools, persistence, recovery, evaluation      | Contracts                   |
| `@napier/server`        | Hono HTTP validation, management routes, SSE, workspace selection, static Web hosting | Contracts, Runtime          |
| `@napier/web`           | Conversation, task, evidence, settings, and trace views                               | Contracts                   |
| `@napier/cli`           | One-shot execution, interactive CLI/TUI, stdio RPC, setup and diagnostics             | Contracts, Runtime          |
| `@napier/sdk`           | Typed local clients, execution handles and management API                             | Contracts, Runtime          |
| `@napier/benchmark-kit` | Task fixtures, outcome benchmarks and evidence verification                           | CLI, Contracts, Runtime     |
| `@napier/harness-eval`  | Controlled Harness experiments and acceptance evidence                                | Contracts, Runtime          |

The Runtime has no Hono or UI dependency. The Web uses React APIs with
`preact/compat` aliases in its [Vite configuration](../apps/web/vite.config.ts).
CLI and SDK create a local Runtime without requiring an HTTP server.

The [shared bootstrap](../packages/runtime/src/local-agent-runtime.ts) assembles
Store, credentials, model registry, extensions, sandbox and execution services.
The [Kernel](../packages/runtime/src/kernel.ts) provides service/plugin lifecycle,
model and tool pipelines, and evidence projections. The
[Server composition root](../apps/server/src/server-composition-root.ts) adapts
these services to transports.

## Core Contracts

- **Configuration is bound to the Run.** Agent revisions, model choices,
  capabilities, prompts, Skills and budgets have snapshots or hash-bound
  receipts. Later profile edits do not silently rewrite a running task.
- **Persist before presenting.** Durable events and domain transitions precede
  the corresponding user-facing execution projections.
- **Sequence is Thread-local.** `RunEvent.seq` orders evidence within a Thread;
  event identity and transaction rules prevent duplicate or conflicting writes.
- **Discovery does not grant authority.** A visible tool still passes schema,
  policy, approval, workspace and sandbox checks at dispatch time.
- **Control decisions use current evidence.** Revision checks, Run-head checks,
  leases and terminal fences reject stale writes and competing settlement.
- **Unknown effects remain unknown.** Recovery cannot treat a timeout or a
  missing receipt as proof that an external operation never happened.
- **Execution is bounded.** Parent and child budgets, cancellation, tool-loop
  protection and recovery limits constrain autonomous work.
- **Hashing and authentication are separate.** Hashes bind content; trusted
  signatures bind a publisher or receipt authority. Neither proves task quality.

Additive event types and optional fields preserve older readers. Renames,
required-field changes and incompatible meanings need explicit version handling.
The [compatibility ledger](compatibility-ledger.json) owns supported legacy
readers, migrations, fixtures and removal criteria. Bundled `skills/` are Runtime
resources, not repository-wide developer instructions.

Sources: [Run contracts](../packages/contracts/src/execution-runs.ts),
[event writer](../packages/runtime/src/run-event-writer.ts),
[Run configuration](../packages/runtime/src/run-config.ts),
[tool protocol registry](../packages/runtime/src/tool-protocol-registry.ts).

## Persistence

```text
.napier/
  ledger.sqlite        authoritative domain snapshots and ordered events
  ledger.sqlite-wal    write-ahead log while SQLite is active
  workspace.json       compatibility projection
  events/*.jsonl       compatibility projections
```

SQLite uses WAL and `synchronous=FULL`. Transactions commit domain changes and
related events together; `(thread_id, seq)` enforces sequence uniqueness.
Workspace revision compare-and-swap protects concurrent mutation. Event-only
writes avoid rewriting unrelated workspace state.

`LocalStore` remains a facade over domain repositories and query/mutation ports.
Compatibility JSON/JSONL files support migration and older readers; they are
outside the authoritative SQLite commit path. Preserve their supported migration
and rollback behavior until the compatibility ledger permits removal.

Lease ownership governs Run settlement. An expired lease does not terminate a
system call already in progress; effect boundaries and recovery assessment still
matter. Filesystem changes and SQLite commits do not share a general ACID
transaction, so hashes, backups, compensation and explicit uncertainty records
cover the remaining boundary.

Sources: [Store](../packages/runtime/src/store.ts),
[repository host](../packages/runtime/src/store-repository-host.ts),
[SQLite schema](../packages/runtime/src/sqlite-ledger-schema.ts),
[terminal commit](../packages/runtime/src/sqlite-terminal-commit.ts),
[compatibility projections](../packages/runtime/src/store-compatibility-projections.ts).

## Agent Configuration And Credential Flow

Agent profiles are revisioned Runtime inputs. Saving a semantic change produces
a new revision; rollback creates another revision rather than editing historical
snapshots. A per-run model override is separate from saving the Agent default.

The model route resolves role, provider, credentials and Harness configuration.
Attempts record the requested and serving models. Fallback is constrained by
visible output, tool effects and recoverability; it cannot blindly replay an
uncertain operation or mix serving models in a same-model comparison.

Credential references resolve locally. Public events and retained evidence use
redacted data or identity hashes where required; profiles, local conversations
and permitted capsules can still contain content. Local-first operation does not
mean that external model requests avoid network transmission.

Sources: [profiles](../packages/runtime/src/agents.ts),
[credentials](../packages/runtime/src/credentials.ts),
[model routing](../packages/runtime/src/agent-run-model-route.ts),
[Harness resolution](../packages/runtime/src/model-harness-resolution.ts).

## Run Flow

```text
prompt / resume / workflow / scheduled input
  -> validate input and current Thread state
  -> create a leased Run with revision, configuration and limits
  -> persist start and user-input evidence
  -> assemble approved capabilities, Skills, memory and context
  -> execute model turns through the Kernel/Pi pipeline
  -> dispatch tools through shared policy and effect boundaries
  -> persist model, tool, progress and usage evidence
  -> apply completion, goal and budget decisions
  -> settle the Run under its lease and terminal fence
  -> return the final Thread projection
```

The primary Agent, optional advisor, compactor, goal evaluator, memory extraction
and subagents have distinct responsibilities. Auxiliary model usage still counts
toward the appropriate shared budgets. Goal completion is assessed from evidence;
a final assistant paragraph is not sufficient proof of success.

Sources: [AgentRuntime](../packages/runtime/src/agent-runtime.ts),
[step lifecycle](../packages/runtime/src/agent-runtime-step-lifecycle.ts),
[completion lifecycle](../packages/runtime/src/agent-run-completion-lifecycle.ts),
[terminal fence](../packages/runtime/src/run-terminal-projection-fence.ts).

## Run Budget And Progress Flow

Run limits cover turns, calibrated token usage, cost and wall time. Checks occur
before requests and after responses; one provider response may exceed an exact
remaining amount. Its evidence is retained while further tool effects and model
calls are blocked as appropriate. These are execution controls, not a guarantee
of an exact external bill.

Progress vector v3 separates semantic progress, delivery readiness and activity.
New observations or distinct artifact states can justify bounded continued work
without declaring the task complete. Repeated reads and A-to-B-to-A changes do
not indefinitely renew that window.

The default no-progress threshold is six turns. Recent activity can extend a
semantic-stall window up to three times that threshold, within the existing
180-second limit. After a redirect, eligible recent work gets a bounded finishing
window whose start does not slide on later actions or recovery.

Acquisition policy distinguishes internal retries from actual model strategy
turns. Plan updates declare coordinate/control effects and do not consume opaque
tool allowances. Tool Loop Guard and overall Run budgets remain independent.

Sources: [budgets](../packages/runtime/src/run-budget.ts),
[activity](../packages/runtime/src/run-progress-activity.ts),
[convergence policy](../packages/runtime/src/run-convergence-policy.ts),
[directive state](../packages/runtime/src/run-progress-directive-state.ts),
[progress investigation](investigations/2026-09-08-run-progress-interruptions.md).

## Context Compaction Flow

There are two complementary checkpoint paths:

| Path           | Input and boundary                                                                               | Events                                                      |
| -------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Thread history | Conversation history prepared for a Run; newest raw messages plus a verified incremental summary | `context.compaction.completed` / `failed`                   |
| Active Run     | Older complete execution units, projected immediately before a model request in the same Run     | `context.run_compaction.completed` / `failed` / `projected` |

Thread-history compaction binds the covered event range, summary hash and parent
checkpoint. Invalid checkpoints are ignored. Failure falls back to a valid
checkpoint and bounded uncovered messages, with omitted counts recorded.

The active-Run path operates after deterministic tool-result pruning and before
the final token governor. It measures the actual serving model, compiled prompt,
tool definitions, images and output/reasoning/safety reserves. Default pressure
triggers at 80% of the available input budget and targets 60%.

A compaction unit includes an assistant tool-call batch and all matching results.
User messages and images remain intact, and the latest complete execution unit
is retained. Incremental summaries use `summary`, `decisions`, `openLoops` and
`artifacts`; auxiliary calls have no tools and consume the original Run budget.
Each accepted batch must advance the source boundary and reduce estimated input
by at least 128 tokens. Failed prefixes are not retried on every later request.

Checkpoints change the model-input projection, not the Pi transcript, Ledger or
stored tool capsules. They do not create a Run, replay tools, reset budgets or
increase semantic progress. A protected working set that still exceeds the model
window produces an explicit failure instead of silently discarding user input.

`context.projected` links the Run compaction receipt to token-pressure evidence
and the actual model request envelope. Replay verifies source, summary, parent
and response bindings. Thread import remaps Run identities and dependent receipts.

Sources: [Thread compactor](../packages/runtime/src/compaction.ts),
[context projection](../packages/runtime/src/context-projection-service.ts),
[Run compactor](../packages/runtime/src/run-context-compaction.ts),
[batch boundaries](../packages/runtime/src/run-context-compaction-boundary.ts),
[implementation and recovery limits](investigations/2026-09-08-run-context-compaction.md).

## Tool And Workspace Flow

Tools have canonical contracts and model-visible schemas. Capability discovery
can make an approved tool reachable on a later step; every actual dispatch still
uses shared validation, policy, concurrency, budget, receipt and result-pruning
logic. Governed JS/Python nested calls use the same pipeline.

Workspace edits bind expected content hashes and canonical paths. Commit logic
rechecks preconditions, uses ordered cooperative locks and staged writes, and
records success, compensation or uncertainty. Other editors are not bound by
those locks. LSP edits, structured patches and subagent change application reuse
these boundaries instead of bypassing them.

### Workspace HTML Preview Flow

Generated deliverables belong to their Thread output directory. File inspection
keeps preview, source and recorded changes together. HTML previews serve local
assets within the approved directory; the iframe allows scripts without granting
same-origin authority. Raw source remains inert text.

Sources: [capability catalog](../packages/runtime/src/capability-catalog.ts),
[governed bridge](../packages/runtime/src/governed-code-bridge.ts),
[workspace commit](../packages/runtime/src/workspace-change-commit.ts),
[workspace sources](../packages/runtime/src/workspace-source.ts),
[HTML preview](../apps/server/src/workspace-html-preview-http.ts).

## Sandboxed Command Flow

Command execution uses an available sandbox adapter, including macOS
`sandbox-exec`, Linux `bubblewrap` or an OCI runtime. Processes, persistent code
sessions, LSP and debugger capabilities share workspace and lifecycle controls.
Browser sessions have their own network, interaction, confirmation and recovery
boundaries; a healthy session can survive an individual target-action timeout.

`NAPIER_HOST_DIRECT_SANDBOX=1` explicitly selects host authority without OS
isolation. Availability and guarantees depend on the chosen adapter and host;
local fixture success does not establish acceptance on another platform.

Sources: [sandbox](../packages/runtime/src/sandbox.ts),
[workspace processes](../packages/runtime/src/workspace-processes.ts),
[browser sessions](../packages/runtime/src/browser-session.ts),
[browser interaction policy](../packages/runtime/src/browser-run-interaction-policy.ts).

## Restart And Recovery Flow

Startup reconciles durable Run/lease records with interrupted work. Manual resume
creates a linked Run and uses the original configuration, model and capabilities
as required by its recovery contract. It does not restore an old process stack.

Automatic recovery is separate and opt-in. Eligibility requires trustworthy
configuration and linkage, an eligible interrupted Run, settled tool evidence and
bounded attempts. Restricted recovery does not replay unresolved side effects.
Durable claims, trigger deduplication, heartbeats and backoff coordinate attempts.

Operator decisions are durable request/answer/continue/cancel transitions. A
waiting task cannot bypass its pending decision through an ordinary prompt.
Workflow-managed Runs resume through their Plan and dependency scheduler.

Sources: [manual recovery](../packages/runtime/src/agent-run-recovery.ts),
[recovery contract](../packages/contracts/src/manual-run-recovery.ts),
[automatic eligibility](../packages/runtime/src/automatic-recovery.ts),
[recovery service](../packages/runtime/src/recovery-service.ts).

## Plans, Delegation, Memory And Extensions

| Domain                  | Current boundary                                                                                                                                | Source                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Plans and Workflow      | Dependency-aware steps, versioned transitions, artifact manifests and managed recovery; a successful tool call alone is not artifact acceptance | [Workflow Runtime](../packages/runtime/src/workflow-runtime.ts)                                      |
| Subagents               | Bounded child execution, typed outcomes, durable mailbox/steering/cancellation and explicit application of isolated worktree changes            | [Supervisor](../packages/runtime/src/subagent-supervisor.ts)                                         |
| Memory                  | Proposed facts require review, scope and expiry checks before injection; corrections preserve provenance                                        | [Memory](../packages/runtime/src/memory.ts)                                                          |
| Skills                  | Discovery and on-demand loading bind catalog, content and resources to the Run; Skill text does not grant tool authority                        | [Skill loading](../packages/runtime/src/skill-load-tool.ts)                                          |
| Extensions and MCP      | Provenance, capability review, schema discovery and last-moment policy/trust checks precede dispatch                                            | [MCP](../packages/runtime/src/mcp.ts)                                                                |
| Automation and channels | Scheduled/inbound work uses shared Runtime services, durable claims and deduplication                                                           | [Automation](../packages/runtime/src/automation.ts), [channels](../packages/runtime/src/channels.ts) |

## Workbench And Transport

HTTP adapters validate bounded requests and expose snapshot/mutation endpoints
and SSE execution streams. CLI JSONL, stdio RPC and SDK have separate transport
shapes around shared Runtime behavior.

Kernel projections use version, provenance and event watermarks to reuse valid
cached state. Web stream handling checks ordering and reconciles final snapshots;
a channel containing only some Thread events cannot require every received
sequence to increase by exactly one.

Conversation, Task and Trajectory share one shell and evidence model. Current
visual values and component guidance are owned by [DESIGN.md](../DESIGN.md),
including the canonical JSON used to generate CSS tokens.

Sources: [HTTP application](../apps/server/src/app.ts),
[Run stream](../packages/runtime/src/run-stream.ts),
[Kernel projections](../packages/runtime/src/kernel-projections.ts),
[Web stream reader](../apps/web/src/stream-run-api.ts),
[workspace view model](../apps/web/src/use-workspace-view-model.ts).

## Replay And Evaluation Flow

Replay verifies historical evidence and configuration bindings. Branching starts
a new Thread with selected historical context; it does not clone all external
state or imply that past tools executed again. Experiments can vary model,
message, tool or workflow inputs at their defined boundaries.

Evaluation uses explicit rubrics and bounded structured verdicts. Human
adjudication, calibration, Casebooks, suites and trusted receipts add independent
review layers. Controlled fixtures, same-model experiments, live-provider quality
and signed release acceptance have different evidence requirements.

Sources: [Run replay](../packages/runtime/src/run-replay.ts),
[branching](../packages/runtime/src/thread-branches.ts),
[evaluation](../packages/runtime/src/evaluation.ts),
[benchmark kit](../packages/benchmark-kit/package.json),
[Harness evaluation](../packages/harness-eval/package.json).

## Engineering Checks And Release Evidence

| Owner                                                                                             | What it constrains                                                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture budgets](architecture-budget.json) / `check:architecture`                           | File size, function complexity, dependency fan-out, static fan-in × fan-out coupling, workspace dependency direction, cycles and export declarations |
| [Repository hygiene](repository-hygiene-baseline.json) / `check:public-api`                       | Reviewed Runtime root/facade/internal symbols and package exports; production imports use supported entry points                                     |
| Repository hygiene / `check:desktop-scope`                                                        | Required desktop viewport declarations; responsive CSS and additional pressure cases are allowed                                                     |
| [Compatibility ledger](compatibility-ledger.json) / `check:compatibility-ledger`                  | Legacy reader ownership, migrations, fixtures and removal gates                                                                                      |
| [Design contract](../DESIGN.md) / `check:web-design`                                              | Generated token equality, contrast, CSS variables and literal-color/text-size debt                                                                   |
| [Performance](product-performance-budget.json) and [long-run budgets](long-run-scale-budget.json) | Declared local measurement profiles and scale limits                                                                                                 |

Architecture overrides record existing debt and ratchet downward when refactors
reduce it. The public API check binds semantic symbol names as well as counts;
adding a symbol behind an unchanged barrel can still change the public surface.
Use the owning configuration for numeric limits instead of duplicating them in
other guides. Static checks do not prove visual behavior or live task quality.

Root build/typecheck commands include a retained release-source manifest check.
Use the documented development build for local compilation. Updating prose or
passing focused tests does not refresh a release receipt. Source identity,
artifact integrity, target-host behavior and external publication are verified
by their respective workflows.

### S1 completion requires two independent external authorities

S1 sandbox completion requires both verified external publication evidence and
Windows host acceptance, with matching source and workflow authority. Local
readiness and a successful dispatch are insufficient. Promoted publication
receipts, retained authorities and packaged receipt bytes must agree; the
completion verifier also checks the relationship between release and current
source identities.

Sources: [S1 verifier](../scripts/check-s1-shell-sandbox-completion.mjs),
[publication workflow](../.github/workflows/publish-sandbox.yml),
[Windows workflow](../.github/workflows/windows-host-product-acceptance.yml),
[source manifest verifier](../scripts/release-product-source-manifest.mjs).

## Security Boundary

The HTTP service is designed for local use and applies Host/request restrictions.
A remote multi-user deployment needs its own authentication, authorization,
tenancy and execution-isolation design. Browser confirmation, approval state,
workspace boundaries and sandbox policy remain independent of tool discovery.

Private-source content can trigger hash-only text/reasoning projection. Other
permitted local content may be retained, so privacy claims must follow the actual
source and storage boundary. Secret redaction and signed provenance complement
these controls; content hashes alone are not an authentication mechanism.

Sources: [HTTP validation](../apps/server/src/http-request-validation.ts),
[private-source projection](../packages/runtime/src/private-source-model-content.ts),
[receipt trust](../packages/runtime/src/receipt-trust.ts).
