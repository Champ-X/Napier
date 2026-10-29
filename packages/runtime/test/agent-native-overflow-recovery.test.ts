import { rm } from "node:fs/promises";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRegistry } from "../src/models.js";
import { createLocalModelCallAdmission } from "../src/model-call-local-admission.js";
import { accountingFixture } from "./model-accounting-fixture.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { assertModelRequestEvidenceBindings } from "../src/model-prompt-evidence-bindings.js";
import { aggregateRunUsage, createRunReplaySnapshot } from "../src/run-replay.js";
import { RunBudgetTracker } from "../src/run-budget.js";

const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden"); })));
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await Promise.all(cleanups.splice(0).map((close) => close())); });

it.each([false, true])("does not redispatch native main overflow after incomplete usage (routed=$routed)", async (routed) => {
  const f = await accountingFixture();
  cleanups.push(async () => { await f.store.shutdown(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
  const registry = new ModelRegistry(undefined, createLocalModelCallAdmission(f.source), f.store.modelAccountingRepository);
  const provider = fauxProvider({ provider: "native-overflow-main", tokensPerSecond: 1_000_000,
    models: [{ id: "bounded", reasoning: false, contextWindow: 32_000, maxTokens: 1_024 },
      { id: "fallback", reasoning: false, contextWindow: 32_000, maxTokens: 1_024 }] });
  registry.registerProvider(provider.provider);
  const model = registry.resolve({ provider: provider.provider.id, id: "bounded" })!;
  const response = (text: string, overflow = false): AssistantMessage => ({ ...fauxAssistantMessage(text),
    api: model.api, provider: model.provider, model: model.id, usage: f.fixture.message.usage,
    ...(overflow ? { stopReason: "error", errorMessage: routed ? "HTTP 500: context_length_exceeded" : "context_length_exceeded" } : {}) });
  const runtime = processReadyAgentRuntime(f.store, registry);
  const run = (text: string) => runtime.runPrompt({ threadId: f.thread.id, text,
    model: { provider: model.provider, id: model.id },
    ...(routed ? { modelRoute: { role: "reasoning" as const, fallbackModels: [{ provider: model.provider, id: "fallback" }] } } : {}) });
  provider.setResponses([response("Historical response"), response('{"facts":[]}')]);
  expect((await run("Historical context " + "x".repeat(2_000))).status).toBe("completed");
  const seen: Context[] = [];
  provider.setResponses([
    (context) => { seen.push(structuredClone(context)); return response("", true); },
    (context) => { seen.push(structuredClone(context)); return response("Unexpected recovered response"); },
    response('{"facts":[]}'),
  ]);
  const result = await run("Latest protected request");
  const events = await f.store.listRunEvents(result.id);
  const observed = { status: result.status, physicalCalls: seen.length,
    overflow: events.filter((event) => event.type === "model.context.overflow").map((event) => event.payload),
    accounting: await f.store.modelAccountingRepository.readRunAccounting(result.id) };
  expect(observed, JSON.stringify(observed)).toMatchObject({ status: "failed", physicalCalls: 1 });
  expect(observed.overflow).toEqual([expect.objectContaining({ action: "finalize", recoveryReadiness: "incomplete" })]);
  expect(events.filter((event) => event.type === "model.accounting.prepared")).toHaveLength(1);
  expect(events.filter((event) => event.type === "model.usage.reconciled")).toHaveLength(1);
  expect((await f.store.modelAccountingRepository.readRunAccounting(result.id)).usageStatus).toBe("incomplete");
  expect(f.source.pending()).toHaveLength(0);
  expect(() => assertModelRequestEvidenceBindings(events)).not.toThrow();
  const overflow = events.find((event) => event.type === "model.context.overflow")!;
  expect(() => assertModelRequestEvidenceBindings(events.map((event) => event.id === overflow.id
    ? { ...event, payload: { ...(event.payload as Record<string, unknown>), usage: {} } } as typeof event : event)))
    .toThrow("overflow diagnostic cannot own usage");
  expect(() => assertModelRequestEvidenceBindings(events.filter((event) => event.type !== "model.response")))
    .toThrow("terminal binding count is invalid");
});

it("keeps the compacted main request when a legacy overflow is followed by thinking recovery", async () => {
  const f = await accountingFixture();
  cleanups.push(async () => { await f.store.shutdown(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
  const provider = fauxProvider({ provider: "legacy-overflow-thinking", tokensPerSecond: 1_000_000,
    models: [{ id: "bounded", reasoning: true, contextWindow: 32_000, maxTokens: 1_024 }] });
  const registry = new ModelRegistry(); registry.registerProvider(provider.provider);
  const runtime = processReadyAgentRuntime(f.store, registry);
  const run = (text: string) => runtime.runPrompt({ threadId: f.thread.id, text, model: { provider: provider.provider.id, id: "bounded" } });
  provider.setResponses([fauxAssistantMessage("Historical response"), fauxAssistantMessage('{"facts":[]}')]);
  expect((await run("Historical context " + "x".repeat(2_000))).status).toBe("completed");
  const seen: Context[] = [];
  provider.setResponses([
    (context) => { seen.push(structuredClone(context)); return fauxAssistantMessage("", { stopReason: "error", errorMessage: "context_length_exceeded" }); },
    (context) => { seen.push(structuredClone(context)); return fauxAssistantMessage([{ type: "thinking", thinking: "Inspect the existing repository next." }]); },
    (context) => { seen.push(structuredClone(context)); return fauxAssistantMessage("Recovered result"); },
    fauxAssistantMessage('{"facts":[]}'),
  ]);
  const result = await run("Latest protected request");
  expect(result.status, result.error).toBe("completed");
  expect(seen).toHaveLength(3);
  expect(JSON.stringify(seen[0]!.messages)).toContain("Historical context");
  expect(JSON.stringify(seen[1]!.messages)).not.toContain("Historical context");
  expect(JSON.stringify(seen[2]!.messages)).not.toContain("Historical context");
  expect(JSON.stringify(seen[2]!.messages)).toContain("Internal thinking-loop redirect");
  const events = await f.store.listRunEvents(result.id);
  expect(events.filter((event) => event.type === "model.response" &&
    (event.payload as Record<string, unknown>)["stopReason"] === "error")).toHaveLength(1);
  expect(aggregateRunUsage(events, [])).toEqual(result.usage);
  expect(() => assertModelRequestEvidenceBindings(events)).not.toThrow();
});

it("retains one legacy usage owner when overflow publication cancels the caller", async () => {
  const f = await accountingFixture();
  cleanups.push(async () => { await f.store.shutdown(); f.source.close(); await rm(f.root, { recursive: true, force: true }); });
  await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
  const provider = fauxProvider({ provider: "legacy-overflow-cancel", models: [{ id: "bounded", reasoning: false }] });
  const registry = new ModelRegistry();
  const dispatch = vi.fn(() => {
    const source = createAssistantMessageEventStream();
    const error: AssistantMessage = { ...f.fixture.message, provider: provider.provider.id, model: "bounded",
      stopReason: "error", errorMessage: "context_length_exceeded" };
    source.push({ type: "error", reason: "error", error });
    return source;
  });
  registry.registerProvider({ ...provider.provider, stream: dispatch, streamSimple: dispatch });
  const controller = new AbortController();
  const auxiliary = vi.spyOn(RunBudgetTracker.prototype, "observeAuxiliaryUsage");
  const primary = vi.spyOn(RunBudgetTracker.prototype, "observePrimaryUsage");
  const result = await processReadyAgentRuntime(f.store, registry).runPrompt({ threadId: f.thread.id,
    text: "Return one result", model: { provider: provider.provider.id, id: "bounded" }, signal: controller.signal,
    onEvent: async (event) => { if (event.type === "model.context.overflow") controller.abort(); } });
  const events = await f.store.listRunEvents(result.id);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(auxiliary).not.toHaveBeenCalled();
  expect(primary).toHaveBeenCalledOnce();
  const overflow = events.filter((event) => event.type === "model.context.overflow");
  expect(overflow).toHaveLength(1);
  expect(overflow[0]!.payload).not.toHaveProperty("usage");
  const stopped = events.filter((event) => event.type === "model.context.overflow_recovery_stopped");
  expect(stopped.map((event) => event.payload)).toEqual([expect.objectContaining({ action: "finalize",
    recoveryReadiness: "cancelled", overflowEventSha256: (overflow[0]!.payload as Record<string, unknown>)["contentSha256"] })]);
  expect(stopped[0]!.payload).not.toHaveProperty("usage");
  const response = events.filter((event) => event.type === "model.response");
  expect(response).toHaveLength(1);
  const usage = (response[0]!.payload as Record<string, unknown>)["usage"];
  expect(result.usage).toEqual(usage);
  expect(aggregateRunUsage(events, [])).toEqual(usage);
  expect((await createRunReplaySnapshot(f.store, f.thread.id, result.id)).metrics.modelResponseCount).toBe(1);
  expect(() => assertModelRequestEvidenceBindings(events)).not.toThrow();
});
