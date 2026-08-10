export const PROCESS_GUARDIAN_SPEC_ENV = "NAPIER_PRIVATE_PROCESS_GUARDIAN_SPEC";

export const PROCESS_GUARDIAN_WORKER_SOURCE = String.raw`
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { readFileSync, writeSync } from "node:fs";

const SPEC_ENV = "NAPIER_PRIVATE_PROCESS_GUARDIAN_SPEC";
const STOP_GRACE_MS = 2000;
const PARENT_WATCH_MS = 100;
const DESCENDANT_SCAN_MS = 2000;
const PROCESS_SCAN_TIMEOUT_MS = 1000;
const PROCESS_SCAN_MAX_BYTES = 4 * 1024 * 1024;
const CLEANUP_TIMEOUT_MS = 10000;
const CLEANUP_MAX_BYTES = 4096;
const PS_EXECUTABLE = "/bin/ps";
let target;
let targetExit;
let parentWatch;
let descendantWatch;
let closing = false;
const trackedProcesses = new Map();

function report(value, statusFd) {
  if (statusFd === undefined) return;
  try {
    writeSync(statusFd, JSON.stringify(value) + "\n");
  } catch {}
}

function validSpec(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isSafeInteger(value.parentPid) &&
    value.parentPid > 1 &&
    typeof value.command === "string" &&
    isAbsolute(value.command) &&
    Array.isArray(value.args) &&
    value.args.every((item) => typeof item === "string") &&
    typeof value.cwd === "string" &&
    isAbsolute(value.cwd) &&
    value.env &&
    typeof value.env === "object" &&
    !Array.isArray(value.env) &&
    Object.entries(value.env).every(
      ([key, item]) => typeof key === "string" && typeof item === "string",
    ) &&
    (value.cleanup === undefined || validCleanup(value.cleanup, value.command)) &&
    (value.statusFd === undefined || value.statusFd === 4)
  );
}

function validCleanup(value, targetCommand) {
  return (
    value &&
    typeof value === "object" &&
    value.kind === "oci-container" &&
    value.command === targetCommand &&
    isAbsolute(value.command) &&
    typeof value.commandSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.commandSha256) &&
    typeof value.containerName === "string" &&
    /^napier-[a-f0-9]{32}$/.test(value.containerName) &&
    (value.networkName === undefined ||
      (typeof value.networkName === "string" &&
        /^napier-network-[a-f0-9]{32}$/.test(value.networkName))) &&
    value.env &&
    typeof value.env === "object" &&
    !Array.isArray(value.env) &&
    Object.entries(value.env).every(
      ([key, item]) =>
        /^[A-Z_][A-Z0-9_]{0,127}$/.test(key) &&
        typeof item === "string" &&
        !/[\u0000-\u001f\u007f]/.test(item),
    )
  );
}

function readSpec() {
  const encoded = process.env[SPEC_ENV];
  delete process.env[SPEC_ENV];
  const text = encoded
    ? Buffer.from(encoded, "base64").toString("utf8")
    : readFileSync(3, "utf8");
  const value = JSON.parse(text);
  if (!validSpec(value)) throw new Error("invalid guardian specification");
  return value;
}

function processSnapshot() {
  if (process.platform === "win32") return new Map();
  const result = spawnSync(
    PS_EXECUTABLE,
    ["-axo", "pid=,ppid=,pgid=,lstart="],
    {
      encoding: "utf8",
      maxBuffer: PROCESS_SCAN_MAX_BYTES,
      timeout: PROCESS_SCAN_TIMEOUT_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
    },
  );
  if (
    result.error ||
    result.status !== 0 ||
    result.signal !== null ||
    typeof result.stdout !== "string"
  ) {
    return undefined;
  }
  const snapshot = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const groupPid = Number(match[3]);
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 1 ||
      !Number.isSafeInteger(parentPid) ||
      parentPid < 0 ||
      !Number.isSafeInteger(groupPid) ||
      groupPid < 0
    ) {
      continue;
    }
    snapshot.set(pid, {
      pid,
      parentPid,
      groupPid,
      startedAt: match[4],
    });
  }
  return snapshot;
}

function refreshTrackedProcesses() {
  const snapshot = processSnapshot();
  if (!snapshot) return undefined;
  if (
    target &&
    target.pid !== undefined &&
    !trackedProcesses.has(target.pid)
  ) {
    const identity = snapshot.get(target.pid);
    if (identity) {
      trackedProcesses.set(target.pid, { ...identity, depth: 0 });
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const identity of snapshot.values()) {
      if (trackedProcesses.has(identity.pid)) continue;
      const parent = trackedProcesses.get(identity.parentPid);
      const currentParent = parent
        ? snapshot.get(identity.parentPid)
        : undefined;
      if (
        !parent ||
        !currentParent ||
        currentParent.startedAt !== parent.startedAt
      ) {
        continue;
      }
      trackedProcesses.set(identity.pid, {
        ...identity,
        depth: parent.depth + 1,
      });
      changed = true;
    }
  }
  return snapshot;
}

function trackedAlive(snapshot) {
  return [...trackedProcesses.values()]
    .filter((tracked) => {
      const current = snapshot.get(tracked.pid);
      return current && current.startedAt === tracked.startedAt;
    })
    .sort(
      (left, right) =>
        right.depth - left.depth || right.pid - left.pid,
    );
}

function signalTracked(signal, snapshot) {
  for (const tracked of trackedAlive(snapshot)) {
    try {
      process.kill(tracked.pid, signal);
    } catch {}
  }
}

function signalTargetGroup(signal, snapshot) {
  if (!target || target.pid === undefined) return;
  const tracked = trackedProcesses.get(target.pid);
  const current = snapshot?.get(target.pid);
  if (tracked && current && current.startedAt === tracked.startedAt) {
    try {
      process.kill(-target.pid, signal);
      return;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ESRCH") return;
    }
  }
  try {
    target.kill(signal);
  } catch {}
}

async function waitForTrackedStop(signal) {
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    const snapshot = refreshTrackedProcesses();
    if (!snapshot) return false;
    const alive = trackedAlive(snapshot);
    if (alive.length === 0) return true;
    signalTracked(signal, snapshot);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function stopTarget() {
  if (!target || !targetExit) return;
  const snapshot = refreshTrackedProcesses();
  if (snapshot) signalTracked("SIGTERM", snapshot);
  signalTargetGroup("SIGTERM", snapshot);
  const stopped = await waitForTrackedStop("SIGTERM");
  if (!stopped) {
    const finalSnapshot = refreshTrackedProcesses();
    if (finalSnapshot) signalTracked("SIGKILL", finalSnapshot);
    signalTargetGroup("SIGKILL", finalSnapshot);
    await waitForTrackedStop("SIGKILL");
  }
  await targetExit;
}

function cleanupTargetResource() {
  if (!spec.cleanup) return true;
  let executableSha256;
  try {
    executableSha256 = createHash("sha256")
      .update(readFileSync(spec.cleanup.command))
      .digest("hex");
  } catch {
    return false;
  }
  if (executableSha256 !== spec.cleanup.commandSha256) return false;
  const remove = spawnSync(
    spec.cleanup.command,
    ["container", "rm", "--force", spec.cleanup.containerName],
    cleanupOptions(spec.cleanup.env),
  );
  const containerClean = successfulCleanupCommand(remove) || containerMissing();
  if (!containerClean || !spec.cleanup.networkName) return containerClean;
  const networkRemove = spawnSync(
    spec.cleanup.command,
    ["network", "rm", spec.cleanup.networkName],
    cleanupOptions(spec.cleanup.env),
  );
  return successfulCleanupCommand(networkRemove) || networkMissing();
}

function containerMissing() {
  const remaining = spawnSync(
    spec.cleanup.command,
    [
      "container",
      "ls",
      "--all",
      "--filter",
      "name=^/" + spec.cleanup.containerName + "$",
      "--format",
      "{{.ID}}",
    ],
    cleanupOptions(spec.cleanup.env),
  );
  return successfulCleanupCommand(remaining) && remaining.stdout.trim() === "";
}

function networkMissing() {
  const remaining = spawnSync(
    spec.cleanup.command,
    [
      "network",
      "ls",
      "--filter",
      "name=^" + spec.cleanup.networkName + "$",
      "--format",
      "{{.ID}}",
    ],
    cleanupOptions(spec.cleanup.env),
  );
  return successfulCleanupCommand(remaining) && remaining.stdout.trim() === "";
}

function cleanupOptions(env) {
  return {
    encoding: "utf8",
    env,
    timeout: CLEANUP_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: CLEANUP_MAX_BYTES,
    windowsHide: true,
  };
}

function successfulCleanupCommand(result) {
  return !result.error && result.status === 0 && result.signal === null;
}

async function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  if (parentWatch) clearInterval(parentWatch);
  if (descendantWatch) clearInterval(descendantWatch);
  await stopTarget();
  process.exit(cleanupTargetResource() ? exitCode : 75);
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown());
}
process.on("SIGWINCH", () => {
  signalTargetGroup("SIGWINCH", refreshTrackedProcesses());
});

let spec;
try {
  spec = readSpec();
} catch {
  process.exit(70);
}

if (process.ppid !== spec.parentPid) {
  report({ type: "error", code: "parent_lost" }, spec.statusFd);
  process.exit(71);
}

try {
  target = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    detached: true,
    shell: false,
    stdio: ["inherit", "inherit", "inherit"],
    windowsHide: true,
  });
} catch {
  report({ type: "error", code: "target_spawn_failed" }, spec.statusFd);
  process.exit(72);
}

targetExit = new Promise((resolve) => {
  let settled = false;
  const finish = (code, signal) => {
    if (settled) return;
    settled = true;
    resolve({ code, signal });
  };
  target.once("exit", finish);
  target.once("close", finish);
  target.once("error", () => finish(null, null));
});

target.once("error", () => {
  report({ type: "error", code: "target_spawn_failed" }, spec.statusFd);
});

target.once("spawn", () => {
  if (!refreshTrackedProcesses()) {
    report({ type: "error", code: "descendant_scan_failed" }, spec.statusFd);
    void shutdown(74);
    return;
  }
  report({ type: "ready", pid: target.pid }, spec.statusFd);
});

parentWatch = setInterval(() => {
  if (process.ppid !== spec.parentPid) void shutdown();
}, PARENT_WATCH_MS);

descendantWatch = setInterval(() => {
  if (!refreshTrackedProcesses() && !closing) {
    report({ type: "error", code: "descendant_scan_failed" }, spec.statusFd);
    void shutdown(74);
  }
}, DESCENDANT_SCAN_MS);

const exit = await targetExit;
if (!closing) {
  clearInterval(parentWatch);
  clearInterval(descendantWatch);
  await stopTarget();
  const cleaned = cleanupTargetResource();
  report(
    {
      type: "exit",
      code: cleaned ? exit.code : 75,
      signal: cleaned ? exit.signal : null,
    },
    spec.statusFd,
  );
  process.exit(cleaned ? 0 : 75);
}
`;
