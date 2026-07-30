# Napier Next-Stage Gap Matrix

This matrix is re-audited from the current repository before each vertical
slice. It is not a feature wishlist or a substitute for task-success
benchmarks.

## Baseline

Audit date: 2026-07-31

- The Work Ledger, replay artifacts, Plans, evaluation, recovery, and
  extension governance are substantially ahead of the execution surface.
- `apps/server/src/app.ts` and `packages/runtime/src/store.ts` remain the
  largest production modules. New execution code must stay outside both.
- The Web main entry remains subject to the 150 KiB release gate.
- General host shell execution remains unavailable.

## Priority Matrix

| Priority                          | Current status | Highest-value remaining gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 architecture and baseline      | In progress    | Split Server and Store by domain; add startup, first-token, tool-latency, long-thread, memory, and database-growth budgets.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P1 managed work environment       | In progress    | Foreground commands, background Process Sessions, workspace drift, reversible file lifecycle, bounded interactive stdin, persistent synchronous JavaScript, and restricted persistent Python now exist. Package-backed Python/Notebook sessions, PTY, write sessions, hard total-RSS quotas, remote sandboxes, tool callbacks, and cross-restart reattachment remain.                                                                                                                                                                                                  |
| P2 coding intelligence            | Partial        | Hashline, heuristic cross-language symbols, real TypeScript/JavaScript AST query/edit previews, semantic LSP document symbols, diagnostics/definitions/references/rename and diagnostic-driven quick-fix previews, write-linked diagnostic deltas, and Run-owned Node launch DAP with breakpoints/stack/variables/evaluation/single-step exist; persistent LSP, direct rename apply, Code Action resolve/command policy, DAP attach/source maps/multi-thread UX, broader AST transforms, write-linked test/symbol association, and isolated subagent worktrees remain. |
| P3 browser/research/data/media    | Early          | Structured local data and research Skills exist; persistent browser sessions, source unification, SQL/DataFrame/Notebook, and media production do not.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P4 executable Workflows           | Partial        | Versioned typed Agent DAG manifests, runtime schemas, explicit bindings, real Run-backed nodes, explicit retry, restart recovery, CLI JSONL, HTTP SSE, and privacy-bounded Trace now exist. Deterministic/Tool/approval nodes, true parallelism, control flow, compensation, single-node debugging, external adapters, artifact settlement, natural-language extraction, and the visual builder remain.                                                                                                                                                                |
| P5 controlled re-execution        | Partial        | Workflow checkpoint experiments now provide read-only preview, verified ancestor reuse, descendant rerun, per-node model replacement, stale-bound side-effect confirmation, isolated target Threads, cancellation/restart recovery, source/target node and outcome comparison, CLI JSONL, HTTP SSE, and Trace evidence. User/model/tool checkpoints, Prompt/Skill/Memory/environment replacement, side-effect simulation, single-step/batch experiments, interactive root-cause views, and evaluation promotion remain.                                                |
| P6 product entry points           | Partial        | Web Workbench, HTTP/SSE, and human/JSONL CLI run/resume/branch/Workflow execution exist over one Runtime; interactive TUI, generic SDK/RPC, ACP, Desktop, and a visual Workflow entry remain.                                                                                                                                                                                                                                                                                                                                                                          |
| P7 extension developer experience | Partial        | Signed MCP packages are deep; stable extension SDK, UI cards, hot reload, ecosystem discovery, and compatibility suites remain.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P8 models and memory              | Partial        | Pi providers, credentials, and reviewed facts exist; dynamic catalogs, local/custom providers, routing policies, semantic memory, decay, and correction retrieval remain.                                                                                                                                                                                                                                                                                                                                                                                              |
| P9 outcome benchmark              | Started        | Two fixed CLI Coding cases now cover single-file repair and a multi-file LSP-guided API migration with repeated trials, Sandbox assertions, distributions, and Ledger evidence; non-nested scoring, cross-model/broader Coding plus other domains remain.                                                                                                                                                                                                                                                                                                              |
| P10 team/distributed              | Deferred       | Do not prioritize Postgres, distributed workers, RBAC, or collaboration before the local P0-P9 acceptance gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
  capability grant, and recovery contract. This input slice does not weaken
  that blocker. The later JavaScript kernel reuses this pipe safely but remains
  synchronous, read-only, and Run-local; Python remains unimplemented.

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

## Completed Slice: Sequence-Accurate CLI Thread Branch

User scenario: a developer can fork a durable Thread from the exact evidence
boundary they are inspecting, continue the alternative through the terminal,
and retain correct source-Run lineage even when the source has newer Runs.

Acceptance:

- add `napier branch --workspace <path> --thread <thread-id> --from-seq <n>`
  with optional data root, title, and JSONL output;
- reject execution-only, duplicate, malformed, future, missing, zero, and
  unsafe-integer options before branch materialization;
- resolve the branch `parentRunId` from the last source Run represented at or
  before `fromSeq`, never from the source Thread's latest Run;
- materialize `branch.created` plus only message events visible through the
  selected sequence under one leased, terminal branch Run;
- preserve imported Thread provenance and its branch-local historical cutoff;
- make Server and CLI call one Runtime domain service instead of maintaining
  separate Store orchestration;
- emit the new Thread ID in human mode or its complete ordered event stream,
  authoritative snapshot, and done frame in JSONL mode;
- continue the resulting Thread through the existing built
  `napier run --thread` path without introducing another Agent loop;
- cover early-Run lineage, invalid/future sequences, invalid titles,
  pre-abort, concurrent branches, imported provenance, Server compatibility,
  and a built subprocess continuation.

Threat boundary:

- Branching copies message evidence only. It does not re-execute a model call,
  reuse a tool result, simulate a side effect, restore an environment, or
  claim controlled Replay.
- Source sequence validation and title normalization complete before a Thread
  is created. A future boundary cannot silently become a branch at the current
  Ledger tail.
- The materialization Run uses the normal lease boundary and records only
  source Thread ID and sequence in `branch.created`; no message body is added
  to lifecycle metadata or error frames.
- An already aborted CLI request stops before local Runtime initialization or
  state mutation. Branch creation is otherwise a short local SQLite operation,
  not a cancellable model/tool execution.

Observed result:

- Runtime tests proved that a branch from the first of two source Runs links
  to the first Run, excludes the second Run's messages, preserves imported
  provenance, rejects invalid boundaries without a new Thread, and allows two
  independent concurrent branches;
- CLI tests exercised human and complete ordered JSONL output, stable
  redacted errors, pre-abort, and a real built-process branch followed by a
  built-process `run --thread` continuation;
- Server integration retained the public response contract while adding a
  future-sequence no-mutation regression; the route's branch orchestration was
  replaced by the shared Runtime service;
- an independent built-CLI dogfood branched sequence 2 of a two-Run source,
  proved that `parentRunId` selected the first Run, excluded both future
  messages, then completed a normal continuation with 18 total branch events;
- the focused Runtime/CLI/Server gate passed 53 tests. The complete repository
  gate passed 969 tests with 12 opt-in live tests skipped by default, verified
  244/244 OpenAPI operations, and kept the Web main entry at 129.13 KiB
  against the 150 KiB budget.

## Completed Slice: Workspace-Confined LSP Rename Preview

User scenario: a coding Agent can ask the real language server for every edit
needed to rename a TypeScript or JavaScript symbol, inspect one complete
multi-file plan, then apply and verify it through Napier's existing write
boundary instead of guessing call sites or granting the language server writes.

Acceptance:

- add opt-in `lsp_rename` with a workspace-relative source, 1-based UTF-16
  position, proposed new name, and bounded timeout;
- drive standard `textDocument/prepareRename` and `textDocument/rename`
  through the existing exact-version, read-only, offline LSP lifecycle;
- accept at most 32 files and 256 non-overlapping text edits as one complete
  WorkspaceEdit, 32 KiB aggregate preview text, and 64 KiB final tool output;
  over-limit responses fail rather than truncate;
- support standard `changes` and text-only `documentChanges`, while rejecting
  create/rename/delete operations, annotations, empty ranges, overlap, and
  malformed versions; standard `documentChanges` takes precedence when both
  representations are present;
- canonicalize every target and reject the whole preview for external,
  virtual, protected, symlinked, missing, oversized, invalid UTF-8,
  out-of-range, or hash-inconsistent files;
- return paths, current file hashes, exact ranges, old text, and replacement
  text only to the live Agent;
- retain only completeness, counts, preview bytes, versions, latency, and
  source/name/prepare/edit/target-file/result hashes in model-call, Ledger,
  Replay, Server SSE, and Web Trace evidence;
- apply real edits only through existing hash-bound `apply_patch`, preserving
  per-file CAS, locks, diagnostics, cancellation-before-commit, and evidence;
- cover protocol shapes, limits, not-found, confinement, overlap, source and
  runtime drift, timeout, cancellation, concurrency, Agent apply, Server SSE,
  Web projection, real language server behavior, and an optional OS-Sandbox
  smoke.

Threat boundary:

- Workspace source and all language-server edits are untrusted live evidence,
  not instructions. Prompt injection in a comment cannot bypass policy or
  directly reach a write primitive.
- `workspace/applyEdit` remains denied. `lsp_rename` is classified as a
  sandboxed read and never mutates files, even when every edit is valid.
- Returning a complete preview does not claim a portable atomic transaction
  across files. Each later `apply_patch` re-reads its full-file SHA and may
  fail stale after an earlier file committed; the Agent must re-inspect and
  recover rather than assume all-or-nothing behavior.
- Target file hashes bind the bytes observed after the language-server request.
  A later external edit invalidates the patch precondition. Napier does not
  claim the preview remains fresh indefinitely.
- This slice does not provide persistent LSP synchronization, direct rename
  application, Code Actions, external dependency editing, DAP, AST rewrite,
  or automatic test selection.

Observed result:

- the real TypeScript 5.9.3 / typescript-language-server 5.3.0 runner returned
  one complete six-edit plan across three source files without changing any
  workspace bytes;
- a deterministic Agent Run consumed a multi-file preview, committed both
  files through real `apply_patch` calls, preserved read/write/write effects,
  and produced a portable Replay with no path, symbol name, source, or
  replacement leakage;
- the public HTTP/SSE path ran the real language server and returned the same
  3-file/6-edit projection with hash-only durable evidence and zero writes;
- independent dogfood copied the fixed workspace, generated the real preview,
  applied all three files through production `applyWorkspacePatch`, removed
  all old-name occurrences, produced six new-name occurrences, and passed
  real `tsc --noEmit`;
- the opt-in macOS Sandbox suite remains unavailable from this IDE-launched
  sandbox: all five LSP cases close during nested Sandbox startup in about
  150 ms. No direct-process or host fallback is used in production;
- the complete repository gate passed 986 tests with 13 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget. Rename Trace parsing
  added only to the lazy trace chunk.

## Completed Slice: Diagnostic-Driven LSP Quick-Fix Preview

User scenario: a coding Agent can ask the real language server for quick fixes
at a current TypeScript or JavaScript diagnostic, compare bounded alternatives,
select one preferred text edit, apply it through Napier's existing CAS write
boundary, and prove the diagnostic was resolved.

Acceptance:

- add opt-in `lsp_code_actions` with a workspace-relative source, 1-based
  UTF-16 diagnostic position, and bounded timeout;
- collect current diagnostics in the same one-shot read-only/offline LSP
  session and issue standard `textDocument/codeAction` restricted to
  `quickfix`;
- accept at most 64 response entries and expose at most 16 actionable
  alternatives; count command-only, disabled, edit-free, and truncated entries
  as omitted and mark the response incomplete;
- accept only text-edit WorkspaceEdits, including zero-length insertion ranges,
  while rejecting resource operations, annotations, unknown fields, overlap,
  malformed versions, and unsafe targets; prefer standard `documentChanges`
  when both representations are present;
- discard command and opaque data payloads before materialization. An edit
  action that carried a command is explicitly marked, but no command is
  executed, shown to the Agent, persisted, or sent to a write primitive;
- enforce aggregate limits across alternatives: 32 target files, 256 edits,
  32 KiB old/replacement text, and 64 KiB formatted Agent output;
- return bounded action titles, paths, current file hashes, ranges, old text,
  and replacement text only to the live Agent;
- retain only completeness/truncation, counts, preview bytes, versions,
  latency, and diagnostic/action/target/result hashes in Agent, Ledger, Replay,
  Server SSE, and Web Trace projections;
- apply a selected action only through `apply_patch`, then prove clean
  write-linked and explicit LSP diagnostics;
- cover real TypeScript behavior, parser shapes, EOF/CRLF insertion
  normalization, confinement, source/runtime drift, timeout, cancellation,
  concurrency, aggregate limits, Agent output limits, policy, Agent apply,
  Server SSE, Web projection, Replay privacy, and an optional OS-Sandbox smoke.

Threat boundary:

- Diagnostics, action titles, source, and replacements are untrusted live
  evidence. They can influence the model but cannot bypass tool policy,
  workspace confinement, file hashes, or the write lock.
- `workspace/applyEdit` remains denied. `lsp_code_actions` is a sandboxed read;
  no response can mutate the workspace or invoke a language-server command.
- Alternatives are mutually exclusive proposals. Napier never merges them or
  silently picks one. The Agent must choose one action and use current
  per-file hashes through `apply_patch`.
- `complete` means no returned alternative was omitted or truncated. It does
  not mean an ignored command ran, that the quick fix is behaviorally correct,
  or that the project has no other diagnostics.
- TypeScript 5.9.3 emits one-character-past-line-break positions for one
  missing-declaration alternative. Napier normalizes only that exact
  zero-length Code Action insertion to the next line; rename and replacement
  ranges remain strict.
- Aggregate candidate limits are checked before filesystem I/O. Edit locations
  are materialized serially with a cache, source version/hash must still match
  the one-shot `didOpen`, and source plus target hashes are rechecked before
  return.
- This slice does not provide persistent LSP synchronization, Code Action
  resolve, command execution, direct multi-file apply, DAP, AST rewrite, or
  automatic test selection.

Observed result:

- the real TypeScript 5.9.3 / typescript-language-server 5.3.0 runner returned
  two missing-name quick fixes. The preferred alternative inserted the
  cross-file import; the second inserted a local declaration. Both remained
  preview-only;
- real protocol probing found `_typescript.applyCodeActionCommand` arguments
  containing paths, diagnostics, and source. Parser, Agent, Server, Replay, and
  Web tests prove those command/data bodies never cross the parser boundary
  into Agent output or durable evidence;
- a deterministic Agent Run selected the preferred import, committed one
  hash-bound patch, changed write-linked diagnostics from one error to zero,
  reran explicit diagnostics as clean, and produced a valid Replay without
  path, source, diagnostic, command, argument, or replacement leakage;
- the public HTTP/SSE path ran the real language server, exposed two
  alternatives to the live Agent, retained hash-only durable evidence, and
  left the source file unchanged;
- aggregate tests fail closed above 256 edits, 32 files, 32 KiB preview text,
  or 64 KiB escaped output. Review additionally removed 256-way file-read
  concurrency and added source-version plus post-materialization target drift
  checks;
- the sixth opt-in macOS LSP smoke remains unavailable from this nested IDE
  host and fails during Sandbox startup with no direct-process fallback;
- the complete repository gate passed 1014 tests with 14 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: Semantic LSP Document Symbols

User scenario: a coding Agent can inspect the real TypeScript/JavaScript
semantic outline, locate nested declarations with exact server-provided ranges,
read only the relevant source, apply a hash-bound edit, and verify the result
without relying on regex symbol inference.

Acceptance:

- add opt-in `lsp_symbols` with a workspace-relative source, 1-256 requested
  result limit, and bounded timeout;
- reuse the existing exact-version, one-shot, read-only/offline LSP Sandbox,
  source/runtime drift checks, process-group termination, cancellation,
  protocol/stderr caps, and denied `workspace/applyEdit`;
- advertise hierarchical document-symbol support while accepting both standard
  `DocumentSymbol[]` and flat `SymbolInformation[]` responses;
- strictly validate standard keys, SymbolKind 1-26, deprecated tags, text
  bounds, selection containment, hierarchical parent containment, and flat
  target URI equality;
- split source lines once; cap protocol traversal at 1,024 nodes, depth 32,
  and 16 MiB aggregate symbol/name range characters before
  materialization; canonicalize by source position/range, deduplicate stable
  receipts, and expose at most 256 symbols;
- bound live names/details/containers/signatures under a 48 KiB UTF-8 display
  budget and 64 KiB formatted output;
- return names, kinds, hierarchy, exact server-provided symbol/name ranges,
  source file SHA-256, range hashes, and bounded signatures only to the live
  Agent;
- retain only shape, completeness/truncation, counts, depth, display bytes,
  versions, latency, and source/symbol/kind/result hashes in Agent events,
  Ledger, Replay, Server SSE, and Web Trace;
- cover hierarchical and flat shapes, malformed responses, CRLF/UTF-16,
  ordering/deduplication, prototype-like kind labels, response/depth/display
  limits, path rejection, source/runtime drift, timeout, cancellation,
  concurrency, policy, recovery assessment, Agent apply, public SSE, Web
  projection, Replay privacy, dogfood, and optional OS-Sandbox smoke.

Threat boundary:

- Language-server names, details, containers, and signatures are untrusted
  source evidence. They cannot change tool policy, read another URI, expand a
  parent/source range, write files, execute commands, or access the network.
- `complete` means no distinct symbol was dropped by the requested count or
  display budget. It does not mean the one opened document represents every
  project symbol or external dependency.
- Flat responses cannot reconstruct hierarchy; Napier preserves
  `containerName` but reports depth zero instead of inventing parentage.
- Every range is interpreted against the exact preflight/didOpen source and the
  file plus runtime assets are rehashed after protocol settlement. Drift fails
  before output.
- The tool performs no write. The Agent must re-read the current file hash,
  apply through existing CAS `apply_patch`, and run diagnostics plus relevant
  tests.
- This slice does not provide persistent synchronization, workspace-symbol
  search, direct symbol edits, DAP, AST rewrite, automatic test selection, or
  write-linked symbol/test association.

Observed result:

- real TypeScript 5.9.3 returned hierarchical class, interface, constructor,
  method, property, namespace, constant, and nested local symbols after Napier
  advertised hierarchical support; a no-capability probe confirmed the flat
  fallback shape;
- a deterministic Agent Run used `lsp_symbols`, narrowed `read_file` to the
  reported method lines, applied one production hash-bound patch, observed
  automatic diagnostics `0 -> 0`, reran explicit diagnostics as clean, and
  produced a valid Replay with path/name/source redacted from symbol events;
- independent dogfood hashed the exact real server method range, changed it
  through production `applyWorkspacePatch`, and passed real `tsc --noEmit`;
- the public HTTP/SSE path ran the real language server, returned two semantic
  symbols live-only, retained hash-only durable evidence, and left the source
  unchanged; Web Trace renders only bounded receipt metadata;
- parser/materialization responsibilities are split between
  `lsp-symbol-parser.ts` and `lsp-symbol-model.ts`, avoiding another oversized
  runtime module;
- the seventh opt-in macOS LSP smoke fails closed during nested Sandbox startup
  in this IDE host, with no direct-process fallback;
- the complete repository gate passed 1044 tests with 15 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: Persistent Synchronous JavaScript Kernel

User scenario: an Agent can start one JavaScript calculation context, preserve
variables across multiple model turns in the same Run, inspect bounded values
and console output, recover from ordinary synchronous errors, and explicitly
close the context without receiving host process or shell access.

Acceptance:

- add opt-in `javascript_kernel` start/evaluate/cancel actions through the
  existing Agent loop, Server SSE path, Agent profile, policy, Context
  guidance, and Web Trace;
- reuse `WorkspaceProcessManager` rather than create a second Session or Store,
  while binding every kernel to its owning Thread and Run;
- launch the fixed worker in the existing explicit-argv, secret-free,
  read-only/offline OS Sandbox with a 10-120 second session lifetime and
  64 MiB V8 old-space limit;
- accept 1-16 KiB UTF-8 synchronous snippets with independent 1-2,000 ms VM
  budgets, canonical base64 transport that remains below the 32 KiB Process
  input limit under worst-case JSON escaping, and serialized concurrent input;
- preserve state after successful values and synchronous exceptions; terminate
  the whole kernel after a returned Promise/thenable, VM timeout, render
  timeout, cancellation, worker exit, malformed protocol, or unknown
  post-write result;
- drain discarded Promise microtasks before the evaluation returns and inside
  the same VM timeout, so finite continuations settle deterministically and
  infinite chains terminate the kernel;
- cancel every remaining Run-owned kernel before successful, failed,
  cancelled, waiting-for-operator, or budget-exhausted Run settlement so
  omitted model cleanup cannot retain Process slots;
- cap live previews at 4,096 characters and console output at 12 entries of
  256 characters; encode private result frames as canonical UTF-16LE base64,
  reserve a terminal response within a 30 KiB cumulative protocol budget, and
  cap the complete Agent tool output at 32 KiB;
- keep code, cwd, values, and console text live-only while retaining
  input/output, request, worker, result, environment, and lifecycle hashes in
  the Work Ledger and Replay;
- mark the active Process entry as a private protocol so generic Process list,
  output, input, Agent tools, HTTP, and Workbench cannot expose or inject
  reversible frames; retain operator cancellation and the same lifecycle
  Ledger;
- expose only action, status, type, terminal/truncation flags, counts, duration,
  Process ID, and hashes in Server history and Web Trace;
- cover persistence, synchronous error reuse, Promise termination, CPU and
  render timeouts, external cancellation, concurrency, output limits,
  malformed and oversized input, cross-Run denial, recreated-manager denial,
  success/failure Run cleanup, policy, recovery exclusion, Replay privacy,
  Agent dogfood, public SSE, Web projection, and optional real OS-Sandbox
  smoke.

Threat boundary:

- The context has no `process`, `require`, `fetch`, inherited environment,
  dynamic string code generation, WebAssembly, shared-memory Atomics, or
  GC-timed callbacks. It cannot import modules, invoke Napier tools, write the
  workspace, or access the network. Ordinary `ArrayBuffer` and TypedArrays
  remain available.
- Promise is a language intrinsic rather than an async-I/O capability.
  Microtasks drain within the current evaluation budget; returned thenables
  remain terminal, and no timer/network/process source is exposed.
- `SharedArrayBuffer`, `Atomics`, `FinalizationRegistry`, `WeakRef`, and
  `WebAssembly` are immutable `undefined`, preventing delayed wait, GC, and
  Wasm work from crossing an evaluation boundary.
- A lazily loaded TypeScript AST check rejects real dynamic `import()` calls
  before stdin write, preventing asynchronous VM module rejection from
  changing later evaluations without charging compiler load to Runtime
  startup.
- `node:vm` is not treated as a security sandbox. Production execution remains
  inside macOS sandbox-exec or Linux Bubblewrap with the same fixed environment
  and capabilities as other Process Sessions.
- Console capture and result rendering are created entirely inside the VM
  realm. No host function or object is injected. Regression tests prove that
  `console.log.constructor`, nested constructors, `Function`, `eval`, and
  `globalThis.constructor.constructor` cannot reach the child `process`.
- Result formatting does not call outer-realm `util.inspect`; a malicious
  `nodejs.util.inspect.custom` method remains inert. User `toJSON`, Proxy, and
  thenable work is confined to a 100 ms render script, whose timeout terminates
  the kernel.
- State is ephemeral and not a recoverable artifact. Another Run or recreated
  manager cannot adopt it; restart interruption never replays prior snippets.
- The private-protocol marker is an in-memory access boundary over the existing
  Process entry, not a second Session or evidence source. Public projection
  reports output/stdin unavailable, while restart already removes all live
  handles.
- This slice is not a Notebook, async JavaScript runtime, module environment,
  Python runtime, cross-restart checkpoint, or tool-calling runtime.

Observed result:

- deterministic Agent dogfood started one kernel, preserved an array across
  separate tool turns, reduced it to a final value, cancelled the process, and
  produced a valid Replay without code, values, console text, or cwd paths;
- Runtime tests exercise real child processes and the production Process
  Manager protocol, including two demonstrated cross-realm escape regressions
  that previously exposed the child `process` through console and custom
  inspection, plus a full 16 KiB escape-amplified source frame;
- control-character-heavy results remain intact below the Process output cap,
  while the next oversized cumulative result returns a structured terminal
  output-budget response instead of a truncated JSONL frame;
- the public HTTP/SSE path streams start/evaluate/cancel through the shared
  Runtime, persists three hash-only tool results, and Web Trace renders only
  bounded receipt metadata; the generic Process HTTP projection exposes
  neither protocol output nor writable stdin;
- the optional OS-Sandbox smoke shares `npm run test:live-process`; this nested
  IDE host rejects both the existing Process input smoke and the new kernel
  smoke. A production `CommandRunner` probe returned exit 71 with
  `sandbox-exec: sandbox_apply: Operation not permitted`; no direct-process
  fallback is used;
- the complete repository gate passed 1057 tests with 16 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: TypeScript AST Query and Edit Preview

User scenario: a coding Agent can select an exact TypeScript or JavaScript
syntax node, preview one structural change against current bytes, apply the
reviewed result through the existing CAS primitive, and prove the result with
real TypeScript rather than relying on regex ranges or model-reported success.

Acceptance:

- add opt-in `ast_query` and `ast_edit_preview` tools through the shared Agent
  Runtime, profile, policy, safe recovery, Context guidance, Server SSE, and
  Web Trace paths;
- parse TypeScript, TSX, JavaScript, JSX, MTS, CTS, MJS, and CJS with the pinned
  TypeScript compiler without starting a process, network client, or second
  state system;
- confine one <=1 MiB UTF-8 source file to the canonical workspace, reject
  protected roots and symlinks, cap traversal at 100,000 nodes, and expose at
  most 64 selected nodes under independent range/display/output budgets;
- support bounded kind/name/ancestor selection for declarations, members,
  imports, calls, parameters, variables, and arrow functions while returning
  exact UTF-16 ranges and stable file/node hashes;
- require both the current file SHA-256 and selected node SHA-256 before an
  edit preview; reject stale file or node evidence;
- preview replace, remove, insert-before, and insert-after without writing;
  rebuild and parse the complete candidate source, reject syntax regressions,
  expand line context until OLD text is unique, and return an exact OLD/NEW
  replacement for `apply_patch`;
- fail closed when insert/remove would reassign leading or trailing comments
  to a different node; require an explicit reviewed replace for that case;
- rehash the source after materialization and map native filesystem errors to
  fixed path-free tool errors before they can reach a remote model;
- keep paths, selector names, signatures, source, and replacements live-only;
  retain only bounded metadata and hashes in Ledger, Replay, SSE history, and
  Trace;
- cover exact and missing selectors, duplicate-node context expansion, all
  edit operations, malformed and oversized source, invalid UTF-8, path escape,
  protected roots, symlinks, stale evidence, syntax regression, comment
  trivia, cancellation, concurrency, policy, safe recovery, live-error privacy,
  Replay, Agent apply, public SSE, Web projection, and real CAS-to-typecheck
  dogfood.

Threat boundary:

- TypeScript source, symbol names, signatures, and replacement text are
  untrusted model context. They cannot write a file, select another path, or
  bypass policy and CAS freshness.
- The compiler API parses syntax in the Runtime process but does not execute
  source, load project plugins, resolve imports, invoke package managers, or
  access the network. The 1 MiB file and 100,000-node limits bound this
  in-process slice; hostile project-wide analysis remains in the OS-sandboxed
  LSP path.
- `ast_edit_preview` proves that one complete candidate file parses. It does
  not prove type correctness, test success, formatting, semantic intent, or
  behavior. Diagnostics and relevant verification remain mandatory after
  `apply_patch`.
- Node identity binds the exact file hash, kind, name, depth, range, text, and
  nearest categorized parent. A fresh query is required after any write.
- Comment ownership is not guessed. Ambiguous insert/remove operations fail
  before preview instead of silently attaching documentation or trailing notes
  to a new node.
- Query and preview are read effects and may participate in safe read-only
  recovery. The resulting `apply_patch` remains a write effect and is never
  replayed automatically.
- This slice does not provide a general transformation DSL, multi-node atomic
  rewrite, cross-file refactor, formatter, typechecker, persistent compiler
  session, DAP, or direct AST write.

Observed result:

- deterministic Agent and public HTTP/SSE runs completed
  `ast_query -> ast_edit_preview -> apply_patch` through the shared Runtime,
  changed the exact selected method, and produced valid path/name/source-free
  durable evidence;
- independent dogfood selected a real TypeScript method, generated the unique
  exact replacement, committed it through production `applyWorkspacePatch`,
  re-queried the changed node, and passed pinned `tsc --noEmit`;
- review reproduced JSDoc and same-line trailing-comment reassociation in the
  initial insertion implementation. The final boundary rejects those previews
  and has regressions for insert-before, insert-after, and remove;
- review also reproduced an absolute workspace path in a native `realpath`
  error. The final Agent regression proves the next model call and Ledger see
  only a fixed path-free failure;
- Runtime, Agent, Server, Replay, and Web tests cover the vertical path, while
  the main production code remains split across focused AST model, source,
  runner, tool, and Trace modules rather than extending Store or Server.
- the complete repository gate passed 1069 tests with 16 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: Persistent Restricted Python Kernel

User scenario: an Agent can keep pure Python calculation state across model
turns, inspect bounded values and print output, recover from ordinary syntax or
runtime errors, and explicitly close the context without receiving imports,
files, packages, network, subprocess, or host-shell access.

Acceptance:

- add opt-in `python_kernel` start/evaluate/cancel actions through the shared
  Agent Runtime, profile, policy, Context guidance, Server SSE, Web Trace, and
  private Process Session APIs;
- keep the public generic command/background-process schema Node-only while
  preparing Python only for the typed private kernel path;
- resolve only fixed Linux or recognized macOS CLT/Xcode Python executables,
  bind the exact version root read-only, hash the executable and bounded
  no-site bootstrap dependency source/existing-bytecode/native-extension set
  before start and after settlement, prove that it covers every module file
  loaded by the real worker imports, and fail closed for unavailable or
  drifting runtime bytes;
- launch with isolated/no-bytecode/no-site/unbuffered flags, a fixed
  secret-free and deterministic-hash environment, no network, read-only
  workspace, and hard CPU/process/output-file/core/file-descriptor limits;
- expose only selected arithmetic, container, iterator, conversion, exception,
  and print builtins; reject imports, classes, async/await, yield/generators,
  context managers, global/nonlocal, decorators, private/dunder names, and
  frame/traceback access before execution;
- accept 1-16 KiB UTF-8 snippets with independent 1-2,000 ms wall budgets and
  a 10-120 second total session lifetime;
- cap live previews at 4,096 characters, console at 12 entries of 256
  characters, cumulative private protocol at 30 KiB, Agent output at 32 KiB,
  and persistent traced Python heap at 32 MiB;
- make memory termination uncatchable by writing one fixed private marker and
  exiting the trusted worker process; map only that marker to a fixed
  path-free error and never persist it as text;
- enforce each evaluation's wall budget inside the worker with a separate
  trusted signal marker and uncatchable process exit rather than treating the
  Manager's protocol grace period as executable time;
- use zlib plus canonical base64 for the fixed worker under the unchanged 16
  KiB explicit-argv budget, canonical base64 for requests, and canonical
  UTF-16LE base64 for result/console strings;
- cancel every remaining JavaScript and Python kernel before all terminal Run
  paths through a focused `AgentKernelRuntime`, reducing rather than expanding
  the oversized Agent module;
- keep code, values, console, cwd, runtime paths, and raw stderr live-only;
  retain only action/status/type/version/count/time/memory and
  request/worker/runtime/command/result/output hashes;
- cover persistence, synchronous error reuse, import/dunder/frame denial,
  generator-frame exploit, worker-enforced wall timeout, bare-except memory
  bypass, external cancellation, concurrent evaluations, oversized input,
  preview/console/protocol limits, cross-Run and recreated-manager denial,
  policy, recovery exclusion, Replay privacy, Agent dogfood, public SSE,
  Process projection, Web Trace, loaded-runtime-asset binding, and optional
  real OS-Sandbox smoke.

Threat boundary:

- Python restrictions protect the typed protocol and reduce available
  capability; they are not presented as a replacement for process isolation.
  The local OS Sandbox remains the host boundary.
- User code cannot import modules or recover worker globals through dunder,
  generator frames, normal frames, or traceback fields. The concrete
  `gi_frame.f_back.f_globals` path is a regression case.
- The selected worker may read its fixed runtime and the Sandbox may read the
  workspace, but restricted user globals contain no file/import/environment
  entry point. Workspace writes and network remain denied independently by the
  OS Sandbox.
- A trusted trace hook observes Python allocations. Crossing 32 MiB invokes
  `os._exit(70)`, which user `except:` cannot catch. This is not a hard total
  RSS quota for arbitrary native extensions; extensions/imports are
  unavailable and OCI/VM quotas remain required for full Python.
- A trusted `ITIMER_REAL` handler separately invokes `os._exit(71)` at the
  requested evaluation deadline. The Manager maps only its fixed private
  marker to a path-free timeout and destroys the registration.
- Synchronous errors may leave partial user-state mutations and are reported
  as such while preserving the context. Timeout, memory exit, background
  thread, malformed protocol, output exhaustion, cancellation, or unknown
  input outcome destroys the whole context.
- State is ephemeral. Another Run, recreated manager, or restart cannot adopt
  or replay prior snippets. Safe automatic recovery excludes every Python
  kernel action.
- Generic Process list/output/input reports private protocol output/stdin
  unavailable. Operator cancellation still settles the same authoritative
  Process Ledger.
- This slice does not provide general Python, package installation,
  DataFrame/SQL, Notebook, async I/O, filesystem or Napier-tool callbacks,
  snapshots, cross-restart recovery, or hard total-RSS accounting.

Observed result:

- deterministic Agent dogfood preserved `[3, 5, 7]` across turns, calculated
  `15` in a real Python child, explicitly cancelled the context, and produced a
  valid Replay without code, values, console, or cwd paths;
- the public HTTP/SSE path ran start/evaluate/cancel through the shared
  Runtime, returned `42` live-only, retained three hash-only tool results, and
  exposed no generic Process output or stdin;
- worker/runtime preparation takes approximately 10 ms and post-run asset
  verification approximately 10 ms in steady state on the reviewed macOS host
  (the first observed preparation was 16 ms); 60 assets cover the worker's
  actual loaded files, and compressed worker argv is 5,017 characters under
  the unchanged 16 KiB budget;
- review found and fixed a catchable memory-guard exception, a generator-frame
  worker-global escape, an unenforced per-evaluation timeout, and an incomplete
  runtime-asset manifest before release; all four concrete failures now have
  executable regressions;
- `AgentKernelRuntime` centralizes both language managers and Run cleanup;
  `agent-runtime.ts` is four lines smaller than the prior committed baseline;
- the opt-in production Sandbox probe fails closed in this nested IDE with
  exit 71 and `sandbox-exec: sandbox_apply: Operation not permitted`; no
  unsandboxed fallback is used.
- the complete repository gate passed 1082 tests with 17 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: Run-Owned Node DAP Launch Debugging

User scenario: a coding Agent can launch a real workspace Node program, stop at
source or exception boundaries, inspect stack/scopes/variables, evaluate a
side-effect-rejected expression, single-step through nested calls, and prove
the target outcome without opening a network debugger or persisting source
details.

Acceptance:

- add opt-in `node_debugger` launch, stack, scopes, variables, evaluate,
  continue, step-over, step-in, step-out, and cancel actions through the shared
  Agent Runtime, policy, Context guidance, Server SSE, and Web Trace paths;
- launch the fixed adapter through a private `WorkspaceProcessManager` session
  with a fixed secret-free environment, read-only workspace, denied network,
  bounded lifetime/output, and Run ownership;
- use a controller Worker plus `node:inspector.connectToMainThread()` so the
  main thread remains the real target without opening a TCP listener;
- confine one <=1 MiB JavaScript or Node-executable TypeScript entry to a
  canonical non-symlinked workspace file outside protected roots;
- implement strict bounded DAP `Content-Length` framing and authenticate every
  adapter response/event with a random per-process nonce;
- reject false internal pauses and relocated breakpoint hits that do not match
  the requested workspace line;
- support exception stops, stack, scopes, bounded variables/object references,
  target argv/output, and `throwOnSideEffect` evaluation;
- bind the source and sorted loaded workspace module graph, rehash both before
  every paused-state action, and terminate the complete session on drift;
- distinguish target exit from adapter cleanup while settling private Process
  evidence before the terminal Run event, including when the model omits
  explicit cancel;
- keep source, paths, argv, expressions, frame/scope/variable names and values,
  and target output live-only; retain bounded lifecycle/count/version and
  source/module/worker/runtime/DAP/result hashes;
- cover framing fragmentation/injection, real breakpoint/exception stops,
  scopes/variables/evaluation, step over/in/out, argv/output truncation,
  source/dependency drift, timeout, cancellation, concurrency, cross-Run
  access, unauthenticated target frame spoofing, policy, recovery exclusion,
  Replay privacy, Agent dogfood, public SSE, Web projection, and opt-in real
  OS-Sandbox smoke.

Threat boundary:

- The target is arbitrary workspace Node code. It is intentionally a high-risk
  write-effect tool and remains inside the read-only, network-denied OS Sandbox
  with no inherited environment. The in-process policy and DAP parser do not
  replace that host boundary.
- The adapter and target share a process only at the main-thread/Worker
  boundary. Authentication material remains in the controller Worker. Target
  stdout can provide untrusted live output or force fail-closed termination,
  but cannot forge an accepted stack, stop, variable, or exit frame.
- Expressions execute only on an existing paused call frame with
  `throwOnSideEffect` and a 250 ms inspector budget. This is inspection, not a
  general REPL or mutation interface.
- Source and loaded workspace modules are evidence bindings, not snapshots.
  Any drift requires a fresh launch; the adapter never silently continues
  against new bytes.
- Generic Process APIs expose no private output or writable stdin. Another Run,
  recreated manager, or restart cannot adopt a debugger registration.
- The Agent surface omits pause because synchronous continue/step waits for the
  next stop or termination. The adapter retains the standard command for a
  future non-blocking session model rather than advertising an unreachable
  action.
- This slice is launch-only. Attach, hot breakpoint mutation, source maps,
  multi-thread/child debugging, a generic third-party adapter host, debugger
  UI, write-capable targets, checkpoints, and cross-restart recovery remain.

Observed result:

- real child-process dogfood stopped in a nested function, inspected local
  `input=20`, evaluated `input + 1` as `21`, stepped over/in/out, captured
  bounded argv-driven stdout, and completed with target exit code 0;
- a separate exception target stopped with the real local value available and
  completed with target exit code 1 after continue;
- deterministic Agent and public HTTP/SSE runs used the same tool loop and
  emitted only hash-bounded durable evidence; a model that ended while paused
  still had its Process cancelled before `run.completed`;
- review found and fixed stale dependency inspection and an inaccurate
  adapter-side output truncation flag, with executable regressions for both;
- security review found no exploitable path across policy, canonical source,
  private protocol authentication, Sandbox, or Ledger projection;
- the opt-in production Sandbox smoke is inconclusive in this nested IDE:
  the existing JavaScript smoke and a minimal `/usr/bin/sandbox-exec` probe
  both fail with exit 71 and `sandbox_apply: Operation not permitted`; no
  unsandboxed fallback exists;
- the complete repository gate passed 1098 tests with 18 opt-in live tests
  skipped by default, verified 244/244 OpenAPI operations, and kept the Web
  main entry at 129.13 KiB against the 150 KiB budget.

## Completed Slice: Typed Executable Plan Workflows

User scenario: a developer can turn an existing durable Blueprint into a
versioned typed Agent DAG, execute it through CLI JSONL or HTTP SSE, inspect
the same Plan/Run/Ledger evidence, resume after restart, and explicitly retry a
failed node without silently replaying unknown side effects.

Acceptance:

- export a TypeScript `defineExecutionPlanWorkflow()` SDK helper and stable
  `napier.execution-plan-workflow` manifest;
- validate one bounded JSON Schema subset for Workflow input/output and every
  node boundary;
- require manifest nodes to match the existing Blueprint DAG and use the
  existing `ExecutionPlan` as the only durable scheduler state;
- execute each node through a real `AgentRuntime` Run with explicit model,
  timeout, attempt limit, typed bindings, and strict JSON output;
- freeze the target Agent revision at Workflow start and persist every node Run
  as `source=workflow`;
- exclude Thread message history, prior node delegation/milestone projections,
  Goal evaluation, automatic Memory proposal, Plan mutation tools, milestone
  tools, and operator-decision tools from Workflow node execution;
- block generic manual and automatic recovery of Workflow-owned Runs;
- reconstruct completed, failed, interrupted, and commit-gap node state from
  Plan, Run, assistant output, and Work Ledger evidence;
- require explicit bounded retry for blocked nodes and keep terminal
  observation Ledger-idempotent;
- expose one shared CLI command and HTTP route with ordered event frames,
  authoritative snapshot, and hash-bound `workflow_result`;
- project Workflow Trace summaries without input, output, diagnostics, prompt,
  or path bodies;
- keep Workflow implementation split across manifest, schema, protocol,
  context, model, Ledger, recovery, and scheduler modules rather than growing
  Store or Server.

Threat boundary:

- Workflow input and node output are untrusted JSON data. Runtime schemas bound
  size and shape; prompt labeling is defense in depth, not a replacement for
  tool policy or Sandbox enforcement.
- Agent nodes retain ordinary policy-approved tools, current reviewed Memory,
  Skills, model credentials, and Sandbox behavior. Every side effect remains a
  normal Agent tool effect in the same Work Ledger.
- Typed bindings enforce the node prompt data path. Workflow Runs load no
  Thread message history, and a regression proves an unbound earlier-node
  output is absent from the later model request.
- A process exit after Run settlement, Plan transition, or Plan event may leave
  a commit-order gap. Resume repairs known evidence, blocks unknown outcomes,
  preserves the original attempt, and never executes during reconstruction.
- Generic `napier resume` and safe automatic recovery reject Workflow Runs;
  only manifest/Plan-bound Workflow resume can reopen them.
- Manifest v1 executes dependency-ready Agent nodes sequentially. It does not
  claim parallel nodes, conditions, loops, Map/Reduce, compensation,
  approvals, deterministic/Tool nodes, external adapters, or artifact
  settlement.

Observed result:

- deterministic Runtime dogfood executes a two-node typed report, proves
  unbound prior output isolation, freezes Agent revision across an in-flight
  profile update, and verifies a portable Replay;
- persistent Store reopen tests cover active-Run interruption, terminal Run
  failure, invalid completed output, missing failure-event reconstruction,
  semantic evidence mismatch, and duplicate-free recovery;
- CLI dogfood covers new execution, blocked observation, explicit retry,
  result-frame tampering, invalid-input no-mutation, and workspace path escape;
- HTTP dogfood covers the same shared Runtime through SSE, and Web tests prove
  Trace summaries omit raw bodies;
- an opt-in DeepSeek CLI smoke is compiled for a real typed node and remains
  skipped in this environment because `DEEPSEEK_API_KEY` is unavailable.
- the complete repository gate passed 1122 tests with 19 opt-in live tests
  skipped by default, generated 245 OpenAPI routes while preserving the
  244/244 compatibility baseline, and kept the Web main entry at 129.13 KiB
  against the 150 KiB budget.

## Completed Slice: Workflow Checkpoint Experiments

User scenario: a developer can preview and fork a completed or blocked typed
Workflow from one node, replace models for the rerun subgraph, reuse verified
ancestor results, and inspect an independent result without mutating the source
Plan.

Acceptance:

- derive the rerun set as the selected node plus every descendant and require
  every node outside that set to have verified completed source evidence;
- bind reused node source/target input hashes, source output hash, source
  Thread/Plan/Run/attempt, frozen Agent revision, model, schemas, and unique
  start/completion evidence;
- execute reused ancestors as explicit `source=workflow_reuse` control Runs,
  then execute rerun nodes through the normal Agent Runtime and policy path;
- allow model replacement only for rerun nodes and include both source and
  deterministically derived candidate Manifests in the final result;
- summarize all historical rerun-attempt tool effects and require explicit
  confirmation of the exact current preview for write, unknown, or unresolved
  effects;
- create no target Thread during preview, stale confirmation, malformed source
  evidence, or pre-abort;
- recover blocked rerun nodes through normal Workflow resume and reconstruct
  unmaterialized reused ancestors after cancellation/restart without executing
  them as Agent nodes;
- expose the same Runtime through CLI preview/JSONL execution and HTTP
  no-store preview/SSE execution, ending with a snapshot-bound
  `workflow_experiment_result`;
- project only bounded IDs, counts, confirmation state, and hashes into Web
  Trace while preserving full local result delivery.

Threat boundary:

- ordinary Workflow requests cannot pin historical Agent revisions or inject
  reused outputs; those values enter the scheduler only through a
  package-internal experiment capability after source projection;
- source Plan state is never mutated. Incomplete reuse recovery requires the
  exact source Plan revision and input; drift fails closed;
- synthetic reuse cannot enter generic manual/automatic Run recovery or
  ordinary blocked-node retry. An interrupted reuse is re-materialized only
  from verified source evidence;
- confirmation covers observed historical tool effects, not permission for
  future effects. Rerun tools still pass normal capability, policy, scope,
  freshness, and Sandbox checks;
- this slice is Workflow-node controlled re-execution, not complete Replay
  debugging. User/model/tool checkpoints, side-effect simulation,
  Prompt/Skill/Memory/environment replacement, single-step, batch comparison,
  and promotion remain open.

Observed result:

- deterministic Runtime dogfood forks a two-node source, reuses its ancestor,
  replaces the selected model, validates Replay/result-frame tampering, and
  creates a second experiment from the first experiment;
- cancellation before ancestor materialization resumes from Ledger with one
  synthetic reuse Run and no accidental ancestor model call;
- Runtime/HTTP regressions reject public Agent revision pinning, fabricated
  reuse internals, stale preview confirmation, ambiguous source evidence, and
  model overrides on reused nodes;
- CLI and HTTP complete the same experiment path, Web Trace omits raw source
  bodies, and an opt-in DeepSeek smoke checkpoint-reruns a real typed node;
- the complete repository gate passed 1133 tests with 19 opt-in live tests
  skipped by default, generated 247 OpenAPI routes while preserving the
  244/244 compatibility baseline, and kept the Web main entry at 129.13 KiB
  against the 150 KiB budget. One first-pass high-parallel Server Python kernel
  timing assertion passed both standalone and in the complete 75/75 Server
  suite; the second complete repository gate passed without failures.

## Completed Slice: Workflow Experiment Comparison

User scenario: after rerunning a Workflow checkpoint, a developer can tell
whether the experiment improved or regressed the original execution without
manually correlating two Threads, while retaining the actual source and target
evidence behind every aggregate.

Acceptance:

- align source and target nodes by the source/candidate Manifest and classify
  each target node as verified reuse or actual rerun;
- observe actual Workflow Run IDs, sources, selected models, configuration
  hashes, attempt and Run counts, duration, token/cost usage, tool outcomes,
  tool-set additions/removals, current input/output hashes, existing
  Evaluation coverage, and path-free Artifact state;
- define every numeric delta as `target - source` and distinguish unchanged,
  changed, newly available, newly unavailable, and unavailable values;
- accept an output hash only from the current completed Plan step's Run, not
  from an older successful attempt after reopen or failure;
- bind the comparison to source/target Thread, Plan, Manifest, preview,
  Workflow result, node order, execution classification, and actual
  `workflow`/`workflow_reuse` Run sources;
- recheck source and target Plan revisions after evidence observation and fail
  closed if the source changes while the target executes;
- preserve schema-v1 compatibility by accepting old experiment results without
  a comparison while always including one in newly generated results;
- deliver the complete comparison in the existing CLI JSONL and HTTP SSE
  terminal frame, print a concise human CLI delta, and append one bounded
  `workflow.experiment.compared` Ledger event for Web Trace.

Threat boundary:

- the comparison contains no prompt, model output body, tool argument,
  Evaluation reason/evidence, raw diagnostic, or Artifact path;
- every observed Run ID has one positionally bound source, model, and
  configuration hash. Removing any of those fields and recomputing the
  comparison content hash fails semantic validation;
- source and target Thread/Plan identities must remain distinct. Non-Workflow
  Runs, mismatched reused/rerun sources, stale Plan revisions, ambiguous input
  or output evidence, and changed result bindings fail closed;
- existing Evaluation records are summarized, not treated as newly executed
  evaluations. Artifact summaries expose status counts and a set hash, not
  local paths.

Observed result:

- deterministic Runtime dogfood compares a completed source with a model-
  replaced target, a blocked regression, a repaired blocked source,
  cancellation before any target Run, restart recovery, and a nested
  experiment;
- tamper regressions recompute content hashes after removing required Run
  provenance, verify target Run-source classification, and reject source Plan
  drift during target execution;
- CLI human and JSONL paths, HTTP SSE, privacy-bounded Web Trace, and the
  opt-in real DeepSeek checkpoint smoke consume the same Runtime comparison;
- the focused Runtime, recovery, Replay, CLI, Server, and Web matrix passes
  with no raw source or target body in comparison or Trace output;
- the complete repository gate passed 1135 tests with 19 opt-in live tests
  skipped by default, verified 247 current OpenAPI routes against the 244/244
  compatibility baseline, and kept the Web main entry at 129.13 KiB against
  the 150 KiB budget.
