# Napier Next-Stage Gap Matrix

This matrix is re-audited from the current repository before each vertical
slice. It is not a feature wishlist or a substitute for task-success
benchmarks.

## Baseline

Audit date: 2026-07-29

- The Work Ledger, replay artifacts, Plans, evaluation, recovery, and
  extension governance are substantially ahead of the execution surface.
- `apps/server/src/app.ts` and `packages/runtime/src/store.ts` remain the
  largest production modules. New execution code must stay outside both.
- The Web main entry remains subject to the 150 KiB release gate.
- General host shell execution remains unavailable.

## Priority Matrix

| Priority                          | Current status | Highest-value remaining gap                                                                                                                                                                                                                                  |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 architecture and baseline      | In progress    | Split Server and Store by domain; add startup, first-token, tool-latency, long-thread, memory, and database-growth budgets.                                                                                                                                  |
| P1 managed work environment       | In progress    | Foreground commands, background Process Sessions, workspace drift, reversible file lifecycle, and bounded interactive stdin now exist. Python kernels, PTY, write sessions, hard CPU/memory quotas, remote sandboxes, and cross-restart reattachment remain. |
| P2 coding intelligence            | Partial        | Hashline, bounded symbols, one-file TypeScript LSP diagnostics, and automatic write-linked diagnostic deltas exist; persistent LSP navigation/rename/Code Actions, DAP, AST edits, test/symbol association, and isolated subagent worktrees remain.          |
| P3 browser/research/data/media    | Early          | Structured local data and research Skills exist; persistent browser sessions, source unification, SQL/DataFrame/Notebook, and media production do not.                                                                                                       |
| P4 executable Workflows           | Early          | Plans and Blueprints are durable data; typed executable nodes, checkpoint reruns, SDK manifests, and JSONL workflow events do not.                                                                                                                           |
| P5 controlled re-execution        | Early          | Evidence replay and comparison exist; checkpoint forks, frozen/replaced dependencies, side-effect simulation, and single-step reruns do not.                                                                                                                 |
| P6 product entry points           | Early          | Web Workbench and HTTP/SSE exist; CLI/TUI, one-shot JSONL, SDK/RPC, ACP, and Desktop are not product-complete.                                                                                                                                               |
| P7 extension developer experience | Partial        | Signed MCP packages are deep; stable extension SDK, UI cards, hot reload, ecosystem discovery, and compatibility suites remain.                                                                                                                              |
| P8 models and memory              | Partial        | Pi providers, credentials, and reviewed facts exist; dynamic catalogs, local/custom providers, routing policies, semantic memory, decay, and correction retrieval remain.                                                                                    |
| P9 outcome benchmark              | Not started    | Build fixed Coding, Research, Workflow, Long-horizon, Tooling, Security, and UX tasks with environment and Ledger evidence.                                                                                                                                  |
| P10 team/distributed              | Deferred       | Do not prioritize Postgres, distributed workers, RBAC, or collaboration before the local P0-P9 acceptance gates.                                                                                                                                             |

## Completed Slice: Read-Only Sandboxed Commands

User scenario: an Agent can run a real Node diagnostic when structured read
tools and the fixed verifier are insufficient.

Acceptance:

- explicit argv only; no user-provided shell command string;
- canonical workspace-relative cwd;
- read-only workspace and denied network capability;
- fixed secret-free environment;
- foreground output capture with independent stdout/stderr caps;
- non-zero exit, timeout, output cap, cancellation, unsupported backend,
  concurrency, and path-escape behavior covered by tests;
- command arguments and output text available to the live model but redacted
  from Ledger and Trace, with stable hashes retained for replay and loop
  detection;
- enabled through the revisioned Agent profile and visible in Context and
  Trace;
- real macOS Sandbox smoke available through `npm run test:live-command`.

Threat boundary:

- The selected runtime is an absolute allowlisted executable and is the only
  process executable admitted by the local OS sandbox profile.
- This slice does not grant workspace writes, inherited environment variables,
  networking, a PTY, background persistence, package installation, or a
  general shell.
- Wall time, output, and process-group termination are enforced. Local macOS
  and Bubblewrap adapters do not yet provide independently configured hard
  CPU/memory quotas; those remain a required managed-session or OCI follow-up.
- OCI execution is fail-closed until the executable identity observed on the
  host can be bound to the executable inside the image.
- Python and Git remain outside the runtime enum after live macOS testing
  showed their Developer Tools shims require broader transitive dependencies
  than this local slice should grant.
- An interrupted command has an unknown outcome and is not silently rerun.

Observed result:

- Unit and Agent integration tests cover success, failure, timeout, output
  cap, cancellation, concurrency, path escape, missing runtime, replay, and
  redaction.
- The live smoke completed through an independent macOS Terminal process,
  drove a scripted model through `AgentRuntime`, returned `napier@0.1.0` from
  the real sandboxed tool, and verified the Ledger redaction boundary. A smoke
  launched from inside an already sandboxed IDE process fails closed because
  macOS rejects nested `sandbox-exec`; this is an environment limitation, not
  a fallback to unsandboxed execution.

## Completed Slice: Bounded Workspace Process Sessions

User scenario: an Agent can start a longer Node diagnostic in the background,
continue reasoning, inspect new output through a cursor, and cancel the process
without receiving host shell access.

Acceptance:

- one revisioned Agent tool starts, polls, and cancels Process Sessions;
- every start uses the existing explicit-argv Node runtime preparation and the
  same read-only, offline OS sandbox boundary as `run_command`;
- active sessions expose bounded, ordered stdout/stderr chunks through local
  API and Workbench views without persisting output text in Ledger or Replay;
- per-session wall time, per-stream output, chunk count, per-Thread and
  per-Runtime active process counts, and retained-session count are bounded;
- start, success, failure, timeout, output cap, cancellation, concurrent
  polling, graceful shutdown, unsupported backend, and ownership denial are
  covered by tests;
- lifecycle events bind the owning Thread and Run, command/environment/runtime
  hashes, status, output hashes, cursors, and settlement reason;
- service restart projects an unclosed historical session as `interrupted`
  with unknown outcome and never silently reruns or reports it as completed;
- a lazy Workbench Processes panel lists status, limits, output availability,
  live output, and cancellation without adding process logic to the oversized
  Store or Server modules;
- a real macOS Sandbox smoke drives start, poll, and settlement through
  `AgentRuntime`.

Threat boundary:

- Process Sessions do not add a shell, user-selected executable, inherited
  environment, network, workspace write, package installation, or PTY.
- Output text is available only from the current local Runtime process and is
  bounded in memory. Ledger, Trace, exports, and restart recovery retain hashes
  and counts only. Output becomes unavailable after restart by design.
- Session IDs are Napier identities rather than host PIDs. A caller can inspect
  or cancel only sessions belonging to the selected Thread.
- Graceful shutdown terminates every active session before Store close.
  Abrupt host or Runtime termination can leave the local macOS wrapper outcome
  unknown because sandbox-exec has no parent-death contract; startup therefore
  records interruption rather than completion. Proved orphan termination and
  cross-restart reattachment require a managed guardian or OCI identity and are
  not claimed by this slice.
- Hard CPU, memory, and process-count quotas remain backend defaults. The
  existing wall/output bounds reduce exposure but do not replace OCI or VM
  resource isolation for hostile code.

Observed result:

- Runtime tests cover start, cursor output, success, failure, timeout, output
  cap, parent and operator cancellation, concurrent admission, Thread
  ownership, graceful shutdown, restart interruption, and Agent tool use.
- Server integration covers Thread-scoped list/output/cancel APIs and confirms
  output text is absent from durable events.
- The independent macOS Terminal smoke drove a scripted model through
  `AgentRuntime`, started a real sandboxed background Node process, observed
  `napier@0.1.0` through the cursor, settled successfully, and verified Ledger
  redaction in 457–499 ms across the initial and final reviewed revisions.
- Browser Dogfood loaded the lazy Processes panel from the live Vite/Server
  pair, verified its accessible tab selection and empty state, and reported no
  application console errors.
- Process capability code is split across execution preparation, lifecycle
  projection, Agent tool projection, and Manager modules. `agent-runtime.ts`
  is smaller than it was before this slice; Store remains unchanged.

## Completed Slice: Process Workspace Delta

User scenario: after a Process Session settles, the operator can tell whether
the workspace changed during its execution window and inspect a bounded local
file delta before trusting the result or considering broader write access.

Acceptance:

- verifier and Process Sessions share one deterministic, dependency-free
  workspace snapshot implementation;
- a pre-execution snapshot is taken before sandbox launch and a post-execution
  snapshot after process settlement and runtime identity verification;
- complete snapshots classify the delta as `unchanged` or `changed`; any
  truncated side classifies it as `indeterminate` rather than claiming safety;
- durable session evidence retains only pre/post digests, truncation state,
  changed-file count, and a changed-path-set digest;
- bounded relative paths and before/after file metadata remain available only
  from the current local Runtime through a Thread-scoped API and Workbench
  view, then become unavailable after restart;
- external concurrent changes are reported as workspace drift even though the
  sandbox itself is read-only; Napier does not falsely attribute the writer;
- failure, timeout, cancellation, output cap, shutdown, restart, concurrent
  polling, file add/modify/remove, symlink exclusion, snapshot truncation, and
  sensitive path redaction have automated coverage;
- the real macOS smoke proves an unchanged read-only session through
  `AgentRuntime`, and browser Dogfood inspects the rendered delta state.

Threat boundary:

- A pre/post comparison observes an execution window; it cannot prove which
  process caused a concurrent external change.
- Snapshot limits remain 2,000 files and 16 MiB. Truncation is fail-closed as
  `indeterminate`, and unobserved bytes are never represented as unchanged.
- `.git`, `.napier`, `node_modules`, and symlinks remain excluded. This avoids
  secret/state ingestion and link traversal, but changes inside those excluded
  roots are intentionally outside the claim.
- Relative paths are local ephemeral product data. Ledger, Trace, Replay,
  exports, and restart projections receive only counts and hashes.
- This slice does not grant workspace write permission. A later write-capable
  session still requires an explicit preflight scope and recovery design.

Observed result:

- the opt-in Agent-to-macOS-Sandbox smoke passed from an independent Terminal
  in 342 ms against a real temporary workspace and proved complete
  before/after snapshots with an `unchanged` result;
- an isolated full Server/Runtime/Store/Web dogfood created one concurrent
  external `drift.txt` write, then the Processes panel rendered
  `1 file drifted during window`, the relative path, before/after metadata, and
  the explicit non-attribution warning;
- the browser page contained no temporary absolute path and produced no console
  error;
- schema v1 Process evidence remains recoverable after an actual Store restart;
  new schema v2 evidence carries the bounded snapshot summary;
- the shared snapshot implementation retains existing verifier digest
  semantics while adding canonical confinement, symlink race defense, bounded
  local details, and fail-closed truncation.

## Completed Slice: Reversible Workspace File Lifecycle

User scenario: an Agent can reorganize a workspace without shell access by
previewing and then creating directories, moving files or directories, moving
an entry into Napier-managed reversible trash, and restoring it. An operator
can inspect and restore trash from Workbench after the originating Run ends.

Acceptance:

- add separate read-only preview/list and write-only apply Agent tools so
  policy, Advisor freshness, and automatic recovery classify effects
  accurately;
- preview plans are short-lived, one-use, and bound to the owning Thread, Run,
  requested operation, normalized paths, source snapshot, destination
  non-existence, and nearest existing parent device/inode identity;
- apply accepts only a preview ID, rechecks the complete plan immediately
  before mutation, rejects stale plans, and refuses a destination observed as
  occupied at the final check;
- support `create_directory`, `move`, `trash`, and `restore`; moving to trash
  remains reversible and permanent purge is not exposed;
- file and directory scope inspection is bounded and rejects protected
  segments including case aliases, symlink targets or descendants, workspace
  escape, unsupported entry types, and incomplete snapshots;
- operations share the existing per-target host lock with `apply_patch`,
  acquire multi-path locks in deterministic order, use atomic rename where
  possible, and fail closed on cross-device movement;
- local trash manifests preserve the original relative path and recovery
  metadata under the protected data root; Ledger, Trace, Replay, and exports
  receive path hashes and bounded metadata only;
- a lazy Files Workbench panel lists reversible items for the selected Thread
  and restores only after an explicit operator action and a fresh destination
  check; Thread/request-sequence guards discard late responses after selection
  changes;
- normal, stale, concurrent, cancellation-before-apply, symlink, protected
  path, ownership, destination collision, restart, cross-device failure, and
  restore tests cover Runtime, Agent tool, Server API, and Workbench views;
- real Agent Dogfood performs preview → move → preview → trash → restore on
  actual workspace bytes without using a shell.

Threat boundary:

- This slice does not grant Process Sessions workspace write access and does
  not introduce arbitrary shell commands.
- Trash is recovery storage, not a security boundary. A local user with direct
  filesystem access can still alter Workspace or trash bytes; freshness and
  postcondition checks report drift rather than claiming attribution.
- Preview cannot make filesystem mutation transactional with external
  processes. Napier locks coordinate Napier writers on one host and narrows the
  final race with an immediate recheck, but external writers do not honor it.
- Rename is required to remain on one filesystem. `EXDEV` fails without a
  copy/delete fallback so a failed move cannot become a partial recursive copy.
- Permanent deletion, overwrite, root moves, permission changes, symlink
  lifecycle, `.git`, `.napier`, `node_modules`, and unbounded trees remain out
  of scope.

Observed result:

- the opt-in Agent smoke completed preview → move → preview → trash → list →
  preview restore → apply against real temporary workspace bytes in 229 ms;
- Runtime tests prove one-use/expiry/ownership, stale source, occupied
  destination, replaced-parent identity drift, cancellation before apply,
  concurrent apply, shared `apply_patch` locking, symlink/case-alias protected
  scope rejection, EXDEV rollback, trash drift rejection, restart recovery,
  and indeterminate postcondition;
- Server integration proves Thread-scoped list/restore, collision response,
  immediate Ledger projection, path redaction, and actual byte restoration;
- Browser Dogfood rendered the lazy Files panel, original relative path,
  bounded scope and snapshot, then restored `deliverables/report.txt`, removed
  the recovery card, displayed the evidence hash, emitted POST 200, exposed no
  temporary absolute path, and produced no console error;
- the main implementation is split into mutation orchestration, bounded scope,
  Agent tool, and shared lock modules; `tools.ts` loses its private lock
  implementation and does not grow.

## Completed Slice: Bounded Process Input Streams

User scenario: an Agent or operator can start an explicitly interactive,
read-only Node Process Session, send multiple bounded UTF-8 input messages,
observe cursor output between messages, and close stdin so a protocol worker
or stateful script can settle without shell access.

Acceptance:

- `workspace_process start` defaults to closed stdin and requires an explicit
  interactive mode to retain the input stream;
- Agent and Server input actions accept a Process ID plus bounded text,
  optional newline, and optional close-after-write, with no command string or
  Workspace write capability;
- enforce per-message, total-byte, and write-count limits independently from
  stdout/stderr limits;
- serialize writes, reject input after close or settlement, and preserve
  Thread ownership across Agent, HTTP, and Workbench paths;
- record only input sequence, size, cumulative size, cumulative hash, and
  close state in the Work Ledger; raw input remains live-process data;
- cancellation, timeout, output cap, parent abort, graceful shutdown, and
  restart interruption close or invalidate stdin before settlement;
- the Processes Workbench exposes input only for a running interactive
  session, supports explicit close, and rejects late cross-Thread responses;
- tests cover normal multi-write state, default EOF compatibility, close,
  cancellation, timeout, overflow, concurrent writes, ownership, restart, and
  input redaction;
- a live macOS sandbox smoke proves state persists across separate writes and
  settles after stdin closes.

Threat boundary:

- This is a pipe protocol, not a PTY. Terminal control sequences, resize,
  foreground process groups, job control, and attach semantics remain out of
  scope.
- Input is untrusted process data. The existing fixed executable, explicit
  argv, secret-free environment, read-only Workspace, denied network, wall
  time, output cap, and process-group termination remain mandatory.
- Client cancellation cannot prove whether the child consumed the final
  kernel-buffered bytes. Unknown write outcomes are reported as such and must
  not be retried blindly.
- Restarted sessions are marked interrupted; stdin is never reattached from
  exported or replayed evidence.
- A write-capable Process Session still requires a preflight scope, explicit
  capability grant, and recovery contract. This slice does not weaken that
  blocker or claim to provide a persistent JavaScript/Python kernel.

Observed result:

- Runtime and Agent integration prove default EOF compatibility, serialized
  multi-write state, close-only input, Run and Thread ownership, independent
  message/total/action limits, Writable backpressure, settlement races,
  restart interruption, Ledger failure handling, schema v1/v2 compatibility,
  action-aware tool effects, and raw input redaction;
- Server integration drives operator input through the Thread-scoped endpoint,
  accepts newline-only input, rejects malformed and cross-Thread requests, and
  confirms input text is absent from Thread events;
- the independent macOS Terminal smoke completed in 327 ms, preserved worker
  state across `alpha` and `beta` writes, returned ordered acknowledgements,
  closed stdin, settled successfully, and reported an unchanged workspace;
- Browser Dogfood sent `ledger-input-dogfood`, observed
  `UI_ACK:ledger-input-dogfood` and `UI_DONE`, closed stdin, reached a
  successful settlement, rendered two hash-only input receipts, and produced
  no console error;
- the complete repository gate passed 878 tests with four opt-in live suites
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget;
- stdin limits, validation, Writable backpressure, and session/receipt
  transitions live in `workspace-process-input.ts`; the Process Manager retains
  ownership, serialization, settlement, and Ledger orchestration rather than
  absorbing another protocol implementation.

## Completed Slice: Sandboxed TypeScript LSP Diagnostics

User scenario: an Agent can ask a real TypeScript language server for current
file diagnostics before or after an edit, receive source locations and compiler
messages, and distinguish a clean file from syntax/type failures without
running a broad project command or relying on Napier's regex symbol outline.

Acceptance:

- use the standard Language Server Protocol and the mature
  `typescript-language-server`; do not label a direct regex or TypeScript API
  wrapper as LSP;
- support bounded TypeScript, TSX, JavaScript, JSX, MTS, CTS, MJS, and CJS
  workspace files with canonical realpath confinement, symlink rejection,
  UTF-8 validation, and a file-size cap;
- run initialize → initialized → didOpen → publishDiagnostics → shutdown over
  framed JSON-RPC stdio in the existing read-only, offline OS Sandbox;
- bind the exact Node executable, language-server bundle, TypeScript runtime,
  workspace root, target content, timeout, output, and diagnostic set to the
  result without persisting diagnostic prose or raw paths;
- expose one opt-in `lsp_diagnostics` Agent tool through the existing Agent
  profile, Web Chat, Context editor, policy gate, Tool Loop Guard, and bounded
  Trace summary;
- bound diagnostic count, message length, protocol frame size, stderr, startup
  and diagnostic latency, and total wall time;
- terminate the complete process group on timeout, cancellation, malformed
  frames, output overflow, protocol error, or normal shutdown;
- cover clean/error diagnostics, unsupported files, escape/symlink attempts,
  malformed/oversized protocol data, timeout, cancellation, concurrent calls,
  server/runtime drift, redaction, and policy denial;
- an opt-in live macOS smoke must obtain a real semantic TypeScript diagnostic
  through the actual language server and prove no source or message text enters
  the Ledger.

Threat boundary:

- This slice grants no workspace write, network, shell, package install, plugin
  install, arbitrary executable, inherited environment, or editor attachment.
- Language-server and TypeScript package assets are Napier-managed read-only
  runtime inputs, distinct from workspace access, and must be explicitly bound
  into the Sandbox launch and result.
- Compiler diagnostics are untrusted tool output, not Agent instructions.
  Related-information paths and arbitrary server logs are not persisted.
- This is the first LSP slice only. Definition, references, symbols, rename,
  Code Action, persistent multi-file synchronization, and automatic
  before/after edit association remain explicit follow-ups.

Observed result:

- real `typescript-language-server` 5.3.0 plus TypeScript 5.9.3 integration
  tests diagnose `TS2322` and a clean file concurrently in about 1.18 seconds
  total on the current machine;
- Runtime tests cover path escape, symlink traversal, unsupported extension,
  invalid UTF-8, 1 MiB input bound, timeout, cancellation, malformed protocol,
  protocol/stderr overflow, diagnostic/message truncation, concurrent
  invocations, OCI denial, and post-run language-server plus TypeScript library
  drift;
- Agent integration proves the live model context receives diagnostic code and
  message while `tool.started`, `tool.completed`, model tool-call projection,
  and Trace receive only bounded hashes, versions, counts, and latency;
- Server integration uses the public Agent profile update plus message SSE
  path and the real standard language server, proving the same tool can be
  configured and executed through the Web product contract;
- the example `examples/lsp-diagnostics/semantic-error.ts` provides a fixed
  semantic-error task and matching isolated `tsconfig.json`;
- Contracts now own the built-in Agent tool catalog consumed by Runtime,
  Server, Context, and Thread Replay validation; a bundle configured with
  `lsp_diagnostics` round-trips without a stale allowlist failure;
- Browser Dogfood confirms Context renders LSP diagnostics and both file
  lifecycle tools from the shared catalog without a console error, while the
  default Agent remains unchanged in observe mode;
- the complete repository gate passed 887 tests with five opt-in live suites
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget;
- current IDE-launched live smoke cannot nest macOS `sandbox-exec`, and the
  local desktop/launchd bridges available to this session did not start an
  independent process. The live suite therefore remains opt-in and is not
  claimed as passed in this environment; the Sandbox fails closed without a
  host-execution fallback.

## Completed Slice: Write-linked TypeScript Diagnostics

User scenario: when an Agent edits a TypeScript or JavaScript file with both
`apply_patch` and `lsp_diagnostics` enabled, Napier automatically diagnoses the
CAS-bound source before and after the write, tells the Agent whether compiler
evidence improved or regressed, and shows the bounded delta on the same patch
Trace entry. The Agent does not need a second model turn merely to remember to
call diagnostics.

Acceptance:

- keep `applyWorkspacePatch` language-neutral and preserve its existing
  atomic/CAS contract; attach code intelligence through an optional observer in
  the Workspace Tool adapter rather than importing TypeScript into the patch
  primitive;
- enable automatic observation only when the frozen Agent revision explicitly
  enables both `apply_patch` and `lsp_diagnostics` under workspace or
  unrestricted policy;
- for existing supported files, run pre-write diagnostics first and require
  their `fileSha256` to equal the patch `expectedSha256`; any timeout,
  cancellation, Sandbox failure, or hash mismatch before commit must leave the
  workspace unchanged;
- after a successful commit, always attempt post-write diagnostics and bind
  them to the patch `afterSha256`; a post-write failure or drift must report
  that the patch committed with unavailable/stale diagnostics, never reclassify
  the known write as an ordinary failed tool call or silently roll it back;
- compare bounded diagnostic multisets by severity, code, source, and message
  rather than source location alone so harmless line movement does not appear
  as a new compiler failure;
- classify clean, introduced, improved, unchanged, regressed, truncated,
  unavailable, and drifted outcomes with before/after severity counts plus
  introduced/resolved/unchanged counts;
- return actionable after-write locations, codes, and messages only to the live
  Agent; patch input, source, paths, diagnostic prose, and server errors must
  not enter model tool-call Ledger projections, `tool.started`,
  `tool.completed`, Trace, Replay, or OTLP;
- unsupported file types and Agents without the explicit LSP tool retain the
  current patch latency and behavior with no hidden process launch;
- cover clean/fix/regression/create/truncated outcomes, pre/post timeout,
  cancellation, post-write drift, concurrent edit races, unsupported files,
  redaction, Replay validation, Server SSE, and Trace projection;
- an opt-in live smoke must use the real OS Sandbox and language server to fix a
  stable `TS2322` example through the Agent tool path.

Threat boundary:

- Compiler diagnostics remain untrusted output. They can guide a later Agent
  turn but cannot authorize another write or mark a plan/evaluation complete.
- Pre/post observations add only the existing read-only, offline LSP
  capability. They do not widen patch scope, permit plugins/network writes, or
  turn diagnostics into a rollback mechanism.
- Napier write locks coordinate Napier writers; external editors may ignore
  them. Therefore association is accepted only when LSP file hashes equal the
  patch before/after hashes, and drift is a first-class result.
- This slice links diagnostics to one changed file. Project-wide test
  selection, changed-symbol association, persistent LSP navigation, and DAP
  remain follow-ups.

Observed result:

- one `apply_patch` call now fixes the stable `TS2322` example, gives the live
  Agent `1 error -> 0` plus one resolved diagnostic, and emits one path-free
  `tool.completed` event rather than a synthetic second tool call;
- the public Server SSE test runs the actual TypeScript language server before
  and after the patch and completes the semantic fix in about 1.77 seconds on
  the current machine;
- status tests cover clean, introduced, improved, unchanged, regressed,
  truncated, unavailable, and drifted outcomes, including location-only
  movement and conservative same-severity diagnostic replacement;
- preflight failure and cancellation leave bytes unchanged; concurrent
  preflights still produce exactly one CAS winner; postflight failure retains a
  successful patch with a failure hash; LSP target rehashing detects edits made
  while diagnostics are running;
- unsupported files and profiles without both tools launch no observer, while
  the generic atomic patch implementation remains unchanged and
  `tools.ts` shrank from 2,014 to 1,848 lines;
- model tool-call, `tool.started`, `tool.completed`, Replay, and Trace tests
  prove patch paths, source, patch text, diagnostic prose, and server errors do
  not enter durable evidence; the live Agent still receives actionable
  after-write compiler locations and messages;
- Trace reuses the patch summary and displays status, before/after counts,
  introduced/resolved counts, latency, and delta/result hash prefixes without
  a new panel or state system;
- the complete repository gate passed 898 tests with six opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget;
- both real OS-Sandbox live LSP cases remain blocked from this IDE-launched
  process because macOS rejects nested `sandbox-exec`. The diagnostic case
  produced no completed details and the write-linked case preserved the
  original erroneous file, so the boundary failed closed and is not claimed as
  a passed live smoke in this environment.

## Completed Slice: Workspace-confined LSP Definition

User scenario: an Agent that finds a TypeScript/JavaScript usage can ask the
real language server for its definition and receive the exact workspace file,
range, file hash, and a bounded source preview before deciding what to read or
edit. This replaces regex-only guessing without requiring a persistent editor
session.

Acceptance:

- add one opt-in `lsp_definition` Agent tool using the standard
  `textDocument/definition` request through the existing read-only, offline OS
  Sandbox and exact language-server/TypeScript runtime binding;
- accept one canonical workspace TypeScript/JavaScript source path plus
  1-based line and character, validate the position against current UTF-8
  source bytes, and bind the request to source/file hashes;
- share the LSP initialize/didOpen/shutdown, process termination, protocol,
  stderr, timeout, and client-request denial infrastructure with diagnostics
  rather than copying a second JSON-RPC lifecycle;
- parse Location and LocationLink responses, cap results, reject malformed
  ranges, and expose only canonical workspace-confined regular files; external,
  protected, missing, symlinked, or oversized targets are omitted and counted;
- return relative paths, ranges, and bounded source previews only to the live
  Agent; durable model-call, tool, Trace, Replay, and OTLP projections retain
  counts, hashes, versions, latency, and truncation only;
- expose the tool through the shared Agent tool catalog, Context, Server SSE,
  policy gate, Tool Loop Guard, automatic-recovery effect classification,
  workspace guidance, and existing Trace surface;
- cover cross-file definition, same-file definition, not-found, multiple and
  malformed results, external/protected targets, position/path escape,
  timeout, cancellation, target/runtime drift, concurrency, redaction, Replay,
  Server SSE, and Web projection;
- provide an opt-in real OS-Sandbox smoke and a fixed two-file example; do not
  claim references, rename, Code Actions, persistent synchronization, or
  external dependency navigation.

Threat boundary:

- A definition response is untrusted language-server output. It cannot grant
  read/write scope, and every returned URI is independently canonicalized
  against the workspace before source is read.
- Standard-library, dependency, virtual, non-file, and out-of-workspace
  definitions are omitted rather than exposing host/runtime paths.
- Source previews are live-only and bounded. Definition paths, previews, and
  exact symbol positions do not enter durable evidence.
- The operation is a read effect. It does not run when the Agent omits the tool,
  in advisor correction, or in safe automatic recovery.

Observed result:

- the fixed `examples/lsp-definition/` import resolves through the real
  TypeScript language server from `usage.ts:3:22` to `definition.ts` in about
  1.3 seconds on the current machine; a separate real fixture proves same-file
  lookup in about 0.8 seconds;
- the public Server SSE path resolves a real workspace-confined definition in
  about 0.9 seconds, gives the live Agent the target path/range/preview, and
  persists only hash/count/version/latency evidence;
- Location, LocationLink, not-found, truncation, stable response ordering,
  malformed ranges, external/virtual/protected/symlinked/missing/oversized/
  invalid UTF-8 targets, path/position rejection, source/runtime drift,
  concurrency, timeout, and cancellation are covered explicitly;
- Agent and Replay tests prove source/target paths and preview text do not enter
  model-call or tool evidence, while Web Trace renders only bounded counts,
  latency, truncation, and hash prefixes;
- the Workbench Context exposes `LSP definition` alongside diagnostics and the
  browser console remains error-free;
- the complete repository gate passed 910 tests with seven opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget;
- all three opt-in OS-Sandbox LSP cases remain blocked from this IDE-launched
  process because macOS rejects nested `sandbox-exec`. Definition produced no
  completed tool event and write-linked diagnostics preserved the original
  file, so the boundary failed closed and is not claimed as a passed live
  smoke in this environment.
