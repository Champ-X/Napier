import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { assessAutomaticRecovery } from "../src/automatic-recovery.js";
import { moveRecoveryEvidence } from "../src/workspace-file-move-evidence.js";
import { projectRunRecoveryCheckpoint } from "../src/run-recovery-checkpoint.js";
import { reconcileInterruptedWorkspaceMove } from "../src/workspace-file-move-reconciliation.js";
import { liveToolEffectAuthoritiesFromEvents } from "../src/sqlite-tool-effect-authority.js";
import { RecoveryService } from "../src/recovery-service.js";
import type { JsonObject, RunEvent } from "@napier/contracts";

const roots: string[] = [], stores: LocalStore[] = [];
const fixture = fileURLToPath(new URL("./fixtures/workspace-file-move-crash.ts", import.meta.url));
const config = fileURLToPath(new URL("./fixtures/workspace-file-move-tsconfig.json", import.meta.url));
const env = { ...process.env, TSX_TSCONFIG_PATH: config };
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["after-rename", "after-evidence", "after-settlement", "after-terminal"])(
  "retains one completed move after %s without replaying it", async (checkpoint) => {
    const root = await crashed(checkpoint), target = path.join(root, "workspace/target/moved.txt");
    const before = await stat(target), store = await restart(root), run = firstRun(store), events = await store.listRunEvents(run.id);
    expect(run.status, run.error).toBe("interrupted");
    const evidence = moveRecoveryEvidence(events);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.status).toBe("completed");
    expect(assessAutomaticRecovery({ run, events }).eligible).toBe(true);
    expect(projectRunRecoveryCheckpoint(run, events)?.operations.find((v) => v.toolName === "workspace_file_apply")?.status).toBe("completed");
    if (["after-rename", "after-evidence"].includes(checkpoint)) {
      expect(events.filter((e) => e.type === "tool.completed" && payload(e)["toolName"] === "workspace_file_apply")).toEqual([]);
      expect(events.filter((e) => e.type === "tool.operation.settled" && payload(e)["route"] === "workspace_file_apply")).toEqual([]);
      for (const type of ["workspace.file.move.prepared", "workspace.file.move.commit_started", "workspace.file.move.reconciled", "tool.operation.effect_indeterminate", "run.interrupted"])
        expect(moveRecoveryEvidence(events.filter((e) => e.type !== type))).toEqual([]);
      const marker = events.find((e) => e.type === "tool.operation.effect_indeterminate")!;
      await expect(store.appendEvent({ threadId: run.threadId, runId: run.id, type: "tool.completed", category: "tool", visibility: "debug",
        payload: { callId: String(payload(marker)["parentCallId"]), toolName: "workspace_file_apply" } })).rejects.toThrow();
    }
    store.close();
    const reloaded = await restart(root);
    expect(moveRecoveryEvidence(await reloaded.listRunEvents(run.id))).toHaveLength(1);
    const provider = fauxProvider({ provider: "faux-move-recovery" });
    provider.setResponses([(context) => {
      expect(context.tools?.map((tool) => tool.name)).toEqual(["read_file"]);
      expect(JSON.stringify(context.messages)).toContain("Do not repeat the move");
      return fauxAssistantMessage("The original move is retained.");
    }]);
    const models = new ModelRegistry(); models.registerProvider(provider.provider);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    const service = new RecoveryService(reloaded, new AgentRuntime(reloaded, models));
    expect(await service.sweep()).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    const continued = reloaded.listRuns(run.threadId).find((value) => value.parentRunId === run.id)!;
    expect(continued.status, continued.error).toBe("completed");
    expect(reloaded.listAutomaticRecoveryAttempts()).toEqual([expect.objectContaining({ status: "completed", recoveryRunId: continued.id })]);
    expect(await service.sweep()).toMatchObject({ claimed: 0, completed: 0, failed: 0 });
    expect(reloaded.listRuns(run.threadId).filter((value) => value.parentRunId === run.id)).toHaveLength(1);
    expect(provider.state.callCount).toBe(1);
    expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
    const after = await stat(target);
    expect([after.dev, after.ino, after.mtimeMs]).toEqual([before.dev, before.ino, before.mtimeMs]);
    expect(await readFile(target, "utf8")).toBe("moved once\n");
  }, 30_000,
);

it("proves a prepared move never entered commit but does not authorize replay", async () => {
  const root = await crashed("after-prepared"), store = await restart(root), run = firstRun(store), events = await store.listRunEvents(run.id);
  expect(run.status).toBe("interrupted");
  expect(moveRecoveryEvidence(events)[0]).toMatchObject({ status: "not_executed", reason: "move_not_committed" });
  expect(projectRunRecoveryCheckpoint(run, events)?.counts.not_executed).toBe(1);
  expect(assessAutomaticRecovery({ run, events }).eligible).toBe(false);
  expect(await readFile(path.join(root, "workspace/source/source.txt"), "utf8")).toBe("moved once\n");
  await expect(stat(path.join(root, "renames.log"))).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);

it.each(["after-gate", "before-effect", "intent-storage-failure", "commit-gate-failure"])("does not infer completion at %s", async (checkpoint) => {
  const root = await crashed(checkpoint), store = await restart(root), run = firstRun(store), events = await store.listRunEvents(run.id);
  expect(moveRecoveryEvidence(events)).toEqual([]);
  expect(assessAutomaticRecovery({ run, events }).eligible).toBe(false);
  expect(await readFile(path.join(root, "workspace/source/source.txt"), "utf8")).toBe("moved once\n");
  await expect(stat(path.join(root, "renames.log"))).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);

it("keeps a native ordinary move available when directory durability is unsupported", async () => {
  const root = await temporary();
  await promisify(execFile)(process.execPath, ["--import", "tsx", fixture, root, "unsupported-directory-completed"], { env, timeout: 20_000 });
  const store = await restart(root), run = firstRun(store), events = await store.listRunEvents(run.id);
  expect(run.status, run.error).toBe("completed");
  const unavailable = expectBoundUnavailableMarker(events);
  expectNoMoveRecoveryProof(events);
  const settled = events.filter((event) => event.type === "tool.operation.settled" && payload(event)["route"] === "workspace_file_apply");
  expect(settled).toHaveLength(1);
  expect(payload(settled[0])["outcome"]).toBe("succeeded");
  expect(unavailable.seq).toBeLessThan(settled[0]!.seq);
  expect(events.filter((event) => event.type === "tool.completed" && payload(event)["toolName"] === "workspace_file_apply")).toHaveLength(1);
  expect(events.filter((event) => event.type === "tool.failed" && payload(event)["toolName"] === "workspace_file_apply")).toEqual([]);
  expect(await readFile(path.join(root, "workspace/target/moved.txt"), "utf8")).toBe("moved once\n");
  await expect(stat(path.join(root, "workspace/source/source.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
  expect(await readFile(path.join(root, "intent-put.log"), "utf8")).toBe("put\n");
  await expectNoAutomaticRecovery(store, run, events);
}, 30_000);

it("keeps a crashed unsupported-durability move unknown without automatic continuation", async () => {
  const root = await crashed("unsupported-directory-after-rename"), store = await restart(root), run = firstRun(store);
  const events = await store.listRunEvents(run.id);
  expectBoundUnavailableMarker(events);
  expectNoMoveRecoveryProof(events);
  expect(run).toMatchObject({ status: "failed", outcome: "blocked_safety" });
  expect(projectRunRecoveryCheckpoint(run, events)?.operations.find((operation) => operation.toolName === "workspace_file_apply"))
    .toMatchObject({ status: "needs_reconciliation", reason: "effect_unresolved" });
  expect(events.filter((event) => event.type === "tool.completed" && payload(event)["toolName"] === "workspace_file_apply")).toEqual([]);
  expect(await readFile(path.join(root, "workspace/target/moved.txt"), "utf8")).toBe("moved once\n");
  expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
  await expectNoAutomaticRecovery(store, run, events);
}, 30_000);

it("blocks rename when the unsupported-durability marker cannot persist", async () => {
  const root = await crashed("unsupported-directory-marker-failure"), store = await restart(root), run = firstRun(store);
  const events = await store.listRunEvents(run.id);
  expect(events.filter((event) => event.type === "workspace.file.move.recovery_unavailable")).toEqual([]);
  expectNoMoveRecoveryProof(events);
  expect(await readFile(path.join(root, "intent-put.log"), "utf8")).toBe("put\n");
  expect(await readFile(path.join(root, "workspace/source/source.txt"), "utf8")).toBe("moved once\n");
  await expect(stat(path.join(root, "workspace/target/moved.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(path.join(root, "renames.log"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(events.filter((event) => event.type === "tool.failed" && payload(event)["toolName"] === "workspace_file_apply")).toHaveLength(1);
  await expectNoAutomaticRecovery(store, run, events);
}, 30_000);

it.each(["plain", "forged-name", "EIO", "ENOSPC", "EACCES", "file-sync-ENOTSUP"])(
  "does not downgrade native move intent failure %s to unsupported recovery", async (fault) => {
    const root = await crashed(`intent-failure-${fault}`), store = await restart(root), run = firstRun(store);
    const events = await store.listRunEvents(run.id);
    expect(events.filter((event) => event.type === "workspace.file.move.recovery_unavailable")).toEqual([]);
    expectNoMoveRecoveryProof(events);
    expect(await readFile(path.join(root, "intent-put.log"), "utf8")).toBe("put\n");
    expect(await readFile(path.join(root, "workspace/source/source.txt"), "utf8")).toBe("moved once\n");
    await expect(stat(path.join(root, "workspace/target/moved.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(root, "renames.log"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(events.filter((event) => event.type === "tool.failed" && payload(event)["toolName"] === "workspace_file_apply")).toHaveLength(1);
    await expectNoAutomaticRecovery(store, run, events);
  }, 30_000,
);

it.each(["bytes", "same-content-new-inode", "source-recreated", "target-missing", "symlink", "fifo", "parent-replaced", "missing-intent", "corrupt-intent", "tampered-prepared", "live-lock"])(
  "blocks %s after the rename", async (change) => {
    const root = await crashed("after-rename"), target = path.join(root, "workspace/target/moved.txt");
    if (change === "bytes") await writeFile(target, "changed\n");
    if (change === "same-content-new-inode") await replaceIdentically(target);
    if (change === "source-recreated") await writeFile(path.join(root, "workspace/source/source.txt"), "moved once\n");
    if (change === "target-missing") await unlink(target);
    if (change === "symlink") { await rename(target, target + ".real"); await symlink(target + ".real", target); }
    if (change === "fifo") { await unlink(target); await promisify(execFile)("mkfifo", [target]); }
    if (change === "parent-replaced") {
      await rename(path.dirname(target), path.dirname(target) + ".old"); await mkdir(path.dirname(target));
      await rename(path.join(path.dirname(target) + ".old", "moved.txt"), target);
    }
    const intentDir = path.join(root, "data/workspace-file-move-intents");
    if (change === "missing-intent") await rm(intentDir, { recursive: true });
    if (change === "corrupt-intent") await writeFile(path.join(intentDir, (await readdir(intentDir))[0]!), "{}");
    if (change === "tampered-prepared") {
      const db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
      db.exec("UPDATE ledger_events SET event_json=json_set(event_json,'$.payload',json('{}')) WHERE event_type='workspace.file.move.prepared'"); db.close();
    }
    if (change === "live-lock") {
      const directory = path.join(root, "data/file-edit-locks");
      await writeFile(path.join(directory, (await readdir(directory))[0]!), JSON.stringify({ pid: process.pid }));
    }
    const store = await restart(root), run = firstRun(store), events = await store.listRunEvents(run.id);
    if (change === "live-lock") {
      expect(run.status).toBe("running");
      expect(moveRecoveryEvidence(events)).toEqual([]);
      expect(assessAutomaticRecovery({ run, events }).eligible).toBe(false);
      expect(events.filter((e) => ["run.failed", "run.interrupted", "tool.operation.effect_indeterminate"].includes(e.type))).toEqual([]);
      return;
    }
    expect(run.outcome).toBe("blocked_safety");
    expect(moveRecoveryEvidence(events)).toEqual([]);
    expect(assessAutomaticRecovery({ run, events }).eligible).toBe(false);
    expect(payload(events.find((e) => e.type === "run.failed"))["reconciliationReason"]).toMatch(/^move_/u);
    expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
  }, 30_000,
);

it("atomically rolls back the proof, authority fence and terminal on persistence failure", async () => {
  const root = await crashed("after-rename"), db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
  db.exec("CREATE TRIGGER stop_move_recovery BEFORE UPDATE ON workspace_state BEGIN SELECT RAISE(ABORT,'forced move rollback'); END;");
  await expect(restart(root)).rejects.toThrow("forced move rollback");
  expect(db.prepare("SELECT event_type FROM ledger_events WHERE event_type IN ('workspace.file.move.reconciled','tool.operation.effect_indeterminate','run.interrupted')").all()).toEqual([]);
  db.exec("DROP TRIGGER stop_move_recovery"); db.close();
  const store = await restart(root);
  expect(firstRun(store).status).toBe("interrupted");
}, 30_000);

it("rejects reordered, duplicate, foreign and conflicting native move history", async () => {
  const root = await crashed("after-settlement"), store = await restart(root), run = firstRun(store);
  const original = await store.listRunEvents(run.id);
  const base = moveRecoveryEvidence(original)[0]!;
  expect(base.reason).toBe("move_settled");
  const changed = (mutate: (events: RunEvent[]) => void) => {
    const events = structuredClone(original); mutate(events); expect(moveRecoveryEvidence(events)).toEqual([]);
  };
  const phase = (events: RunEvent[], type: string) => events.find((event) => event.type === type && payload(event)["operationId"] === base.operationId)!;
  const swap = (events: RunEvent[], a: string, b: string) => {
    const left = phase(events, a), right = phase(events, b); [left.seq, right.seq] = [right.seq, left.seq];
  };
  changed((events) => swap(events, "tool.operation.settled", "workspace.file.move.commit_started"));
  changed((events) => swap(events, "tool.operation.proposed", "tool.operation.admitted"));
  changed((events) => swap(events, "tool.operation.admitted", "tool.operation.started"));
  for (const type of ["tool.operation.proposed", "tool.operation.admitted", "tool.operation.started", "tool.operation.settled", "workspace.file.move.commit_started"])
    changed((events) => events.push({ ...structuredClone(phase(events, type)), id: "different-event", seq: Math.max(...events.map((e) => e.seq)) + 1 }));
  changed((events) => { phase(events, "tool.operation.settled").runId = "foreign-run"; });
  changed((events) => { phase(events, "tool.operation.settled").threadId = "foreign-thread"; });
  changed((events) => { payload(phase(events, "tool.operation.settled"))["executionLeaseOwnerSha256"] = "0".repeat(64); });
  changed((events) => { payload(events.find((e) => e.type === "tool.started" && payload(e)["callId"] === base.callId))["toolName"] = "foreign_move"; });
  changed((events) => { const index = events.findIndex((e) => e.type === "tool.admitted" && payload(e)["callId"] === base.callId); events.splice(index, 1); });
}, 30_000);

it("fences concurrent recovery processes to one durable terminal and one rename", async () => {
  const root = await crashed("after-rename");
  const recoverer = fileURLToPath(new URL("./fixtures/workspace-file-move-recover.ts", import.meta.url));
  const results = await Promise.allSettled([0, 1].map(() => promisify(execFile)(process.execPath,
    ["--import", "tsx", recoverer, root], { env, timeout: 20_000 })));
  expect(results.some((value) => value.status === "fulfilled")).toBe(true);
  const store = await restart(root), run = firstRun(store), events = await store.listRunEvents(run.id);
  expect(run.status).toBe("interrupted");
  expect(events.filter((e) => ["run.interrupted", "run.failed"].includes(e.type))).toHaveLength(1);
  expect(events.filter((e) => e.type === "workspace.file.move.reconciled")).toHaveLength(1);
  expect(events.filter((e) => e.type === "tool.operation.effect_indeterminate")).toHaveLength(1);
  expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
}, 30_000);

it.each(["commit", "crash"])("defers a contender while the first recoverer is held before %s", async (outcome) => {
  const root = await crashed("after-rename");
  const recoverer = fileURLToPath(new URL("./fixtures/workspace-file-move-recover.ts", import.meta.url));
  const winner = spawn(process.execPath, ["--import", "tsx", recoverer, root, "hold-before-commit"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(winner, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Recovery barrier timed out")), 20_000);
      winner.stdout.on("data", (data: Buffer) => { if (data.toString().includes("recovery-held")) { clearTimeout(timer); resolve(); } });
      winner.once("exit", () => { clearTimeout(timer); reject(new Error("Recovery exited before barrier")); });
    });
    const contender = await promisify(execFile)(process.execPath, ["--import", "tsx", recoverer, root], { env, timeout: 20_000 });
    expect(JSON.parse(contender.stdout.trim())).toEqual({ status: "running", eligible: false });
    const db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
    expect(db.prepare("SELECT event_type FROM ledger_events WHERE event_type IN ('workspace.file.move.reconciled','tool.operation.effect_indeterminate','run.interrupted','run.failed')").all()).toEqual([]);
    db.close();
    if (outcome === "commit") {
      winner.stdin.end("commit\n");
      expect((await exited)[0]).toBe(0);
    } else {
      winner.kill("SIGKILL");
      expect((await exited)[1]).toBe("SIGKILL");
    }
  } finally { if (winner.exitCode === null) { winner.kill("SIGKILL"); await exited; } }
  const store = await restart(root), events = await store.listRunEvents(firstRun(store).id);
  expect(firstRun(store).status).toBe("interrupted");
  expect(events.filter((e) => e.type === "workspace.file.move.reconciled")).toHaveLength(1);
  expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
  store.close();
  const reopened = await restart(root);
  expect(firstRun(reopened).status).toBe("interrupted");
  expect((await reopened.listRunEvents(firstRun(reopened).id)).filter((e) => e.type === "workspace.file.move.reconciled")).toHaveLength(1);
}, 30_000);

it("checks current file identity again after a recovery claim", async () => {
  const root = await crashed("after-rename"), store = await restart(root), claim = await recoveryClaim(store);
  await replaceIdentically(path.join(root, "workspace/target/moved.txt"));
  const provider = fauxProvider({ provider: "faux-move-recovery" }), models = new ModelRegistry(); models.registerProvider(provider.provider);
  await expect(new AgentRuntime(store, models).resumeInterruptedRunAutomatically(claim)).rejects.toThrow("Move recovery postcondition");
  expect(provider.state.callCount).toBe(0);
}, 30_000);

it("refuses a live writer after its path locks have been released", async () => {
  const root = await temporary(), child = spawn(process.execPath, ["--import", "tsx", fixture, root, "live-after-effect"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Move fixture timed out")), 20_000);
      child.stdout.on("data", (data: Buffer) => { if (data.toString().includes("move-ready")) { clearTimeout(timer); resolve(); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Move fixture exited early")); });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const store = await restart(root), run = firstRun(store), events = await store.listRunEvents(run.id);
    const result = await reconcileInterruptedWorkspaceMove({ workspaceRoot: store.workspaceRoot, dataRoot: store.dataRoot, events,
      boundaries: liveToolEffectAuthoritiesFromEvents(events).map((v) => v.boundaryEvent!) });
    expect(result.inputs).toEqual([]); expect(result.reason).toBe("move_writer_still_available");
    store.close();
  } finally { child.kill("SIGKILL"); await exited; }
  expect(firstRun(await restart(root)).status).toBe("interrupted");
}, 30_000);

async function temporary() { const root = await mkdtemp(path.join(tmpdir(), "napier-move-recovery-")); roots.push(root); return root; }
async function crashed(checkpoint: string) {
  const root = await temporary();
  await expect(promisify(execFile)(process.execPath, ["--import", "tsx", fixture, root, checkpoint], { env, timeout: 20_000 })).rejects.toMatchObject({ code: 73 });
  return root;
}
async function restart(root: string) {
  const store = new LocalStore({ dataRoot: path.join(root, "data"), workspaceRoot: path.join(root, "workspace") });
  stores.push(store); await store.initialize(true); return store;
}
function firstRun(store: LocalStore) { return store.listRuns(store.listThreads()[0]!.id)[0]!; }
async function recoveryClaim(store: LocalStore) {
  await new Promise((resolve) => setTimeout(resolve, 1050));
  const claims = (await store.claimAutomaticRecoveries("move_recovery_test")).claims;
  expect(claims).toHaveLength(1); return claims[0]!;
}
async function replaceIdentically(file: string) { await writeFile(file + ".replacement", "moved once\n"); await rename(file + ".replacement", file); }
function expectNoMoveRecoveryProof(events: RunEvent[]) {
  expect(events.filter((event) => ["workspace.file.move.prepared", "workspace.file.move.commit_started",
    "workspace.file.move.reconciled", "workspace.file.move.not_committed"].includes(event.type))).toEqual([]);
  expect(moveRecoveryEvidence(events)).toEqual([]);
}
function expectBoundUnavailableMarker(events: RunEvent[]): RunEvent {
  const markers = events.filter((event) => event.type === "workspace.file.move.recovery_unavailable");
  expect(markers).toHaveLength(1);
  const marker = markers[0]!, fields = payload(marker);
  expect(fields).toMatchObject({ schemaVersion: 1, reason: "durable_directory_unsupported", recoveryAvailable: false });
  const boundary = events.find((event) => event.seq === fields["boundaryEventSeq"]);
  expect(boundary).toMatchObject({ runId: marker.runId, threadId: marker.threadId });
  expect(payload(boundary)).toMatchObject({ operationId: fields["operationId"], parentCallId: fields["callId"],
    route: "workspace_file_apply", executionEffectBoundary: true });
  const start = events.find((event) => event.type === "tool.started" && payload(event)["callId"] === fields["callId"]);
  expect(payload(start)).toMatchObject({ toolName: "workspace_file_apply", inputSha256: fields["inputSha256"] });
  expect(boundary!.seq).toBeLessThan(marker.seq);
  return marker;
}
async function expectNoAutomaticRecovery(store: LocalStore, run: ReturnType<typeof firstRun>, events: RunEvent[]) {
  expect(assessAutomaticRecovery({ run, events }).eligible).toBe(false);
  expect((await store.claimAutomaticRecoveries("move_unavailable_test")).claims).toEqual([]);
  expect(store.listAutomaticRecoveryAttempts()).toEqual([]);
  expect(store.listRuns(run.threadId).filter((candidate) => candidate.parentRunId === run.id)).toEqual([]);
}
function payload(event: RunEvent | undefined): JsonObject {
  const value = event?.payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected event object payload");
  return value;
}
