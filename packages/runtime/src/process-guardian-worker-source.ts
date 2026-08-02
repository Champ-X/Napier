export const PROCESS_GUARDIAN_SPEC_ENV = "NAPIER_PRIVATE_PROCESS_GUARDIAN_SPEC";

export const PROCESS_GUARDIAN_WORKER_SOURCE = String.raw`
import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { readFileSync, writeSync } from "node:fs";

const SPEC_ENV = "NAPIER_PRIVATE_PROCESS_GUARDIAN_SPEC";
const STOP_GRACE_MS = 2000;
let target;
let targetExit;
let parentWatch;
let closing = false;

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
    (value.statusFd === undefined || value.statusFd === 4)
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

function signalTargetGroup(signal) {
  if (!target || target.pid === undefined) return;
  try {
    process.kill(-target.pid, signal);
    return;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return;
  }
  try {
    target.kill(signal);
  } catch {}
}

async function stopTarget() {
  if (!target || !targetExit) return;
  signalTargetGroup("SIGTERM");
  const stopped = await Promise.race([
    targetExit.then(() => true),
    new Promise((resolve) =>
      setTimeout(() => resolve(false), STOP_GRACE_MS),
    ),
  ]);
  if (!stopped) signalTargetGroup("SIGKILL");
  await targetExit;
}

async function shutdown() {
  if (closing) return;
  closing = true;
  if (parentWatch) clearInterval(parentWatch);
  await stopTarget();
  process.exit(0);
}

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown());
}

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
  report({ type: "ready", pid: target.pid }, spec.statusFd);
});

parentWatch = setInterval(() => {
  if (process.ppid !== spec.parentPid) void shutdown();
}, 100);

const exit = await targetExit;
if (!closing) {
  clearInterval(parentWatch);
  signalTargetGroup("SIGTERM");
  report({ type: "exit", code: exit.code, signal: exit.signal }, spec.statusFd);
  process.exit(0);
}
`;
