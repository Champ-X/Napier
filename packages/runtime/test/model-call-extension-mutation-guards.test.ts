import { createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { RunRecord } from "@napier/contracts";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileAuxiliaryPrompt } from "../src/agent-prompt-layers.js";
import { installBuiltinModelCallExtensions } from "../src/builtin-model-call-extensions.js";
import { ComposableAgentModelCallPipeline } from "../src/kernel-model-call-pipeline.js";
import type { AgentModelCallPreparation, AgentModelInvocation } from "../src/model-call-lifecycle-types.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { createModelSessionFixture, cleanupModelSessionFixtures } from "./subagent-model-session-fixture.js";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External model requests forbidden"); })));
afterEach(async () => { vi.unstubAllGlobals(); await cleanupModelSessionFixtures(); });

function fixture() {
  const signal = new AbortController().signal;
  const model = fauxProvider({ provider: "mutation-guard" }).getModel();
  const context: Context = { systemPrompt: "Bounded role", tools: [
    { name: "read_file", description: "Read", parameters: Type.Object({ path: Type.String() }) },
    { name: "list_files", description: "List", parameters: Type.Object({}) },
  ], messages: [{ role: "user", content: "Read the selected source.", timestamp: 0 }] };
  const options: SimpleStreamOptions = { signal, maxTokens: 100, headers: { "x-guard": "bound" } };
  const call: AgentModelCallPreparation = { run: { id: "run_guard", threadId: "thread_guard", source: "user" } as RunRecord,
    attempt: 1, model, context, options };
  const compiledPrompt = compileAuxiliaryPrompt({ purpose: "context_compaction", sourceId: "test.guard", systemPrompt: context.systemPrompt!,
    adapter: modelAdapterReceipt(model, options) });
  const invocation: AgentModelInvocation = { ...call, compiledPrompt,
    envelope: createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: compiledPrompt.systemPrompt, tools: context.tools!, messages: context.messages }) };
  return { call, invocation, signal, context, options };
}

const prepareMutations: Array<{ name: string; mutate(call: Readonly<AgentModelCallPreparation>): void }> = [
  { name: "tool insertion", mutate: call => { call.context.tools!.push({ name: "forbidden", description: "No grant", parameters: Type.Object({}) }); } },
  { name: "tool name", mutate: call => { call.context.tools![0]!.name = "forbidden"; } },
  { name: "tool schema", mutate: call => { (call.context.tools![0]!.parameters as { properties: { path: { type: string } } }).properties.path.type = "number"; } },
  { name: "cancellation signal", mutate: call => { call.options.signal = new AbortController().signal; } },
  { name: "output ceiling", mutate: call => { call.options.maxTokens = 101; } },
  { name: "selected model", mutate: call => { call.model.id = "different-model"; } },
];

describe("shared model-call mutable extension guards", () => {
  it.each(prepareMutations)("rejects an in-place prepare $name change even with no returned patch", async ({ mutate }) => {
    const f = fixture(); const original = structuredClone(f.context); const originalTools = [...f.context.tools!];
    const pipeline = new ComposableAgentModelCallPipeline();
    pipeline.use({ id: "test.mutation", prepare: mutate });
    await expect(pipeline.createInvocationLifecycle().prepare(f.call)).rejects.toThrow(/cannot/iu);
    expect(f.context).toEqual(original);
    expect(f.context.tools![0]).toBe(originalTools[0]);
    expect(f.options).toMatchObject({ signal: f.signal, maxTokens: 100 });
    expect(Object.isFrozen(f.context.tools![0]!.parameters)).toBe(false);
  });

  it("keeps a returned tool subset bound to original identities and permits a lower output ceiling", async () => {
    const f = fixture(); const pipeline = new ComposableAgentModelCallPipeline();
    pipeline.use({ id: "test.subset", prepare: call => ({ context: { ...call.context, tools: call.context.tools!.slice(0, 1) }, options: { maxTokens: 50 } }) });
    const result = await pipeline.createInvocationLifecycle().prepare(f.call);
    expect(result.context.tools).toHaveLength(1);
    expect(result.context.tools![0]).toBe(f.context.tools![0]);
    expect(result.options).toMatchObject({ signal: f.signal, maxTokens: 50 });
    expect(f.context.tools).toHaveLength(2);
    expect(f.options.maxTokens).toBe(100);
  });

  it.each(["tool schema", "tool removal", "options"] as const)("rejects an in-place finalize %s change without mutating the host request", async kind => {
    const f = fixture(); const original = structuredClone(f.context); const pipeline = new ComposableAgentModelCallPipeline();
    pipeline.use({ id: "test.finalize", finalize(call) {
      if (kind === "tool schema") (call.context.tools![0]!.parameters as { properties: { path: { type: string } } }).properties.path.type = "number";
      else if (kind === "tool removal") call.context.tools!.pop();
      else call.options.maxTokens = 50;
    } });
    await expect(pipeline.createInvocationLifecycle().finalize({ ...f.invocation, recoveryAttempt: 0 })).rejects.toThrow(/cannot/iu);
    expect(f.context).toEqual(original); expect(f.options.maxTokens).toBe(100);
  });

  it.each(["tool schema", "messages", "system prompt", "options", "model"] as const)("rejects an around %s mutation before next dispatches the provider", kind => {
    const f = fixture(); const original = structuredClone(f.context); const pipeline = new ComposableAgentModelCallPipeline(); const provider = vi.fn();
    pipeline.use({ id: "test.around", around(call, next) {
      if (kind === "tool schema") (call.context.tools![0]!.parameters as { properties: { path: { type: string } } }).properties.path.type = "number";
      else if (kind === "messages") call.context.messages.push({ role: "user", content: "Injected after capture", timestamp: 1 });
      else if (kind === "system prompt") call.context.systemPrompt = "Changed after capture";
      else if (kind === "options") call.options.headers!["x-guard"] = "changed";
      else call.model.id = "different-model";
      return next();
    } });
    expect(() => pipeline.createInvocationLifecycle().invoke(f.invocation, provider)).toThrow("captured request");
    expect(provider).not.toHaveBeenCalled(); expect(f.context).toEqual(original);
    expect(f.options.headers).toEqual({ "x-guard": "bound" });
  });

  it("isolates retained around views after next without freezing or mutating the host request", () => {
    const f = fixture(); const pipeline = new ComposableAgentModelCallPipeline(); let retained: Readonly<AgentModelInvocation> | undefined;
    pipeline.use({ id: "test.retained", around(call, next) { retained = call; return next(); } });
    const stream = createAssistantMessageEventStream();
    const provider = vi.fn(() => stream);
    expect(pipeline.createInvocationLifecycle().invoke(f.invocation, provider)).toBe(stream);
    retained!.context.tools![0]!.name = "late-mutation";
    retained!.context.messages.push({ role: "user", content: "late", timestamp: 1 });
    expect(f.context.tools![0]!.name).toBe("read_file"); expect(f.context.messages).toHaveLength(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each(["prepare", "around"] as const)("rejects in-place %s tool mutations on an actual main runtime before its provider call", async phase => {
    const f = await createModelSessionFixture();
    await f.store.updateAgent(f.run.agentId, { enabledTools: ["list_files"], enabledSubagents: [], toolPolicy: "observe" });
    const thread = await f.store.createThread({ title: "Main mutation guard", agentId: f.run.agentId });
    const runtime = processReadyAgentRuntime(f.store, f.registry); const pipeline = new ComposableAgentModelCallPipeline();
    let attempted = false;
    installBuiltinModelCallExtensions(pipeline, runtime);
    pipeline.use(phase === "prepare" ? { id: "test.main-mutation", prepare(call) { attempted = true; call.context.tools![0]!.name = "forbidden"; } }
      : { id: "test.main-mutation", around(call, next) { attempted = true; call.context.tools![0]!.name = "forbidden"; return next(); } });
    runtime.attachKernelModelCallPipeline(pipeline);
    f.faux.setResponses([fauxAssistantMessage("Must not reach provider.")]);
    const run = await runtime.runPrompt({ threadId: thread.id, text: "Reply briefly.", model: { provider: f.faux.provider.id, id: "faux-1" } });
    expect(attempted).toBe(true); expect(run.status).toBe("failed");
    expect(f.faux.state.callCount).toBe(0);
  });
});
