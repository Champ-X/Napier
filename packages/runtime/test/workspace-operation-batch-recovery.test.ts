import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { link, mkdtemp, readFile, readdir, realpath, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { AgentRuntime } from "../src/agent-runtime.js";
import { ModelRegistry } from "../src/models.js";
import { RecoveryService } from "../src/recovery-service.js";
import { assessAutomaticRecovery } from "../src/automatic-recovery.js";
import { moveRecoveryEvidence } from "../src/workspace-file-move-evidence.js";
import { loadSettledPatchRecoveryEvidence } from "../src/workspace-patch-result-recovery.js";
import { acquireWorkspacePathLocks } from "../src/workspace-write-lock.js";
import { lockWorkspaceOperationChecks } from "../src/workspace-operation-recovery-check.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import type { RunEvent } from "@napier/contracts";

const fixture = fileURLToPath(new URL("./fixtures/workspace-operation-batch-crash.ts", import.meta.url));
const recoverer = fileURLToPath(new URL("./fixtures/workspace-file-move-recover.ts", import.meta.url));
const env = { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL("./fixtures/workspace-file-move-tsconfig.json", import.meta.url)) };
const roots: string[] = [], stores: LocalStore[] = [];
afterEach(async () => {
  stores.splice(0).forEach((store) => store.close());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["moves", "mixed"])("retains an independent %s batch through process crash, restart and read-only continuation", async (shape) => {
  for (const checkpoint of ["settled", "after-effect"]) {
    const root = await crashed(shape, checkpoint), before = await snapshots(root, shape);
    const store = await restart(root), source = firstRun(store), events = await store.listRunEvents(source.id);
    expect(source.status, source.error).toBe("interrupted");
    expect(moveRecoveryEvidence(events)).toHaveLength(shape === "moves" ? 2 : 1);
    expect((await loadSettledPatchRecoveryEvidence(store.dataRoot, events)).patches).toHaveLength(shape === "mixed" ? 1 : 0);
    expect(assessAutomaticRecovery({ run: source, events }).eligible).toBe(true);
    expect(events.filter((event) => event.type === "tool.operation.effect_indeterminate")).toHaveLength(checkpoint === "after-effect" ? 1 : 0);
    expect(events.filter((event) => event.type === "tool.completed" && payload(event)["toolName"] === "workspace_file_apply"))
      .toHaveLength((shape === "moves" ? 2 : 1) - (checkpoint === "after-effect" ? 1 : 0));
    store.close();
    const reopened = await restart(root), { provider, models } = continuation();
    await delay(1_050);
    const service = new RecoveryService(reopened, new AgentRuntime(reopened, models));
    expect(await service.sweep()).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(await service.sweep()).toMatchObject({ claimed: 0 });
    expect(provider.state.callCount).toBe(1);
    expect(reopened.listRuns(source.threadId).filter((run) => run.parentRunId === source.id))
      .toEqual([expect.objectContaining({ status: "completed" })]);
    expect(await snapshots(root, shape)).toEqual(before);
    expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n".repeat(shape === "moves" ? 2 : 1));
  }
}, 40_000);

it.each(["moves", "mixed"])("preserves a settled participant and a precommit %s participant without replay", async (shape) => {
  const root = await crashed(shape, "before-commit"), store = await restart(root), source = firstRun(store);
  const events = await store.listRunEvents(source.id);
  expect(source.status, source.error).toBe("interrupted");
  expect(moveRecoveryEvidence(events).filter((value) => value.status === "not_executed")).toHaveLength(1);
  expect(assessAutomaticRecovery({ run: source, events }).eligible).toBe(false);
  expect(events.filter((event) => event.type === "tool.operation.effect_indeterminate")).toHaveLength(1);
  expect(await readFile(path.join(root, "workspace/source-b/source.txt"), "utf8")).toBe("move b once\n");
  await expect(stat(path.join(root, "workspace/target-b/moved.txt"))).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);

it.each(["after-effect", "before-commit"])("retains a settled move followed by a patch interrupted at %s", async (checkpoint) => {
  const root = await crashed("mixed-reverse", checkpoint), store = await restart(root), source = firstRun(store);
  const events = await store.listRunEvents(source.id);
  expect(source.status, source.error).toBe("interrupted");
  expect(moveRecoveryEvidence(events)).toHaveLength(1);
  expect(events.filter((event) => event.type === (checkpoint === "after-effect" ? "workspace.patch.reconciled" : "workspace.patch.not_committed"))).toHaveLength(1);
  expect(assessAutomaticRecovery({ run: source, events }).eligible).toBe(checkpoint === "after-effect");
  if (checkpoint === "after-effect") {
    await delay(1_050);
    const { models, provider } = continuation();
    expect(await new RecoveryService(store, new AgentRuntime(store, models)).sweep()).toMatchObject({ completed: 1, failed: 0 });
    expect(provider.state.callCount).toBe(1);
  }
  expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
}, 30_000);

it.each(["first-bytes", "last-bytes", "first-inode", "last-inode", "first-intent", "last-intent", "first-event", "last-event", "first-rehashed-event"])(
  "rejects the entire mixed batch when %s changes before reconciliation", async (change) => {
    const root = await crashed("mixed", "after-effect"), first = change.startsWith("first");
    const target = path.join(root, "workspace", first ? "patched.txt" : "target-b/moved.txt");
    if (change.endsWith("bytes")) await writeFile(target, "changed\n");
    if (change.endsWith("inode")) { await writeFile(`${target}.new`, await readFile(target)); await rename(`${target}.new`, target); }
    if (change.endsWith("intent")) {
      const directory = path.join(root, "data", first ? "workspace-patch-intents" : "workspace-file-move-intents");
      await writeFile(path.join(directory, (await readdir(directory))[0]!), "{}");
    }
    if (change === "first-rehashed-event") {
      const db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
      const row = db.prepare("SELECT event_json FROM ledger_events WHERE event_type='workspace.patch.prepared'").get()!;
      const event = JSON.parse(String(row["event_json"])) as RunEvent;
      const { contentSha256: _digest, ...content } = payload(event);
      content["pathSha256"] = "a".repeat(64);
      event.payload = { ...content, contentSha256: sha256(canonicalJson(content)) } as RunEvent["payload"];
      db.prepare("UPDATE ledger_events SET event_json=? WHERE event_type='workspace.patch.prepared'").run(JSON.stringify(event));
      db.close();
    } else if (change.endsWith("event")) {
      const db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
      db.prepare("UPDATE ledger_events SET event_json=json_set(event_json,'$.payload',json('{}')) WHERE event_type=?")
        .run(first ? "workspace.patch.prepared" : "workspace.file.move.prepared");
      db.close();
    }
    const store = await restart(root), source = firstRun(store), events = await store.listRunEvents(source.id);
    expect(source).toMatchObject({ status: "failed", outcome: "blocked_safety" });
    expect(events.filter((event) => ["workspace.patch.reconciled", "workspace.file.move.reconciled"].includes(event.type))).toEqual([]);
    expect(assessAutomaticRecovery({ run: source, events }).eligible).toBe(false);
  }, 30_000,
);

it.each(["moves", "mixed"])("defers the entire %s batch while any settled participant is locked, then rescans", async (shape) => {
  const root = await crashed(shape, "after-effect");
  const target = path.join(await realpath(root), "workspace", shape === "mixed" ? "patched.txt" : "target-a/moved.txt");
  const lease = await acquireWorkspacePathLocks(path.join(root, "data"), [target], "batch contention fixture");
  try {
    const store = await restart(root), source = firstRun(store), { provider, models } = continuation();
    expect(source.status).toBe("running");
    expect((await store.listRunEvents(source.id)).filter((event) => ["run.failed", "run.interrupted", "tool.operation.effect_indeterminate"].includes(event.type))).toEqual([]);
    const service = new RecoveryService(store, new AgentRuntime(store, models));
    await delay(1_050);
    expect(await service.sweep()).toMatchObject({ claimed: 0 });
    expect(provider.state.callCount).toBe(0);
    await lease.release();
    await delay(2_050);
    await service.sweep();
    await delay(1_050);
    expect(await service.sweep()).toMatchObject({ completed: 1 });
    expect(provider.state.callCount).toBe(1);
  } finally { await lease.release(); }
}, 30_000);

it("rolls back every proof, fence and terminal on SQLite persistence failure", async () => {
  const root = await crashed("mixed", "after-effect"), db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
  db.exec("CREATE TRIGGER stop_batch BEFORE UPDATE ON workspace_state BEGIN SELECT RAISE(ABORT,'forced batch rollback'); END;");
  await expect(restart(root)).rejects.toThrow("forced batch rollback");
  expect(db.prepare("SELECT event_type FROM ledger_events WHERE event_type IN ('workspace.file.move.reconciled','tool.operation.effect_indeterminate','run.interrupted')").all()).toEqual([]);
  db.exec("DROP TRIGGER stop_batch"); db.close();
  expect(firstRun(await restart(root)).status).toBe("interrupted");
}, 30_000);

it("rechecks an earlier settled patch after batch lock deferral and blocks drift before dispatch", async () => {
  const root = await crashed("mixed", "after-effect");
  const target = path.join(await realpath(root), "workspace/patched.txt");
  const lease = await acquireWorkspacePathLocks(path.join(root, "data"), [target], "deferred batch drift");
  try {
    const store = await restart(root), source = firstRun(store), { provider, models } = continuation();
    expect(source.status).toBe("running");
    await writeFile(target, "changed while deferred\n");
    await lease.release();
    await delay(1_050);
    expect(await new RecoveryService(store, new AgentRuntime(store, models)).sweep()).toMatchObject({ claimed: 0 });
    expect(firstRun(store)).toMatchObject({ status: "failed", outcome: "blocked_safety" });
    expect((await store.listRunEvents(source.id)).filter((event) => event.type === "workspace.file.move.reconciled")).toEqual([]);
    expect(provider.state.callCount).toBe(0);
  } finally { await lease.release(); }
}, 30_000);

it("does not grant mixed move and pending patch replay under the old verified patch policy", async () => {
  const root = await crashed("mixed-reverse", "before-commit", "verified_patches"), store = await restart(root);
  await delay(1_050);
  const claim = (await store.claimAutomaticRecoveries("mixed_pending_test")).claims[0]!;
  expect(claim).toBeDefined();
  const { provider, models } = continuation();
  await expect(new AgentRuntime(store, models).resumeInterruptedRunAutomatically(claim)).rejects.toThrow("Mixed operation recovery cannot replay pending patches");
  expect(provider.state.callCount).toBe(0);
  expect(await readFile(path.join(root, "workspace/patched.txt"), "utf8")).toBe("before\n");
  expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
}, 30_000);

it.each(["commit", "crash"])("keeps batch contention unknown until held recoverer %s, including restart", async (outcome) => {
  const root = await crashed("mixed", "after-effect");
  const winner = spawn(process.execPath, ["--import", "tsx", recoverer, root, "hold-before-commit"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const exited = once(winner, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("batch recovery barrier timeout")), 15_000);
      winner.stdout.on("data", (data: Buffer) => { if (data.toString().includes("recovery-held")) { clearTimeout(timer); resolve(); } });
      winner.once("exit", () => { clearTimeout(timer); reject(new Error("batch recoverer exited early")); });
    });
    const contender = await restart(root);
    expect(firstRun(contender).status).toBe("running");
    contender.close();
    if (outcome === "crash") winner.kill("SIGKILL"); else winner.stdin.end("commit\n");
    await exited;
    const store = await restart(root), source = firstRun(store), events = await store.listRunEvents(source.id);
    expect(source.status).toBe("interrupted");
    for (const type of ["workspace.file.move.reconciled", "tool.operation.effect_indeterminate", "run.interrupted"])
      expect(events.filter((event) => event.type === type)).toHaveLength(1);
    expect(await readFile(path.join(root, "renames.log"), "utf8")).toBe("rename\n");
  } finally { if (winner.exitCode === null && winner.signalCode === null) winner.kill("SIGKILL"); await exited; }
}, 30_000);

it.each(["before-run", "on-created", "on-created-intent", "on-created-event"])("prevents model dispatch when a batch participant changes at %s", async (checkpoint) => {
  const root = await crashed("mixed", "after-effect"), store = await restart(root);
  await delay(1_050);
  const claim = (await store.claimAutomaticRecoveries("batch_recovery_test")).claims[0]!;
  expect(claim).toBeDefined();
  const mutate = async () => {
    if (checkpoint === "on-created-intent") {
      const directory = path.join(root, "data/workspace-patch-intents");
      await writeFile(path.join(directory, (await readdir(directory))[0]!), "{}");
    } else if (checkpoint === "on-created-event") {
      const db = new DatabaseSync(path.join(root, "data/ledger.sqlite"));
      db.exec("UPDATE ledger_events SET event_json=json_set(event_json,'$.payload',json('{}')) WHERE event_type='workspace.patch.prepared'");
      db.close();
    } else await writeFile(path.join(root, "workspace/patched.txt"), "postclaim drift\n");
  };
  if (checkpoint === "before-run") await mutate();
  const { provider, models } = continuation();
  const result = new AgentRuntime(store, models).resumeInterruptedRunAutomatically({ ...claim,
    ...(checkpoint.startsWith("on-created") ? { onRunCreated: mutate } : {}) });
  if (checkpoint === "before-run") await expect(result).rejects.toThrow();
  else expect(await result).toMatchObject({ status: "failed" });
  expect(provider.state.callCount).toBe(0);
}, 30_000);

it.each(["chain", "hardlinks"])("does not admit unsupported %s as independent settled moves", async (shape) => {
  const root = await crashed(shape, "settled"), store = await restart(root), source = firstRun(store);
  const events = await store.listRunEvents(source.id), { provider, models } = continuation();
  await delay(1_050);
  const claims = (await store.claimAutomaticRecoveries("batch_overlap_test")).claims;
  if (shape === "chain") {
    expect(moveRecoveryEvidence(events)).toEqual([]);
    expect(claims).toEqual([]);
  } else {
    expect(claims).toHaveLength(1);
    await expect(new AgentRuntime(store, models).resumeInterruptedRunAutomatically(claims[0]!)).rejects.toThrow("operation_file_alias_unsupported");
  }
  expect(provider.state.callCount).toBe(0);
}, 30_000);

it("bounds independent checks and rejects aliases and ancestor paths before inspection", async () => {
  const root = await temporary(), file = path.join(root, "a"); await writeFile(file, "a"); await link(file, path.join(root, "b"));
  let calls = 0;
  const check = (name: string) => ({ paths: [path.join(root, name)], filePath: path.join(root, name), maxBytes: 1,
    mismatchReason: "operation_changed", inspect: async () => { calls++; return true; } });
  await expect(lockWorkspaceOperationChecks(root, [check("a"), check("a/child")], "bound test")).rejects.toThrow("operation_path_overlap_unsupported");
  expect(calls).toBe(0);
  await expect(lockWorkspaceOperationChecks(root, Array.from({ length: 129 }, (_, index) => check(String(index))), "bound test"))
    .rejects.toThrow("operation_inspection_limit");
  expect(calls).toBe(0);
  await expect(lockWorkspaceOperationChecks(root, [check("a"), check("b")], "bound test")).rejects.toThrow("operation_file_alias_unsupported");
  await writeFile(path.join(root, "large-a"), ""); await writeFile(path.join(root, "large-b"), "");
  for (const name of ["large-a", "large-b"]) await truncate(path.join(root, name), 33 * 1024 * 1024);
  calls = 0;
  await expect(lockWorkspaceOperationChecks(root, ["large-a", "large-b"].map((name) => ({ ...check(name), maxBytes: 64 * 1024 * 1024 })), "bound test"))
    .rejects.toThrow("operation_inspection_byte_limit");
  expect(calls).toBe(0);
});

async function temporary() { const root = await mkdtemp(path.join(tmpdir(), "napier-operation-batch-")); roots.push(root); return root; }
async function crashed(shape: string, checkpoint: string, mode = "safe_read_only") {
  const root = await temporary();
  await expect(promisify(execFile)(process.execPath, ["--import", "tsx", fixture, root, shape, checkpoint, mode], { env, timeout: 20_000 }))
    .rejects.toMatchObject({ code: 73 });
  return root;
}
async function restart(root: string) {
  const store = new LocalStore({ workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "data") });
  stores.push(store); await store.initialize(true); return store;
}
function firstRun(store: LocalStore) { return store.listRuns(store.listThreads()[0]!.id).find((run) => run.source !== "recovery")!; }
function payload(event: RunEvent) { return event.payload as Record<string, unknown>; }
function continuation() {
  const provider = fauxProvider({ provider: "faux-operation-batch" });
  provider.setResponses([(context) => {
    expect(context.tools?.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(JSON.stringify(context.messages)).toContain("Do not repeat the move");
    return fauxAssistantMessage("Both retained operations were inspected.");
  }]);
  const models = new ModelRegistry(); models.registerProvider(provider.provider); return { provider, models };
}
async function snapshots(root: string, shape: string) {
  return Promise.all([shape === "mixed" ? "patched.txt" : "target-a/moved.txt", "target-b/moved.txt"].map(async (relative) => {
    const file = path.join(root, "workspace", relative), value = await stat(file);
    return { path: relative, dev: value.dev, ino: value.ino, mtimeMs: value.mtimeMs, bytes: await readFile(file, "utf8") };
  }));
}
