import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { LocalStore } from "../src/store.js";
import { LEDGER_DATABASE_FILENAME, type SqliteLedger } from "../src/sqlite-ledger.js";
import { childParentAuthorityLost } from "../src/sqlite-child-parent-loss.js";
import { effectIndeterminateEventPayload } from "../src/tool-effect-indeterminate-event.js";
import { LiveToolEffectAuthorityError } from "../src/sqlite-tool-effect-authority.js";
import { authorizeSubagentChildRun } from "../src/subagent-child-authorization.js";
import type { StartedSubagentChildRun } from "../src/subagent-child-run-types.js";
import { DurableToolOperationJournal, ToolOperationFencingError } from "../src/tool-operation-journal.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function openStore(options: ConstructorParameters<typeof LocalStore>[0]) {
  const store = new LocalStore(options);
  stores.push(store);
  await store.initialize();
  return store;
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-child-effect-fence-"));
  roots.push(root);
  const options = { dataRoot: path.join(root, "data"), workspaceRoot: path.join(root, "workspace") };
  await mkdir(options.workspaceRoot);
  const store = await openStore(options);
  const limits = { maxConcurrent: 1, maxTotal: 2, maxTurns: 4, timeoutMs: 10_000 };
  const profile = await store.updateAgent(store.listAgents()[0]!.id, {
    enabledSubagents: ["reviewer"], subagentLimits: limits,
  });
  const thread = await store.createThread({ agentId: profile.id, title: "Child effect authority" });
  const lease = { ownerId: `process:${process.pid}:child_effect_test`, ttlMs: 60_000 };
  const parent = await store.createLeasedRun({ threadId: thread.id, agentId: profile.id, source: "user" }, lease);
  const task = await store.createSubagentTask({
    threadId: thread.id, runId: parent.run.id, role: "reviewer",
    description: "Inspect child effect authority", prompt: "Inspect the durable effect without replaying it.",
    model: profile.model, providerId: "in_process", executionId: "subexec_effecttest",
  });
  const child = await store.startSubagentChildRun({
    taskId: task.id, executionId: task.executionId!, lease,
    authorization: authorizeSubagentChildRun({
      parentRun: parent.run, parentProfile: profile, taskId: task.id, executionId: task.executionId!, limits,
    }),
  });
  return { store, options, thread, parent, child };
}

function fence(child: StartedSubagentChildRun) {
  return { runId: child.run.id, taskId: child.task.id, executionId: child.task.executionId!,
    token: child.token, expectedExecutionRevision: child.executionRevision };
}

function operation(store: LocalStore, child: StartedSubagentChildRun, ownerId = "child_effect_owner") {
  return new DurableToolOperationJournal(store,
    { threadId: child.run.threadId, runId: child.run.id },
    { executionLease: { ownerId, durationMs: 30_000 } },
  ).observer("call_child_effect").operation({
    role: "execution_authority", ordinal: 1, mode: "mutation", route: "fixture",
    operation: "mutate", scope: "workspace", contribution: "product",
    resourceKey: { workspace: "child-effect-fixture" }, failureDomainKey: { tool: "fixture" },
  });
}

function expireParent(options: { dataRoot: string }, runId: string) {
  const database = new DatabaseSync(path.join(options.dataRoot, LEDGER_DATABASE_FILENAME));
  try {
    database.prepare("UPDATE run_leases SET acquired_at = ?, heartbeat_at = ?, expires_at = ? WHERE run_id = ?")
      .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", "2000-01-01T00:01:00.000Z", runId);
  } finally { database.close(); }
}

describe("subagent child tool effect terminal authority", () => {
  it.each(["completed", "cancelled"] as const)("blocks atomic child %s until live effect authority settles", async (status) => {
    const f = await fixture();
    const effect = operation(f.store, f.child);
    await effect.admit();
    await effect.started();
    await effect.effectBoundary();
    const terminalStore = await openStore(f.options);
    const finish = { ...fence(f.child), finish: { status, stopReason: status } };

    await expect(terminalStore.finishSubagentChildRun(finish)).rejects.toBeInstanceOf(LiveToolEffectAuthorityError);
    expect(terminalStore.listRuns(f.thread.id).find((run) => run.id === f.child.run.id)).toMatchObject({ status: "running" });
    expect(terminalStore.listSubagentTasks(f.thread.id)[0]).toMatchObject({ status: "running", childRunId: f.child.run.id });
    expect((await terminalStore.listRunEvents(f.child.run.id)).some((event) =>
      ["run.completed", "run.cancelled", "run.failed"].includes(event.type))).toBe(false);

    await effect.settled({ outcome: "succeeded", effect: { mutation: "durably-observed" } });
    const finished = await terminalStore.finishSubagentChildRun(finish);
    expect(finished.run.status).toBe(status);
    expect(finished.task.status).toBe(status);
    expect(finished.run.lease).toBeUndefined();
    expect((await terminalStore.listRunEvents(f.child.run.id)).filter((event) => event.type === `run.${status}`)).toHaveLength(1);
    expect(terminalStore.getThread(f.thread.id).currentRunId).toBe(f.parent.run.id);
  });

  it.each(["expired", "terminal"] as const)("preserves an indeterminate child effect with a live child lease and %s parent without replay", async (parentLoss) => {
    const f = await fixture();
    const effect = operation(f.store, f.child);
    await effect.admit();
    await effect.started();
    await effect.effectBoundary();
    if (parentLoss === "expired") expireParent(f.options, f.parent.run.id);
    else await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
    expect(Date.parse(f.store.listRuns(f.thread.id).find((run) => run.id === f.child.run.id)!.lease!.expiresAt)).toBeGreaterThan(Date.now());

    const recovered = await openStore(f.options);
    expect(recovered.listRuns(f.thread.id).find((run) => run.id === f.child.run.id)).toMatchObject({
      status: "failed", outcome: "blocked_safety",
    });
    expect(recovered.listSubagentTasks(f.thread.id)[0]).toMatchObject({ status: "failed", supervisorStatus: "orphaned" });
    const events = await recovered.listRunEvents(f.child.run.id);
    const markerIndex = events.findIndex((event) => event.type === "tool.operation.effect_indeterminate");
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(events.slice(markerIndex, markerIndex + 2).map((event) => event.type)).toEqual([
      "tool.operation.effect_indeterminate", "run.failed",
    ]);
    expect(events.some((event) => event.type === "run.interrupted")).toBe(false);
    expect(events.filter((event) => event.type === "tool.operation.settled")).toHaveLength(0);
    await expect(effect.settled({ outcome: "succeeded", effect: { mutation: "late-claim" } }))
      .rejects.toBeInstanceOf(ToolOperationFencingError);
    await expect(operation(recovered, f.child, "child_replay_owner").admit())
      .resolves.toMatchObject({ admitted: false, disposition: "indeterminate_replay" });
    await expect(recovered.finishSubagentChildRun({ ...fence(f.child), finish: { status: "completed", stopReason: "completed" } }))
      .rejects.toThrow();

    const reopened = await openStore(f.options);
    const replayedEvents = await reopened.listRunEvents(f.child.run.id);
    expect(replayedEvents.filter((event) => event.type === "tool.operation.effect_indeterminate")).toHaveLength(1);
    expect(replayedEvents.filter((event) => event.type === "run.failed")).toHaveLength(1);
    expect(replayedEvents.filter((event) => event.type === "tool.operation.settled")).toHaveLength(0);
  });

  it("rejects a forged parent loss in the proposed snapshot while the durable parent is live", async () => {
    const f = await fixture();
    const effect = operation(f.store, f.child);
    await effect.admit();
    await effect.started();
    await effect.effectBoundary();
    const durable = (f.store as unknown as { ledger: SqliteLedger }).ledger;
    const snapshot = durable.readSnapshot()!;
    const state = JSON.parse(snapshot.stateJson) as { runs: Array<RunRecord & { leaseTokenSha256?: string }> };
    const child = state.runs.find((run) => run.id === f.child.run.id)!;
    const parent = state.runs.find((run) => run.id === f.parent.run.id)!;
    const events = await f.store.listEvents(f.thread.id);
    const boundary = events.findLast((event) => event.runId === child.id &&
      event.type === "tool.operation.lease.renewed" && event.payload && typeof event.payload === "object" &&
      !Array.isArray(event.payload) && event.payload["executionEffectBoundary"] === true)!;
    const timestamp = new Date().toISOString();
    const payload = effectIndeterminateEventPayload({ boundary, run: child, disposition: "run_owner_unavailable", recoveredAt: timestamp });
    const marker: RunEvent = { id: "event_child_forged_loss", threadId: f.thread.id, runId: child.id,
      seq: Math.max(...events.map((event) => event.seq)) + 1, type: "tool.operation.effect_indeterminate",
      category: "tool", visibility: "debug", createdAt: timestamp, payload, schemaVersion: 1 };
    const terminal: RunEvent = { ...marker, id: "event_child_forged_terminal", seq: marker.seq + 1,
      type: "run.failed", category: "lifecycle", payload: { status: "failed", outcome: "blocked_safety",
        reason: "effect_indeterminate", operationIds: [payload.operationId] } };
    child.status = "failed"; child.outcome = "blocked_safety"; child.finishedAt = timestamp;
    parent.status = "cancelled"; parent.finishedAt = timestamp;
    delete child.lease; delete child.leaseTokenSha256;
    delete parent.lease; delete parent.leaseTokenSha256;

    expect(() => durable.commit(snapshot.revision, JSON.stringify(state), [marker, terminal]))
      .toThrow(/owner lease is still preservable/u);
    expect(durable.readSnapshot()!.revision).toBe(snapshot.revision);
    expect((await f.store.listRunEvents(child.id)).some((event) => event.type === marker.type)).toBe(false);
    await effect.settled({ outcome: "succeeded", effect: { mutation: "unchanged-live-authority" } });
  });

  it("requires the durable child Task and configuration binding before using an expired parent", async () => {
    const f = await fixture();
    expireParent(f.options, f.parent.run.id);
    const durable = (f.store as unknown as { ledger: SqliteLedger }).ledger;
    const database = (durable as unknown as { database: DatabaseSync }).database;
    const snapshot = durable.readSnapshot()!;
    expect(childParentAuthorityLost(database, snapshot.stateJson, f.child.run, Date.now())).toBe(true);
    for (const corruption of ["task", "configuration", "parent"] as const) {
      const state = JSON.parse(snapshot.stateJson) as { runs: RunRecord[]; subagents: SubagentTask[] };
      const child = state.runs.find((run) => run.id === f.child.run.id)!;
      if (corruption === "task") state.subagents = [];
      else if (corruption === "configuration") child.subagent!.parentConfigurationSha256 = "0".repeat(64);
      else child.parentRunId = "run_unrelated_parent";
      expect(childParentAuthorityLost(database, JSON.stringify(state), f.child.run, Date.now())).toBe(false);
    }
  });
});
