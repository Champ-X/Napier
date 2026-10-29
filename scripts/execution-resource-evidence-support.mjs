import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const execute = promisify(execFile);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const treeSpecifications = [
  ["packages/contracts/src", ".ts"], ["packages/runtime/src", ".ts"], ["apps/server/src", ".ts"],
  ["packages/contracts/dist", ".js"], ["packages/runtime/dist", ".js"], ["apps/server/dist", ".js"],
];
export async function assertNew(filename) {
  try { await access(filename); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`Refusing to overwrite evidence: ${filename}`);
}
export async function writeJson(filename, value) {
  await writeFile(filename, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
export async function captureBindings(root, raw, stage, files) {
  const bindings = await Promise.all([...files].sort().map(async (file) => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
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
  const result = { files: bindings, trees };
  await writeJson(path.join(raw, `bindings-${stage}.json`), result);
  return result;
}
export async function processTable() {
  const { stdout } = await execute("/bin/ps", ["-ww", "-axo", "pid=,ppid=,lstart=,stat=,command="], {
    env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 5000, maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.split("\n").filter(Boolean).map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(\S+)\s+(.+)$/u.exec(line);
    assert.ok(match, "Incomplete POSIX process identity");
    return { pid: Number(match[1]), ppid: Number(match[2]), startedAt: match[3], state: match[4], command: match[5], commandSha256: hash(match[5]) };
  });
}
export async function inspect(pid) { return (await processTable()).find((item) => item.pid === pid); }
export function descendants(table, pid) {
  const found = new Set([pid]); let changed = true;
  while (changed) { changed = false; for (const item of table) if (found.has(item.ppid) && !found.has(item.pid)) { found.add(item.pid); changed = true; } }
  return table.filter((item) => found.has(item.pid) && item.pid !== pid);
}
export async function observeBrowsers({ executable, ownerPid, nonce, raw, owned }) {
  const table = await processTable();
  const roots = descendants(table, ownerPid).filter((item) => item.command.startsWith(executable) && item.command.includes("--user-data-dir="));
  const observed = new Map();
  for (const browser of roots) {
    const profile = /--user-data-dir=(\S+)/u.exec(browser.command)?.[1];
    assert.ok(profile, "Native browser profile identity is absent");
    for (const item of [browser, ...descendants(table, browser.pid)]) {
      const token = item.command.includes(profile) ? profile : item.command.includes(nonce) ? nonce : undefined;
      const identity = { ...item, browserRootPid: browser.pid, ...(token ? { nonce: token } : {}) };
      observed.set(item.pid, identity); owned.set(`${item.pid}:${item.startedAt}`, identity);
    }
  }
  const result = { roots: roots.map((item) => item.pid), processes: [...observed.values()] };
  await writeJson(path.join(raw, `browser-${randomUUID()}.identities.json`), result);
  return result;
}
export function running(identity) { return Boolean(identity && !identity.state.startsWith("Z")); }
export function sameRunning(expected, current) { return running(current) && current.startedAt === expected.startedAt && current.commandSha256 === expected.commandSha256; }
export async function signalOwned(identity, signal) {
  assert.ok(identity?.nonce, "Refusing signal without an observed ownership nonce");
  const current = await inspect(identity.pid);
  if (!running(current)) return;
  assert.equal(current.startedAt, identity.startedAt, "Refusing signal after PID birth changed");
  assert.equal(current.commandSha256, identity.commandSha256, "Refusing signal after command identity changed");
  assert.ok(current.command.includes(identity.nonce), "Refusing signal without exact nonce match");
  try { process.kill(identity.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
}
export async function waitAbsent(identity, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await inspect(identity.pid);
    if (!running(current)) return { pid: identity.pid, running: false, finalState: current ? "zombie" : "absent" };
    if (current.startedAt !== identity.startedAt) return { pid: identity.pid, running: false, finalState: "original_birth_absent" };
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Observed owned process remains alive: ${identity.pid}`);
}
export async function bounded(promise, label, timeoutMs = 30_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} observation timed out; no automatic retry`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
export function assertNoOutbound(snapshot) {
  assert.equal(snapshot.destinationCount, 0); assert.equal(snapshot.connectCount, 0);
  assert.equal(snapshot.transferredBytes, 0); assert.equal(snapshot.requestCount, snapshot.rejectedCount);
}
export function errorDetails(error) {
  return { name: error?.name ?? "Error", message: error?.message ?? String(error), stack: error?.stack ?? null, code: error?.code ?? null,
    ...(error instanceof AggregateError ? { errors: error.errors.map(errorDetails) } : {}) };
}
export function combine(first, second) { return first ? new AggregateError([first, second], "Reclaim evidence or cleanup failed") : second; }
