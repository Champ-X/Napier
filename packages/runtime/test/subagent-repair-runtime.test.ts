import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { emptyUsage, type RegisteredRunEventTypeForCategory, type SubagentTask } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { runSubagentOutcomeRepair } from "../src/subagent-outcome-repair-runtime.js";
import { settleSubagentTypedOutput } from "../src/subagent-typed-output-runtime.js";

const fixtures: Array<{ root: string; store: LocalStore }> = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-single-repair-"));
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot: path.join(root, "data") });
  fixtures.push({ root, store });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: "Single repair", agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const faux = fauxProvider({ provider: `repair-${run.id}`, models: [{ id: "repair" }], tokensPerSecond: 100_000 });
  const registry = new ModelRegistry();
  registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "repair" })!;
  let task = await store.createSubagentTask({ threadId: thread.id, runId: run.id, role: "researcher",
    description: "Repair fixture", prompt: "Return structured evidence", model: { provider: model.provider, id: model.id } });
  task = await store.startSubagentTask(task.id);
  const events: Array<{ type: string; task: SubagentTask; payload: unknown }> = [];
  const input = {
    store, models: registry.models, model, runId: run.id, task, usage: emptyUsage(),
    limits: { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 5_000 },
    activateAgent: (_abort: () => void): void => undefined,
    emit: async (type: RegisteredRunEventTypeForCategory<"subagent">, updated: SubagentTask, payload: unknown) => { events.push({ type, task: updated, payload }); },
  };
  return { input, faux, events };
}

describe("single-response subagent repair", () => {
  it.each(["typed", "outcome"])("counts exactly one %s response, usage update and durable progress step", async (kind) => {
    const { input, faux, events } = await fixture();
    const base = { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1, costUsd: 0.25 };
    input.usage = base;
    input.task = await input.store.recordSubagentProgress(input.task.id, { usage: base });
    faux.setResponses([(context, options) => {
      expect(context.tools).toEqual([]);
      expect(options).toMatchObject({ maxRetries: 0, sessionId: expect.stringContaining(input.task.id) });
      expect(options).not.toHaveProperty("reasoning");
      return fauxAssistantMessage(kind === "typed" ? '{"answer":"repaired"}' : '{"summary":"repaired","items":[],"unknowns":[]}');
    }]);
    const result = kind === "typed"
      ? await settleSubagentTypedOutput({ ...input, resultText: "not-json", outputSchema: {
        type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false,
      } })
      : await runSubagentOutcomeRepair({ ...input, predecessorResult: "not-json", diagnostic: "Expected JSON" });
    expect(faux.state.callCount).toBe(1);
    expect(result.task).toMatchObject({ turnCount: 1, stepCount: 1 });
    const responses = (await input.store.listEvents(input.task.threadId)).filter((event) => event.type === "subagent.model.response");
    expect(responses).toHaveLength(1);
    const physical = (responses[0]!.payload as { usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } } }).usage;
    expect(result.usage).toEqual({ inputTokens: base.inputTokens + physical.input, outputTokens: base.outputTokens + physical.output,
      cacheReadTokens: base.cacheReadTokens + physical.cacheRead, cacheWriteTokens: base.cacheWriteTokens + physical.cacheWrite,
      costUsd: base.costUsd + physical.cost.total });
    expect(events.filter((event) => event.type === "subagent.step")).toHaveLength(1);
  });

  it.each(["typed", "outcome"])("rejects an unknown tool in %s repair without consuming later valid JSON", async (kind) => {
    const { input, faux, events } = await fixture();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("not_an_admitted_tool", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage(kind === "typed" ? '{"answer":"must not be consumed"}' : '{"summary":"must not be consumed","items":[],"unknowns":[]}'),
    ]);
    let error: string | undefined;
    try {
      if (kind === "typed") {
        await settleSubagentTypedOutput({ ...input, resultText: "not-json",
          outputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } });
      } else {
        error = (await runSubagentOutcomeRepair({ ...input, predecessorResult: "not-json", diagnostic: "Expected JSON" })).error;
      }
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); }
    expect(faux.state.callCount).toBe(1);
    expect(error).toMatch(/tool call/i);
    const task = input.store.listSubagentTasks(input.task.threadId).find((entry) => entry.id === input.task.id)!;
    expect(task.turnCount).toBe(1);
    expect(task.stepCount).toBe(1);
    expect(events.filter((event) => event.type === "subagent.step")).toHaveLength(1);
    expect(events.filter((event) => event.type === "subagent.output.repair.outcome").map((event) => event.payload))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ status: "accepted" })]));
  });

  it.each(["typed", "outcome"])("does not dispatch %s repair cancelled during its requested event", async (kind) => {
    const { input, faux } = await fixture();
    let cancel: () => void = () => undefined;
    input.activateAgent = (abort) => { cancel = abort; };
    input.emit = async (type) => { if (type.endsWith(".repair.requested")) cancel(); };
    const operation = kind === "typed"
      ? settleSubagentTypedOutput({ ...input, resultText: "not-json", outputSchema: { type: "string" } })
      : runSubagentOutcomeRepair({ ...input, predecessorResult: "not-json", diagnostic: "Expected JSON" });
    await expect(operation).rejects.toThrow(/cancelled/i);
    expect(faux.state.callCount).toBe(0);
  });

  it("rejects cancellation during typed repair acceptance after recording its single usage update", async () => {
    const { input, faux } = await fixture();
    let cancel: () => void = () => undefined;
    input.activateAgent = (abort) => { cancel = abort; };
    input.emit = async (type) => { if (type === "subagent.output.repair.outcome") cancel(); };
    faux.setResponses([fauxAssistantMessage('"repaired"')]);
    await expect(settleSubagentTypedOutput({ ...input, resultText: "not-json", outputSchema: { type: "string" } })).rejects.toThrow(/cancelled/i);
    expect(faux.state.callCount).toBe(1);
    expect(input.store.listSubagentTasks(input.task.threadId)[0]).toMatchObject({ turnCount: 1, stepCount: 1 });
  });
});
