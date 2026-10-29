import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeModelPhysicalObservation, readVerifiedModelUsageDelivery } from "@napier/runtime/internal";
import { createUndispatchedModelObservation } from "../../../packages/runtime/dist/model-usage-observation.js";
import { modelUsageFixture } from "../../../packages/runtime/test/model-usage-fixture.js";
import { issueModelUndispatchedDriverProof, issueModelUsagePreparationAuthority, issuePreparedModelCall } from "../../../packages/runtime/dist/model-call-attribution.js";
import { WorkspaceModelAdmission } from "../src/workspace-model-admission.js";
import { admissionModel, measuredMessage, workspaceA, workspaceB } from "./workspace-model-admission-fixture.js";

const homes: string[] = [];
const ledgers: WorkspaceModelAdmission[] = [];
async function setup(options: Parameters<typeof WorkspaceModelAdmission.open>[1] = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "napier-host-usage-")); homes.push(home);
  const ledger = await WorkspaceModelAdmission.open(home, options); ledgers.push(ledger);
  return { home, ledger };
}
function invocation(ledger: WorkspaceModelAdmission, workspaceId = workspaceA) {
  const admission = ledger.forWorkspace(workspaceId), source = admission.usageSource!;
  const fixture = modelUsageFixture({ sourceId: source.sourceId, physicalId: randomUUID(), hostWorkspaceId: workspaceId, model: structuredClone(admissionModel) });
  fixture.message.usage = structuredClone(measuredMessage().usage);
  expect(fixture.message.usage.totalTokens).toBe(14);
  return { ...fixture, admission, source,
    request: { method: fixture.attribution.method, model: fixture.model, attribution: fixture.attribution } };
}
function modelUsageUndispatchedProof(attribution: ReturnType<typeof invocation>["attribution"]) {
  // Use the same emitted private authority module as the production host. A
  // source-module WeakMap is deliberately not interchangeable with this one.
  const repository = {};
  const authority = issueModelUsagePreparationAuthority({ repository,
    owner: { kind: "operation", operationId: "host-fixture", operation: "standalone_model_call" } });
  return issueModelUndispatchedDriverProof(issuePreparedModelCall({ repository, authority, attribution }));
}
afterEach(async () => {
  for (const ledger of ledgers.splice(0)) ledger.close();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

describe("host durable model usage source", () => {
  it("atomically persists physical settlement and receipt, retaining debt until projection acknowledgement", async () => {
    const { ledger } = await setup({ maxConcurrent: 1, maxTokens: 120 });
    const call = invocation(ledger), lease = call.admission.reserve(call.request);
    expect(ledger.snapshot()).toMatchObject({ activeInvocations: 1, chargedTokens: 120, usageProjectionPending: false });
    lease.settle(call.message);
    expect(ledger.snapshot()).toMatchObject({ activeInvocations: 0, chargedTokens: 120, observedTokens: 14, usageProjectionPending: true });
    expect(() => call.admission.reserve(invocation(ledger).request)).toThrow(expect.objectContaining({ code: "budget" }));
    const [delivery] = call.source.pending();
    const receipt = readVerifiedModelUsageDelivery(delivery!);
    expect(receipt.attribution).toEqual(call.attribution);
    expect(receipt.observation).toMatchObject({ usageStatus: "known", usage: { totalTokens: 14 } });
    // This source-layer test simulates the consumer ack; Store commit ordering is
    // covered separately by the workspace recovery integration tests.
    call.source.acknowledge(delivery!); call.source.acknowledge(delivery!);
    expect(ledger.snapshot()).toMatchObject({ chargedTokens: 14, observedTokens: 14, usageProjectionPending: false });
    expect(ledger.snapshot().chargedCostUsd).toBeCloseTo(0.000018, 9);
  });

  it("keeps outbox and conservative debt across a host reopen without dispatch", async () => {
    const { home, ledger } = await setup();
    const call = invocation(ledger); call.admission.reserve(call.request).settle(call.message);
    const before = readVerifiedModelUsageDelivery(call.source.pending()[0]!);
    ledger.close();
    const reopened = await WorkspaceModelAdmission.open(home); ledgers.push(reopened);
    const source = reopened.usageSource(workspaceA);
    expect(readVerifiedModelUsageDelivery(source.pending()[0]!)).toEqual(before);
    expect(reopened.snapshot()).toMatchObject({ budgetInvocations: 1, activeInvocations: 0, chargedTokens: 120, usageProjectionPending: true });
    source.acknowledge(source.pending()[0]!);
    expect(reopened.snapshot()).toMatchObject({ budgetInvocations: 1, chargedTokens: 14, usageProjectionPending: false });
  });

  it("rolls back both settlement and outbox on storage failure and retries the immutable original observation", async () => {
    const { home, ledger } = await setup({ maxConcurrent: 1 });
    const call = invocation(ledger), lease = call.admission.reserve(call.request);
    const db = new DatabaseSync(path.join(home, "model-admission.sqlite"));
    try {
      db.exec("CREATE TRIGGER fail_usage_receipt BEFORE INSERT ON model_usage_receipts BEGIN SELECT RAISE(ABORT, 'receipt storage failure'); END");
      expect(() => lease.settle(call.message)).toThrow("receipt storage failure");
      expect(ledger.snapshot()).toMatchObject({ activeInvocations: 1, observedTokens: 0, usageProjectionPending: false });
      expect(() => ledger.close()).toThrow(expect.objectContaining({ code: "accounting" }));
      db.exec("DROP TRIGGER fail_usage_receipt");
      call.message.usage.input = 9_999; call.message.usage.totalTokens = 10_003;
      lease.settle(call.message);
      expect(readVerifiedModelUsageDelivery(call.source.pending()[0]!).observation.usage.totalTokens).toBe(14);
      expect(ledger.snapshot()).toMatchObject({ activeInvocations: 0, observedTokens: 14, chargedTokens: 120 });
    } finally {
      db.exec("DROP TRIGGER IF EXISTS fail_usage_receipt"); db.close();
      lease.settle(call.message);
    }
  });

  it("preserves source and budget state when acknowledgement transaction fails", async () => {
    const { home, ledger } = await setup();
    const call = invocation(ledger); call.admission.reserve(call.request).settle(call.message);
    const delivery = call.source.pending()[0]!, db = new DatabaseSync(path.join(home, "model-admission.sqlite"));
    try {
      db.exec("CREATE TRIGGER fail_usage_ack BEFORE UPDATE OF acknowledged_at ON model_usage_receipts BEGIN SELECT RAISE(ABORT, 'ack failure'); END");
      expect(() => call.source.acknowledge(delivery)).toThrow("ack failure");
      expect(ledger.snapshot()).toMatchObject({ chargedTokens: 120, usageProjectionPending: true });
      db.exec("DROP TRIGGER fail_usage_ack"); call.source.acknowledge(delivery);
      expect(ledger.snapshot()).toMatchObject({ chargedTokens: 14, usageProjectionPending: false });
    } finally { db.exec("DROP TRIGGER IF EXISTS fail_usage_ack"); db.close(); }
  });

  it("persists pre-entry known zero before and after capacity reservation without inventing a physical result", async () => {
    const { ledger } = await setup({ maxConcurrent: 1 });
    const occupied = invocation(ledger), reserved = occupied.admission.reserve(occupied.request);
    const denied = invocation(ledger);
    expect(() => denied.admission.reserve(denied.request)).toThrow(expect.objectContaining({ code: "capacity" }));
    denied.source.reserve(denied.attribution);
    denied.source.record(createUndispatchedModelObservation(denied.attribution, modelUsageUndispatchedProof(denied.attribution)));
    expect(ledger.snapshot()).toMatchObject({ budgetInvocations: 1, activeInvocations: 1, chargedTokens: 120 });
    const zero = createUndispatchedModelObservation(occupied.attribution, modelUsageUndispatchedProof(occupied.attribution));
    occupied.source.record(zero);
    expect(ledger.hasPending(workspaceA)).toBe(false);
    expect(ledger.snapshot()).toMatchObject({ budgetInvocations: 1, activeInvocations: 0, chargedTokens: 120 });
    for (const delivery of occupied.source.pending()) occupied.source.acknowledge(delivery);
    expect(ledger.snapshot()).toMatchObject({ chargedTokens: 0, observedTokens: 0, usageProjectionPending: false });
    expect(() => reserved.settle(occupied.message)).toThrow("immutable");
    // Rejected conflicting late delivery cannot replace the known-zero source.
    expect(occupied.source.attribution(occupied.attribution.physicalId)).toEqual(occupied.attribution);
  });

  it("isolates workspace sources and rejects forged delivery or direct physical-record bypass", async () => {
    const { ledger } = await setup();
    const call = invocation(ledger), other = ledger.usageSource(workspaceB);
    call.source.reserve(call.attribution);
    expect(other.attribution(call.attribution.physicalId)).toBeUndefined();
    expect(() => other.reserve(call.attribution)).toThrow("workspace mismatch");
    expect(() => other.pending({ hostWorkspaceId: workspaceA })).toThrow("workspace mismatch");
    const observation = normalizeModelPhysicalObservation({ attribution: call.attribution, message: call.message, terminal: "response" });
    expect(() => call.source.record(observation)).toThrow("admission lease");
    expect(() => call.source.acknowledge({} as Parameters<typeof call.source.acknowledge>[0])).toThrow("authority");
    expect(ledger.snapshot()).toMatchObject({ budgetInvocations: 0, usageProjectionPending: false });
  });

  it("raises positive overruns immediately and retains unknown debt even after receipt acknowledgement", async () => {
    const { ledger } = await setup({ maxTokens: 1_000 });
    const call = invocation(ledger), lease = call.admission.reserve(call.request);
    call.message.usage.totalTokens = 2_000;
    lease.settle(call.message);
    expect(ledger.snapshot()).toMatchObject({ chargedTokens: 2_000, observedTokens: 2_000, uncertainInvocations: 1 });
    call.source.acknowledge(call.source.pending()[0]!);
    expect(ledger.snapshot()).toMatchObject({ chargedTokens: 2_000, uncertainInvocations: 1, usageProjectionPending: false });
    expect(() => call.admission.reserve(invocation(ledger).request)).toThrow(expect.objectContaining({ code: "budget" }));
  });
});
