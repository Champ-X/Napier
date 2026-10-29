import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyUsage, type JsonObject, type SubagentLimits } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { applyAgentCapabilityPresetOverride } from "../src/agent-capability-override.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { LocalStore } from "../src/store.js";
import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";
import { authorizeSubagentChildRun } from "../src/subagent-child-authorization.js";
import type { StartedSubagentChildRun, SubagentChildRunFence } from "../src/subagent-child-run-types.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
const limits: SubagentLimits = { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 10_000 };
const usage = { inputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 2, costUsd: 0.4 };
const lease = { ownerId: `process:${process.pid}:child_test`, ttlMs: 60_000 };

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(preset = false, childLimits = limits) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-child-run-")); roots.push(root);
  const options = { dataRoot: path.join(root, "data"), workspaceRoot: path.join(root, "workspace") };
  await mkdir(options.workspaceRoot);
  const store = new LocalStore(options); stores.push(store); await store.initialize();
  const base = await store.updateAgent(store.listAgents()[0]!.id, {
    enabledSubagents: ["researcher", "reviewer"], subagentLimits: childLimits,
    enabledTools: ["read_file", "list_files", "web_fetch", "git_inspect"],
  });
  const profile = preset ? applyAgentCapabilityPresetOverride(base, "research", "user") : base;
  const thread = await store.createThread({ agentId: base.id, title: "Durable child" });
  const parent = await store.createLeasedRun({ threadId: thread.id, agentId: base.id,
    source: "user", ...(preset ? { capabilityPreset: "research" as const } : {}) }, lease);
  const task = await store.createSubagentTask({ threadId: thread.id, runId: parent.run.id,
    role: "researcher", description: "Inspect child persistence", prompt: "Keep my evidence private.",
    model: profile.model, providerId: "in_process", executionId: "subexec_childtest" });
  const authorization = authorizeSubagentChildRun({ parentRun: parent.run, parentProfile: profile,
    taskId: task.id, executionId: task.executionId!, limits: childLimits });
  const start = { taskId: task.id, executionId: task.executionId!, authorization, lease };
  return { store, options, profile, thread, parent, task, start };
}
function fence(child: StartedSubagentChildRun, revision = child.executionRevision): SubagentChildRunFence {
  return { runId: child.run.id, taskId: child.task.id, executionId: child.task.executionId!,
    token: child.token, expectedExecutionRevision: revision };
}
async function reopen(options: ConstructorParameters<typeof LocalStore>[0]) {
  const store = new LocalStore(options); stores.push(store); await store.initialize(); return store;
}
function expire(options: { dataRoot: string }, runId: string) {
  const db = new DatabaseSync(path.join(options.dataRoot, LEDGER_DATABASE_FILENAME));
  try { db.prepare("UPDATE run_leases SET acquired_at = ?, heartbeat_at = ?, expires_at = ? WHERE run_id = ?")
    .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", "2000-01-01T00:01:00.000Z", runId); } finally { db.close(); }
}

describe("durable child Run lifecycle", () => {
  it("preserves the existing one-second child timeout through configuration and reload", async () => {
    const f = await fixture(false, { ...limits, timeoutMs: 1_000 });
    const child = await f.store.startSubagentChildRun(f.start);
    expect(child.run.limits?.timeoutMs).toBe(1_000);
    expect(child.run.configuration).toMatchObject({ executionMode: "subagent", runLimits: { timeoutMs: 1_000 } });
    const reopened = await reopen(f.options);
    expect(reopened.listRuns(f.thread.id).find((run) => run.id === child.run.id)?.limits?.timeoutMs).toBe(1_000);
    const bundle = createThreadReplayBundle(await reopened.getDetail(f.thread.id));
    expect(() => validateThreadReplayBundle(bundle)).not.toThrow();
    const imported = await reopened.importThreadReplayBundle(bundle);
    expect(imported.runs.find((run) => run.source === "subagent")?.limits?.timeoutMs).toBe(1_000);
  });
  it("keeps pending tasks queued and starts exactly one linked leased Run across two Stores", async () => {
    const f = await fixture();
    expect(f.store.listRuns(f.thread.id)).toHaveLength(1);
    expect(f.task.childRunId).toBeUndefined();
    const second = await reopen(f.options);
    const results = await Promise.allSettled([f.store.startSubagentChildRun(f.start), second.startSubagentChildRun(f.start)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const child = (results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<StartedSubagentChildRun>).value;
    expect(second.listSubagentTasks(f.thread.id)[0]).toMatchObject({ childRunId: child.run.id, status: "running" });
    expect(second.getThread(f.thread.id).currentRunId).toBe(f.parent.run.id);
    expect(child.run).toMatchObject({ source: "subagent", parentRunId: f.parent.run.id,
      subagent: { taskId: f.task.id, parentConfigurationSha256: f.parent.run.configuration!.contentSha256 } });
    expect(child.run).not.toHaveProperty("leaseTokenSha256");
    await expect(f.store.createRun({ threadId: f.thread.id, agentId: f.profile.id, source: "subagent" })).rejects.toThrow("internal child");
  });

  it("rejects forged and foreign capabilities and preserves frozen temporary parent permissions", async () => {
    const f = await fixture(true);
    await expect(f.store.startSubagentChildRun({ ...f.start, authorization: { ...f.start.authorization } })).rejects.toThrow("authorization");
    await expect(f.store.startSubagentChildRun({ ...f.start, executionId: "subexec_foreign" })).rejects.toThrow("pending");
    await f.store.updateAgent(f.profile.id, { enabledTools: ["list_files"], enabledSubagents: [] });
    f.profile.enabledTools.splice(0);
    const child = await f.store.startSubagentChildRun(f.start);
    expect(child.profile.enabledTools).toContain("web_fetch");
    expect(child.profile.enabledSubagents).toEqual([]);
    expect(child.run.configuration!.systemPromptSha256).not.toBe(f.parent.run.configuration!.systemPromptSha256);
    expect(child.run.limits).toMatchObject({ maxTurns: limits.maxTurns, timeoutMs: limits.timeoutMs });
  });

  it("rejects expanded parent snapshots and limits before granting authority", async () => {
    const f = await fixture();
    const input = { parentRun: f.parent.run, parentProfile: f.profile, taskId: f.task.id,
      executionId: f.task.executionId!, limits };
    expect(() => authorizeSubagentChildRun({ ...input, parentProfile: { ...f.profile, enabledTools: [...f.profile.enabledTools, "run_command"] } })).toThrow("conflicts");
    expect(() => authorizeSubagentChildRun({ ...input, limits: { ...limits, maxTurns: 5 } })).toThrow("exceed");
  });

  it("enforces the durable total delegation order before an excess pending Task can leapfrog", async () => {
    const f = await fixture();
    let last = f.task;
    for (let index = 1; index <= limits.maxTotal; index += 1) {
      last = await f.store.createSubagentTask({ threadId: f.thread.id, runId: f.parent.run.id,
        role: "researcher", description: "Queued direct provider", prompt: `Task ${index}`,
        model: f.profile.model, providerId: "in_process", executionId: `subexec_direct${index}` });
    }
    const authorization = authorizeSubagentChildRun({ parentRun: f.parent.run, parentProfile: f.profile,
      taskId: last.id, executionId: last.executionId!, limits });
    await expect(f.store.startSubagentChildRun({ taskId: last.id, executionId: last.executionId!,
      authorization, lease })).rejects.toThrow("total child limit");
    expect(f.store.listRuns(f.thread.id)).toHaveLength(1);
    expect((await f.store.startSubagentChildRun(f.start)).task.id).toBe(f.task.id);
  });

  it("uses execution CAS independent of heartbeat and settles one response exactly once", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    const second = await reopen(f.options);
    await second.renewRunLease(child.run.id, child.token, 60_000);
    expect(f.store.assertSubagentChildRunActive(fence(child)).executionRevision).toBe(1);
    expect(() => f.store.assertSubagentChildRunActive({ ...fence(child), token: "forged" })).toThrow("token");
    const reserved = await f.store.reserveSubagentChildInvocation({ ...fence(child), requestId: "physical:1", phase: "subagent_turn" });
    await expect(second.reserveSubagentChildInvocation({ ...fence(child), requestId: "physical:2", phase: "subagent_turn" })).rejects.toThrow("revision");
    const retry = await second.reserveSubagentChildInvocation({ ...fence(child), requestId: "physical:1", phase: "subagent_turn" });
    expect(retry).toEqual({ invocationId: reserved.invocationId, invocationIndex: 1, executionRevision: reserved.executionRevision });
    expect(reserved.events?.map((event) => event.type)).toEqual(["subagent.child.invocation_reserved"]);
    const settlement = { ...fence(child, reserved.executionRevision), invocationId: reserved.invocationId, payload: { stopReason: "stop" }, usage };
    const results = await Promise.all([f.store.settleSubagentChildInvocation(settlement), second.settleSubagentChildInvocation(settlement)]);
    expect(results[0]!.task.usage).toEqual(usage);
    expect(results[1]!.task.usage).toEqual(usage);
    expect(await f.store.aggregateRunUsage(child.run.id)).toEqual(usage);
    expect(await f.store.aggregateRunUsage(f.parent.run.id)).toEqual(usage);
    expect((await f.store.listRunEvents(child.run.id)).filter((event) => event.type === "model.response")).toHaveLength(1);
    await expect(f.store.settleSubagentChildInvocation({ ...settlement, usage: { ...usage, costUsd: 9 } })).rejects.toThrow("conflicts");
    await expect(f.store.settleSubagentChildInvocation({ ...settlement, payload: { usage: emptyUsage() } })).rejects.toThrow("usage conflicts");
  });

  it("fences legacy mutation and atomically commits child progress and terminal state", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    await expect(f.store.recordSubagentProgress(child.task.id, { turnDelta: 1 })).rejects.toThrow("execution fence");
    await expect(f.store.finishSubagentTask(child.task.id, { status: "completed", stopReason: "completed" })).rejects.toThrow("atomic child");
    const progress = await f.store.recordSubagentChildProgress({ ...fence(child), turnDelta: 1, stepDelta: 1 });
    const finished = await f.store.finishSubagentChildRun({ ...fence(child, progress.executionRevision), finish: { status: "completed", stopReason: "completed" } });
    expect(finished.run.status).toBe("completed"); expect(finished.task.status).toBe("completed");
    expect(f.store.getThread(f.thread.id)).toMatchObject({ currentRunId: f.parent.run.id, status: "running" });
    expect(() => f.store.assertSubagentChildRunActive(fence(child))).toThrow();
    const reopened = await reopen(f.options);
    expect(reopened.listSubagentTasks(f.thread.id)[0]).toMatchObject({ status: "completed", turnCount: 1, stepCount: 1 });
  });

  it("retains unknown physical usage without manufacturing a known zero or successful completion", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    const reservation = await f.store.reserveSubagentChildInvocation({ ...fence(child), requestId: "cancelled:1", phase: "typed_repair" });
    const settled = await f.store.settleSubagentChildInvocation({ ...fence(child, reservation.executionRevision), invocationId: reservation.invocationId,
      payload: { stopReason: "aborted" }, usageStatus: "unknown" });
    expect(settled.task.usageStatus).toBe("incomplete");
    const response = (await f.store.listRunEvents(child.run.id)).find((event) => event.type === "model.response")!;
    expect(response.payload).toMatchObject({ usageStatus: "unknown" }); expect(response.payload).not.toHaveProperty("usage");
    await expect(f.store.finishSubagentChildRun({ ...fence(child, settled.executionRevision), finish: { status: "completed", stopReason: "completed" } })).rejects.toThrow("unresolved");
    const failed = await f.store.finishSubagentChildRun({ ...fence(child, settled.executionRevision), finish: { status: "cancelled", stopReason: "cancelled" } });
    expect(failed.run.usageStatus).toBe("incomplete");
    const parent = await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
    expect(parent.usageStatus).toBe("incomplete");
  });

  it("binds only the child's durable route plan and rejects a parent-owned or altered plan", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    const makePlan = (runId: string, id: string) => {
      const content = { kind: "napier.model-route-plan", schemaVersion: 2, id, runId };
      return { ...content, contentSha256: sha256(canonicalJson(content)) };
    };
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "route_plan_created",
      category: "model", payload: makePlan(f.parent.run.id, "route_parentplan") });
    await expect(f.store.bindSubagentChildRoute({ ...fence(child), routePlanId: "route_parentplan" })).rejects.toThrow("Run-owned");
    await f.store.appendEvent({ threadId: f.thread.id, runId: child.run.id, type: "route_plan_created",
      category: "model", payload: { ...makePlan(child.run.id, "route_alteredplan"), contentSha256: "0".repeat(64) } });
    await expect(f.store.bindSubagentChildRoute({ ...fence(child), routePlanId: "route_alteredplan" })).rejects.toThrow("invalid");
    await f.store.appendEvent({ threadId: f.thread.id, runId: child.run.id, type: "route_plan_created",
      category: "model", payload: makePlan(child.run.id, "route_childplan") });
    const bound = await f.store.bindSubagentChildRoute({ ...fence(child), routePlanId: "route_childplan" });
    expect(bound.task.routePlanId).toBe("route_childplan");
    expect(bound.executionRevision).toBe(2);
  });

  it("stops dispatch after parent completion while allowing fenced child cancellation", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
    expect(() => f.store.assertSubagentChildRunActive(fence(child))).toThrow("parent");
    await f.store.finishSubagentChildRun({ ...fence(child), finish: { status: "cancelled", stopReason: "cancelled" } });
    expect(f.store.getThread(f.thread.id)).toMatchObject({ status: "idle" });
    expect(f.store.getThread(f.thread.id).currentRunId).toBeUndefined();
  });

  it("fences an expired lease and orphans the child Task without interrupting its live parent", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start); expire(f.options, child.run.id);
    expect(() => f.store.assertSubagentChildRunActive(fence(child))).toThrow("no longer active");
    const reopened = await reopen(f.options);
    expect(reopened.listRuns(f.thread.id).find((run) => run.id === child.run.id)?.status).toBe("interrupted");
    expect(reopened.listSubagentTasks(f.thread.id)[0]).toMatchObject({ status: "failed", supervisorStatus: "orphaned" });
    expect(reopened.getThread(f.thread.id).currentRunId).toBe(f.parent.run.id);
  });

  it("propagates lost parent ownership and incomplete usage through child recovery while child lease is live", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    await f.store.reserveSubagentChildInvocation({ ...fence(child), requestId: "interrupted-physical-call", phase: "subagent_turn" });
    expire(f.options, f.parent.run.id);
    const reopened = await reopen(f.options);
    expect(reopened.listRuns(f.thread.id).find((run) => run.id === f.parent.run.id)).toMatchObject({ status: "interrupted", usageStatus: "incomplete" });
    expect(reopened.listRuns(f.thread.id).find((run) => run.id === child.run.id)?.status).toBe("interrupted");
    expect(reopened.listSubagentTasks(f.thread.id)[0]?.supervisorStatus).toBe("orphaned");
    expect(reopened.getThread(f.thread.id).currentRunId).toBeUndefined();
  });

  it("round-trips child lineage as inspection evidence and rejects rebound replay associations", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    await f.store.finishSubagentChildRun({ ...fence(child), finish: { status: "completed", stopReason: "completed" } });
    await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
    const bundle = createThreadReplayBundle(await f.store.getDetail(f.thread.id));
    expect(() => validateThreadReplayBundle(bundle)).not.toThrow();
    const imported = await f.store.importThreadReplayBundle(bundle);
    const importedChild = imported.runs.find((run) => run.source === "subagent")!;
    expect(importedChild.id).not.toBe(child.run.id);
    expect(imported.subagents[0]).toMatchObject({ childRunId: importedChild.id, runId: importedChild.parentRunId });
    expect(importedChild.subagent?.taskId).toBe(imported.subagents[0]!.id);
    const corrupted = structuredClone(bundle); corrupted.subagents[0]!.childRunId = f.parent.run.id;
    expect(() => validateThreadReplayBundle(corrupted)).toThrow("binding");
    const corruptedCompleteness = structuredClone(bundle);
    (corruptedCompleteness.runs[0] as unknown as JsonObject)["usageStatus"] = "guessed";
    expect(() => validateThreadReplayBundle(corruptedCompleteness)).toThrow("completeness status");
  });
  it("fences dispatch and successful completion when only the parent lease expires", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    const reserved = await f.store.reserveSubagentChildInvocation({ ...fence(child), requestId: "before-expiry", phase: "subagent_turn" });
    expire(f.options, f.parent.run.id);
    expect(() => f.store.assertSubagentChildRunActive(fence(child, reserved.executionRevision))).toThrow("parent");
    await expect(f.store.reserveSubagentChildInvocation({ ...fence(child, reserved.executionRevision), requestId: "after-expiry", phase: "subagent_turn" })).rejects.toThrow("parent");
    const settled = await f.store.settleSubagentChildInvocation({ ...fence(child, reserved.executionRevision), invocationId: reserved.invocationId, payload: {}, usage });
    await expect(f.store.finishSubagentChildRun({ ...fence(child, settled.executionRevision), finish: { status: "completed", stopReason: "completed" } })).rejects.toThrow("parent");
    const cancelled = await f.store.finishSubagentChildRun({ ...fence(child, settled.executionRevision), finish: { status: "cancelled", stopReason: "cancelled" } });
    expect(cancelled.run.usage).toEqual(usage);
    expect(cancelled.events?.map((event) => event.type)).toEqual(["run.cancelled"]);
  });

  it("commits captured request and canonical response atomically and publishes only new events", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    expect(child.events?.map((event) => event.type)).toEqual(["run.started"]);
    const reserved = await f.store.reserveSubagentChildInvocation({ ...fence(child), requestId: "captured", phase: "subagent_turn" });
    const envelope = createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: "System", messages: [{ role: "user", content: "Hello" }], tools: [] });
    const adapter = modelAdapterReceipt({ api: "openai-responses", maxTokens: 4_096 }) as unknown as JsonObject;
    const input = { ...fence(child, reserved.executionRevision), invocationId: reserved.invocationId, payload: {}, usage, capture: { envelope, adapter } };
    const db = new DatabaseSync(path.join(f.options.dataRoot, LEDGER_DATABASE_FILENAME));
    try { db.exec("CREATE TRIGGER fail_child_response BEFORE INSERT ON ledger_events WHEN NEW.event_type = 'model.response' BEGIN SELECT RAISE(ABORT, 'injected response failure'); END"); }
    finally { db.close(); }
    await expect(f.store.settleSubagentChildInvocation(input)).rejects.toThrow("injected response failure");
    const events = await f.store.listRunEvents(child.run.id);
    expect(events.some((event) => ["context.model_envelope", "context.model_adapter", "model.response"].includes(event.type))).toBe(false);
    expect(f.store.listSubagentTasks(f.thread.id)[0]?.usage).toEqual(emptyUsage());
    const db2 = new DatabaseSync(path.join(f.options.dataRoot, LEDGER_DATABASE_FILENAME));
    try { db2.exec("DROP TRIGGER fail_child_response"); } finally { db2.close(); }
    const settled = await f.store.settleSubagentChildInvocation(input);
    expect(settled.events?.map((event) => event.type)).toEqual(["context.model_envelope", "context.model_adapter", "model.response"]);
    expect((await f.store.settleSubagentChildInvocation(input)).events).toBeUndefined();
    await expect(f.store.settleSubagentChildInvocation({ ...input, capture: { envelope } })).rejects.toThrow("conflicts");
    await expect(f.store.settleSubagentChildInvocation({ ...input, payload: { modelContextEnvelopeTurnIndex: 8 } })).rejects.toThrow("conflicts");
    expect((await f.store.listRunEvents(child.run.id)).some((event) => event.type === "context.model_invocation")).toBe(false);
  });

  it("exports reservation-backed capture gaps without renumbering or inventing known usage", async () => {
    const f = await fixture(); const child = await f.store.startSubagentChildRun(f.start);
    const missing = await f.store.reserveSubagentChildInvocation({ ...fence(child), requestId: "missing-capture", phase: "subagent_turn" });
    const second = await f.store.reserveSubagentChildInvocation({ ...fence(child, missing.executionRevision), requestId: "fallback", phase: "subagent_turn" });
    const envelope = createModelContextEnvelopeReceipt({ turnIndex: 1, systemPrompt: "System", messages: [{ role: "user", content: "Hello" }], tools: [] });
    const settled = await f.store.settleSubagentChildInvocation({ ...fence(child, second.executionRevision), invocationId: second.invocationId, payload: {}, usage, capture: { envelope } });
    const third = await f.store.reserveSubagentChildInvocation({ ...fence(child, settled.executionRevision), requestId: "adapter-recovered", phase: "typed_repair" });
    const last = await f.store.settleSubagentChildInvocation({ ...fence(child, third.executionRevision), invocationId: third.invocationId, payload: {}, usage, capture: {
      envelope: createModelContextEnvelopeReceipt({ turnIndex: 2, systemPrompt: "System", messages: [], tools: [] }),
      adapter: modelAdapterReceipt({ api: "openai-responses", maxTokens: 4_096 }) as unknown as JsonObject,
    } });
    await f.store.finishSubagentChildRun({ ...fence(child, last.executionRevision), finish: { status: "failed", stopReason: "error", error: "first call has unknown usage" } });
    const bundle = createThreadReplayBundle(await f.store.getDetail(f.thread.id));
    expect(() => validateThreadReplayBundle(bundle)).not.toThrow();
    const imported = await f.store.importThreadReplayBundle(bundle);
    expect(imported.runs.find((run) => run.source === "subagent")).toMatchObject({ usageStatus: "incomplete", usage: Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, value * 2])) });
    const reexported = createThreadReplayBundle(imported);
    expect(() => validateThreadReplayBundle(reexported)).not.toThrow();
    expect(reexported.events.find((event) => event.type === "context.model_envelope")?.payload).toMatchObject({ turnIndex: 1 });
    const altered = structuredClone(bundle);
    const reservation = altered.events.find((event) => event.type === "subagent.child.invocation_reserved")!;
    (reservation.payload as JsonObject)["invocationIndex"] = 2;
    expect(() => validateThreadReplayBundle(altered)).toThrow("reservation");
    const alteredCapture = structuredClone(bundle);
    const response = alteredCapture.events.find((event) => event.type === "model.response")!;
    (response.payload as JsonObject)["childCaptureSha256"] = "0".repeat(64);
    expect(() => validateThreadReplayBundle(alteredCapture)).toThrow("capture hash");
  });

});
