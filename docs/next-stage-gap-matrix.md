# Napier Next-Stage Gap Matrix

This matrix is re-audited from the current repository before each vertical
slice. It is not a feature wishlist or a substitute for task-success
benchmarks.

## Baseline

Audit date: 2026-07-30

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
| P2 coding intelligence            | Partial        | Hashline, bounded symbols, TypeScript LSP diagnostics/definitions/references, and write-linked diagnostic deltas exist; persistent LSP/rename/Code Actions, DAP, AST edits, test/symbol association, and isolated subagent worktrees remain.                 |
| P3 browser/research/data/media    | Early          | Structured local data and research Skills exist; persistent browser sessions, source unification, SQL/DataFrame/Notebook, and media production do not.                                                                                                       |
| P4 executable Workflows           | Early          | Plans and Blueprints are durable data; typed executable nodes, checkpoint reruns, SDK manifests, and JSONL workflow events do not.                                                                                                                           |
| P5 controlled re-execution        | Early          | Evidence replay and comparison exist; checkpoint forks, frozen/replaced dependencies, side-effect simulation, and single-step reruns do not.                                                                                                                 |
| P6 product entry points           | Partial        | Web Workbench, HTTP/SSE, and human/JSONL CLI run/resume exist; interactive TUI, branch CLI, SDK/RPC, ACP, and Desktop remain.                                                                                                                               |
| P7 extension developer experience | Partial        | Signed MCP packages are deep; stable extension SDK, UI cards, hot reload, ecosystem discovery, and compatibility suites remain.                                                                                                                              |
| P8 models and memory              | Partial        | Pi providers, credentials, and reviewed facts exist; dynamic catalogs, local/custom providers, routing policies, semantic memory, decay, and correction retrieval remain.                                                                                    |
| P9 outcome benchmark              | Started        | Two fixed CLI Coding cases now cover single-file repair and a multi-file LSP-guided API migration with repeated trials, Sandbox assertions, distributions, and Ledger evidence; non-nested scoring, cross-model/broader Coding plus other domains remain. |
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

## Completed Slice: Workspace-confined LSP References

User scenario: before changing or removing a TypeScript/JavaScript symbol, an
Agent can ask the real language server for all bounded workspace references and
inspect exact files, ranges, hashes, and source previews. This gives multi-file
impact evidence that regex search cannot reliably provide, without granting
rename or write authority.

Acceptance:

- add one opt-in `lsp_references` Agent tool using standard
  `textDocument/references` with an explicit `includeDeclaration` flag through
  the existing exact-version, read-only, offline LSP Sandbox;
- accept one canonical source path and 1-based UTF-16 position, bind it to
  current source bytes, and reject invalid positions before process launch;
- extract shared position validation, semantic readiness, Location parsing,
  workspace URI confinement, bounded preview, stable receipt ordering, and
  target-file projection from definition rather than duplicating a new runner;
- cap references at 64 and each preview at 1,000 characters; expose relative
  paths, ranges, file hashes, and previews only to the live Agent;
- persist only include-declaration mode, counts, versions, latency,
  source/runtime/limit hashes, stable reference/target-file set hashes, and
  truncation; raw paths, symbol positions, previews, and server prose remain
  absent from model-call, Ledger, Replay, Trace, and OTLP evidence;
- expose the tool through the shared catalog, Context, policy, Tool Loop Guard,
  automatic-recovery effect classification, workspace guidance, Server SSE,
  and existing Trace surface;
- move LSP-specific Trace parsing/summary composition out of the already large
  generic `tool-event-view.ts`, preserving current diagnostic/definition
  behavior while references are added;
- cover real cross-file references, declaration include/exclude, same-file,
  not-found, duplicate/multiple/truncated/malformed responses,
  external/virtual/protected/symlinked/missing/oversized/invalid UTF-8 targets,
  source/runtime drift, timeout, cancellation, concurrency, redaction, Replay,
  Server SSE, and Web projection;
- provide a fixed multi-file example and an opt-in real OS-Sandbox Agent smoke;
  do not claim rename, completeness when omitted/truncated, persistent
  synchronization, or external dependency navigation.

Performance and complexity budget:

- fixed real-language-server and public Server reference tasks should settle
  within 2 seconds on the current machine, under the existing 10-second wall,
  2 MiB protocol, and 16,000-character stderr bounds;
- no new code enters `store.ts` or `apps/server/src/app.ts`; Agent Runtime and
  Contracts receive only catalog/wiring types, while shared LSP location code
  replaces definition-local duplication;
- Web main entry remains below 150 KiB, and the generic tool Trace module
  should not grow from its current 1,516-line baseline.

Threat boundary:

- Reference URIs and ranges are untrusted language-server output. Every target
  is independently canonicalized before reading and cannot expand workspace,
  process, network, or write capabilities.
- Dependency, standard-library, virtual, protected, symlinked, and
  out-of-workspace references are omitted and counted. A truncated or omitted
  result is never described as a complete impact set.
- Source previews are bounded live evidence, not instructions, and never enter
  durable state.
- References are a read effect and are unavailable in observe policy, advisor
  correction, safe automatic recovery, or profiles that omit the tool.

Observed result:

- the fixed `examples/lsp-references/` project returns six
  declaration-inclusive and five declaration-excluding references across three
  files through the real TypeScript language server; the test performs both
  cold one-shot calls in about 3.0 seconds total;
- the public Server SSE Agent path resolves the same six-reference shape in
  about 0.95 seconds, under the 2-second product-path budget, and persists no
  source/target path or symbol preview;
- real cross-file and same-file references, declaration mode, not-found,
  duplicate/stable ordering, 64-result truncation, malformed/out-of-range
  responses, all target confinement classes, source/runtime drift, timeout,
  cancellation, concurrency, Agent redaction, Replay, Server SSE, safe
  recovery, and Web projection are covered;
- shared `lsp-locations.ts` now owns position validation, semantic readiness,
  Location parsing, canonical workspace reads, bounded previews, and stable
  receipts. The definition runner fell from 420 to 162 lines rather than
  duplicating those rules for references;
- Web LSP evidence moved into `lsp-tool-event-view.ts`; generic
  `tool-event-view.ts` fell from 1,516 to 1,249 lines after adding the new
  capability;
- the complete repository gate passed 919 tests with eight opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget;
- all four opt-in OS-Sandbox LSP cases remain blocked from this IDE-launched
  process because macOS rejects nested `sandbox-exec`. References produced no
  completed tool event and write-linked diagnostics preserved the original
  file, so the boundary failed closed and is not claimed as a passed live
  smoke in this environment.

## Completed Slice: One-shot JSONL CLI

User scenario: a developer or CI job can run one real Napier task from a
terminal, receive the same hash-bound event stream as the Web/HTTP path, and
reuse the same workspace, Agent revision, model credentials, Sandbox, tools,
and Ledger without starting the Web Server or implementing another Agent Loop.

Acceptance:

- add an installable `napier run` command with explicit workspace, prompt,
  model, Agent, existing Thread, data-root, title, timeout, and `--jsonl`
  options; provide deterministic help/version and reject unknown, duplicate,
  conflicting, oversized, or malformed input before creating a Thread;
- extract a small `createLocalAgentRuntime` bootstrap into `@napier/runtime`
  for Store, credential references, model registry, extensions, Sandbox,
  Workspace Process manager, file mutation manager, and Agent Runtime; migrate
  Server startup to this adapter so CLI and Web do not drift;
- create a Thread when none is supplied, or append to an explicitly selected
  existing Thread after verifying Agent ownership; never silently select a
  different Agent or mutate profile configuration;
- drive only `AgentRuntime.runPrompt`, including cancellation and an external
  wall-time AbortSignal; do not duplicate model, tool, policy, recovery, or
  Ledger logic in the CLI;
- stream the existing `StreamFrame` contract as one JSON object per stdout
  line: hash-bound event frames followed by a final snapshot and done frame;
  pre-Run failures use a bounded error frame and nonzero exit status;
- human mode prints only the final assistant result plus a concise Run status
  to stderr; machine mode emits no banners or non-JSON stdout;
- preserve credential fail-closed behavior: an environment variable is usable
  only when the selected data root already contains an active credential
  reference; CLI arguments and errors must never print secret values;
- cleanly stop active Process Sessions and MCP transports on success, failure,
  timeout, cancellation, SIGINT, and bootstrap failure, then close SQLite;
- cover new/existing Thread, demo/live-provider availability, normal/failure/
  timeout/cancellation, JSONL ordering/hashes/backpressure, invalid arguments,
  concurrent active-Run rejection, cleanup, and secret redaction;
- run a real built CLI subprocess against a temporary workspace and provide an
  opt-in low-cost DeepSeek CLI smoke. Do not claim TUI, interactive chat,
  resume, branch, RPC, ACP, or Desktop in this slice.

Performance and complexity budget:

- demo one-shot startup should emit its first Run event within 1 second and
  settle within 2 seconds on the current machine; JSONL writing must honor
  stdout backpressure;
- no Agent Loop code enters `apps/cli`; Server `app.ts` should shrink or remain
  flat after adopting shared bootstrap, and no new code enters `store.ts`;
- Web main entry remains below 150 KiB and the existing HTTP/SSE contract stays
  compatible.

Threat boundary:

- Workspace and data-root selection are explicit local operator inputs. The
  CLI canonicalizes both but does not grant tools broader policy or filesystem
  capability than the selected Agent revision.
- JSONL is a live local execution stream and may contain user/assistant text,
  matching HTTP SSE behavior. Durable Ledger, Replay, Trace, and tool
  redaction boundaries remain unchanged.
- Machine-mode errors expose a stable public message plus diagnostic hash, not
  raw provider, credential, Sandbox, or tool error text.
- SIGINT/timeout requests cancellation through the active Runtime; the CLI
  never kills unrelated workspace processes or deletes state to recover.

Observed result:

- `napier run` executes a new or explicit existing Thread in human or JSONL
  mode through `AgentRuntime.runPrompt()`. Machine output contains only event
  frames, one final snapshot, and one terminal done frame; preflight/bootstrap
  failures use the shared stable error frame;
- `createLocalAgentRuntime()` now owns the Store, credential, model,
  Extension, Sandbox, Process Session, file mutation, and Agent Runtime
  lifecycle for both Server and CLI. Shared Run stream constructors also
  replace the Server-local event/snapshot/done/error implementations;
- the CLI suite covers parsing, new and existing Threads, hash/order
  verification, stdout backpressure, preflight rejection, missing credential
  references, timeout, pre-aborted cancellation, independent-runtime Run lease
  contention, a built subprocess, and deterministic help. The second
  concurrent Runtime does not call its model;
- the built zero-key CLI subprocess completed in about 0.85 seconds on the
  current machine. The first JSONL Run event remained under the 1-second
  budget;
- the opt-in DeepSeek JSONL smoke completed the fixed
  `NAPIER_CLI_LIVE_OK` task against the real provider in about 2.02 seconds,
  emitted terminal completed evidence, and did not expose the API key;
- pre-aborted CLI testing found and fixed an Agent Runtime cancellation race:
  an already-aborted parent signal is now forwarded before model execution;
- shared shutdown attempts Process Session, MCP, and SQLite cleanup even if an
  earlier step fails, and the Server production entry uses that same shutdown
  path;
- `apps/server/src/app.ts` fell by 84 lines to 27,540 lines, no code entered
  `store.ts`, and `apps/cli` contains no model or tool loop;
- the complete repository gate passed 930 tests with nine opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: CLI Coding Outcome Benchmark

User scenario: a developer can run one fixed coding task through the real
one-shot CLI, receive a deterministic task-success verdict rather than a
model-authored completion claim, inspect cost/latency/tool retries, and
archive privacy-bounded Ledger evidence for offline verification.

Acceptance:

- check in a versioned case manifest, prompt, broken fixture, hidden expected
  target, exact asset hashes, allowed changed paths, required tools, and a
  bounded timeout;
- copy the fixture into a fresh temporary workspace and create a dedicated
  revisioned Agent with fixed model, tool surface, policy, budgets, and
  reasoning level; a live provider requires an explicit credential
  environment-variable locator;
- execute only through the existing one-shot CLI JSONL path and validate every
  event hash, final snapshot, terminal status, event-stream hash, and process
  exit code before scoring;
- determine success from complete workspace before/after snapshots, the exact
  changed-path allowlist, and a hidden full-file TypeScript AST projection;
  comments, whitespace, and numeric separators may differ, but syntax and
  behavior-bearing tokens may not;
- never execute model-modified code on the benchmark host and never accept the
  assistant summary as evidence;
- append one `benchmark.evaluated` event to the same Run after deterministic
  scoring;
- record model/version, Agent revision/configuration, duration, input/output/
  cache tokens, reported cost, tool starts/completions/failures/blocks,
  repeated calls, workspace hashes, AST hashes, and Ledger bindings;
- write CAS-named result and privacy-bounded Ledger artifacts, then
  self-verify exact nested schemas, result/bundle hashes, receipt chains, event
  aggregates, Run/tool bindings, and the evaluation event; unknown-field
  injection remains invalid even when every self-describing hash is recomputed;
- omit prompt, assistant text, reasoning, tool bodies, workspace paths, and
  credential values from benchmark artifacts; summarize high-volume model
  deltas by count and the source event-stream hash;
- cover scripted success, completed-but-unsuccessful outcome, external
  timeout/cancellation, unavailable credentials, credential redaction, AST
  normalization, symlinked case assets, result tampering, self-consistent
  unknown-field injection, malformed bundle input, real command execution, and
  offline verification;
- provide an opt-in real DeepSeek benchmark. Do not claim a success rate,
  cross-model ranking, or superiority from one case/sample.

Performance and complexity budget:

- the fixed live case should normally settle within 60 seconds and remain
  under its 120-second external timeout;
- the result should stay below 8 KiB and the privacy Ledger bundle below
  64 KiB for a normal two-tool execution, regardless of reasoning delta count;
- no benchmark code enters `store.ts` or `apps/server/src/app.ts`; production
  code is split into runner, case, contract, Ledger, session, stream, and type
  modules rather than one new oversized file;
- Web main entry and the 244-route HTTP surface remain unchanged.

Threat boundary:

- Case paths and asset contents are trusted repository inputs but are still
  canonicalized, hash-bound, symlink-rejected, and limited to 256 files /
  2 MiB. Generated workspace bytes are untrusted.
- The scorer parses generated JavaScript but does not import or execute it.
  Full AST equivalence intentionally accepts formatting but not alternative
  implementations; broader semantic test execution requires a separately
  managed untrusted-code Sandbox.
- The temporary workspace and data root are deleted after artifacts are
  written. Output paths are explicit operator inputs and CAS writes never
  overwrite different bytes.
- The Ledger bundle is a bounded evidence projection, not a full Replay
  export. Its source event-stream/snapshot hashes bind the live Run while
  avoiding a second raw-message or reasoning export path.

Observed result:

- the checked-in DeepSeek `deepseek-v4-flash` sample passed in 5,273 ms with
  5,474 input, 523 output, and 10,240 cache-read tokens, reported cost
  `$0.000941472`, two completed tool calls, zero failed/blocked/repeated calls,
  one changed file, and exact hidden AST agreement;
- the CAS result
  `napier-benchmark-result-coding_shipping_boundary_v1-ad31aff64f35d15a.json`
  is 3,008 bytes with logical content SHA-256
  `ad31aff64f35d15a1b56d85e90301835ac3a48d9677c8b5eeed72cfcd70d1edb`;
- the CAS Ledger bundle
  `napier-benchmark-ledger-coding_shipping_boundary_v1-c52d3c3d04232076.json`
  is 20,484 bytes with logical content SHA-256
  `c52d3c3d042320765cb02ff15cb2da8637f0c4c22aabe0637e895d7ccc776d18`;
  it binds 333 source events while retaining 30 important receipts and
  summarizing 303 text/thinking deltas. Prompt, source, reasoning, and
  credential probes were absent;
- an actual offline command revalidated the archived pair with zero
  diagnostics;
- the benchmark exposed and fixed two execution defects before the successful
  run: `apply_patch` advertised an OpenAI-incompatible union-root schema, and
  Pi `stopReason: error` messages were incorrectly settled as completed Runs.
  The schema now remains conditionally strict under a top-level object, while
  provider errors become hash-redacted failed/cancelled evidence without an
  assistant message;
- repeated live executions varied from about 5.3 to 52.0 seconds and from two
  to nine tool calls despite the same case/model. This variance is recorded,
  not hidden, and is why repeated-trial aggregation is the next P9 requirement;
- the complete repository gate passed 938 tests with ten opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: Repeated Coding Trials And Sandbox Outcome Oracle

User scenario: a developer can run the same fixed case/model several times,
distinguish task failures from unscoreable infrastructure, inspect latency,
cost, token, and tool variance, and verify every aggregate back to independent
Run/Ledger evidence without cherry-picking a favorable sample.

Acceptance:

- add `--trials 2..10` without changing the default single-run command;
- execute trials sequentially with fresh workspace, data root, Thread, Run,
  Agent revision, and credential reference lifecycles;
- bind every series entry to a unique Run id, result logical hash, result
  filename, Ledger logical hash, and Ledger filename; duplicate result or Run
  identities are invalid;
- report requested/completed/scored/passed/failed/inconclusive counts,
  completion rate, scoreable-only pass rate, and
  total/min/p50/p95/max/mean distributions for latency, cost, tokens, tool
  starts/completions/failures/blocks, and repeated calls;
- preserve a completed prefix on parent cancellation and never start another
  trial after observing the parent signal;
- evolve the fixed case to schema v2 with a hash-bound hidden assertion module;
  copy it under a reserved one-use workspace name only after the Agent Run and
  before cleanup;
- execute generated source only through the existing explicit-argv Node
  `CommandRunner` with read-only workspace, denied network, fixed environment,
  wall/output limits, and process-group termination;
- retain AST equality as structural evidence but determine v2 success from
  hidden behavior assertions plus the exact changed-path allowlist;
- classify Sandbox backend denial as `inconclusive`, set pass rate to `null`
  when no trial is scoreable, return a non-zero command status, and never fall
  back to host execution;
- append only test script/result/output hashes, status, Sandbox id, duration,
  and exit code to `benchmark.evaluated`; hidden assertions and process output
  remain absent from benchmark artifacts;
- add `--verify-series`, bound the series to 256 KiB, read each result and
  Ledger under their existing limits, derive every referenced filename from
  case id plus logical hash, and recompute all trial and aggregate bindings;
- continue verifying the checked-in schema-v1 result/Ledger pair.

Threat boundary:

- Generated code is untrusted. The benchmark host parses it for AST evidence
  but never imports it; only the managed OS Sandbox executes it.
- The hidden test is trusted, hash-bound repository input, is not copied into
  the Agent workspace until after the model Run, and is removed only when the
  benchmark created the reserved file. A colliding model-created file makes
  the outcome unavailable and is never deleted.
- Nested `sandbox-exec` can be denied by the current host. That is an
  infrastructure limitation, not a task failure. Fail-closed inconclusive
  evidence is preferable to either false 0% scoring or unsandboxed execution.
  A trusted pre-import stdout handshake prevents generated code from spoofing
  a wrapper diagnostic to downgrade a real failure to inconclusive.
- Series verification accepts only hash-derived basenames in the series
  directory and refuses symlinked inputs. `.`/`..`, path separators, missing
  artifacts, extra fields, duplicate Runs, tampered statistics, and
  self-consistently rehashed drift fail closed.
- Trial order is preserved and all completed attempts are included. The series
  cannot silently drop a failed or inconclusive completed trial.

Observed result:

- a real DeepSeek `deepseek-v4-flash` three-trial Run completed all three
  independent Agent Runs with two tool calls each, zero failed/blocked/repeated
  tool calls, and exact allowed-path adherence;
- model duration was 6,201–7,181 ms (p50 6,309 ms, mean 6,563.67 ms), reported
  total cost was `$0.002819208`, and total input/output/cache-read tokens were
  16,068 / 1,721 / 31,360;
- one target matched the hidden expected AST and two used different ASTs. The
  current IDE host denied all three nested macOS Sandbox launches, so the
  series correctly reports three completed, zero scored, zero failed, three
  inconclusive, and `passRate: null`; no model success-rate conclusion is
  drawn;
- the archived series
  `napier-benchmark-series-coding_shipping_boundary_v1-d7738151e8036e7e.json`
  has logical content SHA-256
  `d7738151e8036e7e8402c1e1c37d4df2c5879243af642572ac7f0ebc0bebe1c6`
  and binds three result/Ledger pairs. Offline verification returns zero
  diagnostics;
- targeted tests cover success, task failure, unavailable Sandbox,
  collision-safe cleanup, cancellation prefix, duplicate trials, aggregate
  tampering, self-consistently rehashed path escape, oversized artifacts, and
  schema-v1 compatibility;
- the complete repository gate passed 945 tests with ten opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: Multi-File Coding Outcome Case

User scenario: a developer can evaluate whether an Agent discovers and safely
migrates every workspace use of a JavaScript API instead of succeeding on a
single obvious edit.

Acceptance:

- add a second versioned case selected through the existing `--case` CLI
  option, without adding another Agent loop or benchmark runner;
- require one options-object API migration plus two independent call-site
  updates, with an exact three-path change allowlist;
- expose only `read_file`, `lsp_references`, and `apply_patch`, and instruct
  the Agent to inspect the real LSP impact set before editing;
- bind prompt, five-file fixture, canonical primary target, hidden behavior
  test, and case manifest to fixed hashes;
- assert the new object API, default discount, both call chains, legacy API
  rejection, and invalid input handling inside the existing read-only,
  network-denied outcome Sandbox;
- exercise the real Agent loop with the standard TypeScript language server,
  three writes, result/Ledger generation, and offline verification;
- retain a public subprocess regression and an opt-in live DeepSeek smoke;
- correct repeated-call metrics for generic tools by hashing their structured
  input when no specialized input digest exists;
- serialize concurrent one-shot JSONL callbacks by authoritative Ledger
  sequence and reject missing, duplicate, or cross-Thread frames before the
  terminal snapshot.

Threat boundary:

- The Agent never sees the hidden test. It is copied only after the Run and is
  executed with generated modules only inside the managed Sandbox.
- `package.json` remains fixture input and is outside the three-path mutation
  allowlist. Creating, deleting, or modifying any other path fails evaluation.
- A test-only direct process adapter exercises the real TypeScript language
  server because this IDE host rejects nested `sandbox-exec`; production and
  live paths retain the OS Sandbox and never fall back to host execution.
- A failed LSP launch may be recovered by the Agent, but it remains a failed
  tool call in Ledger evidence. An unavailable outcome Sandbox makes the task
  inconclusive regardless of workspace shape or assistant claims.

Observed result:

- the deterministic Agent integration completed seven tool calls: three
  distinct reads, one real LSP References query, and three successful patches;
  the exact three-path delta and hidden outcome both passed;
- the real DeepSeek `deepseek-v4-flash` Run completed in 19,087 ms with 10,962
  input, 2,170 output, and 21,120 cache-read tokens at a reported cost of
  `$0.002201416`;
- that live Run made 10 tool calls, completed nine, failed one Sandbox-backed
  LSP attempt, changed exactly the three allowed files, and used a
  non-canonical primary AST. The host also denied the outcome Sandbox, so the
  result is correctly `inconclusive`; no behavior-success claim is made;
- an earlier live attempt exposed out-of-order concurrent delta frames. The
  shared CLI writer now buffers by Ledger sequence; the repeated live Run
  emitted a complete stream and reached offline-verifiable artifacts;
- the archived result
  `napier-benchmark-result-coding_pricing_options_migration_v1-ecba9265f0750865.json`
  has logical content SHA-256
  `ecba9265f0750865cd771ebb8ff6930827d7094da4e65a2dd3705580591e4cc6`;
  its Ledger
  `napier-benchmark-ledger-coding_pricing_options_migration_v1-e8ef307d538aab40.json`
  has logical content SHA-256
  `e8ef307d538aab402e648bb02f178104c85a659dd6daa28a31d8ecacdcfc0898`.
  Offline verification returns zero diagnostics;
- the complete repository gate passed 952 tests with 11 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: CLI Interrupted Run Resume

User scenario: after Napier or the machine stops during a long task, a
developer can continue the durable interrupted Run from the terminal without
opening Web, inventing a new prompt, or losing the parent/child evidence chain.

Acceptance:

- add `napier resume --workspace <path> --thread <thread-id>` with optional
  data root, interrupted Run id, model override, timeout, and JSONL output;
- reject prompt, title, Agent, unknown, duplicate, malformed, and conflicting
  resume options before invoking a model;
- initialize the normal local Runtime first so abandoned running Runs become
  durable interrupted evidence through existing reconciliation;
- call only `AgentRuntime.resumeInterruptedRun`, selecting the requested or
  latest interrupted parent and creating a `source=recovery` child linked by
  `parentRunId`;
- share canonical workspace/data-root handling, credentials, Run lease,
  ordered event writer, terminal snapshot/done frames, human output,
  cancellation, and shutdown with `napier run`;
- cover explicit/default parent selection, human/JSONL success, missing parent,
  non-waiting Thread, external cancellation, concurrent resume contention,
  built subprocess execution, and a real-provider smoke;
- split CLI option parsing from Runtime execution instead of growing the
  existing adapter or adding another Agent loop.

Threat boundary:

- Resume accepts no new prompt. The recovery prompt comes from bounded durable
  events and marks unfinished side effects as unknown; the CLI never retries a
  historical tool call itself.
- Only a waiting Thread with an interrupted Run is eligible. A second recovery
  sees the active child lease and fails closed before model execution.
- A model override still uses the selected data root's credential-reference
  policy. Ambient keys, raw provider errors, and tool diagnostics do not enter
  CLI error frames.
- Cancellation and timeout settle the new child as cancelled. They do not
  mutate the interrupted parent or kill unrelated processes.
- JSONL streams only events appended after resume starts, then returns the
  complete authoritative snapshot. Sequence numbers therefore continue from
  the existing Thread rather than restarting at one.

Observed result:

- a real built CLI subprocess reconciled a persisted running Run, created one
  completed recovery child with the exact parent Run id, streamed 17
  contiguous events at sequences 4 through 20, and retained
  `run.recovery.started`, `run.recovery.prompt`, and
  `run.recovery.completed`;
- the opt-in DeepSeek suite passed both the existing one-shot command and the
  new interrupted resume against the real provider; resume completed in about
  1.5 seconds without exposing the API key;
- cancellation produced a linked cancelled child, while two simultaneous
  resume attempts admitted one model call and returned a stable error frame
  for the other;
- CLI option parsing now lives in a 253-line module and the shared execution
  adapter fell from 389 to 298 lines. No code entered Server or Store;
- the complete repository gate passed 960 tests with 12 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.
