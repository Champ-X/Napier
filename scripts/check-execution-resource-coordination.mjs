import assert from "node:assert/strict";
import { execFile, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, constants } from "node:fs";
import { access, appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const output = process.argv[2] && path.resolve(process.argv[2]);
assert.ok(output && process.argv.length === 3, "Usage: node scripts/check-execution-resource-coordination.mjs <new-output-path>");
assert.ok(["darwin", "linux"].includes(process.platform), "The physical verifier requires POSIX process observation");
await assertNew(output);
const execute = promisify(execFile);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const runNonce = randomUUID();
const evidenceHome = path.join(root, "benchmark-results", "execution-resources");
await mkdir(evidenceHome, { recursive: true });
const raw = path.join(evidenceHome, runNonce);
await mkdir(raw, { mode: 0o700 });
await mkdir(path.join(raw, "screenshots"));
const temporary = await realpath(await mkdtemp(path.join(tmpdir(), `napier-resource-${runNonce}-`)));
const records = path.join(temporary, "records");
const browserTmp = path.join(temporary, "tmp");
await mkdir(records); await mkdir(browserTmp);
const stateHome = path.join(temporary, "state");
const targetScript = path.join(temporary, "target.mjs");
const hosts = [];
const browserIdentities = new Map();
const assertions = [];
const observations = {};
const cleanup = [];
const stopped = new AbortController();
const onSignal = () => stopped.abort(new Error("Physical evidence capture interrupted"));
process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
let before;
let after;
let failure;
let sourceHead;
let executable;
let browserBinding;
let writeChain = Promise.resolve();
const treeSpecifications = [
  ["packages/contracts/src", ".ts"], ["packages/runtime/src", ".ts"], ["apps/server/src", ".ts"],
  ["packages/contracts/dist", ".js"], ["packages/runtime/dist", ".js"], ["apps/server/dist", ".js"],
];
const boundFiles = [
  "scripts/check-execution-resource-coordination.mjs", "scripts/execution-resource-host-fixture.mjs",
  "package-lock.json", "package.json", "packages/contracts/package.json", "packages/runtime/package.json", "apps/server/package.json",
  "node_modules/playwright-core/package.json", "node_modules/playwright-core/browsers.json",
];

try {
  executable = await realpath(chromium.executablePath());
  await access(executable, constants.X_OK);
  browserBinding = { path: executable, sha256: hash(await readFile(executable)), resolution: "installed playwright-core executable; no download" };
  sourceHead = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  before = await captureBindings("before");
  await writeFile(targetScript, `import { writeFileSync } from "node:fs";
const [nonce, receipt] = process.argv.slice(2);
const record = { nonce, pid: process.pid };
writeFileSync(receipt, JSON.stringify(record) + "\\n", { flag: "wx", mode: 0o600 });
process.stdout.write(JSON.stringify(record) + "\\n");
setInterval(() => {}, 1000);
setTimeout(() => process.exit(93), 120000);
`, { flag: "wx", mode: 0o600 });
  const workspaces = {};
  for (const label of ["A", "B"]) {
    workspaces[label] = path.join(temporary, `workspace-${label}`);
    await mkdir(workspaces[label]);
    await writeFile(path.join(workspaces[label], "index.html"), `<!doctype html><meta charset="utf-8"><title>Capacity fixture ${label}</title><style>body{margin:0;padding:80px;background:#f6f3eb;color:#162b29;font:24px system-ui}h1{font-size:56px}section{border-left:8px solid #147d70;padding:24px}small{display:block;margin-top:36px}</style><section><h1>Capacity fixture ${label}</h1><p>Native workspace preview under shared resource admission.</p><small>Local deterministic fixture · no external assets</small></section>`, { flag: "wx" });
  }
  observations.fixtureBindings = await Promise.all([targetScript, ...Object.values(workspaces).map((workspace) => path.join(workspace, "index.html"))]
    .map(async (filename) => ({ path: filename, sha256: hash(await readFile(filename)) })));
  const a = await startHost("A", workspaces.A);
  const b = await startHost("B", workspaces.B);
  const initial = await rpc(a, "snapshot");
  assertResource(initial, "sandbox_execution", 0); assertResource(initial, "browser_session", 0);
  observations.initial = initial;

  const processA = await rpc(a, "start-process");
  const identityA = await observeTarget(processA.target);
  assertResource(processA.resources, "sandbox_execution", 1, 1);
  const deniedProcess = await denied(b, "start-process");
  assert.equal(deniedProcess.counters.physicalSandboxLaunches, 0);
  assert.equal(deniedProcess.counters.admission.sandbox_execution.dispatched, 0);
  const retainedProcess = await rpc(a, "reclaim");
  assert.deepEqual(retainedProcess.reclaimed, []);
  assert.equal(retainedProcess.realStoreReadSucceeded, true);
  assert.ok(sameRunning(identityA, await inspect(identityA.pid)));
  observations.processCapacity = { admitted: processA, identity: identityA, rejected: deniedProcess, retained: retainedProcess };
  passed("cross_host_process_capacity_one_rejects_before_adapter_launch");
  passed("lru_retains_graph_and_real_store_while_owned_process_is_active");
  const stoppedA = await rpc(a, "stop-process");
  assert.equal(stoppedA.cleanup.status, "released"); assertResource(stoppedA.resources, "sandbox_execution", 0);
  const absentA = await waitAbsent(identityA);
  const processB = await rpc(b, "start-process");
  const identityB = await observeTarget(processB.target);
  assertResource(processB.resources, "sandbox_execution", 1, 1);
  const stoppedB = await rpc(b, "stop-process");
  assert.equal(stoppedB.cleanup.status, "released"); assertResource(stoppedB.resources, "sandbox_execution", 0);
  observations.processRelease = { stoppedA, absentA, admittedB: processB, stoppedB, absentB: await waitAbsent(identityB) };
  passed("process_cleanup_releases_capacity_for_the_other_host");

  const browserA = await rpc(a, "start-browser");
  assertNoOutbound(browserA.page.network);
  const nativeA = await observeBrowsers(a);
  assert.equal(nativeA.roots.length, 1);
  assertResource(browserA.resources, "browser_session", 1, 1);
  assert.equal(browserA.page.browserExecutableSha256, browserBinding.sha256);
  const deniedBrowser = await denied(b, "start-browser");
  assert.equal(deniedBrowser.counters.admission.browser_session.dispatched, 0);
  const nativeBEmpty = await observeBrowsers(b);
  assert.deepEqual(nativeBEmpty.roots, []);
  const reusedA = await rpc(a, "reuse-browser");
  assert.equal(reusedA.details.sessionIdSha256, browserA.details.sessionIdSha256);
  assertResource(reusedA.resources, "browser_session", 1, 1);
  const retainedBrowser = await rpc(a, "reclaim");
  assert.deepEqual(retainedBrowser.reclaimed, []); assert.equal(retainedBrowser.realStoreReadSucceeded, true);
  const reusedAfterReclaim = await rpc(a, "reuse-browser");
  assert.equal(reusedAfterReclaim.details.sessionIdSha256, browserA.details.sessionIdSha256);
  observations.browserCapacity = { admitted: browserA, native: nativeA, rejected: deniedBrowser, rejectingHostNative: nativeBEmpty, reused: reusedA, retained: retainedBrowser, reusedAfterReclaim };
  passed("native_workspace_preview_body_and_screenshot_are_captured");
  passed("cross_host_browser_capacity_one_rejects_before_resource_dispatch");
  passed("browser_reuse_retains_one_slot_and_lru_retains_its_graph");
  const closedA = await rpc(a, "stop-browser");
  assert.equal(closedA.active, false); assertResource(closedA.resources, "browser_session", 0);
  const absentNativeA = await waitAllAbsent(nativeA.processes);
  const browserB = await rpc(b, "start-browser");
  assertNoOutbound(browserB.page.network);
  const nativeB = await observeBrowsers(b);
  assert.equal(nativeB.roots.length, 1); assertResource(browserB.resources, "browser_session", 1, 1);
  observations.browserRelease = { closedA, absentNativeA, admittedB: browserB, nativeB };
  passed("native_browser_close_releases_capacity_for_the_other_host");

  const shutdownB = await rpc(b, "shutdown");
  b.closed = true;
  const absentNativeB = await waitAllAbsent(nativeB.processes);
  const afterShutdownB = await rpc(a, "snapshot");
  assertResource(afterShutdownB, "browser_session", 0);
  await disconnectHost(b);
  const restartedBrowserA = await rpc(a, "start-browser");
  assertNoOutbound(restartedBrowserA.page.network);
  const finalNativeA = await observeBrowsers(a);
  assert.equal(finalNativeA.roots.length, 1); assertResource(restartedBrowserA.resources, "browser_session", 1, 1);
  const finalClosedA = await rpc(a, "stop-browser");
  observations.hostShutdown = { shutdownB, absentNativeB, afterShutdownB, admittedA: restartedBrowserA, finalClosedA, finalBrowserAbsent: await waitAllAbsent(finalNativeA.processes) };
  passed("host_shutdown_closes_native_browser_and_releases_its_slot");

  const dyingProcess = await rpc(a, "start-process");
  const dyingIdentity = await observeTarget(dyingProcess.target);
  assertResource(dyingProcess.resources, "sandbox_execution", 1, 1);
  await signalOwned(a.identity, "SIGKILL");
  const hostExit = await bounded(a.exit, "Killed host exit", 10_000);
  assert.equal(hostExit.signal, "SIGKILL");
  const targetAfterDeath = await waitAbsent(dyingIdentity, 15_000);
  const { WorkspaceResourceAdmission } = await import("../apps/server/dist/workspace-resource-admission.js");
  const observer = await WorkspaceResourceAdmission.open(stateHome, { sandbox_execution: 1, browser_session: 1, browser_task: 1 });
  let deadSnapshot;
  try { deadSnapshot = observer.snapshot(); assertQuarantine(deadSnapshot); }
  finally { observer.close(); }
  const reopened = await WorkspaceResourceAdmission.open(stateHome, { sandbox_execution: 1, browser_session: 1, browser_task: 1 });
  let reopenedSnapshot;
  try {
    reopenedSnapshot = reopened.snapshot(); assertQuarantine(reopenedSnapshot);
    assert.throws(() => reopened.forWorkspace(b.ready.workspaceId).reserve({ kind: "sandbox_execution", backend: "reopen_probe" }), (error) => error.code === "capacity");
  } finally { reopened.close(); }
  observations.ownerDeath = { process: dyingProcess, identity: dyingIdentity, hostExit, targetAfterDeath, independentObservationTimeoutMs: 15_000, targetSelfExpiryMs: 120_000, deadSnapshot, reopenedSnapshot, automaticReconciliation: false };
  passed("host_sigkill_stops_the_published_guarded_target");
  passed("unknown_host_death_cleanup_retains_quarantine_across_ledger_reopen");
  for (const preview of [browserA, browserB, restartedBrowserA]) {
    assertNoOutbound(preview.page.network);
    assertNoOutbound(preview.details.network);
    assert.equal(hash(await readFile(preview.screenshot)), preview.liveView.imageSha256);
  }
  for (const operation of [reusedA, reusedAfterReclaim, closedA, shutdownB.browserBeforeShutdown, finalClosedA]) assertNoOutbound(operation.details.network);
  const closedProxySnapshots = [...dyingProcess.counters.closedProxySnapshots, ...shutdownB.counters.closedProxySnapshots];
  const proxyRequests = [...dyingProcess.counters.proxyRequests, ...shutdownB.counters.proxyRequests];
  assert.equal(closedProxySnapshots.length, 3);
  for (const proxy of closedProxySnapshots) assertNoOutbound(proxy.network);
  const finalProxyRequests = closedProxySnapshots.reduce((sum, proxy) => sum + proxy.network.requestCount, 0);
  const finalRejectedRequests = closedProxySnapshots.reduce((sum, proxy) => sum + proxy.network.rejectedCount, 0);
  assert.equal(finalProxyRequests, proxyRequests.length);
  assert.equal(finalRejectedRequests, proxyRequests.length);
  observations.network = {
    nativeSessionSnapshots: [closedA, shutdownB.browserBeforeShutdown, finalClosedA].map((operation) => ({
      sessionIdSha256: operation.details.sessionIdSha256, network: operation.details.network,
    })),
    closedProxySnapshots, proxyRequests, finalProxyRequests, finalRejectedRequests,
    interpretation: "Nonzero local proxy attempts are retained. Production counters sampled after each original proxy close account for every passive request record: all rejected, zero destinations, CONNECT successes and transferred bytes.",
  };
  passed("model_admission_invocations_and_observed_proxy_outbound_activity_are_zero");
  stopped.signal.throwIfAborted();
} catch (error) { failure = error; }
finally {
  // Always preserve raw RPCs, outputs and PID identities before cleanup. Never
  // select by process name; every signal checks PID, nonce, full command and birth.
  for (const host of hosts) {
    try {
      if (!host.exited && !host.closed) {
        await observeBrowsers(host);
        try { await rpc(host, "shutdown", 15_000, true); host.closed = true; }
        catch (error) { cleanup.push({ host: host.label, gracefulError: errorDetails(error) }); }
      }
      if (!host.exited && host.closed) await disconnectHost(host);
      if (!host.exited) {
        host.identity ??= await inspect(host.child.pid);
        if (host.identity) host.identity.nonce = host.hostNonce;
        await signalOwned(host.identity, "SIGKILL");
        await bounded(host.exit, "Fallback host exit", 10_000);
      }
      cleanup.push({ host: host.label, exited: host.exited, result: await host.exit });
    } catch (error) { failure = combine(failure, error); }
  }
  for (const name of (await readdir(records)).filter((name) => name.startsWith("target-"))) {
    try {
      const record = JSON.parse(await readFile(path.join(records, name), "utf8"));
      const identity = await inspect(record.pid);
      if (running(identity)) {
        assert.ok(identity.command.includes(targetScript) && identity.command.includes(record.nonce), "Target fallback ownership mismatch");
        identity.nonce = record.nonce;
        await signalOwned(identity, "SIGKILL");
        cleanup.push({ target: record, signalled: true, final: await waitAbsent(identity) });
      } else cleanup.push({ target: record, signalled: false, final: identity ? "not_running" : "absent" });
    } catch (error) { failure = combine(failure, error); }
  }
  for (const identity of browserIdentities.values()) {
    try {
      const current = await inspect(identity.pid);
      if (sameRunning(identity, current)) {
        assert.ok(identity.nonce, "Refusing browser fallback signal without an observed fixture/profile nonce");
        await signalOwned(identity, "SIGKILL");
        cleanup.push({ browserPid: identity.pid, signalled: true, final: await waitAbsent(identity) });
      }
    } catch (error) { failure = combine(failure, error); }
  }
  try {
    after = await captureBindings("after");
    if (before) assert.deepEqual(after, before, "Source or consumed build changed during physical evidence capture");
    if (browserBinding) assert.equal(hash(await readFile(executable)), browserBinding.sha256, "Browser executable changed during capture");
  } catch (error) { failure = combine(failure, error); }
  await writeChain;
  await writeJson(path.join(raw, "observations.json"), observations);
  await writeJson(path.join(raw, "cleanup.json"), cleanup);
  process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
}
const receipt = {
  kind: "napier.execution-resource-physical-coordination-evidence", schemaVersion: 1,
  capturedAt: new Date().toISOString(), success: !failure, sourceHead,
  platform: process.platform, arch: process.arch, nodeVersion: process.version,
  command: ["node", "scripts/check-execution-resource-coordination.mjs", output],
  evidenceClass: "production_workspace_hosts_real_guarded_process_and_native_browser",
  rawEvidence: raw, temporaryFixture: temporary, browserBinding,
  acceptance: assertions, observations, cleanup,
  sourceBindings: before, bindingsUnchanged: Boolean(before && after && JSON.stringify(before) === JSON.stringify(after)),
  bindingFormat: "sha256 of UTF-8 JSON.stringify(sorted {path,sha256} entries); source .ts and consumed dist .js trees bound independently",
  scope: { capacityUnit: "owned sandbox execution handle or native browser session", hostProcesses: hosts.length, perKindCapacity: 1,
    modelAdmissionInvocations: assertions.some((entry) => entry.name === "model_admission_invocations_and_observed_proxy_outbound_activity_are_zero") ? 0 : null,
    observedProxyOutboundConnections: assertions.some((entry) => entry.name === "model_admission_invocations_and_observed_proxy_outbound_activity_are_zero") ? 0 : null,
    observedLocalProxyAttempts: observations.network?.proxyRequests.length ?? null,
    observedFinalRejectedProxyAttempts: observations.network?.finalRejectedRequests ?? null,
    browserTaskPhysicalEvidence: "not exercised" },
  limitations: [
    "Real HostDirectSandboxAdapter and production Guardian run without OS isolation. This is not an all-descendant, CPU, RSS or container containment claim.",
    "Native Chromium uses the default browser port and a local workspace-only page. Its rejected local proxy attempts are recorded explicitly; zero outbound activity describes production destination/CONNECT/transfer counters and is not a system-wide network trace.",
    "Fixture instrumentation forwards the production sandbox/admission methods, observes incoming HTTP events, and snapshots each production proxy after its original close completes; it does not replace the browser launcher, proxy dialing or network authorization policy.",
    "Host death terminates the published guarded target but leaves its lease quarantined because the dead owner cannot persist affirmative cleanup. Reopen preserves that unknown boundary; no automatic resource reconciliation is claimed.",
    "Observed browser process roots and their sampled descendants are checked after closure. No claim is made about unobserved escaped descendants or remote provider resources.",
    "No browser-use local/cloud task, external service, paid model, multi-machine coordination or clean-release-build equivalence is exercised.",
    "Source and consumed build trees remain separately bound. This local run does not establish statistical performance or complete G01-G07 acceptance.",
  ],
  ...(failure ? { error: errorDetails(failure) } : {}),
};
if (failure) {
  const failureFile = `${output}.failure-${runNonce}.json`;
  await writeJson(failureFile, receipt);
  console.error(JSON.stringify({ success: false, failureFile, rawEvidence: raw, retainedFixture: temporary, error: errorDetails(failure) }));
  process.exitCode = 1;
} else {
  await rm(temporary, { recursive: true, force: true });
  receipt.temporaryFixtureRemoved = true;
  await writeJson(output, receipt);
  console.log(JSON.stringify({ success: true, output, rawEvidence: raw, assertions: assertions.length, modelAdmissionInvocations: 0, observedProxyOutboundConnections: 0, observedLocalProxyAttempts: observations.network.proxyRequests.length }));
}

function passed(name) { assertions.push({ name, status: "passed", observedAt: new Date().toISOString() }); console.log(JSON.stringify({ assertion: name, status: "passed" })); }
function assertResource(snapshot, kind, occupied, active = 0) {
  assert.equal(snapshot.budgetInvocations, 0);
  const entry = snapshot.executionResources.find((item) => item.kind === kind);
  assert.equal(entry.effectiveCapacity, 1); assert.equal(entry.occupied, occupied); assert.equal(entry.active, active); assert.equal(entry.quarantined, 0);
}
function assertQuarantine(snapshot) {
  const entry = snapshot.find((item) => item.kind === "sandbox_execution");
  assert.equal(entry.effectiveCapacity, 1); assert.equal(entry.occupied, 1); assert.equal(entry.quarantined, 1); assert.equal(entry.active, 0);
  assert.equal(snapshot.find((item) => item.kind === "browser_session").occupied, 0);
}
function assertNoOutbound(snapshot) {
  assert.equal(snapshot.destinationCount, 0);
  assert.equal(snapshot.connectCount, 0);
  assert.equal(snapshot.transferredBytes, 0);
  assert.equal(snapshot.requestCount, snapshot.rejectedCount);
}
async function denied(host, method) {
  try { await rpc(host, method); assert.fail(`${method} unexpectedly admitted`); }
  catch (error) { assert.equal(error.code, "capacity"); return { error: error.message, code: error.code, counters: error.counters, wallMs: error.wallMs }; }
}
async function startHost(label, workspaceRoot) {
  const hostNonce = randomUUID();
  const options = { label, hostNonce, workspaceRoot, stateHome, targetScript, records, screenshots: path.join(raw, "screenshots") };
  const child = fork(path.join(root, "scripts/execution-resource-host-fixture.mjs"), [JSON.stringify(options)], {
    cwd: root, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TMPDIR: browserTmp, NAPIER_BROWSER_EXECUTABLE: executable },
  });
  const stdout = createWriteStream(path.join(raw, `host-${label}.stdout.log`), { flags: "wx" });
  const stderr = createWriteStream(path.join(raw, `host-${label}.stderr.log`), { flags: "wx" });
  child.stdout.pipe(stdout); child.stderr.pipe(stderr);
  const host = { label, hostNonce, child, pending: new Map(), exited: false, closed: false };
  hosts.push(host);
  host.exit = new Promise((resolve) => child.once("exit", (code, signal) => { host.exited = true; resolve({ code, signal }); for (const pending of host.pending.values()) pending.reject(new Error(`Host ${label} exited`)); }));
  const ready = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.on("message", (message) => {
      writeChain = writeChain.then(() => appendFile(path.join(raw, "rpc.jsonl"), JSON.stringify({ at: new Date().toISOString(), host: label, direction: "response", message }) + "\n"));
      if (message.ready) { resolve(message); return; }
      const pending = host.pending.get(message.id);
      if (pending) { host.pending.delete(message.id); pending.resolve(message); }
    });
    void host.exit.then((result) => reject(new Error(`Host ${label} exited before readiness: ${JSON.stringify(result)}`)));
  });
  host.identity = await inspect(child.pid);
  assert.ok(host.identity && host.identity.command.includes(hostNonce), "Host launch nonce is missing from its observed command");
  host.identity.nonce = hostNonce;
  host.ready = await bounded(ready, `Host ${label} readiness`, 30_000);
  assert.equal(host.ready.hostPid, child.pid); assert.equal(host.ready.hostNonce, hostNonce);
  await writeJson(path.join(raw, `host-${label}.identity.json`), host.identity);
  return host;
}
async function rpc(host, method, timeoutMs = 30_000, cleaning = false) {
  if (!cleaning) stopped.signal.throwIfAborted();
  const id = randomUUID(); const start = performance.now();
  writeChain = writeChain.then(() => appendFile(path.join(raw, "rpc.jsonl"), JSON.stringify({ at: new Date().toISOString(), host: host.label, direction: "request", id, method }) + "\n"));
  const pending = new Promise((resolve, reject) => { host.pending.set(id, { resolve, reject }); });
  host.child.send({ id, method });
  let response;
  try { response = await bounded(pending, `${host.label} ${method}`, timeoutMs); }
  finally { host.pending.delete(id); }
  if (!response.ok) { const error = new Error(response.error); Object.assign(error, { code: response.code, counters: response.counters, wallMs: Math.round(performance.now() - start) }); throw error; }
  return response.value;
}
async function disconnectHost(host) {
  if (host.child.connected) host.child.disconnect();
  const result = await bounded(host.exit, `Host ${host.label} disconnect`, 10_000);
  assert.equal(result.code, 0); assert.equal(result.signal, null);
}
async function observeTarget(target) {
  const published = JSON.parse(await readFile(target.receipt, "utf8"));
  assert.equal(published.nonce, target.nonce); assert.equal(published.pid, target.pid);
  const identity = await inspect(target.pid);
  assert.ok(running(identity)); assert.ok(identity.command.includes(target.script) && identity.command.includes(target.nonce));
  identity.nonce = target.nonce;
  await writeJson(path.join(raw, `target-${target.nonce}.identity.json`), identity);
  return identity;
}
async function processTable() {
  const { stdout } = await execute("/bin/ps", ["-ww", "-axo", "pid=,ppid=,lstart=,stat=,command="], { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.split("\n").filter(Boolean).map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(\S+)\s+(.+)$/u.exec(line);
    assert.ok(match, "Incomplete POSIX process identity");
    return { pid: Number(match[1]), ppid: Number(match[2]), startedAt: match[3], state: match[4], command: match[5], commandSha256: hash(match[5]) };
  });
}
async function inspect(pid) { return (await processTable()).find((item) => item.pid === pid); }
function descendants(table, pid) {
  const found = new Set([pid]); let changed = true;
  while (changed) { changed = false; for (const item of table) if (found.has(item.ppid) && !found.has(item.pid)) { found.add(item.pid); changed = true; } }
  return table.filter((item) => found.has(item.pid) && item.pid !== pid);
}
async function observeBrowsers(host) {
  const table = await processTable();
  const children = descendants(table, host.child.pid);
  const roots = children.filter((item) => item.command.startsWith(executable) && item.command.includes("--user-data-dir="));
  const observed = new Map();
  for (const browser of roots) {
    const profile = /--user-data-dir=(\S+)/u.exec(browser.command)?.[1];
    assert.ok(profile, "Native browser profile identity is absent");
    for (const item of [browser, ...descendants(table, browser.pid)]) {
      const nonce = item.command.includes(profile) ? profile : item.command.includes(runNonce) ? runNonce : undefined;
      const identity = { ...item, browserRootPid: browser.pid, ...(nonce ? { nonce } : {}) };
      observed.set(item.pid, identity); browserIdentities.set(`${item.pid}:${item.startedAt}`, identity);
    }
  }
  const result = { roots: roots.map((item) => item.pid), processes: [...observed.values()] };
  await writeJson(path.join(raw, `browser-${host.label}-${randomUUID()}.identities.json`), result);
  return result;
}
function running(identity) { return Boolean(identity && !identity.state.startsWith("Z")); }
function sameRunning(expected, current) { return running(current) && current.startedAt === expected.startedAt && current.commandSha256 === expected.commandSha256; }
async function signalOwned(identity, signal) {
  assert.ok(identity?.nonce, "Refusing signal without an observed ownership nonce");
  const current = await inspect(identity.pid);
  if (!running(current)) return;
  assert.equal(current.startedAt, identity.startedAt, "Refusing signal after PID birth changed");
  assert.equal(current.commandSha256, identity.commandSha256, "Refusing signal after command identity changed");
  assert.ok(current.command.includes(identity.nonce), "Refusing signal without exact nonce match");
  try { process.kill(identity.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
async function waitAbsent(identity, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await inspect(identity.pid);
    if (!running(current)) return { pid: identity.pid, running: false, finalState: current ? "zombie" : "absent" };
    if (current.startedAt !== identity.startedAt) return { pid: identity.pid, running: false, finalState: "original_birth_absent" };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Observed owned process remains alive: ${identity.pid}`);
}
async function waitAllAbsent(identities) { return Promise.all(identities.map((identity) => waitAbsent(identity))); }
async function bounded(promise, label, timeoutMs) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} observation timed out; no automatic retry`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
async function captureBindings(stage) {
  const files = await Promise.all(boundFiles.map(async (file) => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
  const trees = [];
  for (const [directory, suffix] of treeSpecifications) {
    const paths = (await readdir(path.join(root, directory), { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/")).sort();
    assert.ok(paths.length > 0, `Missing binding tree ${directory}`);
    const entries = [];
    for (let offset = 0; offset < paths.length; offset += 32) entries.push(...await Promise.all(paths.slice(offset, offset + 32).map(async (file) => ({ path: file, sha256: hash(await readFile(path.join(root, file))) }))));
    trees.push({ directory, suffix, fileCount: entries.length, sha256: hash(JSON.stringify(entries)) });
    await writeJson(path.join(raw, `binding-${stage}-${directory.replaceAll("/", "_")}.json`), entries);
  }
  const result = { files, trees };
  await writeJson(path.join(raw, `bindings-${stage}.json`), result);
  return result;
}
async function assertNew(filename) {
  try { await access(filename); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`Refusing to overwrite evidence: ${filename}`);
}
async function writeJson(filename, value) { await writeFile(filename, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
function errorDetails(error) { return { name: error?.name ?? "Error", message: error?.message ?? String(error), stack: error?.stack ?? null, code: error?.code ?? null, ...(error instanceof AggregateError ? { errors: error.errors.map(errorDetails) } : {}) }; }
function combine(first, second) { return first ? new AggregateError([first, second], "Physical evidence or cleanup failed") : second; }
