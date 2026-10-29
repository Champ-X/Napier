import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { emptyUsage, type Usage, type WorkflowValueSchema } from "@napier/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  awaitedEventBarrier,
  cleanupModelSessionFixtures,
  createModelSessionFixture,
  SYNTHETIC_ROUTE_KEY,
} from "./subagent-model-session-fixture.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import { aggregateRunUsage } from "../src/run-replay.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const outputSchema: WorkflowValueSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};
const modes = [
  { name: "ordinary", repairPrefix: "subagent.outcome.repair", request: {}, result: '{"summary":"repaired","items":[],"unknowns":[]}' },
  { name: "typed", repairPrefix: "subagent.output.repair", request: { outputSchema }, result: '{"answer":"repaired"}' },
] as const;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden in child model fixture"); }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanupModelSessionFixtures();
});

describe("Subagent ModelSession actual task settlement", () => {
  it("settles an inherited-tool setup exception as a durable failed task before model dispatch", async () => {
    const fixture = await createModelSessionFixture({
      createInheritedTools: () => { throw new Error("fixture inherited-tool setup failed"); },
    });
    fixture.faux.setResponses([fauxAssistantMessage('{"summary":"must not run","items":[],"unknowns":[]}')]);
    const handle = await fixture.supervisor.start(fixture.request());
    const collected = await fixture.supervisor.collect(handle).catch((error: unknown) => error);
    const task = fixture.store.listSubagentTasks(fixture.thread.id, fixture.run.id)
      .find((candidate) => candidate.id === handle.taskId)!;
    const events = await fixture.store.listEvents(fixture.thread.id);

    expect.soft(collected).toEqual(expect.objectContaining({ status: "failed" }));
    expect.soft(task.status).toBe("failed");
    expect.soft(task.stopReason).toBe("error");
    expect.soft(task.error).toContain("fixture inherited-tool setup failed");
    expect.soft(task.finishedAt).toBeDefined();
    expect.soft(task.output).toBeUndefined();
    expect.soft(task.outcome).toBeUndefined();
    expect.soft(fixture.faux.state.callCount).toBe(0);
    expect.soft(events.filter((event) => event.type === "subagent.failed")).toHaveLength(1);
    expect.soft(events.some((event) => event.type === "subagent.completed")).toBe(false);
    expect.soft(events.some((event) => event.type === "subagent.model.invocation")).toBe(false);
  });

  it("an unknown normal tool cannot dispatch a model turn beyond maxTurns", async () => {
    const fixture = await createModelSessionFixture({ maxTurns: 1 });
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("missing_normal_tool", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage('{"summary":"must not run","items":[],"unknowns":[]}'),
    ]);
    const handle = await fixture.supervisor.start(fixture.request());
    const collected = await fixture.supervisor.collect(handle);
    const events = await fixture.store.listEvents(fixture.thread.id);

    expect.soft(collected.status).toBe("failed");
    expect.soft(collected.task.stopReason).toBe("turn_capped");
    expect.soft(fixture.faux.state.callCount).toBe(1);
    expect.soft(collected.task.turnCount).toBe(1);
    expect.soft(fixture.faux.getPendingResponseCount()).toBe(1);
    expect.soft(collected.task.output).toBeUndefined();
    expect.soft(collected.task.outcome).toBeUndefined();
    expect.soft(events.filter((event) => event.type === "subagent.model.invocation")).toHaveLength(1);
    expect.soft(events.filter((event) => event.type === "subagent.model.response")).toHaveLength(1);
    expect.soft(events.some((event) => event.type === "subagent.completed")).toBe(false);
  });

  for (const mode of modes) {
    for (const boundary of ["requested", "accepted"] as const) {
      it(`${mode.name}: cancellation at awaited repair ${boundary} prevents completed task settlement`, async () => {
        const barrier = awaitedEventBarrier((event) =>
          boundary === "requested"
            ? event.type === `${mode.repairPrefix}.requested`
            : event.type === `${mode.repairPrefix}.outcome` &&
              (event.payload as Record<string, unknown>)["status"] === "accepted",
        );
        const fixture = await createModelSessionFixture({ onEvent: barrier.onEvent });
        fixture.faux.setResponses([
          fauxAssistantMessage("not-json"),
          fauxAssistantMessage(mode.result),
        ]);
        const handle = await fixture.supervisor.start(fixture.request(mode.request));
        const settlement = fixture.supervisor.collect(handle);
        await Promise.race([
          barrier.reached,
          settlement.then((result) => {
            throw new Error(`Task settled before ${boundary} barrier: ${result.status}: ${result.task.error ?? "no error"}`);
          }),
        ]);
        fixture.parent.abort(new Error(`Cancel at ${mode.name} repair ${boundary}`));
        barrier.release();
        const collected = await settlement;
        const events = await fixture.store.listEvents(fixture.thread.id);

        expect.soft(collected.status).toBe("cancelled");
        expect.soft(collected.task.status).toBe("cancelled");
        expect.soft(collected.task.stopReason).toBe("cancelled");
        expect.soft(collected.task.output).toBeUndefined();
        expect.soft(collected.task.outcome).toBeUndefined();
        expect.soft(fixture.faux.state.callCount).toBe(boundary === "requested" ? 1 : 2);
        for (const type of ["subagent.completed", "subagent.output.accepted", "subagent.outcome.accepted"]) {
          expect.soft(events.some((event) => event.type === type)).toBe(false);
        }
      });
    }

    it(`${mode.name}: an unknown repair tool cannot consume a second repair response`, async () => {
      const fixture = await createModelSessionFixture();
      fixture.faux.setResponses([
        fauxAssistantMessage("not-json"),
        fauxAssistantMessage(fauxToolCall("missing_repair_tool", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage(mode.result),
      ]);
      const handle = await fixture.supervisor.start(fixture.request(mode.request));
      const collected = await fixture.supervisor.collect(handle);

      expect.soft(collected.status).toBe("failed");
      expect.soft(fixture.faux.state.callCount).toBe(2);
      expect.soft(fixture.faux.getPendingResponseCount()).toBe(1);
      expect.soft(collected.task.turnCount).toBe(2);
      expect.soft(collected.task.output).toBeUndefined();
      expect.soft(collected.task.outcome).toBeUndefined();
    });

    it(`${mode.name}: route-selected credential and response callback reach both normal and repair calls`, async () => {
      const fixture = await createModelSessionFixture({ routeCredential: true });
      const observed: Array<{ apiKey: string | undefined; hasOnResponse: boolean }> = [];
      fixture.faux.setResponses(["not-json", mode.result].map((text) =>
        (_context, options) => {
          observed.push({ apiKey: options?.apiKey, hasOnResponse: typeof options?.onResponse === "function" });
          return fauxAssistantMessage(text);
        },
      ));
      const handle = await fixture.supervisor.start(fixture.request(mode.request));
      const collected = await fixture.supervisor.collect(handle);

      expect(collected.status, collected.task.error).toBe("completed");
      expect(observed).toEqual([
        { apiKey: SYNTHETIC_ROUTE_KEY, hasOnResponse: true },
        { apiKey: SYNTHETIC_ROUTE_KEY, hasOnResponse: true },
      ]);
    });

    it(`${mode.name}: exact captures bind each sibling task and isolate repair cache state`, async () => {
      const fixture = await createModelSessionFixture();
      const observed: Array<{ context: unknown; maxTokens: number | undefined; cacheRetention: unknown }> = [];
      fixture.faux.setResponses(["not-json", mode.result, "not-json", mode.result].map((text) =>
        (context, options) => {
          observed.push({
            context: JSON.parse(JSON.stringify(context)),
            maxTokens: options?.maxTokens,
            cacheRetention: options?.cacheRetention,
          });
          return fauxAssistantMessage(text);
        },
      ));
      const handles = [];
      for (let index = 0; index < 2; index += 1) {
        const handle = await fixture.supervisor.start(fixture.request(mode.request));
        handles.push(handle);
        const collected = await fixture.supervisor.collect(handle);
        expect(collected.status, collected.task.error).toBe("completed");
      }
      const events = await fixture.store.listEvents(fixture.thread.id);
      const invocations = events.filter((event) => event.type === "subagent.model.invocation");
      const responses = events.filter((event) => event.type === "subagent.model.response");
      expect(invocations).toHaveLength(4);
      expect(responses).toHaveLength(4);
      expect(events.filter((event) => event.type === "model.response")).toHaveLength(0);
      const capsules = new ModelInvocationCapsuleStore(fixture.store.dataRoot);
      for (const [index, event] of invocations.entries()) {
        const invocation = event.payload as unknown as ChildInvocation;
        const handle = handles[Math.floor(index / 2)]!;
        const phase = index % 2 === 0 ? "subagent_turn" : mode.name === "typed" ? "typed_repair" : "outcome_repair";
        expect(event.runId).toBe(fixture.run.id);
        expect(event.category).toBe("subagent");
        expect(invocation.owner).toEqual({
          kind: "subagent", threadId: fixture.thread.id, parentRunId: fixture.run.id,
          taskId: handle.taskId, executionId: handle.executionId,
        });
        expect(invocation.taskId).toBe(handle.taskId);
        expect(invocation.phase).toBe(phase);
        expect(invocation.invocationIndex).toBe(index % 2 + 1);
        expect(invocation.captures.map((capture) => capture.kind)).toEqual([
          "envelope", "adapter", "invocation", "cache_projection",
        ]);
        const receipt = invocation.captures.find((capture) => capture.kind === "invocation")!.payload;
        const capsule = await capsules.read(String(receipt["capsuleSha256"]));
        expect(capsule.sourceThreadId).toBe(fixture.thread.id);
        expect(capsule.sourceRunId).toBe(fixture.run.id);
        expect(capsule.context).toEqual(observed[index]!.context);
        expect(capsule.options.maxTokens).toBe(observed[index]!.maxTokens);
        expect(capsule.options.cacheRetention).toBe(observed[index]!.cacheRetention);
        expect(capsule.contextEnvelopeSha256).toBe(invocation.contextEnvelopeSha256);
        expect(invocation.captures.find((capture) => capture.kind === "cache_projection")!.payload["previousTurnIndex"]).toBeNull();
        const response = responses[index]!;
        expect(response.seq).toBeGreaterThan(event.seq);
        expect(response.payload).toEqual(expect.objectContaining({
          owner: invocation.owner, phase, invocationIndex: invocation.invocationIndex,
          contextEnvelopeSha256: invocation.contextEnvelopeSha256,
        }));
      }
    });
  }

  it("counts child response usage once in a completed parent AgentRuntime run", async () => {
    const fixture = await createModelSessionFixture();
    await fixture.store.updateAgent(fixture.run.agentId, {
      enabledSubagents: ["researcher"], enabledTools: ["list_files"], toolPolicy: "observe",
    });
    const thread = await fixture.store.createThread({ title: "Parent usage integration", agentId: fixture.run.agentId });
    fixture.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("delegate_task", {
        role: "researcher", description: "Collect one bounded result", task: "Return one JSON result.",
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage("not-json"),
      fauxAssistantMessage(modes[0].result),
      fauxAssistantMessage("The delegated result was collected."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const runtime = processReadyAgentRuntime(fixture.store, fixture.registry);
    const run = await runtime.runPrompt({
      threadId: thread.id, text: "Delegate a small research task and summarize its result.",
      model: { provider: fixture.faux.provider.id, id: "faux-1" },
    });
    expect(run.status, run.error).toBe("completed");
    const events = await fixture.store.listRunEvents(run.id);
    const tasks = fixture.store.listSubagentTasks(thread.id, run.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status).toBe("completed");
    const childResponses = events.filter((event) => event.type === "subagent.model.response");
    expect(childResponses).toHaveLength(2);
    const physicalChildUsage = childResponses.reduce<Usage>((total, event) => {
      const payload = event.payload as Record<string, unknown>;
      const usage = payload["usage"] as { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } };
      return sumUsage(total, { inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite, costUsd: usage.cost.total });
    }, emptyUsage());
    expect(tasks[0]!.usage).toEqual(physicalChildUsage);
    const mainUsage = aggregateRunUsage(events.filter((event) => event.type !== "subagent.model.response"), []);
    expect(mainUsage.inputTokens + mainUsage.outputTokens).toBeGreaterThan(0);
    const expected = sumUsage(mainUsage, physicalChildUsage);
    expect(aggregateRunUsage(events, tasks)).toEqual(expected);
    expect(await fixture.store.aggregateRunUsage(run.id)).toEqual(expected);
    expect(run.usage).toEqual(expected);
    const budget = new RunBudgetTracker({ maxTurns: 100, maxTotalTokens: 0, maxCostUsd: 100, timeoutMs: 60_000 });
    budget.syncSubagentUsage(tasks);
    budget.syncSubagentUsage(tasks);
    expect(budget.observed().usage).toEqual(physicalChildUsage);
  });
});

interface ChildInvocation {
  owner: Record<string, unknown>;
  taskId: string;
  phase: string;
  invocationIndex: number;
  contextEnvelopeSha256: string;
  captures: Array<{ kind: string; payload: Record<string, unknown> }>;
}

function sumUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    costUsd: left.costUsd + right.costUsd,
  };
}
