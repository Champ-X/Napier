# Local Development and Troubleshooting

Reviewed on **2026-09-07** against `f5a5937b`. See the
[documentation index](README.md) for design and architecture references.

## Start the workbench

Use Node.js `>=22.19.0`, npm, and Git. From the repository root:

```bash
npm install
# Create .env only if it does not exist.
cp -n .env.example .env
npm run dev
```

Open the **Local** URL printed by Vite. It starts at
`http://127.0.0.1:5173` and tries the next port if that one is occupied; a URL
such as `http://127.0.0.1:5174` is expected in that case. The API defaults to
`127.0.0.1:8787`. Set `NAPIER_PORT` in `.env` to change it; the development
proxy follows that setting.

`npm run dev` compiles Contracts and Runtime, then watches Contracts, Runtime,
Server, and Web. It uses a compilation-only bootstrap. Publishable builds
still validate the retained release source manifest.

Sources: [development supervisor](../scripts/development-entry.mjs),
[Vite configuration](../apps/web/vite.config.ts),
[package scripts](../package.json).

## Credentials and model defaults

The tracked [.env.example](../.env.example) lists supported names with empty
values. Store actual values in the ignored root `.env`.

While `npm run dev` is running, creating, editing, replacing, or removing `.env`
restarts the development services. After saving it, wait for the services to
reload and select **Check again / 重新检查** in the provider setup card, then
enable the detected provider. Other launch modes require a server restart.
You can also register an environment variable reference in
**Settings → Agent & Model → Evidence → Provider credentials**. Register the
variable name there; its value remains server-side.

DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) is the preferred setup model
when DeepSeek is configured and active. An untouched seeded demo Agent can
use the first configured, active provider model. Explicit Agent model choices
are preserved. Without live credentials, `napier/demo` remains available for
deterministic product exploration.

If the setup card still reports no key, check the variable name and confirm
that `.env` belongs to the repository running the Server. Model credentials
and search credentials are separate settings.

Sources: [default model selection](../packages/contracts/src/default-run-model.ts),
[provider setup copy](../apps/web/src/environment-setup-copy.ts),
[model registry](../packages/runtime/src/models.ts).

## Workspaces and generated files

Set an absolute path to select the initial workspace on every server start:

```dotenv
NAPIER_WORKSPACE=/absolute/path/to/agent-workspace
# Optional separate location for the Ledger and runtime data:
# NAPIER_HOME=/absolute/path/to/runtime-data
```

The folder picker changes the active Server workspace. On restart, startup
configuration selects the workspace again; set `NAPIER_WORKSPACE` if the
selection should survive a restart. Runtime data otherwise defaults to
`<workspace>/.napier`.

New standalone deliverables are guided into `outputs/<threadId>/`, with a
separate subdirectory for each new site, report, or similar output. Keep its
HTML, CSS, scripts, images, and verification files together. Continue editing
the current thread's deliverable in place. To reuse another thread's result,
copy it into the current thread's output directory before editing it.

Patch and file lifecycle tools enforce ownership of thread output directories.
Legacy standalone files can also be protected by another thread's durable
patch receipt. Normal application source maintenance keeps the requested
project paths. These checks govern Napier's tools; other host programs can
still write files under their own filesystem permissions.

Source: [thread output ownership](../packages/runtime/src/workspace-thread-outputs.ts).

## HTML previews

Open the generated HTML from the conversation link or workspace file tree.
The inspector serves it in a directory-scoped preview, so relative CSS, images,
scripts, modules, and fonts can load alongside the document. Relative message
links prefer the current thread's output; an explicit file-tree selection
keeps its selected target.

If the preview differs from opening the file in a separate tab:

1. Check that both views refer to the same file and thread output directory.
2. Keep supporting assets below the HTML file's directory and use relative
   paths. Absolute site-root paths such as `/styles.css` do not identify a
   file in that preview directory.
3. Reopen the preview after changing the HTML, switching the workspace, or
   restarting the Server. The inspected HTML is pinned to a preview session;
   sessions expire after one hour and can be evicted earlier under capacity
   limits.
4. Check browser network errors for blocked dependencies. Preview scripts run
   in an opaque sandbox; access to the parent app, its APIs, and paths outside
   the preview directory is blocked. Google Fonts CSS and font hosts are
   allowed, but arbitrary external scripts or API calls are not. Sites that
   need those capabilities require their own development server.

Sources: [HTML preview handler](../apps/server/src/workspace-html-preview-http.ts),
[thread-aware file resolution](../apps/server/src/workspace-file-preview.ts).

## Search and read failures

Optional search credentials use these exact names:

```dotenv
FIRECRAWL_API_KEY=
BRAVE_API_KEY=
TAVILY_API_KEY=
```

The default provider order is Firecrawl, Brave, Tavily, then keyless Bing RSS
and DuckDuckGo, subject to availability and request category. The historical
misspelling `TAVILY_API_KRY` is accepted as a compatibility fallback; use
`TAVILY_API_KEY` in new configuration.

A search result is discovery evidence. It does not mean that the result page
has been read. Image searches may return explicitly labeled **image page
candidates** when a direct image provider is unavailable; those are pages to
inspect, not verified image URLs.

`web_fetch` supports HTML, Markdown, JSON, text, PDF, and recognized image
formats. An image response records image-source metadata, not OCR text.
Timeouts, DNS/network failures, and an open failure circuit are reported with
specific diagnostics. One unsuccessful fetch can coexist with useful results
from other sources. Inspect the individual tool result and the final run
status before deciding whether the task needs to be resumed.

If a completed search has no visible evidence, expand its trace entry and
inspect the retained metadata. A missing projection or unavailable historical
result should not be treated as proof that no search ran.

Sources: [provider order](../packages/runtime/src/web-search-provider-implementations.ts),
[fetch format handling](../packages/runtime/src/web-fetch-content.ts).

## Interrupted tasks and browser actions

The recovery banner checks the latest run's eligibility. Interrupted runs and runs
paused by budget exhaustion or with a partial outcome can offer manual
continuation. Workflow-managed and experiment runs have separate ownership
and are excluded from this generic resume path.

Manual continuation preserves the original run's context, model, and
capability configuration. Inspect any action with an unknown outcome before
repeating it. A browser locator timeout does not by itself mean Chrome or the
session has died: inspect the current page before retrying, since the action
may have taken effect. A healthy session remains usable.

Run progress vectors v3 distinguish execution activity from semantic progress
and delivery readiness. New inspection evidence or changed artifact states
allow bounded follow-through, including multi-step verification; duplicate
observations do not renew it. This activity window survives tracker recovery
and cannot override the semantic-stall deadline or Run budgets. Plan control
tools remain available during acquisition convergence. See the
[interruption investigation](investigations/2026-09-08-run-progress-interruptions.md)
for the evidence, bounds, and regression coverage.

Within a Run, the final context projection can also checkpoint older completed
execution steps before the model window fills. It retains user messages and
recent complete tool batches, persists source-bound summaries, and charges
compaction to the existing Run budget. Provider overflow retries require an
actually smaller request. See the [rolling context design](investigations/2026-09-08-run-context-compaction.md)
for thresholds, upstream references, evidence bindings, and recovery limits.

Automatic recovery is a separate, opt-in path with restricted read-only
capabilities and eligibility checks. It does not replay unresolved tool calls.
Manual browser recovery can request an operator confirmation; restricted
automatic recovery cannot use that path.

Sources: [manual recovery eligibility](../packages/contracts/src/manual-run-recovery.ts),
[browser interaction policy](../packages/runtime/src/browser-run-interaction-policy.ts),
[recovery architecture](architecture.md#restart-and-recovery-flow).

## Sandbox configuration

Use a supported sandbox runtime for command execution. If Docker uses a
non-default socket, set `DOCKER_HOST` to the socket for this machine; do not
copy another user's absolute path. The provider and Sandbox setup cards show
readiness independently.

`NAPIER_HOST_DIRECT_SANDBOX=1` is an explicit fallback that executes with the
current user's host authority **without OS isolation**. The workbench surfaces
that mode. See the [sandbox architecture](architecture.md#sandboxed-command-flow)
for the execution boundary.

## Tessmora knowledge service

The [Tessmora Skill source](../integrations/tessmora/SKILL.md) connects to the
locally running [Tessmora](https://github.com/Champ-X/MMA-RAG) backend at
`http://127.0.0.1:8000`. Python 3 must be on PATH. The upstream Python CLI is
retained unchanged, with a Node launcher for Napier's `run_command` tool.

Install the shared user Skill from the Napier application checkout:

```bash
node scripts/install-tessmora-skill.mjs
```

The installer writes `~/.agents/skills/mma-rag` and resolves an absolute launcher
path, so the Skill can run from any selected workspace. It can be rerun to
update this installation. Do not also copy it into a workspace's `skills/` or
`.agents/skills/`: Napier rejects ambiguous project/user definitions.

Skill installation and Agent enablement have separate scopes. Each workspace
has its own `<workspace>/.napier` Agent profiles; enabling a Skill in the Napier
source checkout does not enable it in another folder. In the **active workspace**,
add `mma-rag` to the selected Agent's enabled Skills. With the server running,
the following example updates the active default Agent through its API and
prints the workspace being configured:

```bash
node -e '
(async () => {
  const base = "http://127.0.0.1:8788"; // Use your configured NAPIER_PORT.
  const bootstrap = await (await fetch(base + "/api/bootstrap")).json();
  console.log("Workspace:", bootstrap.workspace.root);
  const agent = bootstrap.agents[0];
  const response = await fetch(base + "/api/agents/" + agent.id, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabledSkills: [...new Set([...agent.enabledSkills, "mma-rag"])] }),
  });
  if (!response.ok) throw new Error(await response.text());
  console.log("Enabled mma-rag for", agent.id);
})();'
```

Composer permission levels (`read_only`, `safe_automation`, `full_access`)
preserve the Agent's configured Skills. Named task presets such as `research`
and `coding` still choose their own Skill sets. Command execution requires a
process-capable permission level and a provider that can reach the backend;
this local setup uses `NAPIER_HOST_DIRECT_SANDBOX=1`. An offline container cannot
reach the host service at its own loopback address. Arbitrary `.env` values are
not inherited by command processes; pass `--base-url http://HOST:PORT` before
the CLI command to change the endpoint.

Direct smoke checks, from any workspace:

```bash
node "$HOME/.agents/skills/mma-rag/scripts/mma-rag.mjs" health
node "$HOME/.agents/skills/mma-rag/scripts/mma-rag.mjs" kb list
```

Test the real Web flow with a live model: “在知识库中查询，给出申请本科成绩单的办理流程，最好有配图。”
Verify the run's effective Skills include `mma-rag`, its `skill_load` receipt is
`loaded`, and the CLI returns evidence used in the answer. Retrieval can take
several minutes; the Skill uses a 600-second command timeout. Creating knowledge
bases and uploading files require an authorized user request.

Historical runs retain their original configuration. After fixing a missing
Skill, cancel the obsolete missing-Skill decision and submit a new message in
the same thread; continuing the old decision deliberately reuses its original
Agent revision and cannot acquire newly enabled capabilities.

The [initial local smoke-test receipt](artifacts/tessmora-skill-local-smoke.json)
records the original project-scoped test. It predates the shared installation
and permission-preset fix.

The Skill retains retrieval evidence through workspace patches and completes
verified plan steps before further expensive acquisition. Opaque command output
alone is not product progress; the runtime no-progress guard remains enabled.
The Node launcher's `image fetch` extension resolves original images through
Tessmora's reference-image API and saves local bytes with source/hash receipts.
Extracted image IDs are not document IDs and do not work with document stream
routes. See the [CLI reference](../integrations/tessmora/references/cli-reference.md)
for its output, deadline, and endpoint options.

## Development checks

For a local source checkout, compile shared dependencies before running the
checks relevant to your change:

```bash
npm run build:core:development
npm run typecheck -w @napier/server
npm run typecheck -w @napier/web
npm run check:dependency-ownership
npm run check:web-design
```

Run the relevant workspace tests (`npm run test -w @napier/runtime`,
`npm run test -w @napier/server`, or `npm run test -w @napier/web`) and expand
validation when the change warrants it. The HTML preview browser regression is
`node --import tsx scripts/check-workspace-html-preview.mjs`; it requires the
Chromium binary for the installed `playwright-core` version. Install that test
browser with `npx --no-install playwright-core install chromium` when needed.

`npm run check:web-ui-e2e` also uses that Chromium installation and the built
Server/Web outputs. It is a production-path check; the
`npm run test:web-ui-e2e` wrapper builds its prerequisites through the release
source-manifest gate before running it.

For the local CLI, build its output and use the development entry point:

```bash
npm run build:core:development
npm run build -w @napier/cli
npm run napier:dev -- doctor --workspace .
```

`napier:dev` uses existing build output, so rebuild the relevant packages after
changing source. It loads the repository's `.env` for each invocation.

The root `npm run build`, `npm run typecheck`, and `npm run napier -- …` paths
invoke the Runtime release source-manifest gate. `npm run check` adds retained
artifact, host, architecture, build, UI, and test gates. A source identity
mismatch is a release-evidence issue even when local compilation succeeds.
Do not regenerate receipts solely to suppress that mismatch. The
[current gap matrix](next-stage-gap-matrix.md) records the latest reviewed
limitations; focused local checks are not a claim that the full release gate
passes.
