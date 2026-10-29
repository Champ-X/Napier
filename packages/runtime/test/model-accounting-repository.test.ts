import { rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyUsage } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStore } from "../src/store.js";
import { canonicalJson } from "../src/ed25519.js";
import { issueModelUndispatchedDriverProof } from "../src/model-call-attribution.js";
import { createRunReplaySnapshot } from "../src/run-replay.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";
import { accountingFixture } from "./model-accounting-fixture.js";

const fixtures: Awaited<ReturnType<typeof accountingFixture>>[] = [], stores: LocalStore[] = [];
afterEach(async () => {
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

describe("native model usage accounting", () => {
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
