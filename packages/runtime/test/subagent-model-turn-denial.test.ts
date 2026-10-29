import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, type Usage } from "@earendil-works/pi-ai";
import { emptyUsage } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isUndispatchedSubagentModelTurn,
  subagentModelTurnDeniedStream,
  SubagentModelTurnDeniedError,
} from "../src/subagent-model-turn-denial.js";
import { SubagentTaskObserver } from "../src/subagent-task-observer.js";
import { cleanupSubagentHarnesses, createHarness } from "./subagent-test-harness.js";

afterEach(cleanupSubagentHarnesses);

async function fixture(maxTurns: number) {
  const f = await createHarness({ maxTurns });
  const created = await f.store.createSubagentTask({
    threadId: f.thread.id, runId: f.run.id, role: "researcher",
    description: "Observe admitted turns", prompt: "Inspect the assigned task.",
    model: { provider: f.model.provider, id: f.model.id },
  });
  const task = await f.store.startSubagentTask(created.id);
  const emit = vi.fn(async () => undefined);
  const observer = new SubagentTaskObserver(f.store, task, emptyUsage(), f.profile.subagentLimits!, emit);
  return { ...f, observer, emit };
}

describe("undispatched child model turn", () => {
  it("preserves a real response's usage while excluding the host-denied terminal through the actual Agent loop", async () => {
    const f = await fixture(1);
    const actual = fauxAssistantMessage(fauxToolCall("missing_tool", {}), { stopReason: "toolUse" });
    f.faux.setResponses([actual, fauxAssistantMessage("MUST_NOT_BE_DISPATCHED")]);
    let physicalUsage: Usage | undefined;
    const agent = new Agent({
      initialState: { model: f.model, tools: [], messages: [], systemPrompt: "Inspect one turn." },
      streamFn: async (model, context, options) => {
        try { f.observer.assertTurnAvailable(); }
        catch (error) {
          const denied = subagentModelTurnDeniedStream(model, error);
          if (denied) return denied;
          throw error;
        }
        const source = f.registry.models.streamSimple(model, context, options);
        void source.result().then((message) => { physicalUsage = structuredClone(message.usage); });
        return source;
      },
      afterToolCall: async () => f.observer.turnCapped ? { terminate: true } : undefined,
    });
    agent.subscribe((event) => f.observer.observe(event));
    await agent.prompt("Try the assigned tool once.");
    expect(f.faux.state.callCount).toBe(1);
    expect(f.observer.task.turnCount).toBe(1);
    expect(f.observer.task.stepCount).toBe(2);
    if (!physicalUsage) throw new Error("missing physical provider usage");
    expect(physicalUsage.input + physicalUsage.output).toBeGreaterThan(0);
    expect(f.observer.usage).toEqual({
      inputTokens: physicalUsage.input, outputTokens: physicalUsage.output,
      cacheReadTokens: physicalUsage.cacheRead, cacheWriteTokens: physicalUsage.cacheWrite,
      costUsd: physicalUsage.cost.total,
    });
    expect(f.observer.task.usage).toEqual(f.observer.usage);
    expect(f.observer.lastError).toBe("Subagent turn budget exhausted (1)");
    expect(f.observer.turnCapped).toBe(true);
    expect(f.emit).toHaveBeenCalledTimes(2);
  });

  it("does not let copied host fields or matching provider errors hide real usage", async () => {
    const f = await fixture(2);
    const denied = subagentModelTurnDeniedStream(f.model, new SubagentModelTurnDeniedError(2));
    if (!denied) throw new Error("missing host terminal");
    const hostMessage = await denied.result();
    expect(isUndispatchedSubagentModelTurn(hostMessage)).toBe(true);
    const providerMessage = structuredClone(hostMessage);
    providerMessage.usage = {
      input: 9, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 13,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    };
    expect(isUndispatchedSubagentModelTurn(providerMessage)).toBe(false);
    await f.observer.observe({ type: "message_end", message: providerMessage });
    expect(f.observer.task.turnCount).toBe(1);
    expect(f.observer.usage.inputTokens).toBe(9);
    expect(f.observer.usage.outputTokens).toBe(4);
    expect(f.observer.usage.costUsd).toBe(0.3);
    expect(() => f.observer.assertTurnAvailable()).not.toThrow();
  });

  it("checks the current turn count even after a normal stop, and only attests the dedicated denial", async () => {
    const f = await fixture(1);
    await f.observer.observe({ type: "message_end", message: fauxAssistantMessage("done") });
    expect(f.observer.turnCapped).toBe(false);
    expect(() => f.observer.assertTurnAvailable()).toThrow(SubagentModelTurnDeniedError);
    expect(subagentModelTurnDeniedStream(f.model, new Error("Subagent turn budget exhausted (1)"))).toBeUndefined();
    const source = subagentModelTurnDeniedStream(f.model, new SubagentModelTurnDeniedError(1));
    if (!source) throw new Error("missing host terminal");
    const message = await source.result();
    expect(() => { message.usage.input = 100; }).toThrow(TypeError);
    const usage = structuredClone(f.observer.usage);
    await f.observer.observe({ type: "message_end", message });
    expect(f.observer.task.turnCount).toBe(1);
    expect(f.observer.usage).toEqual(usage);
  });
});
