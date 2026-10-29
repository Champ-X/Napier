import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { emptyUsage, type RunEvent, type Usage } from "@napier/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupModelSessionFixtures, createModelSessionFixture, SYNTHETIC_ROUTE_KEY } from "./subagent-model-session-fixture.js";
import { RUN_CONTEXT_COMPACTED_EVENT, RUN_CONTEXT_COMPACTION_FAILED_EVENT } from "../src/run-context-checkpoint.js";
import { aggregateRunUsage } from "../src/run-replay.js";
import { RunBudgetTracker } from "../src/run-budget.js";

const summary = { summary: "Inspected both source files; final response remains unfinished.",
  decisions: ["Preserve original filenames."], openLoops: ["Return the requested result."], artifacts: ["first.txt", "second.txt"] };

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden in child compaction fixture"); })); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await cleanupModelSessionFixtures(); });

describe("child Run context compaction", () => {
  it("compacts a long real tool transcript, continues from its checkpoint, and preserves raw messages", async () => {
    const fixture = await createModelSessionFixture({ timeoutMs: 15_000 });
    Object.assign(fixture.model, { contextWindow: 10_000, maxTokens: 1_200, reasoning: false });
    await writeFile(path.join(fixture.store.workspaceRoot, "first.txt"), "first source evidence ".repeat(400));
    await writeFile(path.join(fixture.store.workspaceRoot, "second.txt"), "second source evidence ".repeat(400));
    const normal: Context[] = [];
    const auxiliary: Context[] = [];
    fixture.faux.setResponses(Array.from({ length: 8 }, () => (context) => {
      if (context.systemPrompt?.includes("checkpoint inside an unfinished Run")) {
        auxiliary.push(structuredClone(context));
        return fauxAssistantMessage(JSON.stringify(summary));
      }
      normal.push(structuredClone(context));
      const index = normal.length;
      if (index <= 2) return fauxAssistantMessage(fauxToolCall("read_file", {
        path: index === 1 ? "first.txt" : "second.txt",
      }, { id: `read-${index}` }), { stopReason: "toolUse" });
      if (index === 3) return fauxAssistantMessage(fauxToolCall("list_files", { path: ".", depth: 0 }, { id: "list-3" }), { stopReason: "toolUse" });
      return fauxAssistantMessage('{"answer":"verified"}');
    }));
    const handle = await fixture.supervisor.start(fixture.request({ outputSchema: {
      type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false,
    } }));
    const result = await fixture.supervisor.collect(handle);
    expect(result.status, result.task.error).toBe("completed");
    expect(normal).toHaveLength(4);
    expect(auxiliary).toHaveLength(1);
    expect(result.task.turnCount).toBe(4);
    expect(fixture.faux.state.callCount).toBe(5);
    expect(JSON.stringify(normal[2])).toContain(summary.summary);
    expect(JSON.stringify(normal[3])).toContain(summary.summary);
    expect(normal.every((context) => context.systemPrompt === normal[0]!.systemPrompt)).toBe(true);
    const child = fixture.store.listRuns(fixture.thread.id).find((run) => run.id === result.task.childRunId)!;
    const pointer = child.subagent!.checkpoint!;
    const raw = JSON.parse(await readFile(path.join(fixture.store.dataRoot, "subagent-working-sets", `${pointer.capsuleSha256}.json`), "utf8")) as { messages: unknown[] };
    expect(raw.messages).toHaveLength(8);
    expect(JSON.stringify(raw)).toContain("first source evidence ".repeat(400));
    expect(JSON.stringify(raw)).not.toContain(summary.summary);
    const events = await fixture.store.listRunEvents(child.id);
    expect(events.filter((event) => event.type === RUN_CONTEXT_COMPACTED_EVENT)).toHaveLength(1);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(5);
    expect(events.filter((event) => event.type === "model.response" &&
      (event.payload as Record<string, unknown>)["modelCallPurpose"] === "context_compaction")).toHaveLength(1);
    const physicalUsage = sumUsage(events);
    expect(result.task.usage).toEqual(physicalUsage);
    expect(child.usage).toEqual(physicalUsage);
    const parentEvents = await fixture.store.listRunEvents(fixture.run.id);
    expect(parentEvents.filter((event) => event.type === "model.response")).toHaveLength(0);
    expect(aggregateRunUsage(parentEvents, [result.task])).toEqual(physicalUsage);
    expect(await fixture.store.aggregateRunUsage(fixture.run.id)).toEqual(physicalUsage);
    const parentBudget = new RunBudgetTracker({ maxTurns: 64, maxTotalTokens: 0, maxCostUsd: 100, timeoutMs: 60_000 });
    parentBudget.syncSubagentUsage([result.task]);
    parentBudget.syncSubagentUsage([result.task]);
    expect(parentBudget.observed().usage).toEqual(physicalUsage);
  });

  it("uses the selected candidate and credential for one auxiliary attempt without consuming a Task turn", async () => {
    const fixture = await controlledTranscript({ fallback: true });
    const result = await fixture.execute();
    expect(result.status, result.task.error).toBe("completed");
    expect(result.task.turnCount).toBe(3);
    expect(fixture.calls).toHaveLength(5);
    expect(fixture.model.contextWindow).toBeGreaterThan(10_000);
    const auxiliary = fixture.calls.filter((call) => call.auxiliary);
    expect(auxiliary).toHaveLength(1);
    expect(auxiliary[0]).toMatchObject({ model: "bounded-route-compaction", contextWindow: 10_000,
      options: { apiKey: SYNTHETIC_ROUTE_KEY, maxRetries: 0, maxTokens: 1_200 } });
    expect(auxiliary[0]!.options?.onResponse).toBeUndefined();
    expect(fixture.calls.filter((call) => !call.auxiliary).every((call) => typeof call.options?.onResponse === "function")).toBe(true);
    expect(auxiliary[0]!.context.tools).toEqual([]);
    expect(result.task.usage).toEqual({ inputTokens: 7_000, outputTokens: 700, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.007 });
    const events = await fixture.store.listRunEvents(result.task.childRunId!);
    expect(events.filter((event) => event.type === "subagent.child.invocation_reserved")).toHaveLength(5);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(5);
  });

  it.each([
    { label: "before auxiliary dispatch", ceiling: 2_200, auxiliaryCalls: 0, responses: 2, tokens: 2_200 },
    { label: "after auxiliary settlement", ceiling: 5_000, auxiliaryCalls: 1, responses: 3, tokens: 5_500 },
  ])("preserves canonical usage and denies the next physical call $label", async (test) => {
    const fixture = await controlledTranscript({ maxTotalTokens: test.ceiling });
    const result = await fixture.execute();
    expect(result.status).toBe("failed");
    expect(result.task.error).toContain("tokens");
    expect(result.task.turnCount).toBe(2);
    expect(fixture.calls.filter((call) => call.auxiliary)).toHaveLength(test.auxiliaryCalls);
    expect(fixture.calls).toHaveLength(test.responses);
    expect(result.task.usage.inputTokens + result.task.usage.outputTokens).toBe(test.tokens);
    const events = await fixture.store.listRunEvents(result.task.childRunId!);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(test.responses);
    expect(events.filter((event) => event.type === RUN_CONTEXT_COMPACTED_EVENT)).toHaveLength(0);
  });

  it.each(["malformed", "transport error"] as const)("settles one %s auxiliary response and continues with the unchanged source", async (kind) => {
    const fixture = await controlledTranscript({ auxiliaryResult: kind });
    const result = await fixture.execute();
    expect(result.status, result.task.error).toBe("completed");
    expect(fixture.calls.filter((call) => call.auxiliary)).toHaveLength(1);
    expect(fixture.calls).toHaveLength(4);
    expect(result.task.turnCount).toBe(3);
    expect(JSON.stringify(fixture.calls.at(-1)!.context)).toContain("first source evidence ".repeat(400));
    const events = await fixture.store.listRunEvents(result.task.childRunId!);
    expect(events.filter((event) => event.type === RUN_CONTEXT_COMPACTED_EVENT)).toHaveLength(0);
    expect(events.filter((event) => event.type === RUN_CONTEXT_COMPACTION_FAILED_EVENT)).toHaveLength(1);
    const auxiliary = events.filter((event) => event.type === "model.response" &&
      (event.payload as Record<string, unknown>)["modelCallPurpose"] === "context_compaction");
    expect(auxiliary).toHaveLength(1);
    expect(auxiliary[0]!.payload).not.toHaveProperty("compactionSummarySha256");
    expect(result.task.usage).toEqual(sumUsage(events));
  });

  it("keeps settled auxiliary usage and raw messages when aborted before checkpoint acceptance", async () => {
    const fixture = await controlledTranscript({ abortAfterAuxiliary: true });
    const result = await fixture.execute();
    expect(result.status).toBe("cancelled");
    expect(result.task.turnCount).toBe(2);
    expect(fixture.calls).toHaveLength(3);
    expect(fixture.calls.filter((call) => call.auxiliary)).toHaveLength(1);
    const child = fixture.store.listRuns(fixture.thread.id).find((run) => run.id === result.task.childRunId)!;
    const events = await fixture.store.listRunEvents(child.id);
    expect(events.filter((event) => event.type === RUN_CONTEXT_COMPACTED_EVENT)).toHaveLength(0);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(3);
    expect(result.task.usage).toEqual(sumUsage(events));
    expect(result.task.usage.inputTokens + result.task.usage.outputTokens).toBe(5_500);
    expect(result.task.usage.costUsd).toBeCloseTo(0.005);
    const pointer = child.subagent!.checkpoint!;
    const raw = await readFile(path.join(fixture.store.dataRoot, "subagent-working-sets", `${pointer.capsuleSha256}.json`), "utf8");
    expect(raw).toContain("first source evidence ".repeat(400));
    expect(raw).toContain("second source evidence ".repeat(400));
    expect(raw).not.toContain(summary.summary);
  });
});

async function controlledTranscript(options: {
  maxTotalTokens?: number;
  auxiliaryResult?: "malformed" | "transport error";
  abortAfterAuxiliary?: boolean;
  fallback?: boolean;
} = {}) {
  let abort = () => {};
  const fixture = await createModelSessionFixture({ timeoutMs: 15_000, maxTurns: 3, routeCredential: true,
    ...(options.maxTotalTokens === undefined ? {} : { runLimits: { maxTotalTokens: options.maxTotalTokens } }),
    onEvent: (event) => {
      if (options.abortAfterAuxiliary && event.type === "model.response" &&
        (event.payload as Record<string, unknown>)["modelCallPurpose"] === "context_compaction") abort();
    },
  });
  abort = () => fixture.parent.abort(new Error("Abort after auxiliary settlement"));
  // The large default can fail into a smaller route candidate, which alone
  // creates pressure and proves projection runs after actual route selection.
  if (options.fallback) vi.spyOn(fixture.registry, "resolveConfigured").mockResolvedValue({
    ...fixture.model, id: "bounded-route-compaction", contextWindow: 10_000, maxTokens: 1_200, reasoning: false,
  });
  else Object.assign(fixture.model, { contextWindow: 10_000, maxTokens: 1_200, reasoning: false });
  await writeFile(path.join(fixture.store.workspaceRoot, "first.txt"), "first source evidence ".repeat(400));
  await writeFile(path.join(fixture.store.workspaceRoot, "second.txt"), "second source evidence ".repeat(400));
  const calls: Array<{ auxiliary: boolean; context: Context; options: SimpleStreamOptions | undefined; model: string; contextWindow: number }> = [];
  let normal = 0;
  vi.spyOn(fixture.registry.models, "streamSimple").mockImplementation((model, context, requestOptions) => {
    const auxiliary = context.systemPrompt?.includes("checkpoint inside an unfinished Run") ?? false;
    calls.push({ auxiliary, context: structuredClone(context), options: requestOptions, model: model.id, contextWindow: model.contextWindow });
    if (!auxiliary) normal += 1;
    const response = auxiliary
      ? options.auxiliaryResult === "transport error"
        ? fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" })
        : fauxAssistantMessage(options.auxiliaryResult === "malformed" ? "malformed summary" : JSON.stringify(summary))
      : options.fallback && normal === 3
        ? fauxAssistantMessage("", { stopReason: "error", errorMessage: "503 service unavailable" })
        : normal <= 2
        ? fauxAssistantMessage(fauxToolCall("read_file", { path: normal === 1 ? "first.txt" : "second.txt" }, { id: `read-${normal}` }), { stopReason: "toolUse" })
        : fauxAssistantMessage('{"answer":"verified"}');
    Object.assign(response, { api: model.api, provider: model.provider, model: model.id });
    response.usage = { input: auxiliary ? 3_000 : 1_000, output: auxiliary ? 300 : 100, cacheRead: 0, cacheWrite: 0,
      totalTokens: auxiliary ? 3_300 : 1_100,
      cost: { input: auxiliary ? 0.003 : 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: auxiliary ? 0.003 : 0.001 } };
    const stream = createAssistantMessageEventStream();
    if (response.stopReason === "error" || response.stopReason === "aborted") stream.push({ type: "error", reason: response.stopReason, error: response });
    else stream.push({ type: "done", reason: response.stopReason, message: response });
    return stream;
  });
  return { ...fixture, calls, execute: async () => fixture.supervisor.collect(await fixture.supervisor.start(fixture.request({ outputSchema: {
    type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false,
  }, ...(options.fallback ? { modelRoute: { fallbackModels: [{ provider: fixture.model.provider, id: "bounded-route-compaction" }] } } : {}) }))) };
}

function sumUsage(events: RunEvent[]): Usage {
  return events.filter((event) => event.type === "model.response").reduce((total, event) => {
    const usage = (event.payload as { usage: Usage }).usage;
    return { inputTokens: total.inputTokens + usage.inputTokens, outputTokens: total.outputTokens + usage.outputTokens,
      cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens, cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
      costUsd: total.costUsd + usage.costUsd };
  }, emptyUsage());
}
