import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall,
  type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupModelSessionFixtures, createModelSessionFixture } from "./subagent-model-session-fixture.js";
import { aggregateRunUsage, createRunReplaySnapshot } from "../src/run-replay.js";
import { assertModelContextEnvelopeEventBindings } from "../src/model-context-envelope.js";

const usage = { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 135,
  cost: { input: 0.01, output: 0.02, cacheRead: 0.002, cacheWrite: 0.001, total: 0.033 } };
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); })));
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await cleanupModelSessionFixtures(); });

it.each([
  { nativeAccounting: true, usageStatus: "partial", thinkingRetry: false },
  { nativeAccounting: true, usageStatus: "unknown", thinkingRetry: false },
  { nativeAccounting: false, usageStatus: "unknown", thinkingRetry: false },
  { nativeAccounting: false, usageStatus: "partial", thinkingRetry: true },
] as const)("bounds child overflow native=$nativeAccounting usage=$usageStatus thinking=$thinkingRetry", async ({ nativeAccounting, usageStatus, thinkingRetry }) => {
  const f = await createModelSessionFixture({ nativeAccounting, reasoning: thinkingRetry, timeoutMs: 15_000, maxTurns: 5 });
  Object.assign(f.model, { contextWindow: 100_000, maxTokens: 1_200 });
  await writeFile(path.join(f.store.workspaceRoot, "first.txt"), "first immutable source evidence ".repeat(400));
  await writeFile(path.join(f.store.workspaceRoot, "second.txt"), "second immutable source evidence ".repeat(400));
  const ordinary: Context[] = [], auxiliary: Context[] = [];
  const dispatch = vi.fn((model: Model<Api>, context: Context, _options?: SimpleStreamOptions) => {
    const isSummary = context.systemPrompt?.includes("checkpoint inside an unfinished Run");
    const stream = createAssistantMessageEventStream();
    let content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop";
    if (isSummary) {
      auxiliary.push(structuredClone(context));
      content = [{ type: "text", text: JSON.stringify({ summary: "Read both named source files; final answer still needed.",
        decisions: [], openLoops: ["Return the requested result"], artifacts: ["first.txt", "second.txt"] }) }];
    } else {
      ordinary.push(structuredClone(context));
      if (ordinary.length < 3) { content = [fauxToolCall("read_file", { path: ordinary.length === 1 ? "first.txt" : "second.txt" }, { id: `read-${ordinary.length}` })]; stopReason = "toolUse"; }
      else if (ordinary.length === 3) { content = []; stopReason = "error"; }
      else if (ordinary.length === 4 && thinkingRetry) content = [{ type: "thinking", thinking: "Inspect the named source files next." }];
      else content = [{ type: "text", text: '"recovered"' }];
    }
    const message: AssistantMessage = { ...fauxAssistantMessage(content), api: model.api, provider: model.provider, model: model.id,
      usage: stopReason === "error" && usageStatus === "unknown" ? zero : usage, stopReason,
      ...(stopReason === "error" ? { errorMessage: "context_length_exceeded" } : {}) };
    stream.push(stopReason === "error" ? { type: "error", reason: "error", error: message } : { type: "done", reason: stopReason, message });
    return stream;
  });
  f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
  const handle = await f.supervisor.start(f.request({ outputSchema: { type: "string" } }));
  const result = await f.supervisor.collect(handle);
  const events = await f.store.listRunEvents(result.task.childRunId!);
  expect(result.status, result.task.error).toBe(nativeAccounting ? "failed" : "completed");
  expect(ordinary).toHaveLength(nativeAccounting ? 3 : thinkingRetry ? 5 : 4);
  expect(auxiliary).toHaveLength(nativeAccounting ? 0 : 1);
  expect(events.filter((event) => event.type === "model.context.overflow").map((event) => event.payload)).toEqual([
    expect.objectContaining({ action: nativeAccounting ? "finalize" : "retry",
      recoveryReadiness: nativeAccounting ? "incomplete" : "legacy_unaccounted" }),
  ]);
  const failed = events.filter((event) => event.type === "model.response" && (event.payload as Record<string, unknown>)["stopReason"] === "error");
  expect(failed).toHaveLength(1); expect(failed[0]!.payload).not.toHaveProperty("outputDisposition");
  expect(result.task.turnCount).toBe(3);
  const child = f.store.listRuns(f.thread.id).find((run) => run.id === result.task.childRunId)!;
  expect(aggregateRunUsage(events, [])).toEqual(child.usage);
  expect((await createRunReplaySnapshot(f.store, f.thread.id, child.id)).metrics.costUsd).toBe(child.usage.costUsd);
  // Child ordinary captures stay exact role requests; no compiler package is manufactured.
  expect(() => assertModelContextEnvelopeEventBindings(events)).not.toThrow();
  const raw = await readFile(path.join(f.store.dataRoot, "subagent-working-sets", `${child.subagent!.checkpoint!.capsuleSha256}.json`), "utf8");
  expect(raw).toContain("first immutable source evidence ".repeat(400));
  expect(raw).not.toContain("Read both named source files");
  if (nativeAccounting) {
    expect(result.task.output).toBeUndefined();
    expect(events.filter((event) => event.type === "model.usage.reconciled").at(-1)?.payload)
      .toMatchObject({ observation: { stopReason: "error", usageStatus } });
    expect((await f.store.modelAccountingRepository.readRunAccounting(child.id)).usageStatus).toBe("incomplete");
    expect(f.source!.pending()).toHaveLength(0);
  } else {
    expect(result.task.output).toBe("recovered");
    expect(JSON.stringify(ordinary.at(-1)!.messages).length).toBeLessThan(JSON.stringify(ordinary[2]!.messages).length);
    expect(ordinary.every((context) => context.systemPrompt === ordinary[0]!.systemPrompt)).toBe(true);
    expect(ordinary.every((context) => JSON.stringify(context.tools) === JSON.stringify(ordinary[0]!.tools))).toBe(true);
    if (thinkingRetry) {
      expect(JSON.stringify(ordinary[4]!.messages)).toContain("Internal thinking-loop redirect");
      expect(JSON.stringify(ordinary[4]!.messages)).toContain("Read both named source files");
      expect(JSON.stringify(ordinary[4]!.messages)).not.toContain("first immutable source evidence");
    }
  }
});
