import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { Server } from "node:http";
import path from "node:path";
import { createWorkspaceRuntimeHost } from "../apps/server/dist/workspace-runtime-host.js";
import { createServices } from "../apps/server/dist/app.js";
import { HostDirectSandboxAdapter } from "../packages/runtime/dist/sandbox-host-direct.js";
import { FixedIpHttpProxy } from "../packages/runtime/dist/fixed-ip-http-proxy.js";

const options = JSON.parse(process.argv[2]);
const graphs = new Map();
const counters = { physicalSandboxLaunches: 0, admission: {}, proxyRequests: [], closedProxySnapshots: [] };
const closedProxies = new WeakSet();
const closeProxy = FixedIpHttpProxy.prototype.close;
FixedIpHttpProxy.prototype.close = async function (...args) {
  await closeProxy.apply(this, args);
  if (!closedProxies.has(this)) {
    closedProxies.add(this);
    counters.closedProxySnapshots.push({ at: new Date().toISOString(), network: this.snapshot() });
  }
};
// Observe the default proxy's incoming requests without replacing its transport,
// authorization, DNS or dialing policy. Never retain proxy credentials.
const emitHttpEvent = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if ((event === "request" || event === "connect") && args[0]?.url) {
    counters.proxyRequests.push({
      event, method: args[0].method, target: args[0].url,
      at: new Date().toISOString(), localPort: this.address()?.port ?? null,
      authorizationPresent: Boolean(args[0].headers["proxy-authorization"]),
    });
  }
  return emitHttpEvent.call(this, event, ...args);
};
class ObservedHostDirectSandbox extends HostDirectSandboxAdapter {
  launch(request) { counters.physicalSandboxLaunches += 1; return super.launch(request); }
}
const host = await createWorkspaceRuntimeHost({
  workspaceRoot: options.workspaceRoot, stateHome: options.stateHome,
  resourceLimits: { sandbox_execution: 1, browser_session: 1, browser_task: 1 },
  maxIdle: 0, maintenanceMs: 300_000,
  services: { env: {}, sandbox: new ObservedHostDirectSandbox() },
}, async (input) => {
  const admission = input.resourceAdmission;
  const services = await createServices({ ...input, resourceAdmission: {
    ...admission,
    reserve(request) {
      const counts = counters.admission[request.kind] ??= { attempts: 0, reserved: 0, dispatched: 0, settled: [] };
      counts.attempts += 1;
      const lease = admission.reserve(request);
      counts.reserved += 1;
      return { ...lease,
        dispatched() { lease.dispatched(); counts.dispatched += 1; },
        settle(evidence) { lease.settle(evidence); counts.settled.push(evidence); },
      };
    },
  } });
  graphs.set(services.store.getWorkspaceSummary().root, services);
  return services;
});
const graph = graphs.get(host.initial.root);
assert.ok(graph);
const thread = await graph.store.createThread({ title: "Capacity fixture", agentId: graph.store.listAgents()[0].id });
const owner = { threadId: thread.id, runId: "run_resource_fixture" };
let execution;
let target;
let stopped = false;
let chain = Promise.resolve();
process.send({ ready: true, hostPid: process.pid, hostNonce: options.hostNonce, workspaceId: host.initial.workspaceId });
process.on("message", (message) => {
  chain = chain.then(async () => {
    try { process.send({ id: message.id, ok: true, value: await perform(message.method) }); }
    catch (error) { process.send({ id: message.id, ok: false, error: String(error), code: error?.code ?? null, counters }); }
  }).catch((error) => { console.error(error); process.exitCode = 1; });
});
process.on("disconnect", () => { void cleanup().then(() => process.exit(), (error) => { console.error(error); process.exit(1); }); });

async function snapshot() {
  const response = await host.fetch(new Request("http://localhost/api/workspace/resources"));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.budgetInvocations, 0);
  return result;
}
async function perform(method) {
  if (method === "snapshot") return snapshot();
  if (method === "stats") return { counters, graphCount: graphs.size };
  if (method === "reclaim") {
    const reclaimed = await host.reclaimIdle();
    await graph.store.listEvents(thread.id);
    return { reclaimed, realStoreReadSucceeded: true, graphCount: graphs.size };
  }
  if (method === "start-process") {
    assert.equal(execution, undefined);
    const nonce = randomUUID();
    const receipt = path.join(options.records, `target-${nonce}.json`);
    await writeFile(path.join(options.records, `intent-${nonce}.json`), JSON.stringify({ nonce, receipt, script: options.targetScript }) + "\n", { flag: "wx", mode: 0o600 });
    execution = await graph.sandbox.launch({
      command: process.execPath, args: [options.targetScript, nonce, receipt],
      cwd: host.initial.root, workspaceRoot: host.initial.root,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, approvedCapabilities: ["process.spawn"], parentDeathGuard: true,
    });
    execution.stderr.resume();
    target = await firstRecord(execution);
    assert.equal(target.nonce, nonce);
    process.kill(target.pid, 0);
    return { target: { ...target, receipt, script: options.targetScript }, resources: await snapshot(), counters };
  }
  if (method === "stop-process") {
    assert.ok(execution);
    const child = execution;
    await child.terminate();
    const result = { target, exit: await child.exit, cleanup: await child.cleanup, resources: await snapshot(), counters };
    execution = undefined;
    return result;
  }
  if (method === "start-browser") {
    const result = await graph.runtime.browserSessions.execute(owner, { action: "preview_workspace", path: "index.html" });
    assert.match(result.output + (result.snapshot ?? ""), /Capacity fixture/u);
    const page = await graph.runtime.browserSessions.capturePage(owner, 4000);
    assert.match(page.lines.join("\n"), new RegExp(`Capacity fixture ${options.label}`, "u"));
    const view = await graph.runtime.browserSessions.captureLiveView(owner);
    const screenshot = path.join(options.screenshots, `${options.label}-${randomUUID()}.png`);
    await writeFile(screenshot, view.image, { flag: "wx" });
    assert.equal(createHash("sha256").update(view.image).digest("hex"), view.receipt.imageSha256);
    return { output: result.output, snapshot: result.snapshot, page, details: result.details, liveView: view.receipt, screenshot, resources: await snapshot(), counters };
  }
  if (method === "reuse-browser") {
    const result = await graph.runtime.browserSessions.execute(owner, { action: "tab_list" });
    return { details: result.details, resources: await snapshot(), counters };
  }
  if (method === "stop-browser") {
    const result = await graph.runtime.browserSessions.execute(owner, { action: "close" });
    return { active: graph.runtime.browserSessions.hasActiveSession(owner), details: result.details, resources: await snapshot(), counters };
  }
  if (method === "shutdown") {
    const browserBeforeShutdown = graph.runtime.browserSessions.hasActiveSession(owner)
      ? await graph.runtime.browserSessions.execute(owner, { action: "tab_list" }) : undefined;
    await cleanup();
    return { stopped: true, browserBeforeShutdown, counters };
  }
  throw new Error(`Unknown fixture command: ${method}`);
}
async function cleanup() {
  if (stopped) return;
  // This direct test-owned handle is outside WorkspaceProcessManager.
  if (execution) { await execution.terminate(); execution = undefined; }
  await host.shutdown();
  stopped = true;
}
async function firstRecord(child) {
  let text = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Target readiness timed out")), 10_000);
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
      if (text.length > 4096) { clearTimeout(timer); reject(new Error("Unexpected target output")); return; }
      if (text.includes("\n")) {
        clearTimeout(timer);
        try { resolve(JSON.parse(text.split("\n")[0])); } catch (error) { reject(error); }
      }
    });
    void child.exit.then(() => { clearTimeout(timer); reject(new Error("Target exited before readiness")); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
