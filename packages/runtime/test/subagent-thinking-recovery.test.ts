import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider, fauxThinking, fauxToolCall,
  type Api, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupModelSessionFixtures, createModelSessionFixture, SYNTHETIC_ROUTE_KEY } from "./subagent-model-session-fixture.js";
import { aggregateRunUsage } from "../src/run-replay.js";

const repeated = "We should keep reconsidering the same general plan without taking action. ".repeat(90);
const usage = { input: 100, output: 20, cacheRead: 10, cacheWrite: 5, totalTokens: 135,
  cost: { input: 0.01, output: 0.02, cacheRead: 0.002, cacheWrite: 0.001, total: 0.033 } };
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); })));
afterEach(async () => { vi.unstubAllGlobals(); await cleanupModelSessionFixtures(); });

function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
function response(model: Model<Api>, content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
  return { ...fauxAssistantMessage(content), api: model.api, provider: model.provider, model: model.id, usage, stopReason };
}

async function fixture(mode: "terminal" | "delayed" | "second_stall" = "delayed", maxCostUsd?: number) {
  const f = await createModelSessionFixture({ nativeAccounting: true, routeCredential: true, reasoning: true, timeoutMs: 15_000,
    ...(maxCostUsd === undefined ? {} : { runLimits: { maxCostUsd } }) });
  const first = createAssistantMessageEventStream(), aborted = deferred();
  const calls: Array<{ context: Context; options: SimpleStreamOptions | undefined }> = [];
  const dispatch = vi.fn((model: Model<Api>, context: Context, options?: SimpleStreamOptions) => {
    calls.push({ context, options });
    if (calls.length === 1) {
      options?.signal?.addEventListener("abort", aborted.resolve, { once: true });
      if (mode === "terminal") first.push({ type: "done", reason: "stop",
        message: response(model, [fauxThinking("Inspect the existing repository next.")]) });
      else first.push({ type: "thinking_delta", contentIndex: 0, delta: repeated, partial: response(model, []) });
      return first;
    }
    expect(JSON.stringify(context.messages)).toContain("Internal thinking-loop redirect");
    expect(options?.reasoning).toBe("minimal");
    expect(options?.apiKey).toBe(SYNTHETIC_ROUTE_KEY);
    expect(typeof options?.onResponse).toBe("function");
    expect(f.source!.pending()).toEqual([]);
    const source = createAssistantMessageEventStream();
    source.push({ type: "done", reason: "stop", message: response(model,
      mode === "second_stall" ? [fauxThinking("Still considering the same next step.")] : [{ type: "text", text: '"recovered"' }]) });
    return source;
  });
  f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
  const handle = await f.supervisor.start(f.request({ outputSchema: { type: "string" } }));
  const result = f.supervisor.collect(handle);
  const late = (stopReason: "error" | "toolUse" = "toolUse") => {
    const message = response(f.model, [{ type: "text", text: "LATE_OUTPUT_MUST_STAY_QUARANTINED" },
      fauxToolCall("read_file", { path: "late-never-read.txt" }, { id: "late_quarantined_tool" })], stopReason);
    first.push(stopReason === "error" ? { type: "error", reason: "error", error: message } : { type: "done", reason: stopReason, message });
  };
  return { ...f, first, aborted, dispatch, calls, result, late };
}

it.each(["terminal", "delayed"] as const)("native child recovers %s known thought attempt once and checkpoints only delivered output", async (mode) => {
  const f = await fixture(mode);
  if (mode === "delayed") {
    await f.aborted.promise;
    await vi.waitFor(async () => {
      const task = f.store.listSubagentTasks(f.thread.id)[0]!;
      const responses = (await f.store.listRunEvents(task.childRunId!)).filter((event) => event.type === "model.response");
      expect(responses).toHaveLength(1);
      expect(responses[0]!.payload).toMatchObject({ stopReason: "aborted", outputDisposition: "suppressed_thinking_recovery" });
    });
    expect(f.dispatch).toHaveBeenCalledOnce();
    f.late();
  }
  const result = await f.result;
  expect(result.status, result.task.error).toBe("completed");
  expect(result.task.output).toBe("recovered");
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  const events = await f.store.listRunEvents(result.task.childRunId!);
  const responses = events.filter((event) => event.type === "model.response");
  expect(responses).toHaveLength(2);
  expect(responses[0]!.payload).toMatchObject({ outputDisposition: "suppressed_thinking_recovery",
    stopReason: mode === "terminal" ? "stop" : "aborted", toolCalls: [] });
  expect(events.filter((event) => event.type === "model.thinking_loop.detected")[0]!.payload)
    .toMatchObject({ action: "retry", recoveryReadiness: "known" });
  expect(events.filter((event) => event.type === "subagent.child.checkpoint_committed")).toHaveLength(2);
  expect(events.some((event) => event.type === "tool.completed")).toBe(false);
  expect(JSON.stringify(events.filter((event) => event.type === "model.response" || event.type === "message.assistant")))
    .not.toContain("LATE_OUTPUT_MUST_STAY_QUARANTINED");
  const child = await f.store.modelAccountingRepository.readRunAccounting(result.task.childRunId!);
  const parent = await f.store.modelAccountingRepository.readRunAccounting(f.run.id);
  expect(child.usage).toEqual({ inputTokens: 200, outputTokens: 40, cacheReadTokens: 20, cacheWriteTokens: 10, costUsd: 0.066 });
  expect(child.usage).toEqual(result.task.usage);
  expect(parent.usage).toEqual(child.usage);
  expect(aggregateRunUsage(events, [])).toEqual(child.usage);
  const physicalIds = events.filter((event) => event.type === "model.accounting.prepared")
    .map((event) => (event.payload as unknown as { attribution: { physicalId: string } }).attribution.physicalId);
  expect(new Set(physicalIds).size).toBe(2);
});

it("native child stops on immutable incomplete receipt and keeps the first logical response exactly once", async () => {
  const f = await fixture();
  await f.aborted.promise; f.late("error");
  const result = await f.result;
  expect(result.status).toBe("failed");
  expect(result.task.output).toBeUndefined();
  expect(f.dispatch).toHaveBeenCalledOnce();
  const events = await f.store.listRunEvents(result.task.childRunId!);
  expect(events.filter((event) => event.type === "model.response")).toHaveLength(1);
  expect(events.find((event) => event.type === "model.thinking_loop.detected")!.payload)
    .toMatchObject({ action: "finalize", recoveryReadiness: "incomplete" });
  expect((await f.store.modelAccountingRepository.readRunAccounting(result.task.childRunId!)).usageStatus).toBe("incomplete");
});

it("native child second stall ends after two physical attempts without accepting hidden output", async () => {
  const f = await fixture("second_stall");
  await f.aborted.promise; f.late();
  const result = await f.result;
  expect(result.status).toBe("failed");
  expect(result.task.output).toBeUndefined();
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  const events = await f.store.listRunEvents(result.task.childRunId!);
  expect(events.filter((event) => event.type === "model.response")).toHaveLength(2);
  expect(events.filter((event) => event.type === "model.thinking_loop.detected").map((event) =>
    (event.payload as unknown as { action: string }).action)).toEqual(["retry", "finalize"]);
});

it.each([false, true])("bounds routed child thinking recovery with native accounting %s", async (nativeAccounting) => {
  const f = await createModelSessionFixture({ nativeAccounting, reasoning: true, timeoutMs: 15_000 });
  const fallback = fauxProvider({ provider: "child-thinking-fallback", models: [{ id: "fallback", reasoning: true }] });
  const calls: string[] = [];
  const dispatch = vi.fn((model: Model<Api>, context: Context) => {
    calls.push(`${model.provider}/${model.id}`);
    if (calls.length > 3) throw new Error("Unexpected fourth physical child model call");
    if (calls.length === 2) expect(JSON.stringify(context.messages)).toContain("Internal thinking-loop redirect");
    const source = createAssistantMessageEventStream();
    const message = response(model, [fauxThinking("Inspect the existing repository next.")]);
    if (calls.length === 2) source.push({ type: "error", reason: "error", error: {
      ...message, content: [], stopReason: "error", errorMessage: "HTTP 503 service unavailable",
    } });
    else source.push({ type: "done", reason: "stop", message });
    return source;
  });
  f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
  f.registry.registerProvider({ ...fallback.provider, stream: dispatch, streamSimple: dispatch });
  const handle = await f.supervisor.start(f.request({ outputSchema: { type: "string" },
    modelRoute: { fallbackModels: [{ provider: fallback.provider.id, id: "fallback" }] } }));
  const result = await f.supervisor.collect(handle);
  expect(result.status).toBe("failed");
  expect(result.task.output).toBeUndefined();
  const primary = `${f.model.provider}/${f.model.id}`;
  // Native child admission stops at the incomplete A retry receipt. Explicit
  // legacy mode reaches B and exercises the shared per-open thinking retry flag.
  expect(calls).toEqual(nativeAccounting ? [primary, primary] : [primary, primary, `${fallback.provider.id}/fallback`]);
  const events = await f.store.listRunEvents(result.task.childRunId!);
  const readiness = nativeAccounting ? "known" : "legacy_unaccounted";
  expect(events.filter((event) => event.type === "model.thinking_loop.detected").map((event) => event.payload)).toEqual([
    expect.objectContaining({ action: "retry", recoveryReadiness: readiness }),
    ...(nativeAccounting ? [] : [expect.objectContaining({ action: "finalize", recoveryReadiness: readiness })]),
  ]);
  expect(events.filter((event) => event.type === "model.response")).toHaveLength(calls.length);
  expect(events.filter((event) => event.type === "tool.started")).toEqual([]);
  if (nativeAccounting) {
    expect((await f.store.modelAccountingRepository.readRunAccounting(result.task.childRunId!)).usageStatus).toBe("incomplete");
    expect(events.filter((event) => event.type === "model.accounting.prepared")).toHaveLength(2);
    expect(f.source!.pending()).toEqual([]);
  }
});

it("a known receipt still cannot pass fresh child budget admission", async () => {
  const f = await fixture("terminal", 0.02);
  const result = await f.result;
  expect(result.status).toBe("failed");
  expect(f.dispatch).toHaveBeenCalledOnce();
  const events = await f.store.listRunEvents(result.task.childRunId!);
  expect(events.find((event) => event.type === "model.thinking_loop.detected")!.payload)
    .toMatchObject({ action: "finalize", recoveryReadiness: "known" });
  expect((await f.store.modelAccountingRepository.readRunAccounting(result.task.childRunId!)).usage.costUsd).toBe(0.033);
});

it("root cancellation interrupts pending readiness and late usage cannot restart or complete the child", async () => {
  const f = await fixture();
  await f.aborted.promise; f.parent.abort();
  const result = await f.result;
  expect(result.status).toBe("cancelled");
  f.late();
  await vi.waitFor(async () => expect((await f.store.modelAccountingRepository.readRunAccounting(result.task.childRunId!)).usageStatus).toBe("complete"));
  expect(f.dispatch).toHaveBeenCalledOnce();
  const task = f.store.listSubagentTasks(f.thread.id)[0]!;
  expect(task.status).toBe("cancelled");
  expect(task.output).toBeUndefined();
});
