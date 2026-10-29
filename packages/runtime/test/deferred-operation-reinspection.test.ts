import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { RecoveryService } from "../src/recovery-service.js";
import { LocalStore } from "../src/store.js";

const fixture = fileURLToPath(new URL("./fixtures/workspace-file-move-crash.ts", import.meta.url));
const recoverer = fileURLToPath(new URL("./fixtures/workspace-file-move-recover.ts", import.meta.url));
const sweeper = fileURLToPath(new URL("./fixtures/deferred-operation-reinspection.ts", import.meta.url));
const env = { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL("./fixtures/workspace-file-move-tsconfig.json", import.meta.url)) };
const roots: string[] = [], stores: LocalStore[] = [], services: RecoveryService[] = [];
const children: Array<{ child: ChildProcessWithoutNullStreams; exited: Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await Promise.all(children.splice(0).map(({ exited }) => exited));
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps a held live recoverer unknown across due sweeps, then observes its commit without reopening", async () => {
  const f = await deferredFixture();
  const fileBefore = await stat(target(f.root));
  for (const wait of [1_100, 2_100]) {
    await delay(wait);
    expect(await f.service.sweep()).toMatchObject({ claimed: 0, completed: 0 });
    await expectUnresolved(f.store, f.runId, f.threadId);
  }
  f.winner.child.stdin.end("commit\n");
  expect((await f.winner.exited)[0]).toBe(0);
  f.service.start();
  await until(async () => completedDescendants(f.store, f.threadId, f.runId) === 1);
  await f.service.stop();
  await expectExactlyOneRecovery(f.store, f.root, f.runId, f.threadId);
  const fileAfter = await stat(target(f.root));
  expect([fileAfter.dev, fileAfter.ino, fileAfter.mtimeMs]).toEqual([fileBefore.dev, fileBefore.ino, fileBefore.mtimeMs]);
}, 40_000);

it("periodic sweeps recover after the held winner dies without any Store restart or manual sweep", async () => {
  const f = await deferredFixture();
  f.service.start();
  await delay(1_350);
  await expectUnresolved(f.store, f.runId, f.threadId);
  await kill(f.winner);
  await until(async () => completedDescendants(f.store, f.threadId, f.runId) === 1);
  await f.service.stop();
  await expectExactlyOneRecovery(f.store, f.root, f.runId, f.threadId);
  expect(f.provider.state.callCount).toBe(1);
}, 35_000);

it("immediately defers real SQLite coordinator contention and converges after the guard is released", async () => {
  const f = await deferredFixture();
  await kill(f.winner);
  const coordinator = new DatabaseSync(path.join(f.root, "data/file-edit-locks.sqlite"));
  try {
    coordinator.exec("BEGIN IMMEDIATE");
    await delay(1_100);
    const startedAt = performance.now();
    const heartbeat = delay(25).then(() => performance.now() - startedAt);
    expect(await f.service.sweep()).toMatchObject({ claimed: 0, completed: 0 });
    // A held guard must not impose a synchronous SQLite wait on ordinary timers.
    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(await heartbeat).toBeLessThan(500);
    await expectUnresolved(f.store, f.runId, f.threadId);
    expect(f.provider.state.callCount).toBe(0);
    coordinator.exec("COMMIT");
    f.service.start();
    await until(async () => completedDescendants(f.store, f.threadId, f.runId) === 1);
    await f.service.stop();
    await expectExactlyOneRecovery(f.store, f.root, f.runId, f.threadId);
    expect(f.provider.state.callCount).toBe(1);
  } finally {
    if (coordinator.isTransaction) coordinator.exec("ROLLBACK");
    coordinator.close();
  }
}, 35_000);

it("two independent periodic sweepers produce one proof, fence, terminal and continuation after winner death", async () => {
  const root = await crashed(), winner = await heldWinner(root);
  const peers = await Promise.all([startPeer(root), startPeer(root)]);
  for (const peer of peers) expect(peer.initial).toMatchObject({ status: "running", proofCount: 0, fenceCount: 0, terminalCount: 0 });
  await Promise.all(peers.map((peer) => peer.command("start")));
  await delay(1_350);
  for (const peer of peers) expect(await peer.command("snapshot")).toMatchObject({ status: "running", proofCount: 0, fenceCount: 0, terminalCount: 0, descendants: [], attempts: [] });
  await kill(winner);
  await until(async () => (await peers[0]!.command("snapshot")).descendants.some((value) => value.status === "completed"));
  const snapshots = await Promise.all(peers.map((peer) => peer.command("stop")));
  for (const value of snapshots) {
    expect(value).toMatchObject({ status: "interrupted", proofCount: 1, fenceCount: 1, terminalCount: 1 });
    expect(value.descendants).toEqual([expect.objectContaining({ status: "completed" })]);
    expect(value.attempts).toEqual([expect.objectContaining({ status: "completed" })]);
  }
  expect(snapshots.reduce((count, value) => count + value.modelCalls, 0)).toBe(1);
  expect((await readFile(path.join(root, "continuations.log"), "utf8")).trim().split("\n")).toHaveLength(1);
  expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
}, 40_000);

it("rechecks the target identity after lock deferral and blocks a same-content replacement before continuation", async () => {
  const f = await deferredFixture();
  await writeFile(`${target(f.root)}.replacement`, "moved once\n");
  await rename(`${target(f.root)}.replacement`, target(f.root));
  await kill(f.winner);
  f.service.start();
  await until(async () => sourceRun(f.store, f.threadId, f.runId).status === "failed");
  await f.service.stop();
  const run = sourceRun(f.store, f.threadId, f.runId), events = await f.store.listRunEvents(f.runId);
  expect(run).toMatchObject({ status: "failed", outcome: "blocked_safety" });
  expect(events.filter((event) => event.type === "workspace.file.move.reconciled")).toEqual([]);
  expect(events.filter((event) => event.type === "tool.operation.effect_indeterminate")).toHaveLength(1);
  expect(events.filter((event) => event.type === "run.failed")).toHaveLength(1);
  expect(f.store.listAutomaticRecoveryAttempts()).toEqual([]);
  expect(f.store.listRuns(f.threadId).filter((value) => value.parentRunId === f.runId)).toEqual([]);
  expect(f.provider.state.callCount).toBe(0);
  expect(await readFile(path.join(f.root, "renames.log"), "utf8")).toBe("rename\n");
}, 30_000);

it("discards a deferred hint after lease generation changes and does not rediscover it by scanning active Runs", async () => {
  const f = await deferredFixture(), database = new DatabaseSync(path.join(f.root, "data/ledger.sqlite"));
  const old = database.prepare("SELECT owner_id, revision, token_sha256 FROM run_leases WHERE run_id=?").get(f.runId)!;
  try {
    database.prepare("UPDATE run_leases SET owner_id=?, revision=revision+1, token_sha256=? WHERE run_id=?")
      .run(`process:${process.pid}:replacement_owner`, "a".repeat(64), f.runId);
    await delay(1_100);
    await f.service.sweep();
    await expectUnresolved(f.store, f.runId, f.threadId);
    // Returning to the original dead owner must not resurrect the discarded scheduling hint.
    database.prepare("UPDATE run_leases SET owner_id=?, revision=?, token_sha256=? WHERE run_id=?")
      .run(old["owner_id"]!, old["revision"]!, old["token_sha256"]!, f.runId);
    await kill(f.winner);
    for (const wait of [2_100, 1_100]) { await delay(wait); await f.service.sweep(); }
    await expectUnresolved(f.store, f.runId, f.threadId);
    expect(f.provider.state.callCount).toBe(0);
  } finally { database.close(); }
}, 35_000);

it("reinspection leaves unrelated live and unknown-owner Runs and a connecting extension untouched", async () => {
  const f = await deferredFixture(), agentId = f.store.listAgents()[0]!.id;
  const unrelated = [];
  for (const ownerId of [`process:${process.pid}:unrelated_live`, "remote_worker_unknown"]) {
    const thread = await f.store.createThread({ title: ownerId, agentId });
    const leased = await f.store.createLeasedRun({ threadId: thread.id, agentId }, { ownerId, ttlMs: 60_000 });
    unrelated.push({ thread: f.store.getThread(thread.id), run: leased.run, events: await f.store.listRunEvents(leased.run.id) });
  }
  const extension = await f.store.createMcpExtension({ name: "Unrelated connecting service",
    transport: { type: "streamable_http", url: "http://127.0.0.1:9/mcp" }, requestedCapabilities: ["external.read"] });
  const connecting = await f.store.setExtensionConnection(extension.id, { status: "connecting", toolCount: 0 });
  await delay(1_100);
  await f.service.sweep();
  await kill(f.winner);
  f.service.start();
  await until(async () => completedDescendants(f.store, f.threadId, f.runId) === 1);
  await f.service.stop();
  for (const value of unrelated) {
    expect(sourceRun(f.store, value.thread.id, value.run.id)).toEqual(value.run);
    expect(f.store.getThread(value.thread.id)).toEqual(value.thread);
    expect(await f.store.listRunEvents(value.run.id)).toEqual(value.events);
  }
  expect(f.store.getExtension(extension.id)).toEqual(connecting);
  await expectExactlyOneRecovery(f.store, f.root, f.runId, f.threadId);
}, 35_000);

async function crashed() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-deferred-operation-")); roots.push(root);
  await expect(promisify(execFile)(process.execPath, ["--import", "tsx", fixture, root, "after-rename"], { env, timeout: 20_000 }))
    .rejects.toMatchObject({ code: 73 });
  return root;
}
function childProcess(script: string, root: string, ...args: string[]) {
  const child = spawn(process.execPath, ["--import", "tsx", script, root, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let output = "", errors = "";
  child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
  child.stderr.on("data", (data: Buffer) => { errors += data.toString(); });
  const value = { child, exited, output: () => output, errors: () => errors };
  children.push(value);
  return value;
}
async function heldWinner(root: string) {
  const child = childProcess(recoverer, root, "hold-before-commit");
  await until(async () => {
    if (child.child.exitCode !== null || child.child.signalCode !== null) throw new Error(child.errors());
    return child.output().includes("recovery-held\n");
  }, 20_000);
  return child;
}
async function kill(value: ReturnType<typeof childProcess>) {
  value.child.kill("SIGKILL");
  expect((await value.exited)[1]).toBe("SIGKILL");
}
async function deferredFixture() {
  const root = await crashed(), winner = await heldWinner(root);
  const store = new LocalStore({ workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "data") });
  stores.push(store); await store.initialize(true);
  const thread = store.listThreads().find((value) => value.title === "Recover one native move")!;
  const run = store.listRuns(thread.id).find((value) => value.source !== "recovery")!;
  expect(run.status).toBe("running");
  const provider = fauxProvider({ provider: "faux-move-recovery" });
  provider.setResponses([async (context) => {
    expect(context.tools?.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(JSON.stringify(context.messages)).toContain("Do not repeat the move");
    await appendFile(path.join(root, "continuations.log"), `${process.pid}\n`);
    return fauxAssistantMessage("The original move is retained.");
  }]);
  const models = new ModelRegistry(); models.registerProvider(provider.provider);
  const service = new RecoveryService(store, new AgentRuntime(store, models), { sweepMs: 250 });
  services.push(service);
  return { root, winner, store, service, provider, threadId: thread.id, runId: run.id };
}
function target(root: string) { return path.join(root, "workspace/target/moved.txt"); }
function sourceRun(store: LocalStore, threadId: string, runId: string) { return store.listRuns(threadId).find((value) => value.id === runId)!; }
function completedDescendants(store: LocalStore, threadId: string, runId: string) {
  return store.listRuns(threadId).filter((value) => value.parentRunId === runId && value.status === "completed").length;
}
async function expectUnresolved(store: LocalStore, runId: string, threadId: string) {
  expect(sourceRun(store, threadId, runId).status).toBe("running");
  expect((await store.listRunEvents(runId)).filter((event) =>
    ["workspace.file.move.reconciled", "tool.operation.effect_indeterminate", "run.interrupted", "run.failed"].includes(event.type))).toEqual([]);
  expect(store.listAutomaticRecoveryAttempts()).toEqual([]);
  expect(store.listRuns(threadId).filter((value) => value.parentRunId === runId)).toEqual([]);
}
async function expectExactlyOneRecovery(store: LocalStore, root: string, runId: string, threadId: string) {
  const events = await store.listRunEvents(runId);
  for (const type of ["workspace.file.move.reconciled", "tool.operation.effect_indeterminate", "run.interrupted"])
    expect(events.filter((event) => event.type === type)).toHaveLength(1);
  expect(events.filter((event) => event.type === "run.failed")).toEqual([]);
  expect(store.listRuns(threadId).filter((value) => value.parentRunId === runId)).toEqual([expect.objectContaining({ status: "completed" })]);
  expect(store.listAutomaticRecoveryAttempts()).toEqual([expect.objectContaining({ status: "completed" })]);
  expect((await readFile(path.join(root, "continuations.log"), "utf8")).trim().split("\n")).toHaveLength(1);
  expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
}
async function until(predicate: () => Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Deferred operation acceptance condition timed out");
    await delay(50);
  }
}
interface SweeperSnapshot {
  runId: string; status: string; proofCount: number; fenceCount: number; terminalCount: number;
  descendants: Array<{ id: string; status: string }>; attempts: Array<{ id: string; status: string }>; modelCalls: number;
}
async function startPeer(root: string) {
  const process = childProcess(sweeper, root);
  await until(async () => {
    if (process.child.exitCode !== null || process.child.signalCode !== null) throw new Error(process.errors());
    return process.output().includes('"type":"ready"');
  }, 20_000);
  const records = () => process.output().trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as {
    type: string; id?: number; snapshot: SweeperSnapshot; error?: string;
  });
  const initial = records().find((value) => value.type === "ready")!.snapshot;
  let id = 0;
  return { initial, async command(action: "start" | "snapshot" | "stop") {
    const requestId = ++id;
    process.child.stdin.write(`${JSON.stringify({ id: requestId, action })}\n`);
    await until(async () => {
      if (records().some((value) => value.id === requestId)) return true;
      if (process.child.exitCode !== null || process.child.signalCode !== null) throw new Error(process.errors());
      return false;
    }, 10_000);
    const reply = records().find((value) => value.id === requestId)!;
    if (reply.type === "error") throw new Error(reply.error);
    return reply.snapshot;
  } };
}
