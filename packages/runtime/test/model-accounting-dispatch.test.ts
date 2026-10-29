import { rm } from "node:fs/promises";
import { createAssistantMessageEventStream, fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { completeModelInvocation } from "../src/model-complete-invocation.js";
import { createLocalModelCallAdmission } from "../src/model-call-local-admission.js";
import { drainModelCallAccounting } from "../src/model-call-admission.js";
import { consumeModelCallAttribution, modelAccountingLinkage, modelResultAttribution } from "../src/model-call-attribution.js";
import { accountingFixture } from "./model-accounting-fixture.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { awaitedEventBarrier, cleanupModelSessionFixtures, createModelSessionFixture } from "./subagent-model-session-fixture.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { emptyUsage } from "@napier/contracts";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createRunReplaySnapshot } from "../src/run-replay.js";
import { reviewIndependentModelAdvisorCandidate, projectIndependentModelAdvisorReviews } from "../src/independent-model-advisor.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";

const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); })));
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(cleanup.splice(0).map((close) => close())); await cleanupModelSessionFixtures(); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function scripted(registry: ModelRegistry, provider: ReturnType<typeof fauxProvider>["provider"], messages: AssistantMessage[]) {
  let index = 0;
  const dispatch = vi.fn((model: { api: AssistantMessage["api"]; provider: string; id: string }) => {
    const message = { ...messages[index++]!, api: model.api, provider: model.provider, model: model.id };
    const source = createAssistantMessageEventStream();
    source.push({ type: "done", reason: "stop", message });
    return source;
  });
  registry.registerProvider({ ...provider, stream: dispatch, streamSimple: dispatch });
  return dispatch;
}

async function fixture() {
  const f = await accountingFixture();
  cleanup.push(async () => { await f.store.shutdown(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  const registry = new ModelRegistry(undefined, createLocalModelCallAdmission(f.source), f.store.modelAccountingRepository);
  const faux = fauxProvider({ provider: "accounting-dispatch", models: [{ id: "tiny", maxTokens: 1000 }], tokensPerSecond: 1_000_000 });
  registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "tiny" })!;
  registry.bindRunAccounting(f.parent.run.id, f.parent.token);
  const message: AssistantMessage = { ...f.fixture.message, api: model.api, provider: model.provider, model: model.id,
    content: [{ type: "text", text: "Durable final output" }] };
  return { ...f, registry, faux, model, message };
}

describe("native model dispatch accounting", () => {
  it("persists proof-backed zero when cancellation wins after preparation and before raw entry", async () => {
    const f = await fixture(), abort = new AbortController();
    const dispatch = scripted(f.registry, f.faux.provider, [f.message]);
    const prepare = f.store.modelAccountingRepository.prepare.bind(f.store.modelAccountingRepository);
    vi.spyOn(f.store.modelAccountingRepository, "prepare").mockImplementationOnce(async (input) => {
      const call = await prepare(input); abort.abort(new Error("cancelled during preparation")); return call;
    });
    await expect(completeModelInvocation({ models: f.registry.models, model: f.model, context: f.fixture.context,
      phase: "goal_evaluation", accounting: f.registry.accountingForRun(f.parent.run.id), options: { signal: abort.signal } })).rejects.toThrow("cancelled during preparation");
    expect(dispatch).not.toHaveBeenCalled();
    const events = await f.store.listRunEvents(f.parent.run.id);
    const receipts = events.filter((event) => event.type === "model.usage.reconciled");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.payload).toMatchObject({ observation: { terminal: "undispatched", usageStatus: "known_zero_undispatched" } });
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).usage).toEqual(emptyUsage());
  });

  it("hashes advisor linkage and keeps no-dispatch diagnostic usage out of the native total", async () => {
    const f = await fixture();
    const dispatch = scripted(f.registry, f.faux.provider, [{ ...f.message,
      content: [{ type: "text", text: '{"verdict":"accept","score":95,"risk":"low","issues":[]}' }] }]);
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "model.response", category: "model",
      payload: { text: "A bounded result", model: "candidate/candidate", stopReason: "stop" } });
    const input = { turnSource: "user", turnPrompt: "Answer briefly", candidateText: "A bounded result", candidateModel: { provider: "candidate", id: "candidate" },
      reviewerModel: { provider: f.model.provider, id: f.model.id }, runEvents: await f.store.listRunEvents(f.parent.run.id), accounting: f.registry.accountingForRun(f.parent.run.id) };
    const result = await reviewIndependentModelAdvisorCandidate(f.registry, input);
    expect(result.review.accountingMode).toBe("physical_receipt_v1");
    const event = await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id,
      type: "model.advisor.independent.reviewed", category: "system", payload: JSON.parse(JSON.stringify(result.review)) });
    expect(projectIndependentModelAdvisorReviews([event])).toEqual([result.review]);
    const skipped = await reviewIndependentModelAdvisorCandidate(f.registry, { ...input, candidateModel: input.reviewerModel });
    expect(skipped.review.modelCallDisposition).toBe("not_dispatched");
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id,
      type: "model.advisor.independent.reviewed", category: "system", payload: JSON.parse(JSON.stringify(skipped.review)) });
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).usage.costUsd).toBe(0.033);
    const first = await f.store.importThreadReplayBundle(createThreadReplayBundle(await f.store.getDetail(f.thread.id)));
    const twice = await f.store.importThreadReplayBundle(createThreadReplayBundle(first));
    for (const imported of [first, twice]) {
      validateThreadReplayBundle(createThreadReplayBundle(imported));
      const importedReview = projectIndependentModelAdvisorReviews(imported.events).find((review) => !!review.physicalId)!;
      expect(importedReview).toBeDefined();
      expect(importedReview.contentSha256).not.toBe(result.review.contentSha256);
      expect(importedReview.physicalId).not.toBe(result.review.physicalId);
      expect(importedReview.inputSha256).toBe(result.review.inputSha256);
      expect(importedReview.promptSha256).toBe(result.review.promptSha256);
      expect(importedReview.responseSha256).toBe(result.review.responseSha256);
    }
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("returns a complete-call abort immediately, then accounts the late result once without changing terminal evidence", async () => {
    const f = await fixture(), started = deferred(), source = createAssistantMessageEventStream();
    const dispatch = vi.fn(() => { expect(consumeModelCallAttribution(f.registry.models)).toBeUndefined(); started.resolve(); return source; });
    f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
    const abort = new AbortController();
    const pending = completeModelInvocation({ models: f.registry.models, model: f.model, context: f.fixture.context,
      phase: "goal_evaluation", accounting: f.registry.accountingForRun(f.parent.run.id), options: { signal: abort.signal } });
    await started.promise;
    abort.abort();
    const logical = await pending;
    expect(logical.stopReason).toBe("aborted");
    const attribution = modelResultAttribution(logical)!;
    expect(attribution).toBeDefined();
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "model.response", category: "model", visibility: "debug",
      payload: { ...modelAccountingLinkage(attribution), stopReason: "aborted", usage: emptyUsage() } });
    await f.store.finishRun(f.parent.run.id, "cancelled", { leaseToken: f.parent.token });
    const terminal = structuredClone(f.store.listRuns(f.thread.id).find((run) => run.id === f.parent.run.id)!);
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).summary.unresolvedInvocations).toBe(1);
    source.push({ type: "done", reason: "stop", message: f.message });
    await drainModelCallAccounting(f.registry.models);
    const accounting = await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id);
    expect(accounting.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 5, costUsd: 0.033 });
    expect(accounting.summary.unresolvedInvocations).toBe(0);
    expect(f.store.listRuns(f.thread.id).find((run) => run.id === f.parent.run.id)!).toMatchObject({ status: terminal.status, finishedAt: terminal.finishedAt });
    const events = await f.store.listRunEvents(f.parent.run.id);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(1);
    expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(f.source.pending()).toHaveLength(0);
  });

  it("keeps a real main Run logically cancelled while its ignored-abort provider receipt updates usage", async () => {
    const f = await fixture(), started = deferred(), source = createAssistantMessageEventStream();
    const dispatch = vi.fn(() => { started.resolve(); return source; });
    f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
    await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
    const runtime = processReadyAgentRuntime(f.store, f.registry), abort = new AbortController();
    const pending = runtime.runPrompt({ threadId: f.thread.id, text: "Return one short result.", model: { provider: f.model.provider, id: f.model.id }, signal: abort.signal });
    await Promise.race([started.promise, pending.then((run) => { throw new Error(`Run ended before dispatch: ${JSON.stringify(run)}`); })]); abort.abort();
    const result = await pending;
    expect(result.status).toBe("cancelled");
    const before = await f.store.listRunEvents(result.id);
    const logical = before.filter((event) => event.type === "model.response");
    expect(logical).toHaveLength(1);
    expect(logical[0]?.payload).toMatchObject({ accountingMode: "physical_receipt_v1", stopReason: "aborted" });
    source.push({ type: "done", reason: "stop", message: f.message });
    await drainModelCallAccounting(f.registry.models);
    const after = await f.store.listRunEvents(result.id);
    expect(after.filter((event) => event.type !== "model.usage.reconciled")).toEqual(before);
    expect((await f.store.modelAccountingRepository.readRunAccounting(result.id)).usage.costUsd).toBe(0.033);
    expect(f.store.listRuns(f.thread.id).find((run) => run.id === result.id)!?.status).toBe("cancelled");
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("retains a cancelled child's output fences while late usage reaches child, Task and parent exactly once", async () => {
    const f = await createModelSessionFixture({ nativeAccounting: true }), started = deferred(), source = createAssistantMessageEventStream();
    const dispatch = vi.fn(() => { started.resolve(); return source; });
    f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
    const handle = await f.supervisor.start(f.request());
    await started.promise; f.parent.abort();
    const logical = await f.supervisor.collect(handle);
    expect(logical.task.status).toBe("cancelled");
    const taskBefore = structuredClone(logical.task);
    const child = f.store.listRuns(f.thread.id).find((run) => run.subagent?.taskId === logical.task.id)!;
    const before = await f.store.listRunEvents(child.id);
    const message = { role: "assistant", api: f.model.api, provider: f.model.provider, model: f.model.id,
      content: [{ type: "text", text: "late uncommitted output" }], stopReason: "stop", timestamp: Date.now(),
      usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 135, cost: { input: 0.01, output: 0.02, cacheRead: 0.002, cacheWrite: 0.001, total: 0.033 } } } as AssistantMessage;
    source.push({ type: "done", reason: "stop", message });
    await drainModelCallAccounting(f.registry.models);
    const settled = (await f.supervisor.collect(handle)).task;
    expect(settled).toMatchObject({ status: taskBefore.status, revision: taskBefore.revision });
    expect(settled.output).toBeUndefined(); expect(settled.outcome).toBeUndefined();
    const after = await f.store.listRunEvents(child.id);
    expect(after.filter((event) => event.type !== "model.usage.reconciled")).toEqual(before);
    expect(settled.usage.costUsd).toBe(0.033);
    expect((await f.store.modelAccountingRepository.readRunAccounting(child.id)).usage.costUsd).toBe(0.033);
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.run.id)).usage.costUsd).toBe(0.033);
    expect(f.store.listRuns(f.thread.id).find((run) => run.id === child.id)?.subagent).toEqual(child.subagent);
    expect((await createRunReplaySnapshot(f.store, f.thread.id, f.run.id)).metrics.inputTokens).toBe(100);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("closes the reserved child invocation if cancellation wins during capture without manufacturing a physical call", async () => {
    const barrier = awaitedEventBarrier((event) => event.type === "subagent.model.invocation");
    const f = await createModelSessionFixture({ nativeAccounting: true, onEvent: barrier.onEvent });
    const dispatch = scripted(f.registry, f.faux.provider, []);
    const handle = await f.supervisor.start(f.request());
    const result = f.supervisor.collect(handle);
    await Promise.race([barrier.reached, result.then((value) => { throw new Error(`Task ended before capture: ${value.task.error}`); })]);
    f.parent.abort(); barrier.release();
    const task = (await result).task;
    expect(task.status).toBe("cancelled");
    expect(dispatch).not.toHaveBeenCalled();
    const events = await f.store.listRunEvents(task.childRunId!);
    expect(events.filter((event) => event.type === "model.accounting.child_undispatched")).toHaveLength(1);
    expect(events.filter((event) => event.type === "model.accounting.prepared")).toHaveLength(0);
    expect((await f.store.modelAccountingRepository.readRunAccounting(task.childRunId!)).usageStatus).toBe("complete");
  });

  it.each(["outcome_repair", "typed_repair"] as const)("settles native child %s with one receipt per actual attempt", async (phase) => {
    const f = await createModelSessionFixture({ nativeAccounting: true });
    const usage = { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 135,
      cost: { input: 0.01, output: 0.02, cacheRead: 0.002, cacheWrite: 0.001, total: 0.033 } };
    const dispatch = scripted(f.registry, f.faux.provider, ["not-json", phase === "typed_repair" ? '{"answer":"repaired"}' : '{"summary":"repaired","items":[],"unknowns":[]}']
      .map((text) => ({ ...fauxAssistantMessage(text), usage })));
    const handle = await f.supervisor.start(f.request(phase === "typed_repair" ? {
      outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
    } : {}));
    const result = await f.supervisor.collect(handle);
    expect(result.status, result.task.error).toBe("completed");
    const events = await f.store.listRunEvents(result.task.childRunId!);
    expect(events.filter((event) => event.type === "model.accounting.prepared").map((event) =>
      (event.payload as any).attribution.phase)).toEqual(["subagent_turn", phase]);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(2);
    expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(2);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(result.task.usage.costUsd).toBe(0.066);
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.run.id)).usage.costUsd).toBe(0.066);
    expect((await createRunReplaySnapshot(f.store, f.thread.id, f.run.id)).metrics.inputTokens).toBe(200);
    expect(f.source!.pending()).toHaveLength(0);
  });

  it.each(["source", "projection"] as const)("retries %s persistence from the original observation without redispatch", async (failure) => {
    const f = await fixture();
    const dispatch = scripted(f.registry, f.faux.provider, [f.message]);
    if (failure === "source") vi.spyOn(f.source, "record").mockImplementationOnce(() => { throw new Error("source unavailable"); });
    else vi.spyOn(f.store.modelAccountingRepository, "reconcile").mockRejectedValueOnce(new Error("Store temporarily unavailable"));
    await expect(completeModelInvocation({ models: f.registry.models, model: f.model, context: f.fixture.context,
      phase: "goal_evaluation", accounting: f.registry.accountingForRun(f.parent.run.id) })).rejects.toThrow("accounting");
    await drainModelCallAccounting(f.registry.models);
    expect(dispatch).toHaveBeenCalledOnce();
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).usage.costUsd).toBe(0.033);
    expect((await f.store.listRunEvents(f.parent.run.id)).filter((event) => event.type === "model.usage.reconciled")).toHaveLength(1);
    expect(f.source.pending()).toHaveLength(0);
  });

  it("uses one coherent budget snapshot while logical completions update only turns and forecasts", async () => {
    const tracker = new RunBudgetTracker({ maxTurns: 10, maxTotalTokens: 10000, maxCostUsd: 10, timeoutMs: 60000 });
    const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10, cacheWriteTokens: 5, costUsd: 0.033 };
    let revision = 3;
    tracker.bindAccounting(async () => ({ accountingRevision: revision, usage, summary: { budgetTokens: 128, budgetCostUsd: 0.04 } }));
    tracker.beginPrimaryTurn();
    await tracker.refreshAccounting();
    tracker.observePrimaryUsage(usage); tracker.observeAuxiliaryUsage(usage); tracker.syncSubagentUsage([{ id: "t", usage }] as never);
    await tracker.refreshAccounting();
    expect(tracker.observed()).toMatchObject({ turns: 1, inFlightTurns: 0, totalTokens: 128, costUsd: 0.04, usage });
    expect(tracker.primaryRequestForecast()?.uncachedCallTokens).toBe(135);
    revision = 2; usage.costUsd = 999;
    await tracker.refreshAccounting();
    expect(tracker.observed().costUsd).toBe(0.04);
    tracker.bindAccounting(async () => ({ accountingRevision: 4, usage: emptyUsage(), knownBudgetCostUsd: 0.08,
      summary: { budgetTokens: 128, budgetCostUsd: null } }));
    await tracker.refreshAccounting();
    expect(tracker.observed().costUsd).toBe(0.08);
  });
});
