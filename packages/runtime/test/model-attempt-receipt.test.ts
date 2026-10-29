import { rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyUsage } from "@napier/contracts";
import { readPreparedModelCall, issueModelUndispatchedDriverProof } from "../src/model-call-attribution.js";
import { normalizeModelPhysicalObservation } from "../src/model-usage-observation.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { accountingFixture } from "./model-accounting-fixture.js";

const fixtures: Awaited<ReturnType<typeof accountingFixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) { f.store.close(); f.source.close(); await rm(f.root, { recursive: true, force: true }); }
});
async function fixture() { const f = await accountingFixture(); fixtures.push(f); return f; }
function reference(call: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["main"]>>) {
  return { owner: readPreparedModelCall(call.prepared).authority, physicalId: call.attribution.physicalId,
    attributionSha256: call.attribution.contentSha256 };
}

describe("exact native model attempt receipt", () => {
  it("distinguishes prepared, source-only and durable receipt without inferring readiness from an empty outbox", async () => {
    const f = await fixture(), call = await f.main(), ref = reference(call), repository = f.store.modelAccountingRepository;
    expect(f.source.pending()).toHaveLength(0);
    expect(repository.readAttemptReceipt(ref)).toMatchObject({ state: "pending" });
    const physical = await f.physical(call);
    expect(repository.readAttemptReceipt(ref)).toMatchObject({ state: "pending" });
    await repository.reconcile(physical.delivery);
    const view = repository.readAttemptReceipt(ref);
    expect(view).toMatchObject({ state: "known", usageStatus: "known", receiptSha256: physical.observation.contentSha256 });
    // The receipt read is evidence, not an ACK or an invocation capability.
    expect(f.source.pending()).toHaveLength(1);
    f.source.acknowledge(physical.delivery);
    expect(f.source.pending()).toHaveLength(0);
    expect(repository.readAttemptReceipt(ref)).toEqual(view);
  });

  it.each(["partial", "unknown"] as const)("returns immutable final %s without claiming retry readiness", async (status) => {
    const f = await fixture(), call = await f.main(), repository = f.store.modelAccountingRepository;
    await repository.enter(call.prepared); f.source.reserve(call.attribution);
    const message = { ...f.fixture.message, stopReason: "error", errorMessage: "context_length_exceeded",
      ...(status === "unknown" ? { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } : {}) };
    const observation = normalizeModelPhysicalObservation({ attribution: call.attribution, message, terminal: "response" });
    f.source.record(observation);
    const delivery = f.source.pending({ physicalId: call.attribution.physicalId })[0]!;
    await repository.reconcile(delivery); f.source.acknowledge(delivery);
    expect(repository.readAttemptReceipt(reference(call))).toMatchObject({ state: "incomplete", usageStatus: status,
      receiptSha256: observation.contentSha256 });
  });

  it("identifies a proof-backed undispatched zero separately", async () => {
    const f = await fixture(), call = await f.main();
    await f.store.modelAccountingRepository.rejectUndispatched(issueModelUndispatchedDriverProof(call.prepared), "capture_rejected");
    expect(f.store.modelAccountingRepository.readAttemptReceipt(reference(call))).toMatchObject({ state: "undispatched", usageStatus: "known_zero_undispatched" });
  });

  it("keeps an old child attempt readable after logical settlement and terminal fencing without authorizing another call", async () => {
    const f = await fixture(), child = await f.child(), call = await child.prepare(), physical = await f.physical(call);
    const repository = f.store.modelAccountingRepository;
    await repository.reconcile(physical.delivery);
    const settled = await f.store.settleSubagentChildInvocation({ ...child.fence,
      expectedExecutionRevision: child.reservation.executionRevision, invocationId: child.reservation.invocationId,
      capture: child.capture, usage: emptyUsage(), payload: { ...call.reference, stopReason: "aborted" } });
    expect(repository.readAttemptReceipt(reference(call))).toMatchObject({ state: "known" });
    await f.store.finishSubagentChildRun({ ...child.fence, expectedExecutionRevision: settled.executionRevision,
      finish: { status: "cancelled", stopReason: "cancelled" } });
    expect(repository.readAttemptReceipt(reference(call))).toMatchObject({ state: "known" });
    await expect(child.prepare()).rejects.toThrow();
  });

  it("rejects copied authority, another repository, another owner and a mismatched exact attempt hash", async () => {
    const f = await fixture(), call = await f.main(), other = await fixture(), child = await f.child();
    const ref = reference(call), repository = f.store.modelAccountingRepository;
    expect(() => repository.readAttemptReceipt({ ...ref, owner: { ...ref.owner } })).toThrow("native owner authority");
    expect(() => other.store.modelAccountingRepository.readAttemptReceipt(ref)).toThrow("native owner authority");
    expect(() => repository.readAttemptReceipt({ ...ref, owner: child.authority })).toThrow("owner, source or attribution");
    expect(() => repository.readAttemptReceipt({ ...ref, attributionSha256: "0".repeat(64) })).toThrow("owner, source or attribution");
  });

  it("does not accept another child invocation's authority under the same parent", async () => {
    const f = await fixture(), first = await f.child(), call = await first.prepare(), second = await f.child();
    expect(() => f.store.modelAccountingRepository.readAttemptReceipt({ ...reference(call), owner: second.authority }))
      .toThrow("owner, source or attribution");
    expect(f.store.modelAccountingRepository.readAttemptReceipt(reference(call)).state).toBe("pending");
  });

  it.each(["source_root", "source_id", "claim_hash", "claim_event"] as const)("rejects corrupted %s evidence instead of returning known", async (field) => {
    const f = await fixture(), call = await f.main(), physical = await f.physical(call);
    await f.store.modelAccountingRepository.reconcile(physical.delivery);
    const ref = reference(call);
    const database = new DatabaseSync(path.join(f.options.dataRoot, "ledger.sqlite"));
    try {
      if (field === "source_root") database.prepare("UPDATE model_call_attributions SET data_root_sha256 = ? WHERE physical_id = ?")
        .run("0".repeat(64), call.attribution.physicalId);
      if (field === "source_id") {
        const { contentSha256: _hash, ...content } = { ...call.attribution, receiptSourceId: "source_other_receipts" };
        const changed = { ...content, contentSha256: sha256(canonicalJson(content)) };
        database.prepare("UPDATE model_call_attributions SET attribution_sha256 = ?, attribution_json = ? WHERE physical_id = ?")
          .run(changed.contentSha256, canonicalJson(changed), call.attribution.physicalId);
        ref.attributionSha256 = changed.contentSha256;
      }
      if (field === "claim_hash") database.prepare("UPDATE model_usage_claims SET receipt_sha256 = ? WHERE physical_id = ?")
        .run("0".repeat(64), call.attribution.physicalId);
      if (field === "claim_event") database.prepare("UPDATE model_usage_claims SET event_id = (SELECT event_id FROM ledger_events ORDER BY seq LIMIT 1) WHERE physical_id = ?")
        .run(call.attribution.physicalId);
      expect(() => f.store.modelAccountingRepository.readAttemptReceipt(ref)).toThrow("Model attempt receipt");
    } finally { database.close(); }
  });
});
