import { rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyUsage } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/store.js";
import { canonicalJson } from "../src/ed25519.js";
import { issueModelUndispatchedDriverProof } from "../src/model-call-attribution.js";
import { createRunReplaySnapshot } from "../src/run-replay.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";
import { accountingFixture } from "./model-accounting-fixture.js";
import { modelUsageDeliveryIssuer } from "../src/model-usage-delivery.js";
import { normalizeModelPhysicalObservation } from "../src/model-usage-observation.js";
import type { SqliteLedger } from "../src/sqlite-ledger.js";

const fixtures: Awaited<ReturnType<typeof accountingFixture>>[] = [], stores: LocalStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const fixture of fixtures.splice(0)) { fixture.store.close(); fixture.source.close(); await rm(fixture.root, { recursive: true, force: true }); }
});
async function fixture() { const f = await accountingFixture(); fixtures.push(f); return f; }
async function reopen(f: Awaited<ReturnType<typeof fixture>>) {
  const store = new LocalStore(f.options); stores.push(store); await store.initializeAccounting();
  store.modelAccountingRepository.configureSource({ source: f.source }); return store;
}
function counts(f: Awaited<ReturnType<typeof fixture>>) {
  const db = new DatabaseSync(path.join(f.options.dataRoot, "ledger.sqlite"));
  try { return { revision: Number(db.prepare("SELECT revision FROM workspace_state").get()!.revision),
    claims: Number(db.prepare("SELECT count(*) AS n FROM model_usage_claims").get()!.n) }; } finally { db.close(); }
}
function durableDetail(detail: Awaited<ReturnType<LocalStore["getDetail"]>>) {
  return canonicalJson({ thread: detail.thread, runs: detail.runs, subagents: detail.subagents, events: detail.events });
}

describe("native model usage accounting", () => {
  it("retries a stale native claim view without duplicating the receipt or retaining a phantom heap event", async () => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call), other = await reopen(f);
    const ledger = (other as unknown as { requireLedger(): SqliteLedger }).requireLedger();
    const stale = ledger.readModelAttemptView(call.attribution.physicalId);
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    const before = counts(f), saved = durableDetail(await f.store.getDetail(f.thread.id));
    vi.spyOn(ledger, "modelUsageClaim").mockReturnValueOnce(undefined);
    vi.spyOn(ledger, "readModelAttemptView").mockReturnValueOnce(stale);
    expect((await other.modelAccountingRepository.reconcile(physical.delivery)).outcome).toBe("duplicate");
    expect(counts(f)).toEqual(before);
    expect(durableDetail(await other.getDetail(f.thread.id))).toBe(saved);
  });

  it("rejects a conflicting final receipt after a stale view retry and on a stable revision", async () => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call), other = await reopen(f);
    const ledger = (other as unknown as { requireLedger(): SqliteLedger }).requireLedger();
    const stale = ledger.readModelAttemptView(call.attribution.physicalId);
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "model.advisor.independent.reviewed",
      category: "system", payload: { unrelated: true } });
    const observation = normalizeModelPhysicalObservation({ attribution: call.attribution, terminal: "response",
      message: { ...f.fixture.message, usage: { ...f.fixture.message.usage, input: 101, totalTokens: 136 } } });
    expect(() => f.source.record(observation)).toThrow("immutable");
    // Test-only private issuer simulates a contradictory native source; public JSON cannot issue this authority.
    const conflicting = modelUsageDeliveryIssuer(f.source.sourceId, () => ({ sourceId: f.source.sourceId, attribution: call.attribution, observation }))(call.attribution, observation);
    const before = counts(f), saved = durableDetail(await f.store.getDetail(f.thread.id));
    vi.spyOn(ledger, "modelUsageClaim").mockReturnValueOnce(undefined);
    vi.spyOn(ledger, "readModelAttemptView").mockReturnValueOnce(stale);
    await expect(other.modelAccountingRepository.reconcile(conflicting)).rejects.toThrow("Final model accounting claim conflicts");
    await expect(other.modelAccountingRepository.reconcile(conflicting)).rejects.toThrow("Final model accounting claim conflicts");
    expect(counts(f)).toEqual(before); expect(durableDetail(await other.getDetail(f.thread.id))).toBe(saved);
  });

  it("rejects tampered final evidence on a stable revision without retaining an uncommitted projection", async () => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call);
    const observation = { ...physical.observation, contentSha256: "0".repeat(64) };
    const tampered = modelUsageDeliveryIssuer(f.source.sourceId, () => ({ sourceId: f.source.sourceId, attribution: call.attribution, observation }))(call.attribution, observation);
    const before = counts(f), saved = durableDetail(await f.store.getDetail(f.thread.id));
    await expect(f.store.modelAccountingRepository.reconcile(tampered)).rejects.toThrow();
    expect(counts(f)).toEqual(before); expect(durableDetail(await f.store.getDetail(f.thread.id))).toBe(saved);
    expect(f.source.pending()).toHaveLength(1);
    expect((await f.store.modelAccountingRepository.reconcile(physical.delivery)).outcome).toBe("applied");
    expect(counts(f).claims).toBe(1);
  });
  it.each(["receipt_first", "logical_first"])("counts normal identity once with %s and no-write duplicate", async (order) => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call);
    expect(f.fixture.message.usage.input).toBe(100);
    const logical = () => f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "model.response", category: "model",
      payload: { ...call.reference, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 5, costUsd: 0.033 } } });
    if (order === "logical_first") {
      await logical(); expect((await f.store.aggregateRunUsage(f.parent.run.id)).inputTokens).toBe(0);
    }
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    if (order === "receipt_first") await logical();
    expect((await f.store.aggregateRunUsage(f.parent.run.id)).inputTokens).toBe(100);
    const before = counts(f), saved = canonicalJson(f.store.listRuns(f.thread.id));
    const other = await reopen(f);
    expect((await other.modelAccountingRepository.reconcile(physical.delivery)).outcome).toBe("duplicate");
    expect(counts(f)).toEqual(before); expect(canonicalJson(other.listRuns(f.thread.id))).toBe(saved);
    expect((await createRunReplaySnapshot(other, f.thread.id, f.parent.run.id)).metrics.inputTokens).toBe(100);
  });

  it.each(["before_finish", "after_finish"])("does not overwrite late accounting %s", async (order) => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call);
    const stale = await f.store.aggregateRunUsage(f.parent.run.id);
    const finish = () => f.store.finishRun(f.parent.run.id, "cancelled", { leaseToken: f.parent.token, usage: stale,
      outcome: "cancelled", terminalEvent: { payload: { status: "cancelled", usage: stale } } });
    if (order === "before_finish") await f.store.modelAccountingRepository.reconcile(physical.delivery);
    await finish(); const terminal = (await f.store.listRunEvents(f.parent.run.id)).find((event) => event.type === "run.cancelled")!;
    const finishedAt = f.store.listRuns(f.thread.id)[0]!.finishedAt;
    if (order === "after_finish") await f.store.modelAccountingRepository.reconcile(physical.delivery);
    await finish();
    expect(f.store.listRuns(f.thread.id)[0]).toMatchObject({ status: "cancelled", finishedAt, usage: { inputTokens: 100 }, usageStatus: "complete" });
    expect((await f.store.listRunEvents(f.parent.run.id)).filter((event) => event.type === "run.cancelled")).toEqual([terminal]);
  });

  it("atomically upgrades terminal child, Task and parent without logical/history mutation", async () => {
    const f = await fixture(), child = await f.child(), call = await child.prepare(), physical = await f.physical(call);
    const settled = await f.store.settleSubagentChildInvocation({ ...child.fence, expectedExecutionRevision: child.reservation.executionRevision,
      invocationId: child.reservation.invocationId, usageStatus: "unknown", capture: child.capture,
      payload: { ...call.reference, stopReason: "aborted" } });
    const terminal = await f.store.finishSubagentChildRun({ ...child.fence, expectedExecutionRevision: settled.executionRevision,
      finish: { status: "cancelled", stopReason: "cancelled" } });
    await f.store.finishRun(f.parent.run.id, "cancelled", { leaseToken: f.parent.token, usage: emptyUsage() });
    const beforeEvents = await f.store.listRunEvents(child.child.run.id), revision = terminal.task.revision;
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    const task = f.store.listSubagentTasks(f.thread.id)[0]!;
    expect(task).toMatchObject({ status: "cancelled", revision, usageStatus: "complete", usage: { inputTokens: 100 } });
    const run = f.store.listRuns(f.thread.id).find((value) => value.id === child.child.run.id)!;
    expect(run.usage).toEqual(task.usage); expect(run.subagent).toEqual(terminal.run.subagent);
    expect((await f.store.listRunEvents(run.id)).slice(0, beforeEvents.length)).toEqual(beforeEvents);
    expect((await f.store.aggregateRunUsage(f.parent.run.id)).inputTokens).toBe(100);
    expect((await createRunReplaySnapshot(f.store, f.thread.id, f.parent.run.id)).metrics.inputTokens).toBe(100);
    const bundle = createThreadReplayBundle(await f.store.getDetail(f.thread.id));
    expect(() => validateThreadReplayBundle(bundle)).not.toThrow();
    await reopen(f);
  });

  it("requires a logical response even when receipt arrived first and preserves pre-capture zero", async () => {
    const f = await fixture(), child = await f.child(), call = await child.prepare(), physical = await f.physical(call);
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    await expect(f.store.finishSubagentChildRun({ ...child.fence, expectedExecutionRevision: child.reservation.executionRevision,
      finish: { status: "completed", stopReason: "completed" } })).rejects.toThrow("logical response");
    expect(f.store.listSubagentTasks(f.thread.id)[0]!.status).toBe("running");
  });

  it("durably fences a pre-capture child failure without inventing a physical receipt", async () => {
    const f = await fixture(), child = await f.child();
    await f.store.modelAccountingRepository.closeUndispatchedChildInvocation(issueModelUndispatchedDriverProof(child.authority), "capture_failed");
    expect(f.store.listSubagentTasks(f.thread.id)[0]).toMatchObject({ usageStatus: "complete", usage: emptyUsage() });
    await expect(child.prepare()).rejects.toThrow("reservation");
    expect(counts(f).claims).toBe(0); expect(f.source.pending()).toHaveLength(0);
  });

  it("uses an immutable final zero receipt for a prepared but undispatched call", async () => {
    const f = await fixture(), call = await f.main();
    const proof = issueModelUndispatchedDriverProof(call.prepared);
    const first = await f.store.modelAccountingRepository.rejectUndispatched(proof, "aborted_before_entry");
    const before = counts(f);
    expect((await f.store.modelAccountingRepository.rejectUndispatched(proof, "aborted_before_entry")).outcome).toBe("duplicate");
    expect(counts(f)).toEqual(before); expect(first.outcome).toBe("applied");
    expect(f.store.listRuns(f.thread.id)[0]).toMatchObject({ usage: emptyUsage(), usageStatus: "complete" });
  });

  it("commits undispatched claims through the private native path before acknowledging", async () => {
    const f = await fixture(), call = await f.main(), proof = issueModelUndispatchedDriverProof(call.prepared);
    const replacement = vi.spyOn(f.store.modelAccountingRepository, "reconcile").mockImplementation(async () => {
      throw new Error("Public projection replacement must not execute");
    });
    const db = new DatabaseSync(path.join(f.options.dataRoot, "ledger.sqlite"));
    try {
      db.exec("CREATE TRIGGER fail_undispatched_projection BEFORE INSERT ON model_usage_claims BEGIN SELECT RAISE(ABORT,'undispatched projection unavailable'); END");
      await expect(f.store.modelAccountingRepository.rejectUndispatched(proof, "aborted_before_entry")).rejects.toThrow("undispatched projection unavailable");
      expect(f.source.pending()).toHaveLength(1); expect(counts(f).claims).toBe(0);
      db.exec("DROP TRIGGER fail_undispatched_projection");
      await f.store.modelAccountingRepository.rejectUndispatched(proof, "aborted_before_entry");
      expect(f.source.pending()).toHaveLength(0); expect(counts(f).claims).toBe(1);
      expect(replacement).not.toHaveBeenCalled();
    } finally { db.exec("DROP TRIGGER IF EXISTS fail_undispatched_projection"); db.close(); replacement.mockRestore(); }
  });

  it("rejects copied delivery/owner authority and foreign Store projection", async () => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call), other = await fixture();
    await expect(f.store.modelAccountingRepository.reconcile({ ...physical.delivery })).rejects.toThrow("authority");
    await expect(other.store.modelAccountingRepository.reconcile(physical.delivery)).rejects.toThrow("source");
    await expect(f.store.modelAccountingRepository.prepare({ owner: {} as never, phase: "agent_turn", method: "streamSimple",
      logicalCallId: "forged", model: f.fixture.model, capture: f.fixture.attribution.capture })).rejects.toThrow("authority");
    await expect(f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id,
      type: "model.usage.reconciled", category: "model", payload: {} })).rejects.toThrow("authority");
    expect(counts(f).claims).toBe(0);
  });

  it("rolls back claim, event and snapshot together while source evidence remains pending", async () => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call);
    const db = new DatabaseSync(path.join(f.options.dataRoot, "ledger.sqlite"));
    db.exec("CREATE TRIGGER reject_accounting_claim BEFORE INSERT ON model_usage_claims BEGIN SELECT RAISE(ABORT, 'forced accounting rollback'); END");
    try { await expect(f.store.modelAccountingRepository.reconcile(physical.delivery)).rejects.toThrow("forced accounting rollback"); }
    finally { db.exec("DROP TRIGGER reject_accounting_claim"); db.close(); }
    expect(counts(f).claims).toBe(0);
    expect((await f.store.listRunEvents(f.parent.run.id)).some((event) => event.type === "model.usage.reconciled")).toBe(false);
    expect(f.source.pending()).toHaveLength(1);
    const second = await reopen(f);
    const results = await Promise.all([f.store.modelAccountingRepository.reconcile(physical.delivery), second.modelAccountingRepository.reconcile(physical.delivery)]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["applied", "duplicate"]);
    expect(counts(f).claims).toBe(1);
  });
});
