import { rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyUsage } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/store.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";
import { issueModelUndispatchedDriverProof, readPreparedModelCall } from "../src/model-call-attribution.js";
import { normalizeModelPhysicalObservation, validateModelCallAttribution, validateModelPhysicalObservation } from "../src/model-usage-observation.js";
import { canonicalJson } from "../src/ed25519.js";
import { accountingFixture } from "./model-accounting-fixture.js";
import { modelUsageFixture } from "./model-usage-fixture.js";

const fixtures: Awaited<ReturnType<typeof accountingFixture>>[] = [], stores: LocalStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const f of fixtures.splice(0)) { f.store.close(); f.source.close(); await rm(f.root, { recursive: true, force: true }); }
});
async function fixture() { const f = await accountingFixture(); fixtures.push(f); return f; }
async function reopen(f: Awaited<ReturnType<typeof fixture>>) {
  const store = new LocalStore(f.options); stores.push(store); await store.initializeAccounting();
  store.modelAccountingRepository.configureSource({ source: f.source }); return store;
}
function nativeCount(f: Awaited<ReturnType<typeof fixture>>) {
  const db = new DatabaseSync(path.join(f.options.dataRoot, "ledger.sqlite"));
  try { return Number(db.prepare("SELECT count(*) AS n FROM model_call_attributions").get()!.n); } finally { db.close(); }
}

describe("model accounting evidence boundaries", () => {
  it("rejects unlinked logical usage before writing while allowing explicit zero diagnostics", async () => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call);
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    const before = await f.store.listRunEvents(f.parent.run.id);
    await expect(f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "model.response", category: "model",
      payload: { usage: { ...emptyUsage(), inputTokens: 1 } } })).rejects.toThrow("physical attribution");
    await expect(f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "model.response", category: "model",
      payload: { modelCallDisposition: "not_dispatched", usage: { ...emptyUsage(), inputTokens: 1 } } })).rejects.toThrow("exact empty usage");
    expect(await f.store.listRunEvents(f.parent.run.id)).toEqual(before);
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "model.advisor.independent.reviewed", category: "system",
      payload: { modelCallDisposition: "not_dispatched", usage: emptyUsage() } });
    expect((await f.store.aggregateRunUsage(f.parent.run.id)).inputTokens).toBe(100);
    await reopen(f);
  });

  it("refreshes child and parent summaries when a second logical reservation is created", async () => {
    const f = await fixture(), child = await f.child(), call = await child.prepare(), physical = await f.physical(call);
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    const settled = await f.store.settleSubagentChildInvocation({ ...child.fence, expectedExecutionRevision: child.reservation.executionRevision,
      invocationId: child.reservation.invocationId, usageStatus: "unknown", capture: child.capture, payload: { ...call.reference } });
    const next = await f.store.reserveSubagentChildInvocation({ ...child.fence, expectedExecutionRevision: settled.executionRevision,
      requestId: "second-call", phase: "subagent_turn" });
    expect(f.store.listSubagentTasks(f.thread.id)[0]!.accounting).toMatchObject({ unresolvedInvocations: 1, usageStatus: "incomplete" });
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).summary.unresolvedInvocations).toBe(1);
    const other = await reopen(f);
    const authority = other.modelAccountingRepository.childAuthority({ ...child.fence, kind: "child", threadId: f.thread.id,
      parentRunId: f.parent.run.id, childInvocationId: next.invocationId, invocationIndex: next.invocationIndex,
      expectedExecutionRevision: next.executionRevision });
    await other.modelAccountingRepository.closeUndispatchedChildInvocation(issueModelUndispatchedDriverProof(authority), "capture_failed");
    expect((await other.modelAccountingRepository.readRunAccounting(f.parent.run.id)).summary.usageStatus).toBe("complete");
  });

  it.each([false, true])("imports immutable history twice without native authority (receipt=%s)", async (receipt) => {
    const f = await fixture(), child = await f.child(), call = await child.prepare(), physical = await f.physical(call);
    await f.store.settleSubagentChildInvocation({ ...child.fence, expectedExecutionRevision: child.reservation.executionRevision,
      invocationId: child.reservation.invocationId, usageStatus: "unknown", capture: child.capture, payload: { ...call.reference } });
    if (receipt) await f.store.modelAccountingRepository.reconcile(physical.delivery);
    const bundle = createThreadReplayBundle(await f.store.getDetail(f.thread.id)), before = nativeCount(f);
    const first = await f.store.importThreadReplayBundle(bundle);
    const twice = await f.store.importThreadReplayBundle(createThreadReplayBundle(first));
    expect(nativeCount(f)).toBe(before);
    for (const imported of [first, twice]) {
      validateThreadReplayBundle(createThreadReplayBundle(imported));
      const run = imported.runs.find((value) => value.source === "subagent")!;
      expect(run.usage.inputTokens).toBe(receipt ? 100 : 0);
      expect(run.usageStatus).toBe(receipt ? "complete" : "incomplete");
      expect(() => f.store.modelAccountingRepository.runAuthority({ runId: run.id, token: f.parent.token })).toThrow("Imported historical");
    }
    if (receipt) {
      const importedAttribution = validateModelCallAttribution((first.events.find((event) => event.type === "model.accounting.prepared")!.payload as Record<string, unknown>).attribution);
      const importedObservation = validateModelPhysicalObservation((first.events.find((event) => event.type === "model.usage.reconciled")!.payload as Record<string, unknown>).observation);
      f.source.reserve(importedAttribution); f.source.record(importedObservation);
      const forgedDelivery = f.source.pending({ physicalId: importedAttribution.physicalId })[0]!;
      await expect(f.store.modelAccountingRepository.reconcile(forgedDelivery)).rejects.toThrow("native workspace/source");
      expect(f.source.pending({ physicalId: importedAttribution.physicalId })).toHaveLength(1);
      expect(nativeCount(f)).toBe(before);
    }
    const native = await f.store.createLeasedRun({ threadId: first.thread.id, agentId: first.thread.agentId },
      { ownerId: `process:${process.pid}:native_after_import`, ttlMs: 60_000 });
    const prepared = await f.store.modelAccountingRepository.prepare({ owner: f.store.modelAccountingRepository.runAuthority({ runId: native.run.id, token: native.token }),
      phase: "agent_turn", method: "completeSimple", logicalCallId: "after-import", model: f.fixture.model, capture: f.fixture.attribution.capture });
    const attribution = readPreparedModelCall(prepared).attribution;
    expect(attribution.owner).toMatchObject({ runId: native.run.id, threadId: first.thread.id });
    await f.store.modelAccountingRepository.rejectUndispatched(issueModelUndispatchedDriverProof(prepared), "test");
    await reopen(f);
  });

  it("retries a Thread export when a receipt commits after its event read", async () => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call), other = await reopen(f);
    const list = f.store.listEvents.bind(f.store);
    const spy = vi.spyOn(f.store, "listEvents").mockImplementationOnce(async (...args) => {
      const events = await list(...args);
      await other.modelAccountingRepository.reconcile(physical.delivery);
      return events;
    });
    const detail = await f.store.getDetail(f.thread.id);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(detail.runs.find((run) => run.id === f.parent.run.id)!.usage.inputTokens).toBe(100);
    validateThreadReplayBundle(createThreadReplayBundle(detail));
  });

  it("retains an estimated cost debit when another prepared call makes completeness unknown", async () => {
    const f = await fixture();
    const profile = await f.store.updateAgent(f.profile.id, { runLimits: { ...f.profile.runLimits!, maxCostUsd: 0.01 } });
    const thread = await f.store.createThread({ agentId: profile.id, title: "Priced budget" });
    const leased = await f.store.createLeasedRun({ threadId: thread.id, agentId: profile.id },
      { ownerId: `process:${process.pid}:priced_budget`, ttlMs: 60_000 });
    const model = { ...f.fixture.model, provider: "deepseek", id: "deepseek-chat" };
    const priced = modelUsageFixture({ model });
    const prepare = () => f.store.modelAccountingRepository.prepare({ owner: f.store.modelAccountingRepository.runAuthority({ runId: leased.run.id, token: leased.token }),
      phase: "agent_turn", method: "completeSimple", logicalCallId: "priced", model, capture: priced.attribution.capture });
    const first = await prepare(); await f.store.modelAccountingRepository.enter(first);
    const attribution = readPreparedModelCall(first).attribution; f.source.reserve(attribution);
    const message = { ...f.fixture.message, provider: model.provider, model: model.id,
      usage: { ...f.fixture.message.usage, input: 100_000, totalTokens: 100_035,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    f.source.record(normalizeModelPhysicalObservation({ attribution, terminal: "response", message }));
    await f.store.modelAccountingRepository.reconcile(f.source.pending({ physicalId: attribution.physicalId })[0]!);
    const second = await prepare();
    const snapshot = await f.store.modelAccountingRepository.readRunAccounting(leased.run.id);
    expect(snapshot.summary.budgetCostUsd).toBeNull();
    expect(snapshot.usage.costUsd).toBe(0); expect(snapshot.knownBudgetCostUsd).toBeGreaterThan(profile.runLimits!.maxCostUsd);
    await expect(f.store.modelAccountingRepository.enter(second)).rejects.toThrow("accounted Run budget");
  });

  it("keeps a final unknown receipt immutable and source evidence pending on replacement", async () => {
    const f = await fixture(), call = await f.main();
    await f.store.modelAccountingRepository.enter(call.prepared); f.source.reserve(call.attribution);
    const unknown = normalizeModelPhysicalObservation({ attribution: call.attribution, terminal: "rejected" });
    f.source.record(unknown); const delivery = f.source.pending()[0]!;
    await f.store.modelAccountingRepository.reconcile(delivery);
    const known = normalizeModelPhysicalObservation({ attribution: call.attribution, terminal: "response", message: f.fixture.message });
    expect(() => f.source.record(known)).toThrow();
    expect(f.source.pending()).toHaveLength(1);
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).summary).toMatchObject({ partialInvocations: 1, usageStatus: "incomplete" });
  });

  it("allows exact receipt duplicates after completion without changing completion proof", async () => {
    const f = await fixture(), child = await f.child(), call = await child.prepare(), physical = await f.physical(call);
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    const settled = await f.store.settleSubagentChildInvocation({ ...child.fence, expectedExecutionRevision: child.reservation.executionRevision,
      invocationId: child.reservation.invocationId, usageStatus: "unknown", capture: child.capture, payload: { ...call.reference } });
    const finish = { status: "completed" as const, stopReason: "completed" as const, result: "ready" };
    const ready = await f.store.prepareSubagentChildCompletion({ ...child.fence, expectedExecutionRevision: settled.executionRevision, finish });
    const completed = await f.store.finishSubagentChildRun({ ...child.fence, expectedExecutionRevision: ready.executionRevision,
      finish: { ...finish, preparedCompletion: ready.prepared } });
    const before = canonicalJson(completed);
    expect((await f.store.modelAccountingRepository.reconcile(physical.delivery)).outcome).toBe("duplicate");
    expect(canonicalJson({ ...completed, task: f.store.listSubagentTasks(f.thread.id)[0] })).toBe(before);
    await reopen(f);
  });
});
