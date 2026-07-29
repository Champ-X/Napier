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

| Priority                          | Current status | Highest-value remaining gap                                                                                                                                                                                                       |
| --------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 architecture and baseline      | In progress    | Split Server and Store by domain; add startup, first-token, tool-latency, long-thread, memory, and database-growth budgets.                                                                                                       |
| P1 managed work environment       | In progress    | `run_command` provides one foreground, read-only, offline Node execution slice. Python, PTY, background jobs, process inventory, workspace diff, write sessions, hard CPU/memory quotas, containers, and remote sandboxes remain. |
| P2 coding intelligence            | Partial        | Hashline and bounded symbols exist; LSP, DAP, AST edits, post-write diagnostics, and isolated subagent worktrees do not.                                                                                                          |
| P3 browser/research/data/media    | Early          | Structured local data and research Skills exist; persistent browser sessions, source unification, SQL/DataFrame/Notebook, and media production do not.                                                                            |
| P4 executable Workflows           | Early          | Plans and Blueprints are durable data; typed executable nodes, checkpoint reruns, SDK manifests, and JSONL workflow events do not.                                                                                                |
| P5 controlled re-execution        | Early          | Evidence replay and comparison exist; checkpoint forks, frozen/replaced dependencies, side-effect simulation, and single-step reruns do not.                                                                                      |
| P6 product entry points           | Early          | Web Workbench and HTTP/SSE exist; CLI/TUI, one-shot JSONL, SDK/RPC, ACP, and Desktop are not product-complete.                                                                                                                    |
| P7 extension developer experience | Partial        | Signed MCP packages are deep; stable extension SDK, UI cards, hot reload, ecosystem discovery, and compatibility suites remain.                                                                                                   |
| P8 models and memory              | Partial        | Pi providers, credentials, and reviewed facts exist; dynamic catalogs, local/custom providers, routing policies, semantic memory, decay, and correction retrieval remain.                                                         |
| P9 outcome benchmark              | Not started    | Build fixed Coding, Research, Workflow, Long-horizon, Tooling, Security, and UX tasks with environment and Ledger evidence.                                                                                                       |
| P10 team/distributed              | Deferred       | Do not prioritize Postgres, distributed workers, RBAC, or collaboration before the local P0-P9 acceptance gates.                                                                                                                  |

## Current Slice: Read-Only Sandboxed Commands

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

## Next Candidate

Build a durable foreground/background Workspace Process Session around the
same runner: process IDs, bounded output cursors, cancel/timeout settlement,
restart reconciliation, pre/post workspace snapshots, and Workbench process
cards. Do not add write capability until preview, explicit scope, diff, and
recovery behavior are complete.
