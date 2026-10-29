import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { compileAuxiliaryPrompt } from "../src/agent-prompt-layers.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import { captureCompiledModelInvocation } from "../src/model-invocation-capture.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import { captureExactModelInvocation, type ExactModelInvocationCaptureEvent } from "../src/model-invocation-exact-capture.js";
import { ModelSession } from "../src/model-session.js";
import { snapshotModelInvocation } from "../src/model-invocation-snapshot.js";
import { ModelRegistry } from "../src/models.js";
import { appendRuntimeContext, stripRuntimeContext } from "../src/runtime-context-delivery.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];
const stores: LocalStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-exact-capture-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot: path.join(root, "data") });
  stores.push(store);
  await store.initialize();
  const thread = await store.createThread({ title: "Exact capture", agentId: store.listAgents()[0]!.id });
  const run = await store.createRun({ threadId: thread.id, agentId: thread.agentId });
  const capsules = new ModelInvocationCapsuleStore(store.dataRoot);
  const provider = fauxProvider({ provider: "exact-capture" });
  const model = provider.getModel();
  const context: Context = {
    systemPrompt: "original exact prompt",
    messages: [{ role: "user", content: "private user content", timestamp: 1 }],
    tools: [{ name: "read_file", description: "Only an authorized reader", parameters: Type.Object({ path: Type.String() }) }],
  };
  const events: ExactModelInvocationCaptureEvent[] = [];
  const input = {
    capsules,
    source: { threadId: thread.id, runId: run.id },
    model,
    context,
    options: undefined,
    turnIndex: 0,
    purpose: "agent_turn" as const,
    cacheScope: {},
    emit: async (event: ExactModelInvocationCaptureEvent) => { events.push(event); },
  };
  return { root, store, thread, run, capsules, provider, model, context, events, input };
}

describe("exact model invocation capture", () => {
  it("preserves runtime-tail ownership transitively without allowing another Run or text copy to strip it", async () => {
    const f = await fixture();
    const withRuntime = appendRuntimeContext(f.run, f.context, {
      message: { role: "user", content: "runtime-owned-data", timestamp: 0 },
      sources: [],
    });
    const first = snapshotModelInvocation({ model: f.model, context: withRuntime, options: undefined });
    const second = snapshotModelInvocation(first);
    expect(stripRuntimeContext(f.run, second.context).messages).toEqual(f.context.messages);
    const foreignThread = await f.store.createThread({ title: "Foreign owner", agentId: f.thread.agentId });
    const foreignRun = await f.store.createRun({ threadId: foreignThread.id, agentId: foreignThread.agentId });
    expect(stripRuntimeContext(foreignRun, second.context).messages).toHaveLength(2);
    expect(stripRuntimeContext(f.run, structuredClone(second.context)).messages).toHaveLength(2);
  });

  it("isolates cache projections by session and phase while retaining same-scope observations", async () => {
    const f = await fixture();
    const input = { ...f.input, cacheScopeKind: "session_and_phase" as const };
    await captureExactModelInvocation({ ...input, phase: "subagent_turn" });
    await captureExactModelInvocation({ ...input, phase: "subagent_turn", turnIndex: 1 });
    await captureExactModelInvocation({ ...input, phase: "typed_repair", turnIndex: 2 });
    await captureExactModelInvocation({ ...input, phase: "subagent_turn", cacheScope: {}, turnIndex: 3 });
    const projections = f.events.filter((event) => event.kind === "cache_projection");
    expect(projections.map((event) => event.payload.previousTurnIndex)).toEqual([null, 0, null, null]);
    expect(projections.every((event) => event.payload.toolSurfaceRevisionScope === "session_and_phase")).toBe(true);
    expect(f.events.map((event) => event.kind)).toEqual(Array(4).fill([
      "envelope", "adapter", "invocation", "cache_projection",
    ]).flat());
  });

  it.each([
    [new Error("capsule byte limit exceeded"), "limit"],
    [Object.assign(new Error("denied"), { code: "ENOSPC" }), "storage"],
    [new Error("invalid capsule"), "invalid"],
  ] as const)("records a bounded failure and keeps the exact context when capsule capture fails: %s", async (error, reason) => {
    const f = await fixture();
    vi.spyOn(f.capsules, "put").mockRejectedValueOnce(error);
    const result = await captureExactModelInvocation(f.input);
    expect(result.context).toEqual(f.context);
    expect(f.events.map((event) => event.kind)).toEqual(["envelope", "adapter", "unavailable", "cache_projection"]);
    expect(f.events.find((event) => event.kind === "unavailable")?.payload).toMatchObject({ reason });
    expect(JSON.stringify(f.events)).not.toContain(error.message);
  });

  it("propagates failure of the initial or unavailable durable receipt", async () => {
    const f = await fixture();
    const put = vi.spyOn(f.capsules, "put");
    await expect(captureExactModelInvocation({ ...f.input, emit: async () => { throw new Error("ledger unavailable"); } })).rejects.toThrow("ledger unavailable");
    expect(put).not.toHaveBeenCalled();
    put.mockRejectedValueOnce(new Error("capture invalid"));
    await expect(captureExactModelInvocation({
      ...f.input,
      emit: async (event) => { if (event.kind === "unavailable") throw new Error("unavailable receipt failed"); },
    })).rejects.toThrow("unavailable receipt failed");
  });

  it("snapshots the actual ledger source before awaiting capture events", async () => {
    const f = await fixture();
    const originalRunId = f.input.source.runId;
    const otherThread = await f.store.createThread({ title: "Other ledger", agentId: f.thread.agentId });
    const otherRun = await f.store.createRun({ threadId: otherThread.id, agentId: otherThread.agentId });
    await captureExactModelInvocation({
      ...f.input,
      emit: async (event) => {
        f.events.push(event);
        if (event.kind === "envelope") {
          f.input.source.runId = otherRun.id;
          f.input.source.threadId = otherThread.id;
        }
      },
    });
    const receipt = f.events.find((event) => event.kind === "invocation");
    if (receipt?.kind !== "invocation") throw new Error("missing capsule receipt");
    const capsule = await f.capsules.read(receipt.payload.capsuleSha256);
    expect(capsule.sourceRunId).toBe(originalRunId);
    expect(capsule.sourceThreadId).toBe(f.thread.id);
  });

  it("detaches caller data across awaited capsule writes and dispatches the captured request", async () => {
    const f = await fixture();
    const options: SimpleStreamOptions = { maxTokens: 90, headers: { "x-fixture": "before" }, metadata: { nested: { value: "before" } }, onResponse: vi.fn() };
    const originalContext = structuredClone(f.context);
    const originalModel = structuredClone(f.model);
    const execute = vi.fn(async () => ({ content: [], details: {} }));
    Object.assign(f.context.tools![0]!, { label: "Runtime-only label", execute });
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const realPut = f.capsules.put.bind(f.capsules);
    vi.spyOn(f.capsules, "put").mockImplementation(async (input) => { entered(); await barrier; return realPut(input); });
    const registry = new ModelRegistry();
    f.provider.setResponses([(context, providerOptions) => {
      expect(context).toEqual(originalContext);
      expect(providerOptions).toMatchObject({ maxTokens: 90, headers: { "x-fixture": "before" }, metadata: { nested: { value: "before" } } });
      expect(providerOptions?.onResponse).toBe(options.onResponse);
      return fauxAssistantMessage("captured bytes dispatched");
    }]);
    registry.registerProvider(f.provider.provider);
    const session = new ModelSession({ models: registry.models, lifetime: { remainingMs: () => 60_000, assertActive: () => undefined } });
    const opening = session.open({
      phase: "subagent_turn", model: f.model, context: f.context, options,
      capture: (request) => captureExactModelInvocation({ ...f.input, ...request }),
    });
    await started;
    f.context.systemPrompt = "mutated prompt";
    f.context.messages.push({ role: "user", content: "late steering", timestamp: 2 });
    f.context.tools![0]!.description = "mutated tool";
    f.model.maxTokens = 1;
    options.maxTokens = 1;
    options.headers!["x-fixture"] = "after";
    (options.metadata!["nested"] as { value: string }).value = "after";
    release();
    const opened = await opening;
    for await (const _event of opened.source) { /* Real provider dispatch. */ }
    expect((await opened.source.result()).stopReason).toBe("stop");
    expect(opened.model).toEqual(originalModel);
    const receipt = f.events.find((event) => event.kind === "invocation");
    expect(receipt?.kind).toBe("invocation");
    if (receipt?.kind !== "invocation") throw new Error("missing capsule receipt");
    const capsule = await f.capsules.read(receipt.payload.capsuleSha256);
    expect(capsule.context).toEqual(originalContext);
    expect(capsule.options.maxTokens).toBe(90);
    expect(capsule.contextEnvelopeSha256).toBe(opened.envelope.contentSha256);
    expect(execute).not.toHaveBeenCalled();
  });

  it("preserves compiled capture event order, prompt replacement, options and observer isolation", async () => {
    const f = await fixture();
    const options = { maxTokens: 51, temperature: 0, apiKey: "fixture-only", onResponse: vi.fn() };
    const compiledPrompt = compileAuxiliaryPrompt({ purpose: "context_compaction", sourceId: "task.test", systemPrompt: "compiled prompt", adapter: modelAdapterReceipt(f.model, options) });
    const result = await captureCompiledModelInvocation({
      ...f, options, turnIndex: 0, purpose: "context_compaction", compiledPrompt,
      onEvent: () => { throw new Error("disconnected observer"); },
    });
    const events = await f.store.listRunEvents(f.run.id);
    expect(events.map((event) => event.type)).toEqual([
      "context.model_envelope", "context.model_adapter", "context.prompt_package",
      "context.model_invocation", "context.prompt_cache_projection",
    ]);
    expect(result.context.systemPrompt).toBe(compiledPrompt.systemPrompt);
    expect(result.context.messages).toEqual(f.context.messages);
    expect(result.context.tools).toEqual(f.context.tools);
    await captureCompiledModelInvocation({ ...f, options, turnIndex: 1, purpose: "context_compaction", compiledPrompt });
    const latest = (await f.store.listRunEvents(f.run.id)).at(-1)!;
    expect(latest.payload).toMatchObject({ previousTurnIndex: 0 });
    expect(latest.payload).toMatchObject({ toolSurfaceRevisionScope: "run_and_invocation_purpose" });
  });

  it("routes the actual main Agent through the shared session", async () => {
    const f = await fixture();
    const registry = new ModelRegistry();
    f.provider.setResponses([fauxAssistantMessage("main shared session"), fauxAssistantMessage('{"facts":[]}')]);
    registry.registerProvider(f.provider.provider);
    const thread = await f.store.createThread({ title: "Actual main session", agentId: f.thread.agentId });
    const opened = vi.spyOn(ModelSession.prototype, "open");
    const runtime = new AgentRuntime(f.store, registry);
    const run = await runtime.runPrompt({ threadId: thread.id, text: "Answer briefly.", model: { provider: f.model.provider, id: f.model.id } });
    expect(run.status, run.error).toBe("completed");
    expect(opened.mock.calls.some(([input]) => input.phase === "agent_turn")).toBe(true);
    const events = await f.store.listRunEvents(run.id);
    expect(events.filter((event) => event.type === "context.model_invocation").length).toBeGreaterThan(0);
    // This fixture also performs the existing memory-extraction auxiliary call.
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(f.provider.state.callCount);
  });
});
