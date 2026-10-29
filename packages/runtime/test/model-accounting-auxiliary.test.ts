import { rm } from "node:fs/promises";
import { createAssistantMessageEventStream, fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunEvaluationService, DEFAULT_EVALUATION_RUBRIC } from "../src/evaluation.js";
import { createLocalModelCallAdmission } from "../src/model-call-local-admission.js";
import { drainModelCallAccounting } from "../src/model-call-admission.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import { ModelRegistry } from "../src/models.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { invokeRunContextCompactor, prepareRunCompactionRequest } from "../src/run-context-compaction-model.js";
import { createRunReplaySnapshot } from "../src/replay.js";
import { accountingFixture } from "./model-accounting-fixture.js";

const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); })));
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const close of cleanup.splice(0)) await close();
});
const summary = { summary: "Inspected inputs; work remains.", decisions: ["Preserve constraints."], openLoops: ["Verify output."], artifacts: ["out.txt"] };
const judgment = { verdict: "tie", reason: "Both inputs are empty.", evidence: "Neither Run has a delivery.",
  scores: DEFAULT_EVALUATION_RUBRIC.criteria.map((criterion) => ({ criterionId: criterion.id, leftScore: 1, rightScore: 1, reason: "No evidence." })) };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function fixture(text = JSON.stringify(summary)) {
  const f = await accountingFixture();
  cleanup.push(async () => { await f.store.shutdown(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  const registry = new ModelRegistry(undefined, createLocalModelCallAdmission(f.source), f.store.modelAccountingRepository);
  const faux = fauxProvider({ provider: "auxiliary-accounting", models: [{ id: "tiny", maxTokens: 2000 }], tokensPerSecond: 1_000_000 });
  registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "tiny" })!;
  f.store.modelAccountingRepository.configureSource({ source: f.source, isDeclaredZeroCost: (value) => value.provider === faux.provider.id });
  registry.bindRunAccounting(f.parent.run.id, f.parent.token);
  const message: AssistantMessage = { ...f.fixture.message, api: model.api, provider: model.provider, model: model.id,
    content: [{ type: "text", text }] };
  const stream = createAssistantMessageEventStream(), started = deferred();
  const dispatch = vi.fn(() => { started.resolve(); return stream; });
  registry.registerProvider({ ...faux.provider, stream: dispatch, streamSimple: dispatch });
  const budget = new RunBudgetTracker({ maxTurns: 64, maxTotalTokens: 1_000_000, maxCostUsd: 100, timeoutMs: 60_000 });
  budget.bindAccounting(() => f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id));
  const host = { store: f.store, modelRegistry: registry, modelInvocationCapsules: new ModelInvocationCapsuleStore(f.store.dataRoot) };
  function compact(signal?: AbortSignal) {
    return invokeRunContextCompactor({ host, run: f.parent.run, budget, model,
      request: prepareRunCompactionRequest({ model, options: {}, evidence: ["Read complete; verification pending."], ...(signal ? { signal } : {}) }),
      nextTurnIndex: () => 0 });
  }
  return { ...f, registry, model, message, stream, started, dispatch, budget, compact,
    run: (id: string) => f.store.listRuns(f.thread.id).find((run) => run.id === id) };
}
async function compared(f: Awaited<ReturnType<typeof fixture>>) {
  await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
  const right = await f.store.createRun({ threadId: f.thread.id, agentId: f.profile.id });
  await f.store.finishRun(right.id, "completed");
  return { left: await createRunReplaySnapshot(f.store, f.thread.id, f.parent.run.id),
    right: await createRunReplaySnapshot(f.store, f.thread.id, right.id) };
}

describe("accounted evaluation and Run compaction consumers", () => {
  it("charges an independent evaluation Run while preserving both compared Runs", async () => {
    const f = await fixture(JSON.stringify(judgment)), snapshots = await compared(f);
    const before = [f.run(snapshots.left.run.id), f.run(snapshots.right.run.id)].map((value) => structuredClone(value));
    const service = new RunEvaluationService(f.store, f.registry);
    const pending = service.evaluate(f.thread.id, { leftRunId: snapshots.left.run.id, rightRunId: snapshots.right.run.id,
      model: { provider: f.model.provider, id: f.model.id } });
    await Promise.race([f.started.promise, pending]); f.stream.push({ type: "done", reason: "stop", message: f.message });
    const result = await pending;
    expect(result.verdict).toBe("tie");
    const run = f.store.listRuns(f.thread.id).find((run) => !before.some((prior) => prior?.id === run.id))!;
    expect(run.status).toBe("completed"); expect(run.usage.costUsd).toBe(0.033);
    expect([f.run(snapshots.left.run.id), f.run(snapshots.right.run.id)]).toEqual(before);
    const events = await f.store.listRunEvents(run.id);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(1);
    expect(events.find((event) => event.type === "model.response")?.payload).toMatchObject({ accountingMode: "physical_receipt_v1" });
    expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(1);
    expect(f.source.pending()).toHaveLength(0); expect(f.dispatch).toHaveBeenCalledOnce();
  });

  it("uses operation attribution for an untraced judgment without charging the compared Runs", async () => {
    const f = await fixture(JSON.stringify(judgment)), snapshots = await compared(f);
    const reserve = vi.spyOn(f.source, "reserve");
    const pending = new RunEvaluationService(f.store, f.registry).judgeSnapshots(snapshots.left, snapshots.right,
      DEFAULT_EVALUATION_RUBRIC, { provider: f.model.provider, id: f.model.id });
    await Promise.race([f.started.promise, pending]); f.stream.push({ type: "done", reason: "stop", message: f.message });
    expect((await pending).verdict).toBe("tie");
    expect(reserve.mock.calls[0]?.[0].owner).toMatchObject({ kind: "operation", operation: "evaluation_judgment" });
    expect(f.store.listRuns(f.thread.id)).toHaveLength(2);
    expect(f.run(snapshots.left.run.id)?.usage.costUsd).toBe(0);
    expect(f.run(snapshots.right.run.id)?.usage.costUsd).toBe(0);
    expect(f.source.pending()).toHaveLength(0); expect(f.dispatch).toHaveBeenCalledOnce();
  });

  it("fails an evaluation when receipt persistence fails and replays usage without publishing a judgment", async () => {
    const f = await fixture(JSON.stringify(judgment)), snapshots = await compared(f);
    vi.spyOn(f.source, "record").mockImplementationOnce(() => { throw new Error("receipt write interrupted"); });
    const pending = expect(new RunEvaluationService(f.store, f.registry).evaluate(f.thread.id, {
      leftRunId: snapshots.left.run.id, rightRunId: snapshots.right.run.id,
      model: { provider: f.model.provider, id: f.model.id },
    })).rejects.toThrow("accounting could not be committed");
    await Promise.race([f.started.promise, pending]); f.stream.push({ type: "done", reason: "stop", message: f.message });
    await pending;
    const run = f.store.listRuns(f.thread.id).find((run) => run.id !== snapshots.left.run.id && run.id !== snapshots.right.run.id)!;
    expect(run.status).toBe("failed");
    expect(run.accounting?.unresolvedInvocations).toBe(1);
    const before = await f.store.listRunEvents(run.id);
    expect(f.store.listRunEvaluations(f.thread.id)).toHaveLength(0);
    await drainModelCallAccounting(f.registry.models);
    expect(f.run(run.id)).toMatchObject({ status: "failed", finishedAt: run.finishedAt, usage: { costUsd: 0.033 } });
    expect((await f.store.listRunEvents(run.id)).filter((event) => event.type !== "model.usage.reconciled")).toEqual(before);
    expect(f.store.listRunEvaluations(f.thread.id)).toHaveLength(0);
    expect(f.source.pending()).toHaveLength(0); expect(f.dispatch).toHaveBeenCalledOnce();
  });

  it("settles compactor usage once and refreshes its canonical budget", async () => {
    const f = await fixture(), pending = f.compact();
    await Promise.race([f.started.promise, pending]); f.stream.push({ type: "done", reason: "stop", message: f.message });
    expect((await pending).summary).toEqual(summary);
    const accounting = await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id);
    expect(accounting.usage.costUsd).toBe(0.033);
    expect(f.budget.observed().usage).toEqual(accounting.usage);
    expect(f.budget.observed().turns).toBe(0);
    const events = await f.store.listRunEvents(f.parent.run.id);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(1);
    expect(events.find((event) => event.type === "model.response")?.payload).toMatchObject({ accountingMode: "physical_receipt_v1", modelCallPurpose: "context_compaction" });
    expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(1);
    expect(f.source.pending()).toHaveLength(0);
  });

  it("adds only accounting after a compactor cancellation and never delivers the late summary", async () => {
    const f = await fixture(), controller = new AbortController();
    const pending = expect(f.compact(controller.signal)).rejects.toThrow("cancel compactor");
    await Promise.race([f.started.promise, pending]); controller.abort(new Error("cancel compactor")); await pending;
    await f.store.finishRun(f.parent.run.id, "cancelled", { leaseToken: f.parent.token });
    const terminal = structuredClone(f.run(f.parent.run.id)), before = await f.store.listRunEvents(f.parent.run.id);
    expect((await f.store.modelAccountingRepository.readRunAccounting(f.parent.run.id)).summary.unresolvedInvocations).toBe(1);
    f.stream.push({ type: "done", reason: "stop", message: f.message });
    await drainModelCallAccounting(f.registry.models);
    const after = await f.store.listRunEvents(f.parent.run.id);
    expect(after.filter((event) => event.type !== "model.usage.reconciled")).toEqual(before);
    expect(after.some((event) => event.type === "context.run_compaction.completed")).toBe(false);
    expect(f.run(f.parent.run.id)).toMatchObject({ status: terminal?.status, finishedAt: terminal?.finishedAt, usage: { costUsd: 0.033 } });
    expect(f.source.pending()).toHaveLength(0); expect(f.dispatch).toHaveBeenCalledOnce();
  });
});
