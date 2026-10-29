import { rm } from "node:fs/promises";
import {
  createAssistantMessageEventStream, fauxProvider,
  type AssistantMessage, type Context, type Model, type Api, type StreamOptions,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { createLocalModelCallAdmission } from "../src/model-call-local-admission.js";
import { drainModelCallAccounting } from "../src/model-call-admission.js";
import { createRunReplaySnapshot } from "../src/run-replay.js";
import { accountingFixture } from "./model-accounting-fixture.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); })));
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const f = await accountingFixture();
  cleanups.push(async () => { await f.store.shutdown(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
  const registry = new ModelRegistry(undefined, createLocalModelCallAdmission(f.source), f.store.modelAccountingRepository);
  const faux = fauxProvider({ provider: "native-thinking-main", models: [{ id: "reasoning", reasoning: true, maxTokens: 4096 }] });
  registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "reasoning" })!;
  const message = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage => ({
    ...f.fixture.message, api: model.api, provider: model.provider, model: model.id, content, stopReason,
  });
  const runtime = processReadyAgentRuntime(f.store, registry);
  const run = (signal?: AbortSignal) => runtime.runPrompt({ threadId: f.thread.id, text: "Return one concrete result.",
    model: { provider: model.provider, id: model.id }, ...(signal ? { signal } : {}) });
  return { ...f, registry, faux, model, message, run };
}

function providerScript(f: Awaited<ReturnType<typeof fixture>>, first: ReturnType<typeof createAssistantMessageEventStream>,
  onDispatch?: (index: number, context: Context, options?: StreamOptions) => void) {
  let calls = 0;
  const dispatch = vi.fn((_model: Model<Api>, context: Context, options?: StreamOptions) => {
    const index = ++calls;
    onDispatch?.(index, context, options);
    if (index === 1) return first;
    if (index > 3) throw new Error("Unexpected extra physical model call");
    const source = createAssistantMessageEventStream();
    const message = f.message([{ type: "text", text: index === 2 ? "Concrete recovered result." : '{"facts":[]}' }]);
    source.push({ type: "done", reason: "stop", message });
    return source;
  });
  f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
  return dispatch;
}

function startLoop(f: Awaited<ReturnType<typeof fixture>>, source: ReturnType<typeof createAssistantMessageEventStream>) {
  const delta = "We should keep reconsidering the same general plan without taking action. ".repeat(90);
  const partial = f.message([{ type: "thinking", thinking: delta }]);
  source.push({ type: "thinking_delta", contentIndex: 0, delta, partial });
}

it("recovers a native thinking-only terminal with fresh captures and exact physical usage", async () => {
  const f = await fixture(), first = createAssistantMessageEventStream();
  const dispatch = providerScript(f, first, (index, context) => {
    if (index === 2) expect(JSON.stringify(context.messages)).toContain("Internal thinking-loop redirect");
  });
  first.push({ type: "done", reason: "stop", message: f.message([{ type: "thinking", thinking: "Inspect src/graph.mjs next." }]) });
  const run = await f.run();
  expect(run.status, run.error).toBe("completed");
  const events = await f.store.listRunEvents(run.id);
  expect(events.filter((event) => event.type === "model.thinking_loop.detected").map((event) => event.payload)).toEqual([
    expect.objectContaining({ action: "retry", attempt: 1, recoveryReadiness: "known", reason: "thinking_only_terminal" }),
  ]);
  const prepared = events.filter((event) => event.type === "model.accounting.prepared");
  expect(prepared).toHaveLength(3);
  expect(new Set(prepared.map((event) => (event.payload as any).attribution.physicalId)).size).toBe(3);
  expect(prepared.map((event) => (event.payload as any).attribution.phase)).toEqual(["agent_turn", "agent_turn", "memory_extraction"]);
  expect(prepared.map((event) => (event.payload as any).attribution.capture.envelope.turnIndex)).toEqual([0, 1, 2]);
  expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(3);
  expect(events.filter((event) => event.type === "message.assistant").at(-1)?.payload).toMatchObject({ text: "Concrete recovered result." });
  const accounting = await f.store.modelAccountingRepository.readRunAccounting(run.id);
  expect(accounting.usage).toEqual({ inputTokens: 300, outputTokens: 60, cacheReadTokens: 30, cacheWriteTokens: 15, costUsd: 0.099 });
  expect(accounting.usageStatus).toBe("complete");
  expect((await createRunReplaySnapshot(f.store, f.thread.id, run.id)).metrics.inputTokens).toBe(300);
  expect(dispatch).toHaveBeenCalledTimes(3);
  expect(f.source.pending()).toHaveLength(0);
});

it("refreshes the physical debit before admitting a thinking retry under the Run hard budget", async () => {
  const f = await fixture(), first = createAssistantMessageEventStream();
  await f.store.updateAgent(f.profile.id, { runLimits: { maxTurns: 24, maxTotalTokens: 100_000,
    maxCostUsd: 0.02, timeoutMs: 120_000 } });
  const dispatch = providerScript(f, first);
  first.push({ type: "done", reason: "stop", message: f.message([{ type: "thinking", thinking: "Inspect src/graph.mjs next." }]) });
  const run = await f.run();
  expect(run.status).toBe("failed");
  expect(run.outcome).toBe("paused_budget");
  expect(dispatch).toHaveBeenCalledOnce();
  const events = await f.store.listRunEvents(run.id);
  expect(events.find((event) => event.type === "model.thinking_loop.detected")?.payload)
    .toMatchObject({ action: "budget_exhausted", recoveryReadiness: "known" });
  expect(events.filter((event) => event.type === "model.accounting.prepared")).toHaveLength(1);
  expect((await f.store.modelAccountingRepository.readRunAccounting(run.id)).usage.costUsd).toBe(0.033);
});

it("shares one thinking retry across native routed candidates after a retryable provider failure", async () => {
  const f = await fixture();
  const fallback = fauxProvider({ provider: "native-thinking-fallback", models: [{ id: "fallback", reasoning: true }] });
  const calls: string[] = [];
  const dispatch = vi.fn((model: Model<Api>, context: Context) => {
    calls.push(`${model.provider}/${model.id}`);
    if (calls.length > 3) throw new Error("Unexpected fourth physical model call");
    if (calls.length === 2) expect(JSON.stringify(context.messages)).toContain("Internal thinking-loop redirect");
    const source = createAssistantMessageEventStream();
    const message = { ...f.message([{ type: "thinking", thinking: "Inspect the existing repository next." }]),
      api: model.api, provider: model.provider, model: model.id };
    if (calls.length === 2) source.push({ type: "error", reason: "error", error: {
      ...message, content: [], stopReason: "error", errorMessage: "HTTP 503 service unavailable",
    } });
    else source.push({ type: "done", reason: "stop", message });
    return source;
  });
  f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
  f.registry.registerProvider({ ...fallback.provider, stream: dispatch, streamSimple: dispatch });
  const run = await processReadyAgentRuntime(f.store, f.registry).runPrompt({
    threadId: f.thread.id, text: "Return one concrete result.", model: { provider: f.model.provider, id: f.model.id },
    modelRoute: { role: "reasoning", fallbackModels: [{ provider: fallback.provider.id, id: "fallback" }] },
  });
  expect(run.status).toBe("failed");
  expect(calls).toEqual([`${f.model.provider}/${f.model.id}`, `${f.model.provider}/${f.model.id}`, `${fallback.provider.id}/fallback`]);
  const events = await f.store.listRunEvents(run.id);
  expect(events.filter((event) => event.type === "model.thinking_loop.detected").map((event) => event.payload)).toEqual([
    expect.objectContaining({ action: "retry", recoveryReadiness: "known" }),
    expect.objectContaining({ action: "finalize", recoveryReadiness: "known" }),
  ]);
  expect(events.filter((event) => event.type === "model.accounting.prepared")).toHaveLength(3);
  expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(3);
  expect(events.filter((event) => event.type === "tool.started")).toEqual([]);
  expect((await f.store.modelAccountingRepository.readRunAccounting(run.id)).usageStatus).toBe("incomplete");
  expect(f.source.pending()).toEqual([]);
});

it("waits for this attempt's Store projection and ACK while quarantining late raw text and tools", async () => {
  const f = await fixture(), first = createAssistantMessageEventStream(), cancelled = deferred(), committed = deferred(), release = deferred();
  const reconcile = f.store.modelAccountingRepository.reconcile.bind(f.store.modelAccountingRepository);
  vi.spyOn(f.store.modelAccountingRepository, "reconcile").mockImplementationOnce(async (delivery) => {
    const result = await reconcile(delivery); committed.resolve(); await release.promise; return result;
  });
  const dispatch = providerScript(f, first, (index, _context, options) => {
    if (index === 1) options?.signal?.addEventListener("abort", cancelled.resolve, { once: true });
    if (index === 2) expect(f.source.pending()).toHaveLength(0);
  });
  startLoop(f, first);
  const pending = f.run();
  await Promise.race([cancelled.promise, pending.then((run) => { throw new Error(`Run ended before detection: ${JSON.stringify(run)}`); })]);
  expect(dispatch).toHaveBeenCalledOnce();
  const late = f.message([{ type: "text", text: "LATE_RAW_TEXT_MUST_STAY_QUARANTINED" },
    { type: "toolCall", id: "late_tool_must_never_execute", name: "read_file", arguments: { path: "missing.txt" } }], "toolUse");
  first.push({ type: "done", reason: "toolUse", message: late });
  await Promise.race([committed.promise, pending.then((run) => { throw new Error(`Run ended before projection: ${JSON.stringify(run)}`); })]);
  expect(f.source.pending()).toHaveLength(1);
  expect(dispatch).toHaveBeenCalledOnce();
  release.resolve();
  const run = await pending;
  expect(run.status, run.error).toBe("completed");
  expect(dispatch).toHaveBeenCalledTimes(3);
  const events = await f.store.listRunEvents(run.id);
  expect(events.filter((event) => event.type === "tool.started")).toHaveLength(0);
  expect(JSON.stringify(events)).not.toContain("LATE_RAW_TEXT_MUST_STAY_QUARANTINED");
  expect(JSON.stringify(events)).not.toContain("late_tool_must_never_execute");
  expect(events.find((event) => event.type === "model.thinking_loop.detected")?.payload).toMatchObject({ action: "retry", recoveryReadiness: "known" });
  expect((await f.store.modelAccountingRepository.readRunAccounting(run.id)).usage.costUsd).toBe(0.099);
});

it.each(["incomplete", "ack_failure"] as const)("does not retry when late physical readiness is %s", async (failure) => {
  const f = await fixture(), first = createAssistantMessageEventStream(), cancelled = deferred();
  const dispatch = providerScript(f, first, (index, _context, options) => {
    if (index === 1) options?.signal?.addEventListener("abort", cancelled.resolve, { once: true });
  });
  if (failure === "ack_failure") vi.spyOn(f.source, "acknowledge").mockImplementationOnce(() => { throw new Error("Injected ACK failure"); });
  startLoop(f, first);
  const pending = f.run();
  await Promise.race([cancelled.promise, pending.then((run) => { throw new Error(`Run ended before detection: ${JSON.stringify(run)}`); })]);
  const message = f.message([{ type: "thinking", thinking: "Late final reasoning" }], failure === "incomplete" ? "aborted" : "stop");
  if (failure === "incomplete") first.push({ type: "error", reason: "aborted", error: message });
  else first.push({ type: "done", reason: "stop", message });
  const run = await pending;
  expect(run.status).toBe("failed");
  expect(dispatch).toHaveBeenCalledOnce();
  const before = await f.store.listRunEvents(run.id);
  expect(before.find((event) => event.type === "model.thinking_loop.detected")?.payload).toMatchObject({ action: "finalize",
    recoveryReadiness: failure === "incomplete" ? "incomplete" : "accounting_failed" });
  await drainModelCallAccounting(f.registry.models);
  expect(dispatch).toHaveBeenCalledOnce();
  expect((await f.store.listRunEvents(run.id)).filter((event) => event.type !== "model.usage.reconciled"))
    .toEqual(before.filter((event) => event.type !== "model.usage.reconciled"));
  expect(f.store.listRuns(f.thread.id).find((item) => item.id === run.id)?.status).toBe("failed");
});

it("cancels a native recovery wait immediately and keeps later usage from reviving execution", async () => {
  const f = await fixture(), first = createAssistantMessageEventStream(), cancelled = deferred(), abort = new AbortController();
  const dispatch = providerScript(f, first, (index, _context, options) => {
    if (index === 1) options?.signal?.addEventListener("abort", cancelled.resolve, { once: true });
  });
  startLoop(f, first);
  const pending = f.run(abort.signal);
  await Promise.race([cancelled.promise, pending.then((run) => { throw new Error(`Run ended before detection: ${JSON.stringify(run)}`); })]);
  abort.abort();
  const run = await pending;
  expect(run.status).toBe("cancelled");
  expect(dispatch).toHaveBeenCalledOnce();
  const before = await f.store.listRunEvents(run.id);
  first.push({ type: "done", reason: "stop", message: f.message([{ type: "text", text: "Late answer" }]) });
  await drainModelCallAccounting(f.registry.models);
  expect((await f.store.listRunEvents(run.id)).filter((event) => event.type !== "model.usage.reconciled")).toEqual(before);
  expect((await f.store.modelAccountingRepository.readRunAccounting(run.id)).usage.costUsd).toBe(0.033);
  expect(dispatch).toHaveBeenCalledOnce();
});
