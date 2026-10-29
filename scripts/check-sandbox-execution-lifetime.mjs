import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(process.argv[2] ?? "/tmp/napier-sandbox-execution-lifetime.json");
const injectAssertionFailure = process.argv.includes("--inject-assertion-failure");
assert.ok(["darwin", "linux"].includes(process.platform), "This guardian baseline requires POSIX process inspection");
const execute = promisify(execFile);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const files = [
  "scripts/check-sandbox-execution-lifetime.mjs",
  "packages/runtime/src/process-guardian.ts",
  "packages/runtime/src/process-guardian-worker-source.ts",
  "packages/runtime/src/sandbox-types.ts",
  "packages/runtime/dist/process-guardian.js",
  "packages/runtime/dist/process-guardian-worker-source.js",
  "packages/runtime/package.json",
];
const bindings = () => Promise.all(files.map(async (file) => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
const before = await bindings();
const { launchParentGuardedProcess } = await import(pathToFileURL(path.join(root, "packages/runtime/dist/process-guardian.js")));
const temporary = await mkdtemp(path.join(tmpdir(), "napier-sandbox-lifetime-"));
const nonce = randomUUID();
const targetFile = path.join(temporary, "target.mjs");
const childFile = path.join(temporary, "descendant.mjs");
const targetReceipt = path.join(temporary, "target.json");
const spawnedReceipt = path.join(temporary, "spawned.json");
const childReceipt = path.join(temporary, "descendant.json");
const stopFile = path.join(temporary, "stop");
const interrupted = new AbortController();
const onSignal = () => interrupted.abort(new Error("Baseline interrupted"));
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
let guarded;
let launching;
let observation;
let cleanup;
let primaryError;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(promise, label, timeoutMs = 10_000) {
  let timer;
  const aborted = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  try { return await Promise.race([promise, aborted]); }
  finally { clearTimeout(timer); }
}
async function readReceipt(filename) {
  try {
    const record = JSON.parse(await readFile(filename, "utf8"));
    assert.equal(record.nonce, nonce);
    assert.ok(Number.isSafeInteger(record.pid) && record.pid > 1);
    return record;
  } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
async function inspect(pid) {
  let stdout;
  try {
    ({ stdout } = await execute("/bin/ps", ["-p", String(pid), "-o", "lstart=", "-o", "stat=", "-o", "command="], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 2_000, maxBuffer: 256 * 1024,
    }));
  } catch (error) { if (error.code === 1 && !error.stdout?.trim()) return undefined; throw error; }
  const match = /^\s*(\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(\S+)\s+(.+)$/u.exec(stdout.trim());
  assert.ok(match, "Process identity inspection was incomplete");
  return { pid, startedAt: match[1], state: match[2], command: match[3] };
}
const running = (identity) => identity && !identity.state.startsWith("Z");
function assertOwned(identity, script) {
  assert.ok(identity.command.includes(script) && identity.command.includes(nonce), "Refusing to signal a process without this fixture's exact script and nonce");
}
async function waitForReceipt(filename) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    interrupted.signal.throwIfAborted();
    const record = await readReceipt(filename);
    if (record) return record;
    await pause(20);
  }
  throw new Error("Fixture process did not publish its identity");
}
async function cleanOwned(filename, script) {
  const record = await readReceipt(filename);
  if (!record) return { identityPublished: false, running: false };
  const first = await inspect(record.pid);
  let signalled = false;
  if (running(first)) {
    assertOwned(first, script);
    const current = await inspect(record.pid);
    if (running(current)) {
      assertOwned(current, script);
      assert.equal(current.startedAt, first.startedAt, "PID birth identity changed before cleanup");
      try { process.kill(record.pid, "SIGKILL"); signalled = true; }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await inspect(record.pid);
    if (!running(current)) return { identityPublished: true, pid: record.pid, signalled, running: false, finalState: current ? "zombie" : "absent" };
    // No further signal is sent here. macOS can hide argv while an already
    // signalled process is exiting; polling does not require selecting it again.
    if (first && current.startedAt !== first.startedAt) return { identityPublished: true, pid: record.pid, signalled, running: false, finalState: "original_identity_absent" };
    await pause(20);
  }
  throw new Error("Owned fixture process remained running after cleanup");
}

try {
  await writeFile(childFile, `import { existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const [nonce, receipt, stop] = process.argv.slice(2);
if (existsSync(stop)) process.exit(0);
writeFileSync(receipt, JSON.stringify({ nonce, pid: process.pid }), { flag: 'wx', mode: 0o600 });
setInterval(() => { if (existsSync(stop) || !existsSync(dirname(stop))) process.exit(0); }, 20);
setTimeout(() => process.exit(0), 30000);
`, { flag: "wx", mode: 0o600 });
  await writeFile(targetFile, `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [nonce, childFile, childReceipt, spawnedReceipt, targetReceipt, stop] = process.argv.slice(2);
writeFileSync(targetReceipt, JSON.stringify({ nonce, pid: process.pid }), { flag: 'wx', mode: 0o600 });
setTimeout(() => process.exit(91), 10000);
process.stdin.once('data', () => {
  const child = spawn(process.execPath, [childFile, nonce, childReceipt, stop], { detached: true, stdio: 'ignore', env: {} });
  if (child.pid) writeFileSync(spawnedReceipt, JSON.stringify({ nonce, pid: child.pid }), { flag: 'wx', mode: 0o600 });
  child.once('error', () => process.exit(92));
  child.once('spawn', () => {
    child.unref();
    process.exit(0);
  });
});
`, { flag: "wx", mode: 0o600 });
  const startedAt = Date.now();
  launching = launchParentGuardedProcess({
    command: process.execPath,
    args: [targetFile, nonce, childFile, childReceipt, spawnedReceipt, targetReceipt, stopFile],
    cwd: temporary, env: {},
  }).then((child) => { guarded = child; return child; });
  await bounded(launching, "Guardian launch");
  guarded.stdout.resume(); guarded.stderr.resume();
  // Readiness confirms the initial guardian scan; create the descendant only now.
  guarded.stdin.end("GO\n");
  const exit = await bounded(guarded.exit, "Guarded target exit");
  assert.deepEqual(exit, { code: 0, signal: null });
  const spawned = await waitForReceipt(spawnedReceipt);
  const child = await waitForReceipt(childReceipt);
  assert.equal(child.pid, spawned.pid);
  const identity = await inspect(child.pid);
  assert.ok(running(identity), "Expected the existing detached-descendant boundary to remain observable");
  assertOwned(identity, childFile);
  process.kill(child.pid, 0);
  observation = {
    guardianPid: guarded.guardianPid, targetPid: guarded.targetPid, descendantPid: child.pid,
    directTargetExit: exit, descendantAliveAfterGuardianExit: true,
    descendantIdentity: { startedAt: identity.startedAt, state: identity.state, commandSha256: hash(identity.command), exactFixtureNonceVerified: true },
    elapsedMs: Date.now() - startedAt,
  };
  assert.equal(injectAssertionFailure, false, "Injected assertion failure after observing the owned descendant");
} catch (error) { primaryError = error; }
finally {
  const failures = [];
  // Prevent a still-starting target from creating another child after our final
  // descendant check. Never abandon a late handle after bounded launch timeout.
  try { cleanup = { target: await cleanOwned(targetReceipt, targetFile) }; }
  catch (error) { failures.push(error); }
  if (launching) await launching.catch(() => undefined);
  try { await bounded(guarded?.terminate() ?? Promise.resolve(), "Guardian cleanup", 6_000); }
  catch (error) { failures.push(error); }
  try { cleanup = { ...cleanup, target: await cleanOwned(targetReceipt, targetFile) }; }
  catch (error) { failures.push(error); }
  try {
    const filename = await readReceipt(spawnedReceipt) ? spawnedReceipt : childReceipt;
    cleanup = { ...cleanup, descendant: await cleanOwned(filename, childFile) };
  } catch (error) { failures.push(error); }
  try { await writeFile(stopFile, "stop", { mode: 0o600 }); } catch (error) { failures.push(error); }
  try { await rm(temporary, { recursive: true, force: true }); cleanup = { ...cleanup, temporaryRemoved: true }; }
  catch (error) { failures.push(error); }
  process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
  console.log(JSON.stringify({ phase: "cleanup", assertionFailureInjected: injectAssertionFailure, temporary, cleanup, cleanupFailures: failures.length }));
  if (primaryError || failures.length) throw new AggregateError([...(primaryError ? [primaryError] : []), ...failures], "Sandbox execution baseline failed");
}
assert.equal(cleanup.descendant.identityPublished, true);
assert.equal(cleanup.descendant.running, false);
interrupted.signal.throwIfAborted();
assert.deepEqual(await bindings(), before, "Source or consumed build changed during the baseline");
const head = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
const receipt = {
  kind: "napier.sandbox-execution-lifetime-baseline", schemaVersion: 1,
  evidenceClass: "deterministic_existing_boundary_counterexample",
  capturedAt: new Date().toISOString(), sourceHead: head,
  platform: process.platform, arch: process.arch, nodeVersion: process.version,
  command: "node scripts/check-sandbox-execution-lifetime.mjs <new-output-path>",
  externalNetworkRequests: 0, externalModelRequests: 0,
  observation, cleanup, sourceBindings: before,
  limitations: [
    "This is an existing direct POSIX guardian boundary relevant to host-direct/macOS launch paths; it is not a new regression or a global execution-slot pool implementation.",
    "Guardian readiness precedes descendant creation. The direct target exits normally with code zero; its detached stdio-ignore child remains alive after guardian exit.",
    "The fixture imports consumed Runtime dist files directly. Source and build hashes are recorded separately; this is not clean-build or source-to-build equivalence evidence.",
    "Cleanup signals only a fixture-published PID after matching its exact script, nonce and birth identity. It never selects a process by name. A 30-second child self-expiry is an additional harness-crash safeguard.",
    "No OS sandbox, container, browser, provider, network request or model call is exercised. This does not establish all-descendant containment or cross-process capacity enforcement.",
    "The receipt records one local execution; timing and PIDs are observations, not statistical guarantees. A future containment fix should make this counterexample assertion fail.",
  ],
};
await writeFile(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, directTargetExit: observation.directTargetExit, descendantAliveAfterGuardianExit: true, descendantCleanup: cleanup.descendant.finalState, temporaryRemoved: true }));
