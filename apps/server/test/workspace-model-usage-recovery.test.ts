import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyUsage } from "@napier/contracts";
import { LocalStore } from "@napier/runtime/store";
import { readEnteredModelCall } from "../../../packages/runtime/dist/model-call-attribution.js";
import { modelUsageFixture } from "../../../packages/runtime/test/model-usage-fixture.js";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceModelAdmission } from "../src/workspace-model-admission.js";
import { resolveWorkspaceRuntimeIdentity } from "../src/workspace-runtime-identity.js";
import { reconcileWorkspaceModelUsage } from "../src/workspace-model-usage-recovery.js";
import { admissionModel, measuredMessage } from "./workspace-model-admission-fixture.js";

const roots: string[] = [], stores: LocalStore[] = [], admissions: WorkspaceModelAdmission[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const admission of admissions.splice(0)) admission.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "napier-host-usage-recovery-")); roots.push(root);
  const workspaceRoot = path.join(root, "workspace"), dataRoot = path.join(root, "data"), stateHome = path.join(root, "host");
  await mkdir(workspaceRoot);
  const identity = await resolveWorkspaceRuntimeIdentity(workspaceRoot, dataRoot);
  const admission = await WorkspaceModelAdmission.open(stateHome); admissions.push(admission);
  const options = { workspaceRoot: identity.root, dataRoot: identity.dataRoot };
  const store = new LocalStore(options); stores.push(store); await store.initialize();
  const source = admission.usageSource(identity.workspaceId);
  store.modelAccountingRepository.configureSource({ source, hostWorkspaceId: identity.workspaceId });
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({ agentId, title: "Usage recovery stays accounting-only" });
  const leased = await store.createLeasedRun({ threadId: thread.id, agentId, source: "user" },
    { ownerId: `process:${process.pid}:host-usage-test`, ttlMs: 60_000 });
  const fixture = modelUsageFixture({ sourceId: source.sourceId, model: structuredClone(admissionModel) });
  fixture.message.usage = structuredClone(measuredMessage().usage);
  expect(fixture.message.usage.totalTokens).toBe(14);
  const prepared = await store.modelAccountingRepository.prepare({
    owner: store.modelAccountingRepository.runAuthority({ runId: leased.run.id, token: leased.token }),
    method: "completeSimple", phase: "agent_turn", logicalCallId: "recovery-fixture", model: fixture.model,
    capture: fixture.attribution.capture,
  });
  const entered = await store.modelAccountingRepository.enter(prepared);
  const attribution = readEnteredModelCall(entered).attribution;
  const physical = admission.forWorkspace(identity.workspaceId).reserve({ method: "completeSimple", model: fixture.model, attribution });
  return { root, identity, options, stateHome, admission, store, source, thread, leased, physical, message: fixture.message };
}
async function openStore(options: ConstructorParameters<typeof LocalStore>[0]) {
  const store = new LocalStore(options); stores.push(store); await store.initializeAccounting(); return store;
}
async function cancel(f: Awaited<ReturnType<typeof setup>>) {
  return f.store.finishRun(f.leased.run.id, "cancelled", { leaseToken: f.leased.token, usage: emptyUsage(),
    terminalEvent: { payload: { status: "cancelled", reason: "logical abort before physical usage" } } });
}

describe("nonexecuting host usage recovery", () => {
  it("projects a late source receipt into a closed terminal workspace without changing execution history", async () => {
    const f = await setup(), terminal = await cancel(f);
    const terminalEvents = (await f.store.listRunEvents(terminal.id)).filter((event) => event.type === "run.cancelled");
    f.store.close(); f.physical.settle(f.message); f.admission.close();
    const restarted = await WorkspaceModelAdmission.open(f.stateHome); admissions.push(restarted);
    await reconcileWorkspaceModelUsage(f.identity, restarted);
    const reopened = await openStore(f.options), run = reopened.listRuns(f.thread.id).find((value) => value.id === terminal.id)!;
    expect(run).toMatchObject({ status: "cancelled", finishedAt: terminal.finishedAt, usageStatus: "complete",
      usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.000018 } });
    const events = await reopened.listRunEvents(run.id);
    expect(events.filter((event) => event.type === "run.cancelled")).toEqual(terminalEvents);
    expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(1);
    expect(events.filter((event) => event.type === "model.response" || event.type === "message.assistant")).toHaveLength(0);
    expect(await reopened.aggregateRunUsage(run.id)).toEqual(run.usage);
    expect(restarted.snapshot()).toMatchObject({ budgetInvocations: 1, activeInvocations: 0, chargedTokens: 14, usageProjectionPending: false });
  });

  it("replays a Store-committed receipt after ack failure without another event or accounting revision", async () => {
    const f = await setup(); await cancel(f); f.physical.settle(f.message); f.store.close();
    const db = new DatabaseSync(path.join(f.stateHome, "model-admission.sqlite"));
    try {
      db.exec("CREATE TRIGGER fail_recovery_ack BEFORE UPDATE OF acknowledged_at ON model_usage_receipts BEGIN SELECT RAISE(ABORT, 'ack crash window'); END");
      await expect(reconcileWorkspaceModelUsage(f.identity, f.admission)).rejects.toThrow("requires reconciliation");
      const first = await openStore(f.options), before = first.listRuns(f.thread.id).find((value) => value.id === f.leased.run.id)!;
      const events = await first.listRunEvents(before.id); first.close();
      expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(1);
      expect(f.admission.snapshot()).toMatchObject({ chargedTokens: 120, usageProjectionPending: true });
      db.exec("DROP TRIGGER fail_recovery_ack");
      await reconcileWorkspaceModelUsage(f.identity, f.admission);
      const second = await openStore(f.options);
      expect(second.listRuns(f.thread.id).find((value) => value.id === before.id)).toEqual(before);
      expect(await second.listRunEvents(before.id)).toEqual(events);
      expect(f.admission.snapshot()).toMatchObject({ chargedTokens: 14, usageProjectionPending: false });
    } finally { db.exec("DROP TRIGGER IF EXISTS fail_recovery_ack"); db.close(); }
  });

  it("retains the new usage when a live original Store later finishes with a stale zero snapshot", async () => {
    const f = await setup(); f.physical.settle(f.message);
    await reconcileWorkspaceModelUsage(f.identity, f.admission);
    const terminal = await cancel(f);
    expect(terminal.usage).toMatchObject({ inputTokens: 10, outputTokens: 4, costUsd: 0.000018 });
    expect(terminal.status).toBe("cancelled");
    expect(f.admission.snapshot()).toMatchObject({ budgetInvocations: 1, chargedTokens: 14 });
  });

  it("leaves wrong-ledger receipts pending and does not seed or recover an alternative destination", async () => {
    const f = await setup(); await cancel(f); f.physical.settle(f.message); f.store.close();
    await rename(f.identity.dataRoot, path.join(f.root, "original-data"));
    const replacement = new LocalStore(f.options); stores.push(replacement); await replacement.initialize();
    const before = replacement.listThreads(); replacement.close();
    await expect(reconcileWorkspaceModelUsage(f.identity, f.admission)).rejects.toThrow("another workspace ledger");
    const reopened = await openStore(f.options);
    expect(reopened.listThreads()).toEqual(before);
    expect(f.admission.snapshot()).toMatchObject({ chargedTokens: 120, usageProjectionPending: true });
  });
});
