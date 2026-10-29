import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { chromium } from "playwright-core";
import {
  assertNew, assertNoOutbound, bounded, captureBindings, combine, errorDetails,
  execute, hash, inspect, observeBrowsers, running, sameRunning, signalOwned, waitAbsent, writeJson,
} from "./execution-resource-evidence-support.mjs";

const root = path.resolve(import.meta.dirname, "..");
const output = process.argv[2] && path.resolve(process.argv[2]);
assert.ok(output && process.argv.length === 3, "Usage: node scripts/check-workspace-resource-reclaim.mjs <new-output-path>");
assert.ok(["darwin", "linux"].includes(process.platform));
await assertNew(output);
const nonce = randomUUID();
const raw = path.join(root, "benchmark-results", "workspace-resource-reclaim", nonce);
await mkdir(path.dirname(raw), { recursive: true }); await mkdir(raw, { mode: 0o700 });
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), `napier-resource-reclaim-${nonce}-`)));
const aRoot = path.join(temporary, "workspace-a");
const bRoot = path.join(temporary, "workspace-b");
const customDataRoot = path.join(temporary, "custom-a-ledger");
const targetScript = path.join(temporary, "target.mjs");
const targetReceipt = path.join(temporary, "target.json");
const targetNonce = randomUUID();
const observations = { http: [], proxyRequests: [], closedProxySnapshots: [] };
const acceptance = [];
const cleanup = [];
const browserIdentities = new Map();
const graphs = new Map();
const oldEnvironment = { browser: process.env.NAPIER_BROWSER_EXECUTABLE, temporary: process.env.TMPDIR };
const originalHttpEmit = Server.prototype.emit;
let originalProxyClose;
let proxyPrototype;
let host;
let server;
let execution;
let targetIdentity;
let browserOwner;
let a;
let b;
let origin;
let before;
let after;
let browserBinding;
let sourceHead;
let failure;
let launchPending;
const interrupted = new AbortController();
const onSignal = () => interrupted.abort(new Error("Reclaim evidence capture interrupted"));
process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
const files = [
  "scripts/check-workspace-resource-reclaim.mjs", "scripts/execution-resource-evidence-support.mjs",
  "package-lock.json", "package.json", "packages/contracts/package.json", "packages/runtime/package.json", "apps/server/package.json",
  "node_modules/playwright-core/package.json", "node_modules/playwright-core/browsers.json", "node_modules/@hono/node-server/package.json",
];

try {
  const executable = await realpath(chromium.executablePath());
  await access(executable, constants.X_OK);
  browserBinding = { path: executable, sha256: hash(await readFile(executable)), resolution: "installed Playwright executable; no download" };
  process.env.NAPIER_BROWSER_EXECUTABLE = executable;
  process.env.TMPDIR = temporary;
  sourceHead = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  before = await captureBindings(root, raw, "before", files);
  await mkdir(aRoot); await mkdir(bRoot);
  await writeFile(path.join(aRoot, "index.html"), '<!doctype html><meta charset="utf-8"><title>Reclaim fixture A</title><style>body{padding:80px;background:#f6f3eb;color:#162b29;font:24px system-ui}h1{font-size:52px}</style><h1>Reclaim fixture A</h1><p>Real resources release before this workspace graph retires.</p>', { flag: "wx" });
  await writeFile(targetScript, `import { writeFileSync } from "node:fs";
const [nonce, receipt] = process.argv.slice(2);
const identity = { nonce, pid: process.pid };
writeFileSync(receipt, JSON.stringify(identity) + "\\n", { flag: "wx", mode: 0o600 });
process.stdout.write(JSON.stringify(identity) + "\\n");
setInterval(() => {}, 1000); setTimeout(() => process.exit(93), 120000);
`, { flag: "wx", mode: 0o600 });
  observations.fixtureBindings = await Promise.all([targetScript, path.join(aRoot, "index.html")].map(async (filename) => ({ path: filename, sha256: hash(await readFile(filename)) })));
  const [{ createWorkspaceRuntimeHost }, { createServices }, { HostDirectSandboxAdapter }, { FixedIpHttpProxy }] = await Promise.all([
    import("../apps/server/dist/workspace-runtime-host.js"), import("../apps/server/dist/app.js"),
    import("../packages/runtime/dist/sandbox-host-direct.js"), import("../packages/runtime/dist/fixed-ip-http-proxy.js"),
  ]);
  Server.prototype.emit = function (event, ...args) {
    const request = args[0];
    if ((event === "connect" || (event === "request" && /^https?:/u.test(request?.url ?? ""))) && request?.url) {
      observations.proxyRequests.push({ event, method: request.method, target: request.url, localPort: this.address()?.port ?? null, authorizationPresent: Boolean(request.headers["proxy-authorization"]), at: new Date().toISOString() });
    }
    return originalHttpEmit.call(this, event, ...args);
  };
  proxyPrototype = FixedIpHttpProxy.prototype;
  originalProxyClose = proxyPrototype.close;
  const closed = new WeakSet();
  proxyPrototype.close = async function (...args) {
    await originalProxyClose.apply(this, args);
    if (!closed.has(this)) { closed.add(this); observations.closedProxySnapshots.push({ at: new Date().toISOString(), network: this.snapshot() }); }
  };
  host = await createWorkspaceRuntimeHost({
    workspaceRoot: aRoot, dataRoot: customDataRoot, stateHome: path.join(temporary, "host-state"),
    maxIdle: 0, maintenanceMs: 300_000,
    resourceLimits: { sandbox_execution: 1, browser_session: 1, browser_task: 1 },
    services: { env: {}, sandbox: new HostDirectSandboxAdapter() },
  }, async (options) => {
    const services = await createServices(options);
    const key = services.store.getWorkspaceSummary().root;
    const generations = graphs.get(key) ?? [];
    generations.push(services); graphs.set(key, generations);
    return services;
  });
  a = graphs.get(aRoot)[0];
  const openedB = await host.openWorkspace(bRoot);
  b = graphs.get(bRoot)[0];
  assert.equal(host.initial.dataRoot, customDataRoot);
  assert.notEqual(customDataRoot, path.join(aRoot, ".napier"));
  observations.identities = { a: host.initial, b: openedB };
  passed("explicit_custom_data_root_is_registered_for_workspace_a");

  const threadA = await a.store.createThread({ title: "Reclaim persistence fixture", agentId: a.store.listAgents()[0].id });
  const run = await a.store.createRun({ threadId: threadA.id, agentId: threadA.agentId });
  const fixtureEvent = await a.store.appendEvent({ threadId: threadA.id, runId: run.id, category: "message", type: "message.user", payload: { role: "user", text: `Persisted reclaim marker ${nonce}` } });
  await a.store.finishRun(run.id, "completed");
  const eventsBefore = await a.store.listEvents(threadA.id);
  observations.historySeed = { threadId: threadA.id, runId: run.id, eventId: fixtureEvent.id, eventsSha256: hash(JSON.stringify(eventsBefore)), eventCount: eventsBefore.length, boundary: "direct deterministic store fixture; no Agent or model execution" };
  const threadB = await b.store.createThread({ title: "Protected future automation", agentId: b.store.listAgents()[0].id });
  const schedule = await b.store.createSchedule({
    name: "Remain resident while A reclaims", threadId: threadB.id,
    prompt: "Future deterministic fixture, not due during this capture.", model: { provider: "napier", id: "demo" },
    trigger: { type: "interval", everyMs: 60_000, anchorAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  const firstTick = await b.automation.tick();
  assert.equal(firstTick.claimed, 0); assert.equal(b.store.getSchedule(schedule.id).status, "active");
  observations.automation = { schedule, firstTick, generation: 1 };
  server = serve({ fetch: host.fetch, hostname: "127.0.0.1", port: 0 });
  if (!server.listening) await bounded(new Promise((resolve) => server.once("listening", resolve)), "Loopback server listen");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
  const initialBootstrap = await getScoped(host.initial.workspaceId, "bootstrap");
  assert.equal(initialBootstrap.workspace.dataRoot, customDataRoot);

  launchPending = a.sandbox.launch({ command: process.execPath, args: [targetScript, targetNonce, targetReceipt],
    cwd: aRoot, workspaceRoot: aRoot, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, approvedCapabilities: ["process.spawn"], parentDeathGuard: true,
  }).then((child) => { execution = child; return child; });
  await bounded(launchPending, "Guarded target launch");
  execution.stdout.resume(); execution.stderr.resume();
  const target = await readTarget();
  targetIdentity = await inspect(target.pid);
  assert.ok(running(targetIdentity)); assert.ok(targetIdentity.command.includes(targetScript) && targetIdentity.command.includes(targetNonce));
  targetIdentity.nonce = targetNonce;
  await writeJson(path.join(raw, "target.identity.json"), targetIdentity);
  browserOwner = { threadId: threadA.id, runId: run.id };
  const browser = await a.runtime.browserSessions.execute(browserOwner, { action: "preview_workspace", path: "index.html" });
  const page = await a.runtime.browserSessions.capturePage(browserOwner, 4000);
  assert.match(page.lines.join("\n"), /Reclaim fixture A/u); assertNoOutbound(page.network);
  assert.equal(page.browserExecutableSha256, browserBinding.sha256);
  const image = await a.runtime.browserSessions.captureLiveView(browserOwner);
  const screenshot = path.join(raw, `reclaim-a-${randomUUID()}.png`);
  await writeFile(screenshot, image.image, { flag: "wx" });
  assert.equal(hash(image.image), image.receipt.imageSha256);
  const native = await observeBrowsers({ executable, ownerPid: process.pid, nonce, raw, owned: browserIdentities });
  assert.equal(native.roots.length, 1);
  const activeResources = await getScoped(openedB.workspaceId, "workspace/resources");
  assertResource(activeResources, "sandbox_execution", 1); assertResource(activeResources, "browser_session", 1);
  const activeReclaim = await host.reclaimIdle();
  assert.deepEqual(activeReclaim, []);
  assert.ok(sameRunning(targetIdentity, await inspect(targetIdentity.pid)));
  await a.store.listEvents(threadA.id); await b.store.listEvents(threadB.id);
  observations.activeResources = { target: targetIdentity, browser: { details: browser.details, page, liveView: image.receipt, screenshot, native }, resources: activeResources, reclaimed: activeReclaim };
  passed("real_guarded_process_and_native_browser_keep_a_resident_before_release");
  passed("future_automation_keeps_b_resident_during_resource_retention");

  await bounded(execution.terminate(), "Guarded target termination");
  const processExit = await execution.exit; const processCleanup = await execution.cleanup;
  assert.equal(processCleanup.status, "released");
  execution = undefined;
  const targetAbsent = await waitAbsent(targetIdentity);
  const browserClose = await a.runtime.browserSessions.execute(browserOwner, { action: "close" });
  assert.equal(a.runtime.browserSessions.hasActiveSession(browserOwner), false);
  const nativeAbsent = await Promise.all(native.processes.map((identity) => waitAbsent(identity)));
  const releasedResources = await getScoped(openedB.workspaceId, "workspace/resources");
  assertResource(releasedResources, "sandbox_execution", 0); assertResource(releasedResources, "browser_session", 0);
  observations.release = { processExit, processCleanup, targetAbsent, browserClose: browserClose.details, nativeAbsent, resources: releasedResources };
  passed("affirmative_process_cleanup_and_native_browser_close_release_both_slots");

  const reclaimed = await host.reclaimIdle();
  assert.deepEqual(reclaimed, [host.initial.workspaceId]);
  let closedStoreError;
  try { await a.store.listEvents(threadA.id); assert.fail("Reclaimed SQLite remained open"); }
  catch (error) { assert.match(error.message, /SQLite ledger is not initialized/u); closedStoreError = errorDetails(error); }
  assert.equal(graphs.get(aRoot).length, 1);
  assert.equal(graphs.get(bRoot).length, 1); assert.equal(graphs.get(bRoot)[0], b);
  await b.store.listEvents(threadB.id);
  assert.equal(b.store.getSchedule(schedule.id).status, "active");
  const secondTick = await b.automation.tick(); assert.equal(secondTick.claimed, 0);
  observations.reclaim = { reclaimed, closedStoreError, aGenerationsBeforeHttp: graphs.get(aRoot).length, bGenerations: graphs.get(bRoot).length, bRealStoreReadSucceeded: true, schedule: b.store.getSchedule(schedule.id), secondTick };
  passed("max_idle_zero_reclaims_only_a_after_resource_release");
  passed("reclaimed_graph_sqlite_is_closed_while_b_automation_store_remains_open");

  const reopenedBootstrap = await getScoped(host.initial.workspaceId, "bootstrap");
  const fresh = graphs.get(aRoot).at(-1);
  assert.notEqual(fresh, a); assert.equal(graphs.get(aRoot).length, 2);
  assert.equal(reopenedBootstrap.workspace.root, aRoot); assert.equal(reopenedBootstrap.workspace.dataRoot, customDataRoot);
  assert.equal(fresh.store.dataRoot, customDataRoot);
  const eventsAfter = await fresh.store.listEvents(threadA.id);
  assert.deepEqual(eventsAfter, eventsBefore);
  const history = await getScoped(host.initial.workspaceId, `threads/${threadA.id}`);
  assert.equal(history.thread.title, threadA.title);
  assert.ok(JSON.stringify(history).includes(`Persisted reclaim marker ${nonce}`));
  assert.equal(graphs.get(bRoot).length, 1); assert.equal(graphs.get(bRoot)[0], b);
  await b.store.listEvents(threadB.id); assert.equal(b.store.getSchedule(schedule.id).status, "active");
  const finalResources = await getScoped(openedB.workspaceId, "workspace/resources");
  assertResource(finalResources, "sandbox_execution", 0); assertResource(finalResources, "browser_session", 0);
  observations.coldReopen = { bootstrap: reopenedBootstrap, freshGraph: true, aGenerations: 2, bGenerations: 1, eventCount: eventsAfter.length, eventsSha256: hash(JSON.stringify(eventsAfter)), history, resources: finalResources, bSchedule: b.store.getSchedule(schedule.id) };
  passed("scoped_loopback_http_cold_opens_new_graph_with_same_workspace_and_custom_data_root");
  passed("cold_reopened_sqlite_and_http_history_match_persisted_event_fixture");
  passed("other_workspace_future_automation_remains_same_resident_graph_through_cold_reopen");
  assert.equal(observations.closedProxySnapshots.length, 1);
  const finalProxy = observations.closedProxySnapshots[0].network;
  assertNoOutbound(finalProxy); assert.equal(finalProxy.requestCount, observations.proxyRequests.length);
  assert.equal(finalProxy.rejectedCount, observations.proxyRequests.length);
  passed("all_proxy_attempts_are_rejected_and_model_admission_remains_unused");
  interrupted.signal.throwIfAborted();
} catch (error) { failure = error; }
finally {
  // Stop intake, then settle directly owned resources and the production host.
  if (server) {
    try { await bounded(new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())), "Loopback server close", 10_000); cleanup.push({ httpServerClosed: true }); }
    catch (error) { failure = combine(failure, error); }
  }
  if (launchPending) await launchPending.catch(() => undefined);
  if (execution) {
    try { await bounded(execution.terminate(), "Final guarded target cleanup", 10_000); cleanup.push({ processCleanup: await execution.cleanup }); }
    catch (error) { failure = combine(failure, error); }
  }
  try {
    if (host) { await bounded(host.shutdown(), "Production host shutdown", 20_000); cleanup.push({ hostShutdown: "fulfilled" }); }
  } catch (error) { failure = combine(failure, error); }
  try {
    const published = await readFile(targetReceipt, "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (published) {
      assert.equal(published.nonce, targetNonce);
      const current = await inspect(published.pid);
      if (running(current)) {
        assert.ok(current.command.includes(targetScript) && current.command.includes(targetNonce)); current.nonce = targetNonce;
        await signalOwned(current, "SIGKILL"); cleanup.push({ targetFallback: await waitAbsent(current) });
      } else cleanup.push({ targetPid: published.pid, targetAbsent: true, fallbackSignal: false });
    }
  } catch (error) { failure = combine(failure, error); }
  if (browserBinding) {
    try { await observeBrowsers({ executable: browserBinding.path, ownerPid: process.pid, nonce, raw, owned: browserIdentities }); }
    catch (error) { failure = combine(failure, error); }
  }
  for (const identity of browserIdentities.values()) {
    try {
      if (sameRunning(identity, await inspect(identity.pid))) {
        await signalOwned(identity, "SIGKILL"); cleanup.push({ browserFallback: await waitAbsent(identity) });
      }
    } catch (error) { failure = combine(failure, error); }
  }
  try {
    after = await captureBindings(root, raw, "after", files);
    if (before) assert.deepEqual(after, before, "Source or consumed build changed during capture");
    if (browserBinding) assert.equal(hash(await readFile(browserBinding.path)), browserBinding.sha256);
  } catch (error) { failure = combine(failure, error); }
  Server.prototype.emit = originalHttpEmit;
  if (proxyPrototype && originalProxyClose) proxyPrototype.close = originalProxyClose;
  if (oldEnvironment.browser === undefined) delete process.env.NAPIER_BROWSER_EXECUTABLE; else process.env.NAPIER_BROWSER_EXECUTABLE = oldEnvironment.browser;
  if (oldEnvironment.temporary === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldEnvironment.temporary;
  process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
  await writeJson(path.join(raw, "observations.json"), observations); await writeJson(path.join(raw, "cleanup.json"), cleanup);
}
const receipt = {
  kind: "napier.workspace-resource-release-reclaim-evidence", schemaVersion: 1,
  capturedAt: new Date().toISOString(), success: !failure, sourceHead,
  platform: process.platform, arch: process.arch, nodeVersion: process.version,
  command: ["node", "scripts/check-workspace-resource-reclaim.mjs", output],
  rawEvidence: raw, temporaryFixture: temporary, browserBinding,
  acceptance, observations, cleanup, sourceBindings: before,
  bindingsUnchanged: Boolean(before && after && JSON.stringify(before) === JSON.stringify(after)),
  bindingFormat: "sha256 of UTF-8 JSON.stringify(sorted {path,sha256} entries); source .ts and consumed dist .js trees bound independently",
  limitations: [
    "This exercises one production host with two workspace graphs, real guarded HostDirect execution, native Chromium, actual maxIdle0 reclamation and loopback TCP HTTP cold reopening. Cross-host capacity and host-death evidence remain in their separate receipts.",
    "B is protected by a future active automation schedule. Explicit scheduler ticks claim zero work; this does not claim a due automation execution or model result.",
    "A's history is directly seeded through production store APIs, marked completed and never executed by an Agent. Reopening proves persistence and routing, not model quality or side-effect recovery.",
    "Proxy requests are observed passively and production counters are sampled after the original close. Zero outbound counters are not a system-wide packet trace; rejected Chromium background attempts remain visible.",
    "Owned target and observed browser PIDs are checked with birth and nonce identities. No all-descendant containment, container, remote provider, paid-model or complete G01-G07 acceptance is claimed.",
  ],
  ...(failure ? { error: errorDetails(failure) } : {}),
};
if (failure) {
  const failureFile = `${output}.failure-${nonce}.json`; await writeJson(failureFile, receipt);
  console.error(JSON.stringify({ success: false, failureFile, rawEvidence: raw, retainedFixture: temporary, error: errorDetails(failure) })); process.exitCode = 1;
} else {
  await rm(temporary, { recursive: true, force: true }); receipt.temporaryFixtureRemoved = true;
  await writeJson(output, receipt);
  console.log(JSON.stringify({ success: true, output, rawEvidence: raw, assertions: acceptance.length, proxyAttempts: observations.proxyRequests.length }));
}
function passed(name) { acceptance.push({ name, status: "passed", observedAt: new Date().toISOString() }); console.log(JSON.stringify({ assertion: name, status: "passed" })); }
async function getScoped(workspaceId, endpoint) {
  interrupted.signal.throwIfAborted();
  const url = `${origin}/api/workspaces/${workspaceId}/${endpoint}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  const record = { at: new Date().toISOString(), url, status: response.status, workspaceHeader: response.headers.get("X-Napier-Workspace-Id"), bodySha256: hash(text), body: JSON.parse(text) };
  observations.http.push(record); await writeJson(path.join(raw, `http-${String(observations.http.length).padStart(2, "0")}.json`), record);
  assert.equal(response.status, 200); assert.equal(record.workspaceHeader, workspaceId);
  return record.body;
}
function assertResource(snapshot, kind, occupied) {
  assert.equal(snapshot.budgetInvocations, 0);
  const item = snapshot.executionResources.find((entry) => entry.kind === kind);
  assert.equal(item.effectiveCapacity, 1); assert.equal(item.occupied, occupied); assert.equal(item.active, occupied); assert.equal(item.quarantined, 0);
}
async function readTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = await readFile(targetReceipt, "utf8").then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return undefined; throw error; });
    if (record) { assert.equal(record.nonce, targetNonce); return record; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Guarded target did not publish its identity");
}
