import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { LocalStore } from "../packages/runtime/dist/store.js";
import { createServices } from "../apps/server/dist/app.js";
import { createWorkspaceRuntimeHost } from "../apps/server/dist/workspace-runtime-host.js";
import { WorkspaceRuntimeCatalog } from "../apps/server/dist/workspace-runtime-catalog.js";
import { resolveWorkspaceRuntimeIdentity } from "../apps/server/dist/workspace-runtime-identity.js";
import { createWebUiE2eRoot, removeWebUiE2eRoot, startWebUiBrowser, startProductionWebServer } from "./web-ui-e2e-runtime.mjs";

const output = path.resolve(process.argv[2] ?? "/tmp/napier-workspace-runtime-ui.json");
const screenshotRoot = path.resolve("benchmark-results/workspace-runtime", path.basename(output));
await mkdir(screenshotRoot, { recursive: true });
const root = await createWebUiE2eRoot();
const previousStateHome = process.env.NAPIER_STATE_HOME;
process.env.NAPIER_STATE_HOME = path.join(root, "state");
let host, server, browser, gate, production;
const graphs = new Map();
const receipt = { kind: "workspace-runtime-browser-integration", externalModelRequests: 0, viewports: [] };
const sourceFiles = [
  "apps/server/src/index.ts", "apps/server/src/app.ts", "apps/server/src/recent-workspaces.ts", "apps/server/src/workspace-runtime-host.ts", "apps/server/src/workspace-runtime-services.ts",
  "apps/server/src/workspace-runtime-http.ts", "apps/server/src/workspace-runtime-registry.ts", "apps/server/src/workspace-runtime-catalog.ts",
  "apps/server/src/workspace-root-http.ts", "apps/server/src/workspace-html-preview-http.ts", "apps/web/src/workspace-api-binding.ts",
  "apps/web/src/use-workspace-view-model.ts", "apps/web/src/bootstrap-api.ts", "apps/web/src/workspace-directory-api.ts",
  "apps/web/src/message-markdown-inline.tsx", "apps/web/src/AutomationChannelSummary.tsx", "apps/web/src/use-automation-channel-composer-controller.ts",
  "apps/server/dist/index.js", "apps/server/dist/workspace-runtime-host.js", "apps/web/dist/index.html", "scripts/check-workspace-runtime-ui.mjs",
  ...(await readdir("apps/web/dist/assets")).sort().map((file) => `apps/web/dist/assets/${file}`),
];
const hashes = () => Promise.all(sourceFiles.map(async (file) => ({ path: file, sha256: hash(await readFile(file)) })));
const before = await hashes();
try {
  const aRoot = await realpath(path.join(root, "workspace"));
  const bRoot = path.join(await realpath(root), "project-b");
  const dataA = path.join(root, "state");
  const dataB = path.join(root, "custom-ledger-b");
  await mkdir(bRoot);
  const seed = new LocalStore({ workspaceRoot: aRoot, dataRoot: dataA });
  await seed.initialize();
  const agent = seed.listAgents()[0];
  await seed.updateAgent(agent.id, { model: { provider: "faux-workspace-ui", id: "faux-1" }, enabledTools: [] });
  const thread = await seed.createThread({ title: "Workspace identity task", agentId: agent.id });
  await seed.shutdown();
  // Identical thread IDs are intentional: identity must include the workspace.
  await cp(dataA, dataB, { recursive: true });
  for (const [directory, label] of [[aRoot, "A"], [bRoot, "B"]]) {
    await writeFile(path.join(directory, "same-output.html"), `<h1>Workspace ${label}</h1><button id="advance">Advance</button><p id="step">1</p><script src="preview.js"></script>`);
    await writeFile(path.join(directory, "preview.js"), 'document.querySelector("#advance").onclick = () => { document.querySelector("#step").textContent = "2"; };');
    await writeFile(path.join(directory, "same-image.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><text x="5" y="25">Workspace ${label}</text></svg>`);
  }
  const catalog = await WorkspaceRuntimeCatalog.open(dataA);
  const a = catalog.register(await resolveWorkspaceRuntimeIdentity(aRoot, dataA));
  const b = catalog.register(await resolveWorkspaceRuntimeIdentity(bRoot, dataB));
  catalog.close();
  const prepare = async (options) => {
    const services = await createServices(options);
    const label = options.workspaceRoot === a.root ? "A" : "B";
    const provider = fauxProvider({ provider: "faux-workspace-ui" });
    provider.setResponses(Array.from({ length: 12 }, () => [
      fauxAssistantMessage(`Workspace ${label} result: [Report](same-output.html)\n\n![Workspace ${label} image](same-image.svg)`),
      fauxAssistantMessage('{"facts":[]}'),
    ]).flat());
    services.models.registerProvider(provider.provider);
    const runPrompt = services.kernel.runPrompt.bind(services.kernel);
    services.kernel.runPrompt = (input) => runPrompt({ ...input, onEvent: async (event) => {
      await input.onEvent?.(event);
      if (label === "A" && gate && event.threadId === thread.id && event.type === "run.started") {
        const held = gate; gate = undefined; held.started.resolve(); await held.release.promise;
      }
    } });
    graphs.set(label, services);
    return services;
  };
  const options = { workspaceRoot: a.root, stateHome: dataA, services: { env: { NAPIER_HOST_DIRECT_SANDBOX: "1" } } };
  host = await createWorkspaceRuntimeHost(options, prepare);
  await host.openWorkspace(b.root);
  const app = new Hono();
  app.all("/api/*", (context) => host.fetch(context.req.raw));
  app.use("/*", serveStatic({ root: path.resolve("apps/web/dist") }));
  app.get("*", async (context) => context.html(await readFile("apps/web/dist/index.html", "utf8")));
  const ready = Promise.withResolvers();
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, ready.resolve);
  const info = await ready.promise;
  const origin = `http://127.0.0.1:${info.port}`;
  browser = await startWebUiBrowser(root);
  const context = browser.browser.contexts()[0];
  await context.addInitScript(() => window.top === window && localStorage.setItem("napier.locale", "en"));
  for (const width of [1440, 320]) {
    const page = await context.newPage();
    const pageErrors = [], wrongResponses = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", async (response) => {
      const match = new URL(response.url()).pathname.match(/^\/api\/workspaces\/(workspace_[a-f0-9]{64})\//u);
      if (match && response.ok() && (await response.headerValue("x-napier-workspace-id")) !== match[1]) wrongResponses.push(response.url());
    });
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width, height: 900 });
    const held = { started: Promise.withResolvers(), release: Promise.withResolvers() };
    gate = held;
    try {
      await page.goto(`${origin}/?workspace=${a.workspaceId}&thread=${thread.id}`);
      await page.locator(".composer textarea").fill(`Start A at width ${width}`);
      await page.locator('.composer button[type="submit"]').last().click();
      await held.started.promise;
      const aRun = graphs.get("A").store.listRuns(thread.id).at(-1);
      assert.equal(aRun.status, "running");
      if (!(await page.locator(`.workspace-tree-project[title="${b.root}"]`).isVisible())) {
        await page.locator('.ledger-collapse-button').click();
      }
      await page.locator(`.workspace-tree-project[title="${b.root}"]`).click();
      await page.waitForURL((url) => url.searchParams.get("workspace") === b.workspaceId);
      await page.locator(".composer textarea").fill(`Complete B at width ${width}`);
      await page.locator('.composer button[type="submit"]').last().click();
      await waitFor(() => graphs.get("B").store.listRuns(thread.id).some((run) => run.status === "completed" && run.startedAt > aRun.startedAt));
      const inlineImage = page.getByRole("img", { name: "Workspace B image", exact: true }).last();
      await inlineImage.waitFor();
      assert.ok((await inlineImage.getAttribute("src")).startsWith(`/api/workspaces/${b.workspaceId}/`));
      await inlineImage.evaluate((image) => image.decode());
      const imageBytes = await fetch(new URL(await inlineImage.getAttribute("src"), origin));
      assert.ok((await imageBytes.text()).includes("Workspace B"));
      assert.equal(graphs.get("A").store.listRuns(thread.id).find((run) => run.id === aRun.id).status, "running");
      const wrongStop = await fetch(`${origin}/api/workspaces/${b.workspaceId}/threads/${thread.id}/stop`, { method: "POST" });
      assert.equal(wrongStop.status, 409); await wrongStop.text();
      assert.equal(graphs.get("A").store.listRuns(thread.id).find((run) => run.id === aRun.id).status, "running");
      const automatic = await graphs.get("A").store.createThread({ title: `A automation ${width}`, agentId: agent.id });
      const schedule = await graphs.get("A").store.createSchedule({
        name: `A background ${width}`, threadId: automatic.id, prompt: "Run in A after B navigation.",
        model: { provider: "napier", id: "demo" }, trigger: { type: "interval", everyMs: 60_000, anchorAt: new Date(Date.now() + 100).toISOString() },
      });
      await waitFor(() => Boolean(graphs.get("A").store.getSchedule(schedule.id).lastRunId));
      await graphs.get("A").store.updateSchedule(schedule.id, { status: "paused" });
      await waitFor(() => graphs.get("A").store.listRuns(automatic.id).some((run) => run.status === "completed"));
      const outputButton = page.locator(".workspace-evidence-output-list button").first();
      if (!(await outputButton.isVisible())) await page.locator('button[aria-controls="workspace-evidence-rail"]').click();
      await outputButton.click();
      const frame = page.frameLocator(".artifact-inspector iframe");
      await frame.getByRole("heading", { name: "Workspace B", exact: true }).waitFor();
      await frame.getByRole("button", { name: "Advance", exact: true }).evaluate((button) => button.click());
      assert.equal(await frame.locator("#step").textContent(), "2");
      await page.screenshot({ path: path.join(screenshotRoot, `workspace-${width}.png`), fullPage: true });
      const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
      assert.equal(overflow, 0); assert.deepEqual(pageErrors, []); assert.deepEqual(wrongResponses, []);
      held.release.resolve();
      await waitFor(() => graphs.get("A").store.listRuns(thread.id).find((run) => run.id === aRun.id).status === "completed");
      receipt.viewports.push({ width, copiedThreadId: thread.id, aStayedRunningAcrossNavigation: true, bCompleted: true,
        aAutomationCompleted: true, wrongWorkspaceStopRejected: true, preview: "Workspace B", previewScriptLoaded: true,
        inlineImageWorkspace: "B",
        overflowPx: overflow, pageErrors, wrongResponses, aRunId: aRun.id });
    } catch (error) {
      await page.screenshot({ path: path.join(screenshotRoot, `failure-${width}.png`), fullPage: true });
      throw error;
    } finally { held.release.resolve(); gate = undefined; await page.close(); }
  }
  await host.shutdown();
  production = await startProductionWebServer(root);
  for (const identity of [a, b]) {
    const response = await fetch(`${production.origin}/api/workspaces/${identity.workspaceId}/bootstrap?thread=${thread.id}`);
    const body = await response.json();
    assert.equal(body.workspace.dataRoot, identity.dataRoot);
    assert.equal(body.activeThread.thread.id, thread.id);
    assert.ok(body.activeThread.runs.some((run) => run.status === "completed"));
  }
  receipt.productionProcessRestartVerified = true;
  receipt.boundaries = ["Prepared production host with deterministic run.started gate and fixture provider; not a live-model quality experiment", "Readiness uses host-direct fixture configuration; no OS sandbox claim", "HTML interaction uses DOM button click as in existing preview checks", "Production entry reopened both completed ledgers in an independent child process; active execution restart is not claimed here", "This navigation scenario does not accept global resource or budget coordination; separate admission and lifetime tests cover those boundaries"];
  receipt.sources = before;
  assert.deepEqual(await hashes(), before);
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ output, viewports: receipt.viewports.length, externalModelRequests: 0 }));
} finally {
  gate?.release.resolve();
  await browser?.close();
  await production?.close();
  await host?.shutdown();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (previousStateHome === undefined) delete process.env.NAPIER_STATE_HOME;
  else process.env.NAPIER_STATE_HOME = previousStateHome;
  await removeWebUiE2eRoot(root);
}

async function waitFor(predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Workspace UI condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
