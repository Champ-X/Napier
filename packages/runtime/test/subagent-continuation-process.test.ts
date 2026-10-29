import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";
import { effectiveRunProfile } from "../src/effective-run-profile.js";
import { authorizeSubagentChildContinuation } from "../src/subagent-continuation-authorization.js";
import { resolveSubagentChildRestore } from "../src/subagent-continuation-source.js";
import { readSubagentWorkingSetForRestore } from "../src/subagent-working-set-capsule.js";
import { continuationRunnerFixture, cleanupContinuationRunnerFixtures } from "./subagent-continuation-runner-fixture.js";

type Fixture = Awaited<ReturnType<typeof continuationRunnerFixture>>;
type Ready = Awaited<ReturnType<Fixture["interruptAndPrepare"]>>;
const stores: LocalStore[] = [];
const workers: Array<{ process: ChildProcess; ended: Promise<{ code: number | null; signal: string | null; stderr: string }> }> = [];
afterEach(async () => {
  for (const worker of workers) if (worker.process.exitCode === null && worker.process.signalCode === null) worker.process.kill("SIGKILL");
  await Promise.all(workers.splice(0).map((worker) => worker.ended));
  for (const store of stores.splice(0)) store.close();
  await cleanupContinuationRunnerFixtures();
});

async function launch(f: Fixture, ready: Ready, mode: string, suffix = mode, barrier?: string) {
  const output = path.join(f.dataRoot, `${suffix}-result.json`), prepared = path.join(f.dataRoot, `${suffix}-ready.json`);
  const config = path.join(f.dataRoot, `${suffix}-config.json`);
  await writeFile(config, JSON.stringify({ dataRoot: f.dataRoot, workspaceRoot: f.workspaceRoot, threadId: f.thread.id,
    sourceTaskId: f.task.id, targetParentRunId: ready.target.run.id, mode, output, ready: prepared, barrier }), { mode: 0o600 });
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./subagent-continuation-process-worker.ts", import.meta.url)), config],
    { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr!.on("data", (chunk) => { stderr += chunk; });
  const ended = new Promise<{ code: number | null; signal: string | null; stderr: string }>((resolve) => {
    child.once("error", (error) => resolve({ code: -1, signal: null, stderr: String(error) }));
    child.once("exit", (code, signal) => resolve({ code, signal, stderr }));
  });
  workers.push({ process: child, ended });
  return { output, prepared, ended };
}
async function waitJson(target: string): Promise<Record<string, any>> {
  for (let attempt = 0; ; attempt += 1) {
    try { return JSON.parse(await readFile(target, "utf8")); }
    catch (error) { if (attempt > 1_000) throw error; await delay(10); }
  }
}
async function assertKilled(worker: Awaited<ReturnType<typeof launch>>) {
  const result = await worker.ended;
  expect(result, result.stderr).toMatchObject({ code: null, signal: "SIGKILL" });
  return waitJson(worker.output);
}
function expireParent(f: Fixture, runId: string) {
  const db = new DatabaseSync(path.join(f.dataRoot, LEDGER_DATABASE_FILENAME));
  try { db.prepare("UPDATE run_leases SET acquired_at = ?, heartbeat_at = ?, expires_at = ? WHERE run_id = ?")
    .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", "2000-01-01T00:01:00.000Z", runId); }
  finally { db.close(); }
}
async function nextRecovery(f: Fixture, ready: Ready, sourceTaskId: string) {
  expireParent(f, ready.target.run.id);
  const store = new LocalStore({ dataRoot: f.dataRoot, workspaceRoot: f.workspaceRoot }); stores.push(store); await store.initialize();
  const sourceTask = store.listSubagentTasks(f.thread.id).find((task) => task.id === sourceTaskId)!;
  const runs = store.listRuns(f.thread.id), sourceRun = runs.find((run) => run.id === sourceTask.childRunId)!;
  const sourceParent = runs.find((run) => run.id === ready.target.run.id)!;
  expect(sourceTask.supervisorStatus).toBe("orphaned"); expect(sourceRun.status).toBe("interrupted");
  const lease = { ownerId: `process:${process.pid}:continuation_recover`, ttlMs: 60_000 };
  const target = await store.createLeasedRun({ threadId: f.thread.id, agentId: f.profile.id, source: "recovery", parentRunId: sourceParent.id }, lease);
  const recoveryStarted = await store.appendEvent({ threadId: f.thread.id, runId: target.run.id, type: "run.recovery.started",
    category: "lifecycle", payload: { mode: "manual", parentRunId: sourceParent.id } });
  const prepared = await store.prepareSubagentChildContinuation({ sourceTaskId, targetParentRunId: target.run.id });
  return { store, sourceTask, sourceRun, sourceParent, target, recoveryStarted, prepared, lease };
}

describe("continuation process fault boundaries", () => {
  it("SIGKILL before claim leaves no successor or new lease", async () => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare();
    await assertKilled(await launch(f, ready, "before_claim"));
    expect(ready.store.listSubagentTasks(f.thread.id)).toHaveLength(1);
    expect(ready.store.listRuns(f.thread.id).filter((run) => run.subagent?.continuation)).toEqual([]);
    const claimed = await ready.store.startSubagentChildContinuation({ prepared: ready.prepared.prepared,
      authorization: ready.authorization, lease: ready.lease });
    expect(claimed.kind).toBe("started");
  });

  it.each(["before_checkpoint", "after_checkpoint"])("recovers exact source and sparse mailbox after SIGKILL %s", async (mode) => {
    const f = await continuationRunnerFixture({ readFile: true });
    await writeFile(path.join(f.workspaceRoot, "evidence.txt"), "stable exact evidence");
    const pending = await f.accept("earlier pending steering"), consumed = await f.accept("later consumed steering", true);
    const response = fauxAssistantMessage(fauxToolCall("read_file", { path: "evidence.txt" }), { stopReason: "toolUse" });
    Object.assign(response.usage, { input: 7, output: 3, totalTokens: 10 });
    response.usage.cost = { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 };
    await f.assistant(response);
    const ready = await f.interruptAndPrepare(), original = structuredClone(ready.sourceTask);
    expect(ready.prepared.assessment.budget).toMatchObject({ inheritedTurnCount: 1, inheritedStepCount: 2,
      inheritedUsage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.03 } });
    const crashed = await assertKilled(await launch(f, ready, mode));
    expect(crashed.tokenIssued).toBe(true);
    expect(Boolean(crashed.checkpoint)).toBe(mode === "after_checkpoint");
    if (crashed.checkpoint) {
      const native = await readSubagentWorkingSetForRestore(f.dataRoot, crashed.checkpoint.capsuleSha256);
      expect(native.binding.frontier.runId).toBe(crashed.runId);
      expect(native.capsule.messages).toEqual(f.messages);
      expect(native.binding.mailbox.entries.map((entry) => entry.id)).toEqual([consumed.id]);
    }
    const next = await nextRecovery(f, ready, crashed.taskId);
    expect(next.prepared.kind).toBe("ready");
    if (next.prepared.kind !== "ready") throw new Error(`Expected safe source: ${next.prepared.reason}`);
    const configuredProfile = next.store.getAgent(f.profile.id);
    const authorization = authorizeSubagentChildContinuation({ assessment: next.prepared.assessment, sourceRun: next.sourceRun,
      sourceTask: next.sourceTask, sourceParent: next.sourceParent, targetParent: next.target.run, configuredProfile,
      parentProfile: effectiveRunProfile(configuredProfile, next.target.run), recoveryStarted: next.recoveryStarted });
    const claimed = await next.store.startSubagentChildContinuation({ prepared: next.prepared.prepared, authorization, lease: next.lease });
    expect(claimed.kind).toBe("started"); if (claimed.kind !== "started") throw new Error("No new executor");
    const restored = resolveSubagentChildRestore(claimed.restore);
    expect(restored.messages).toEqual(f.messages);
    expect(restored.mailbox.pending.map((entry) => entry.message.id)).toEqual([pending.id]);
    expect(restored.mailbox.consumed.map((entry) => entry.id)).toEqual([consumed.id]);
    expect(restored.mailbox.consumed[0]).toMatchObject({ originTaskId: f.task.id, originParentRunId: f.parent.run.id });
    expect(claimed.execution.run.subagent!.continuation).toMatchObject({ predecessorRunId: crashed.runId,
      sourceRunId: crashed.checkpoint ? crashed.runId : f.child.run.id,
      sourceCapsuleSha256: crashed.checkpoint?.capsuleSha256 ?? crashed.continuation.sourceCapsuleSha256 });
    expect(claimed.budget).toMatchObject({ ...crashed.budget, continuationOrdinal: 2 });
    expect(claimed.execution.run.usage).toEqual(f.emptyUsage());
    expect(next.store.listSubagentTasks(f.thread.id).find((task) => task.id === f.task.id)).toEqual(original);
    expect((await next.store.listRunEvents(f.child.run.id)).filter((event) => event.type === "tool.started")).toHaveLength(1);
    expect((await next.store.listRunEvents(crashed.runId)).filter((event) => event.type === "tool.started" || event.type === "model.response")).toEqual([]);
    expect((await next.store.listRunEvents(claimed.execution.run.id)).filter((event) => event.type === "tool.started" || event.type === "model.response")).toEqual([]);
  });

  it.each([
    ["after_reservation", "usage_incomplete"], ["after_response", "checkpoint_tail_uncovered"],
  ])("SIGKILL %s cannot use an older checkpoint to replay an uncovered call", async (mode, reason) => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare();
    const crashed = await assertKilled(await launch(f, ready, mode!));
    expect(crashed.checkpoint).toBeDefined();
    const next = await nextRecovery(f, ready, crashed.taskId);
    expect(next.prepared).toEqual({ kind: "unavailable", reason });
    expect(next.store.listRuns(f.thread.id).filter((run) => run.subagent?.continuation?.predecessorRunId === crashed.runId)).toEqual([]);
    const events = await next.store.listRunEvents(crashed.runId);
    expect(events.filter((event) => event.type === "subagent.child.invocation_reserved")).toHaveLength(1);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(mode === "after_response" ? 1 : 0);
  });

  it("two prepared processes claim one successor and issue exactly one executor lease", async () => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare();
    const barrier = path.join(f.dataRoot, "claim.go");
    const running = await Promise.all([launch(f, ready, "race", "race-a", barrier), launch(f, ready, "race", "race-b", barrier)]);
    const prepared = await Promise.all(running.map((worker) => waitJson(worker.prepared)));
    expect(prepared[0]!.assessmentSha256).toBe(prepared[1]!.assessmentSha256);
    await writeFile(barrier, "go");
    const ended = await Promise.all(running.map((worker) => worker.ended));
    for (const result of ended) expect(result, result.stderr).toMatchObject({ code: 0, signal: null });
    const results = await Promise.all(running.map((worker) => waitJson(worker.output)));
    expect(results.map((result) => result.kind).sort()).toEqual(["existing", "started"]);
    expect(results.filter((result) => result.tokenIssued)).toHaveLength(1);
    expect(results.find((result) => result.kind === "existing")).not.toHaveProperty("tokenSha256");
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    expect(new Set(results.map((result) => result.taskId)).size).toBe(1);
    expect(ready.store.listSubagentTasks(f.thread.id)).toHaveLength(2);
    const runId = results[0]!.runId;
    expect((await ready.store.listRunEvents(runId)).filter((event) => event.type === "subagent.child.continuation_started")).toHaveLength(1);
    expect((await ready.store.listRunEvents(runId)).filter((event) => event.type === "model.response" || event.type === "subagent.child.invocation_reserved")).toEqual([]);
    const db = new DatabaseSync(path.join(f.dataRoot, LEDGER_DATABASE_FILENAME));
    try { expect(db.prepare("SELECT COUNT(*) AS count FROM run_leases WHERE run_id = ?").get(runId)).toMatchObject({ count: 1 }); }
    finally { db.close(); }
  });
});
