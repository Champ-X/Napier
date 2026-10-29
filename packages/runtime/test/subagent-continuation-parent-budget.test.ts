import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { emptyUsage } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InProcessSubagentProvider } from "../src/in-process-subagent-provider.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { resumeInterruptedSubagents } from "../src/subagent-recovery-coordination.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { continuationRunnerFixture, cleanupContinuationRunnerFixtures } from "./subagent-continuation-runner-fixture.js";

afterEach(async () => { vi.restoreAllMocks(); await cleanupContinuationRunnerFixtures(); });

describe("continuation shared parent budget admission", () => {
  it.each([
    { text: '{"answer":"already finished"}', status: "completed" },
    { text: "malformed final output", status: "failed" },
  ])("settles $status final output at the exhausted parent ceiling with zero calls", async ({ text, status }) => {
    const f = await continuationRunnerFixture();
    await f.assistant(fauxAssistantMessage(text));
    const active = await f.interruptAndPrepare();
    const budget = new RunBudgetTracker({ ...f.profile.runLimits!, maxTotalTokens: 1_000 });
    budget.observeAuxiliaryUsage({ ...emptyUsage(), inputTokens: 1_000 });
    f.faux.setResponses([fauxAssistantMessage('{"answer":"must not dispatch repair"}')]);
    await recover(f, active, budget);
    const task = active.store.listSubagentTasks(f.thread.id).find((item) => item.continuedFromTaskId === f.task.id)!;
    expect(task.status).toBe(status);
    expect(task.usage).toEqual(emptyUsage());
    expect(task.turnCount).toBe(0);
    expect(f.faux.state.callCount).toBe(0);
    expect(active.store.listRuns(f.thread.id).find((run) => run.id === task.childRunId)?.status).toBe(status);
  });

  it("refreshes physical child usage before a subsequent typed repair", async () => {
    const f = await continuationRunnerFixture({ runLimits: { maxTotalTokens: 20_000 } });
    const active = await f.interruptAndPrepare();
    const budget = new RunBudgetTracker({ ...f.profile.runLimits!, maxTotalTokens: 1_000 });
    let calls = 0;
    vi.spyOn(f.registry.models, "streamSimple").mockImplementation((model) => {
      calls += 1;
      const message = fauxAssistantMessage(calls === 1 ? "malformed result" : '{"answer":"unauthorized repair"}');
      Object.assign(message, { api: model.api, provider: model.provider, model: model.id });
      Object.assign(message.usage, { input: 1_000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1_000 });
      message.usage.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      return stream;
    });
    await recover(f, active, budget);
    const task = active.store.listSubagentTasks(f.thread.id).find((item) => item.continuedFromTaskId === f.task.id)!;
    expect(calls).toBe(1);
    expect(task).toMatchObject({ status: "failed", turnCount: 1, usageStatus: "complete", usage: { inputTokens: 1_000 } });
    expect(budget.observed().totalTokens).toBe(1_000);
    expect((await active.store.listRunEvents(task.childRunId!)).filter((event) => event.type === "model.response")).toHaveLength(1);
  });
});

async function recover(
  f: Awaited<ReturnType<typeof continuationRunnerFixture>>,
  active: Awaited<ReturnType<Awaited<ReturnType<typeof continuationRunnerFixture>>["interruptAndPrepare"]>>,
  budget: RunBudgetTracker,
) {
  const signal = new AbortController().signal;
  const provider = new InProcessSubagentProvider({ store: active.store, models: f.registry.models, defaultModel: f.model,
    profile: f.profile, run: active.target.run, limits: f.profile.subagentLimits!, parentSignal: signal,
    concurrencyGate: new ToolConcurrencyGate() });
  return resumeInterruptedSubagents({ store: active.store, run: active.target.run, parentProfile: f.profile,
    configuredProfile: f.profile, provider, budget, signal });
}
