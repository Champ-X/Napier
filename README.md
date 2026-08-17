# Napier

Napier is a local-first, glass-box agent runtime for work that takes more than
one prompt. It pairs a small extensible agent core with durable goals,
workspace-scoped tools, replayable event ledgers, and an inspection-first UI.

Its distinguishing primitive is the **work ledger**: messages, model calls,
tools, goals, branches, artifacts, and runtime decisions all share one ordered,
replayable evidence stream. Durable behavior is recorded before it is shown, so
every run can be inspected, resumed, branched, and replayed.

> Version `0.1.0`. The demo model runs with no credentials; add a provider key
> to use live models.

## Quick start

Prerequisite: Node.js `>=22.19.0`.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173` and start a task — the zero-key demo model works
immediately. `npm run dev` loads a repository `.env` when present, so the
Server and Web processes share one environment without exposing secrets on the
command line.

To use a live model, open **Context → Provider credentials** in the UI and
enable a provider whose API key is present in the environment; the secret value
never leaves the Server.

## CLI

The CLI is backed by the same runtime, policy, sandbox, and SQLite ledger as
the Web app:

```bash
npm run napier -- chat        # line-oriented terminal session
npm run napier -- tui         # full-screen multi-turn session
npm run napier -- run "..."   # one-shot run
npm run napier -- resume      # resume an interrupted run
npm run napier -- branch      # branch from any message sequence
npm run napier -- workflow    # run a typed executable plan workflow
npm run napier -- setup       # preview/apply provider credential setup
```

A long-lived `napier rpc` stdio JSON-RPC 2.0 process exposes the same runtime
to the TypeScript SDK and other embedders.

## What's inside

- **Work ledger & replay** — an authoritative SQLite WAL store; threads,
  branches, and portable replay fixtures reconstruct runs deterministically.
- **Durable execution** — long-horizon goals, run budgets, live run control,
  operator decisions, safe automatic recovery, and agent milestones.
- **Workspace-scoped tools** — sandboxed command execution, controlled Git
  operations, workspace editing, JS/Python kernels, a Node debugger, controlled
  browser sessions, and reversible file lifecycle — all permission-checked
  immediately before execution.
- **Executable plan workflows** — versioned, typed, hash-bound multi-step
  plans with approval gates, breakpoints, checkpoint experiments, and shared
  CLI/HTTP/SDK/RPC/Web evidence.
- **Governance & evaluation** — reviewed memory, an independent model advisor,
  signed extension packages, durable evaluation suites/casebooks, and
  OpenTelemetry trace export.
- **Interfaces** — Web workbench, CLI/TUI, HTTP/SSE server, local stdio RPC,
  and a store-free TypeScript SDK, all over one runtime.

See [docs/architecture.md](./docs/architecture.md) for the event contract,
runtime boundaries, and a detailed capability-by-capability reference.

## Architecture

```text
apps/web             Paper Ledger workbench; consumes contracts only
apps/server          Hono HTTP/SSE adapter and static production host
packages/contracts   Stable domain and stream contracts
packages/runtime     Agent loop, policy, goals, memory, subagents, MCP, store
packages/sdk         Store-free local TypeScript embedding facade
skills/              Bundled Agent Skills packages
.napier/             SQLite ledger and compatibility projections (Git-ignored)
```

The runtime holds four invariants:

1. Durable behavior is recorded before it is presented.
2. Sequence numbers are strictly increasing within a thread.
3. Model credentials and host capabilities stay server-side.
4. Tool permission is evaluated immediately before execution.

## Development

```bash
npm run typecheck   # type-check every workspace
npm test            # release-gate contract tests + workspace suites
npm run build       # build all workspaces
npm run check       # full gate: runtime/lockfile/OpenAPI/dist/tests
```

`npm run check` audits the Node runtime, `package-lock.json`, the
management-plane OpenAPI catalog, and the production Web dist before building
every workspace and running the test suites. The many `check:*` / `verify:*` /
`write:*` scripts refresh and verify individual release artifacts; see
`package.json` for the full list.

## Data & safety

- Runtime data defaults to `<workspace>/.napier`; override with `NAPIER_HOME`.
- Tool access is confined to `NAPIER_WORKSPACE` (the current directory by
  default).
- `ledger.sqlite` is authoritative; `workspace.json` and `events/*.jsonl` are
  non-authoritative compatibility projections for inspection and legacy
  migration.
- Model credentials and host capabilities never leave the Server.
- `GET /api/health` reports SQLite schema, migrations, and Node runtime
  readiness without exposing workspace content.

## Inspiration

Napier is not a fork, but it draws on:
[Pi](https://github.com/earendil-works/pi) (small runtime, unified model API,
composable tools, standard skills),
[LLM Space](https://github.com/deer-flow/llm-space) (local-first prototyping,
trace inspection, replay, evaluation),
[DeerFlow](https://github.com/bytedance/deer-flow) (long-horizon goals, context
governance, sandboxes, memory, subagents),
[Deer Workflow](https://github.com/deerwork-ai/deer-workflow) (workflow-style
decomposition and durable handoffs), and
[Oh My Pi](https://github.com/can1357/oh-my-pi) (hashline editing, passive
advisors, resilient control loops).

## License

Napier is released under the [MIT License](./LICENSE).
