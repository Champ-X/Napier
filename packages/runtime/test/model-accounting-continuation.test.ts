import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { JsonObject } from "@napier/contracts";
import { LocalStore } from "../src/store.js";
import { SubagentChildExecution } from "../src/subagent-child-execution.js";
import { ModelUsageReceiptSpool } from "../src/model-usage-source.js";
import { issueModelUndispatchedDriverProof, readPreparedModelCall } from "../src/model-call-attribution.js";
import { normalizeModelPhysicalObservation } from "../src/model-usage-observation.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { modelUsageFixture } from "./model-usage-fixture.js";
import { continuationRunnerFixture, cleanupContinuationRunnerFixtures } from "./subagent-continuation-runner-fixture.js";

const sources: ModelUsageReceiptSpool[] = [], stores: LocalStore[] = [], children: SubagentChildExecution[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.dispose();
  for (const store of stores.splice(0)) store.close();
  for (const source of sources.splice(0)) source.close();
  await cleanupContinuationRunnerFixtures();
});

it("attributes a cancelled successor's late usage to its recovery parent and preserves the exact predecessor", async () => {
  const f = await continuationRunnerFixture();
  const source = await ModelUsageReceiptSpool.open(path.join(f.dataRoot, "model-usage.sqlite")); sources.push(source);
  f.sourceStore.modelAccountingRepository.configureSource({ source });
  const priorInvocation = await f.child.reserve("subagent_turn");
  const priorAuthority = f.child.accountingForInvocation(priorInvocation)!;
  await f.sourceStore.modelAccountingRepository.closeUndispatchedChildInvocation(
    issueModelUndispatchedDriverProof(priorAuthority.owner), "capture_failed");
  const ready = await f.interruptAndClaim();
  ready.store.modelAccountingRepository.configureSource({ source });
  const child = new SubagentChildExecution(ready.store, ready.continuation.execution); children.push(child);
  const predecessor = canonicalJson({ run: ready.sourceRun, task: ready.sourceTask, parent: ready.sourceParent });
  const invocation = await child.reserve("subagent_turn"), accounting = child.accountingForInvocation(invocation)!;
  const fixture = modelUsageFixture({ model: f.model });
  const prepared = await ready.store.modelAccountingRepository.prepare({ owner: accounting.owner,
    logicalCallId: accounting.logicalCallId, method: "streamSimple", phase: "subagent_turn", model: f.model,
    capture: fixture.attribution.capture });
  const attribution = readPreparedModelCall(prepared).attribution;
  await ready.store.modelAccountingRepository.enter(prepared); source.reserve(attribution);
  source.record(normalizeModelPhysicalObservation({ attribution, terminal: "response", message: fixture.message }));
  await child.settle(invocation.invocationId, { physicalId: attribution.physicalId, attributionSha256: attribution.contentSha256,
    accountingMode: "physical_receipt_v1", stopReason: "aborted" }, undefined,
    { envelope: fixture.attribution.capture.envelope, adapter: JSON.parse(canonicalJson(fixture.attribution.capture.adapter)) as JsonObject });
  await ready.store.finishSubagentChildRun({ runId: child.run.id, taskId: child.task.id, executionId: child.task.executionId!,
    token: ready.continuation.execution.token, expectedExecutionRevision: child.run.subagent!.executionRevision,
    finish: { status: "cancelled", stopReason: "cancelled" } });
  await ready.store.finishRun(ready.target.run.id, "cancelled", { leaseToken: ready.target.token });
  await ready.store.modelAccountingRepository.reconcile(source.pending({ physicalId: attribution.physicalId })[0]!);
  const runs = ready.store.listRuns(f.thread.id), tasks = ready.store.listSubagentTasks(f.thread.id);
  expect(canonicalJson({ run: runs.find((run) => run.id === ready.sourceRun.id),
    task: tasks.find((task) => task.id === ready.sourceTask.id), parent: runs.find((run) => run.id === ready.sourceParent.id) })).toBe(predecessor);
  expect(runs.find((run) => run.id === child.run.id)!.usage.inputTokens).toBe(100);
  expect(runs.find((run) => run.id === ready.target.run.id)!.usage.inputTokens).toBe(100);
  validateThreadReplayBundle(createThreadReplayBundle(await ready.store.getDetail(f.thread.id)));
  const reopened = new LocalStore(f); stores.push(reopened); await reopened.initializeAccounting();
  expect((await reopened.aggregateRunUsage(ready.target.run.id)).inputTokens).toBe(100);
});

it("does not advertise continuation when frozen estimated cost exhausted the source budget", async () => {
  const f = await continuationRunnerFixture({ runLimits: { maxCostUsd: 0.01, maxTotalTokens: 1_000_000 } });
  const source = await ModelUsageReceiptSpool.open(path.join(f.dataRoot, "model-usage.sqlite")); sources.push(source);
  f.sourceStore.modelAccountingRepository.configureSource({ source });
  const invocation = await f.child.reserve("subagent_turn"), accounting = f.child.accountingForInvocation(invocation)!;
  const model = { ...f.model, provider: "deepseek", id: "deepseek-chat" }, fixture = modelUsageFixture({ model });
  const prepared = await f.sourceStore.modelAccountingRepository.prepare({ owner: accounting.owner,
    logicalCallId: accounting.logicalCallId, method: "streamSimple", phase: "subagent_turn", model, capture: fixture.attribution.capture });
  const attribution = readPreparedModelCall(prepared).attribution;
  await f.sourceStore.modelAccountingRepository.enter(prepared); source.reserve(attribution);
  const message = { ...fixture.message, usage: { ...fixture.message.usage, input: 100_000, totalTokens: 100_035,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  source.record(normalizeModelPhysicalObservation({ attribution, terminal: "response", message }));
  await f.sourceStore.modelAccountingRepository.reconcile(source.pending()[0]!);
  await f.child.settle(invocation.invocationId, { physicalId: attribution.physicalId, attributionSha256: attribution.contentSha256,
    accountingMode: "physical_receipt_v1", responseSha256: sha256(canonicalJson(message)), stopReason: message.stopReason }, undefined,
    { envelope: fixture.attribution.capture.envelope, adapter: JSON.parse(canonicalJson(fixture.attribution.capture.adapter)) as JsonObject });
  await f.child.progress({ turnDelta: 1, stepDelta: 1 }); f.messages.push(message);
  await f.accept("Continue with additional verification.");
  const recovered = await f.interrupt();
  const target = await recovered.store.createLeasedRun({ threadId: f.thread.id, agentId: f.profile.id, source: "recovery", parentRunId: f.parent.run.id },
    { ownerId: `process:${process.pid}:budget_recovery`, ttlMs: 60_000 });
  await recovered.store.appendEvent({ threadId: f.thread.id, runId: target.run.id, type: "run.recovery.started", category: "lifecycle",
    payload: { parentRunId: f.parent.run.id, mode: "manual", purpose: "continuation" } });
  expect(recovered.sourceRun.usage.costUsd).toBe(0);
  expect(recovered.sourceRun.accounting!.knownBudgetCostUsd).toBeGreaterThan(0.01);
  expect(await recovered.store.prepareSubagentChildContinuation({ sourceTaskId: f.task.id, targetParentRunId: target.run.id }))
    .toEqual({ kind: "unavailable", reason: "budget_exhausted" });
});
