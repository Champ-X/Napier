import { readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/store.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { SubagentChildExecution } from "../src/subagent-child-execution.js";
import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";
import { authorizeSubagentChildContinuation } from "../src/subagent-continuation-authorization.js";
import { prepareSubagentContinuationSource, resolvePreparedSubagentContinuation, resolveSubagentChildRestore } from "../src/subagent-continuation-source.js";
import type { PreparedSubagentChildContinuation } from "../src/subagent-continuation-types.js";
import { prepareSubagentWorkingSet } from "../src/subagent-working-set-capsule.js";
import { subagentRoleInstructionsForSchema } from "../src/subagent-role-instructions.js";
import { createWorkspaceTools } from "../src/tools.js";
import { continuationRunnerFixture, cleanupContinuationRunnerFixtures } from "./subagent-continuation-runner-fixture.js";

type Fixture = Awaited<ReturnType<typeof continuationRunnerFixture>>;
const stores: LocalStore[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const store of stores.splice(0)) store.close(); await cleanupContinuationRunnerFixtures(); });
async function open(f: Fixture) {
  const store = new LocalStore({ dataRoot: f.dataRoot, workspaceRoot: f.workspaceRoot }); stores.push(store);
  await store.initialize(); return store;
}
async function checkpoint(f: Fixture) {
  await f.child.checkpoint((snapshot) => prepareSubagentWorkingSet(f.dataRoot, { frontier: snapshot.frontier,
    boundary: "before_model", systemPrompt: subagentRoleInstructionsForSchema(f.task.role, f.task.outputSchema!),
    tools: createWorkspaceTools(f.workspaceRoot).filter((tool) => f.profile.enabledTools.includes(tool.name)), messages: f.messages,
    mailbox: { consumedThroughSeq: 0, entries: [] }, ...(snapshot.previousCheckpoint ? { previousCheckpoint: snapshot.previousCheckpoint } : {}) }));
}
function expire(f: Fixture, runId: string) {
  const db = new DatabaseSync(path.join(f.dataRoot, LEDGER_DATABASE_FILENAME));
  try { db.prepare("UPDATE run_leases SET acquired_at = ?, heartbeat_at = ?, expires_at = ? WHERE run_id = ?")
    .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", "2000-01-01T00:01:00.000Z", runId); } finally { db.close(); }
}
async function recover(f: Fixture, store: LocalStore, sourceTaskId: string, parentRunId: string) {
  const sourceTask = store.listSubagentTasks(f.thread.id).find((task) => task.id === sourceTaskId)!;
  const sourceRun = store.listRuns(f.thread.id).find((run) => run.id === sourceTask.childRunId)!;
  const sourceParent = store.listRuns(f.thread.id).find((run) => run.id === parentRunId)!;
  const lease = { ownerId: `process:${process.pid}:continuation_repository`, ttlMs: 60_000 };
  const target = await store.createLeasedRun({ threadId: f.thread.id, agentId: f.profile.id, source: "recovery", parentRunId }, lease);
  const recoveryStarted = await store.appendEvent({ threadId: f.thread.id, runId: target.run.id, type: "run.recovery.started",
    category: "lifecycle", payload: { parentRunId, mode: "manual" } });
  const prepared = await store.prepareSubagentChildContinuation({ sourceTaskId, targetParentRunId: target.run.id });
  return { sourceTask, sourceRun, sourceParent, target, recoveryStarted, prepared, lease };
}

describe("atomic child continuation repository", () => {
  it("claims one successor across independent Stores and never reissues its executor token", async () => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare(), other = await open(f);
    const input = { prepared: ready.prepared.prepared, authorization: ready.authorization, lease: ready.lease };
    const results = await Promise.all([ready.store.startSubagentChildContinuation(input), other.startSubagentChildContinuation(input)]);
    expect(results.filter((result) => result.kind === "started")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "existing")).toHaveLength(1);
    const existing = results.find((result) => result.kind === "existing")!;
    expect(existing).not.toHaveProperty("execution");
    expect(other.listSubagentTasks(f.thread.id)).toHaveLength(2);
    expect(other.listRuns(f.thread.id).filter((run) => run.subagent?.continuation)).toHaveLength(1);
    expect((await other.startSubagentChildContinuation(input)).kind).toBe("existing");
  });

  it("rejects forged preparation and re-reads exact source even if an internal preparation object is altered", async () => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare();
    await expect(ready.store.startSubagentChildContinuation({ prepared: {} as PreparedSubagentChildContinuation,
      authorization: ready.authorization, lease: ready.lease })).rejects.toThrow("preparation authority");
    const state = resolvePreparedSubagentContinuation(ready.prepared.prepared);
    state.capsule.messages[0] = { role: "user", content: "Invented source", timestamp: 1 };
    const started = await ready.store.startSubagentChildContinuation({ prepared: prepareSubagentContinuationSource(state),
      authorization: ready.authorization, lease: ready.lease });
    expect(started.kind).toBe("started");
    if (started.kind === "started") expect(resolveSubagentChildRestore(started.restore).messages).toEqual(f.messages);
  });

  it("rolls back the claim, new Task and Run together when the ledger insert fails", async () => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare();
    const db = new DatabaseSync(path.join(f.dataRoot, LEDGER_DATABASE_FILENAME));
    db.exec("CREATE TRIGGER fail_continuation BEFORE INSERT ON ledger_events WHEN NEW.event_type = 'subagent.child.continuation_started' BEGIN SELECT RAISE(ABORT, 'injected continuation failure'); END"); db.close();
    const input = { prepared: ready.prepared.prepared, authorization: ready.authorization, lease: ready.lease };
    await expect(ready.store.startSubagentChildContinuation(input)).rejects.toThrow("injected continuation failure");
    expect(ready.store.listSubagentTasks(f.thread.id)).toHaveLength(1);
    const clean = new DatabaseSync(path.join(f.dataRoot, LEDGER_DATABASE_FILENAME)); clean.exec("DROP TRIGGER fail_continuation"); clean.close();
    expect((await ready.store.startSubagentChildContinuation(input)).kind).toBe("started");
  });

  it("fences a recovered parent that loses its lease after private preparation", async () => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare();
    expire(f, ready.target.run.id);
    await expect(ready.store.startSubagentChildContinuation({ prepared: ready.prepared.prepared,
      authorization: ready.authorization, lease: ready.lease })).rejects.toThrow("parent_authority_unavailable");
    expect(ready.store.listSubagentTasks(f.thread.id)).toHaveLength(1);
  });

  it.each(["known", "pending"] as const)("rejects an uncovered %s model tail after the source checkpoint", async (kind) => {
    const f = await continuationRunnerFixture(); await checkpoint(f);
    if (kind === "known") await f.assistant(fauxAssistantMessage("A response not in the saved source"));
    else await f.child.reserve("subagent_turn");
    expire(f, f.parent.run.id);
    const store = await open(f), next = await recover(f, store, f.task.id, f.parent.run.id);
    expect(next.prepared).toEqual({ kind: "unavailable", reason: kind === "known" ? "checkpoint_tail_uncovered" : "usage_incomplete" });
  });

  it("checks retained full-file evidence again before committing restoration authority", async () => {
    const f = await continuationRunnerFixture({ readFile: true });
    await writeFile(path.join(f.workspaceRoot, "evidence.txt"), "Original evidence");
    await f.assistant(fauxAssistantMessage(fauxToolCall("read_file", { path: "evidence.txt" }), { stopReason: "toolUse" }));
    const ready = await f.interruptAndPrepare();
    await writeFile(path.join(f.workspaceRoot, "evidence.txt"), "Changed evidence");
    await expect(ready.store.startSubagentChildContinuation({ prepared: ready.prepared.prepared,
      authorization: ready.authorization, lease: ready.lease })).rejects.toThrow("workspace_context_unverifiable");
  });

  it.each([false, true])("restores the claimed successor before its first checkpoint with route bound: %s", async (withRoute) => {
    const f = await continuationRunnerFixture();
    const historical = fauxAssistantMessage("Historical evidence");
    historical.usage = { ...historical.usage, input: 7, output: 3, totalTokens: 10 };
    await f.assistant(historical);
    await f.accept("Continue after the evidence");
    const ready = await f.interruptAndPrepare();
    const first = await ready.store.startSubagentChildContinuation({ prepared: ready.prepared.prepared,
      authorization: ready.authorization, lease: ready.lease });
    if (first.kind !== "started") throw new Error("Expected first executor");
    expect(first.budget.inheritedUsage).toMatchObject({ inputTokens: 7, outputTokens: 3 });
    expect(first.execution.run.subagent?.checkpoint).toBeUndefined();
    if (withRoute) {
      const content = { kind: "napier.model-route-plan", schemaVersion: 2, id: "route_inherited_successor", runId: first.execution.run.id };
      await ready.store.appendEvent({ threadId: f.thread.id, runId: first.execution.run.id, type: "route_plan_created",
        category: "model", payload: { ...content, contentSha256: sha256(canonicalJson(content)) } });
      await new SubagentChildExecution(ready.store, first.execution).bindRoute(content.id);
    }
    expire(f, ready.target.run.id);
    const store = await open(f), next = await recover(f, store, first.execution.task.id, ready.target.run.id);
    expect(next.prepared.kind).toBe("ready");
    if (next.prepared.kind !== "ready") throw new Error("Expected inherited source to remain available");
    const authorization = authorizeSubagentChildContinuation({ assessment: next.prepared.assessment,
      sourceRun: next.sourceRun, sourceTask: next.sourceTask, sourceParent: next.sourceParent, targetParent: next.target.run,
      parentProfile: f.profile, configuredProfile: f.profile, recoveryStarted: next.recoveryStarted });
    const second = await store.startSubagentChildContinuation({ prepared: next.prepared.prepared, authorization, lease: next.lease });
    if (second.kind !== "started") throw new Error("Expected successor executor");
    expect(second.budget.inheritedUsage).toEqual(first.budget.inheritedUsage);
    expect(second.budget.inheritedTurnCount).toBe(first.budget.inheritedTurnCount);
    expect(second.budget.deadlineAt).toBe(first.budget.deadlineAt);
    expect(second.budget.continuationOrdinal).toBe(2);
    expect(resolveSubagentChildRestore(second.restore).messages).toEqual(f.messages);
    expect(second.execution.run.subagent?.continuation?.sourceRunId).toBe(f.child.run.id);
    expect(second.execution.run.subagent?.continuation?.predecessorRunId).toBe(first.execution.run.id);
  });

  it("does not refresh the original absolute deadline on a live recovered parent", async () => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare();
    await ready.store.renewRunLease(ready.target.run.id, ready.target.token, 300_000);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(ready.prepared.assessment.budget.deadlineAt) + 1);
    expect(await ready.store.prepareSubagentChildContinuation({ sourceTaskId: f.task.id, targetParentRunId: ready.target.run.id }))
      .toEqual({ kind: "unavailable", reason: "deadline_exhausted" });
  });

  it("rejects a truncated assistant tail before creating a successor", async () => {
    const f = await continuationRunnerFixture();
    await f.assistant(fauxAssistantMessage("A truncated answer", { stopReason: "length" }));
    const { store } = await f.interrupt(), next = await recover(f, store, f.task.id, f.parent.run.id);
    expect(next.prepared).toEqual({ kind: "unavailable", reason: "source_tail_unresumable" });
    expect(store.listSubagentTasks(f.thread.id)).toHaveLength(1);
  });

  it.each(["missing", "corrupt"] as const)("reports %s inherited private source even when the successor checkpoint is intact", async (condition) => {
    const f = await continuationRunnerFixture(), claimed = await f.interruptAndClaim();
    const restored = resolveSubagentChildRestore(claimed.continuation.restore);
    const child = new SubagentChildExecution(claimed.store, claimed.continuation.execution);
    await child.checkpoint((snapshot) => prepareSubagentWorkingSet(f.dataRoot, { frontier: snapshot.frontier,
      boundary: "before_model", systemPrompt: restored.systemPrompt, tools: restored.tools, messages: restored.messages,
      mailbox: { consumedThroughSeq: 0, entries: [] }, previousCheckpoint: snapshot.previousCheckpoint! }));
    const original = path.join(f.dataRoot, "subagent-working-sets", `${claimed.continuation.execution.run.subagent!.continuation!.sourceCapsuleSha256}.json`);
    if (condition === "missing") await rm(original);
    else await writeFile(original, "{broken");
    expire(f, claimed.target.run.id);
    const store = await open(f), next = await recover(f, store, child.task.id, claimed.target.run.id);
    expect(next.prepared).toEqual({ kind: "unavailable", reason: "private_state_unavailable" });
    expect(store.listSubagentTasks(f.thread.id)).toHaveLength(2);
  });

  it("rejects unsupported continuation replay import before persistence and leaves the Store reopenable", async () => {
    const f = await continuationRunnerFixture(), claimed = await f.interruptAndClaim();
    const bundle = await exportThreadReplayBundle(claimed.store, f.thread.id);
    const before = claimed.store.listThreads();
    await expect(claimed.store.importThreadReplayBundle(bundle)).rejects.toThrow("child continuation lineage is unsupported");
    expect(claimed.store.listThreads()).toEqual(before);
    expect((await exportThreadReplayBundle(claimed.store, f.thread.id)).contentSha256).toBe(bundle.contentSha256);
    const reopened = await open(f);
    expect(reopened.listThreads()).toEqual(before);
    expect((await exportThreadReplayBundle(reopened, f.thread.id)).contentSha256).toBe(bundle.contentSha256);
  });

  it.each(["before_claim", "after_claim"])("preserves a real process-exit boundary %s without duplicating the original successor", async (mode) => {
    const f = await continuationRunnerFixture(), ready = await f.interruptAndPrepare();
    const output = path.join(f.dataRoot, "continuation-crash-result.json");
    await expect(promisify(execFile)(process.execPath, ["--import", "tsx",
      fileURLToPath(new URL("./subagent-continuation-crash-worker.ts", import.meta.url)), f.dataRoot, f.workspaceRoot,
      f.task.id, ready.target.run.id, mode, output])).rejects.toMatchObject({ code: 73 });
    const receipt = JSON.parse(await readFile(output, "utf8")) as { taskId?: string; runId?: string; budget?: unknown };
    if (mode === "before_claim") {
      expect(ready.store.listSubagentTasks(f.thread.id)).toHaveLength(1);
      expect((await ready.store.startSubagentChildContinuation({ prepared: ready.prepared.prepared,
        authorization: ready.authorization, lease: ready.lease })).kind).toBe("started");
      return;
    }
    expect(ready.store.listRuns(f.thread.id).find((run) => run.id === receipt.runId)?.subagent?.checkpoint).toBeUndefined();
    expire(f, ready.target.run.id);
    const reopened = await open(f), next = await recover(f, reopened, receipt.taskId!, ready.target.run.id);
    expect(next.prepared.kind).toBe("ready");
    if (next.prepared.kind !== "ready") throw new Error("Expected private source after executor process exit");
    const authorization = authorizeSubagentChildContinuation({ assessment: next.prepared.assessment,
      sourceRun: next.sourceRun, sourceTask: next.sourceTask, sourceParent: next.sourceParent, targetParent: next.target.run,
      parentProfile: f.profile, configuredProfile: f.profile, recoveryStarted: next.recoveryStarted });
    const successor = await reopened.startSubagentChildContinuation({ prepared: next.prepared.prepared, authorization, lease: next.lease });
    expect(successor.kind).toBe("started");
    expect(reopened.listRuns(f.thread.id).filter((run) => run.subagent?.continuation?.predecessorRunId === f.child.run.id)).toHaveLength(1);
    if (successor.kind === "started") expect(successor.budget.deadlineAt).toBe(ready.prepared.assessment.budget.deadlineAt);
  });
});
