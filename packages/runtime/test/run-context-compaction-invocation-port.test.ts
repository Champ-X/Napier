import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type Context } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapModelUsage, modelRefFromModel } from "../src/agent-model-projection.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { compileAuxiliaryPrompt } from "../src/agent-prompt-layers.js";
import { modelAdapterReceipt } from "../src/model-adapters.js";
import { captureCompiledModelInvocation } from "../src/model-invocation-capture.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import { ModelSession } from "../src/model-session.js";
import { ModelRegistry } from "../src/models.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { RunContextCompactor } from "../src/run-context-compaction.js";
import { invokeRunContextCompactor, prepareRunCompactionRequest, type RunCompactionInvocationPort } from "../src/run-context-compaction-model.js";
import { createUsageAccounting } from "../src/token-accounting.js";
import { TokenMeterRegistry } from "../src/token-meter-provider.js";
import { LocalStore } from "../src/store.js";

const summary = { summary: "Inspected evidence; implementation remains unfinished.", decisions: ["Keep user constraints."], openLoops: ["Verify output."], artifacts: ["outputs/report.md"] };
const fixtures: Array<{ store: LocalStore; root: string }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) { f.store.close(); await rm(f.root, { recursive: true, force: true }); }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-compactor-port-"));
  const workspaceRoot = path.join(root, "workspace"); await mkdir(workspaceRoot);
  const store = new LocalStore({ dataRoot: path.join(root, "data"), workspaceRoot });
  fixtures.push({ store, root }); await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: "Compaction port", agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const provider = fauxProvider({ provider: "compaction-port-test", tokenSize: { min: 10_000, max: 10_000 },
    models: [{ id: "bounded", contextWindow: 16_000, maxTokens: 1_200, reasoning: false }] });
  provider.setResponses(Array.from({ length: 20 }, () => fauxAssistantMessage(JSON.stringify(summary))));
  const modelRegistry = new ModelRegistry(); modelRegistry.registerProvider(provider.provider);
  const model = provider.getModel();
  const host = { store, modelRegistry, modelInvocationCapsules: new ModelInvocationCapsuleStore(store.dataRoot) };
  const budget = new RunBudgetTracker({ maxTurns: 64, maxTotalTokens: 1_000_000, maxCostUsd: 100, timeoutMs: 60_000 });
  const tokenMeters = new TokenMeterRegistry();
  const compiledPrompt = compileAuxiliaryPrompt({ purpose: "context_compaction", sourceId: "task.fixture",
    systemPrompt: "Pinned runtime instructions", adapter: modelAdapterReceipt(model, { maxTokens: 1_200 }) });
  return { root, store, run, provider, model, host, budget,
    input: (context: Context) => ({ sourceContext: context, prunedContext: context, context, model,
      options: { maxTokens: 1_200 }, compiledPrompt, tokenMeters, modelAttempt: 1, recoveryAttempt: 0 as const }),
  };
}

function transcript(): Context {
  return { messages: [{ role: "user", content: "Keep all filenames unchanged; verify outputs before completion.", timestamp: 0 },
    ...Array.from({ length: 12 }, (_, index) => [
      fauxAssistantMessage(fauxToolCall("read_file", { path: `section-${index}.txt` }, { id: `call-${index}` }), { stopReason: "toolUse", timestamp: index }),
      { role: "toolResult" as const, toolCallId: `call-${index}`, toolName: "read_file", content: [{ type: "text" as const, text: "evidence ".repeat(450) }], isError: false, timestamp: index },
    ]).flat()] };
}

/** Exercises a real shared ModelSession; the port owns its one response write.
 * Child-specific lease/reservation wiring is tested by the child adapter suite. */
function sessionPort(f: Awaited<ReturnType<typeof fixture>>, afterSettlement?: () => void) {
  const session = new ModelSession({
    models: f.host.modelRegistry.models,
    lifetime: { remainingMs: () => 60_000, assertActive: () => undefined },
  });
  let invocationIndex = 0;
  const invoke = vi.fn<RunCompactionInvocationPort["invoke"]>(async (input) => {
    const turnIndex = invocationIndex++;
    const opened = await session.open({
      phase: "context_compaction", model: input.model,
      context: input.request.context, options: input.request.options,
      capture: (request) => captureCompiledModelInvocation({
        store: f.store, capsules: f.host.modelInvocationCapsules, run: input.run,
        model: request.model, context: request.context, options: request.options,
        turnIndex, purpose: "context_compaction", compiledPrompt: input.request.compiledPrompt,
        cacheScope: request.cacheScope, phase: request.phase,
      }),
    });
    // ModelSession transport resolves its terminal while the stream is drained.
    for await (const _event of opened.source) { /* drain through settlement */ }
    const response = await opened.source.result();
    const usage = mapModelUsage(response.usage);
    await f.store.appendEvent({
      threadId: input.run.threadId, runId: input.run.id, type: "model.response", category: "model", visibility: "debug",
      payload: {
        ...input.responseEvidence(response), model: `${response.provider}/${response.model}`,
        modelContextEnvelopeSha256: opened.envelope.contentSha256,
        modelContextEnvelopeTurnIndex: opened.envelope.turnIndex,
        modelContextMessageSetSha256: opened.envelope.messageSetSha256,
        modelContextToolDefinitionSetSha256: opened.envelope.toolDefinitionSetSha256,
        usage, usageAccounting: createUsageAccounting(modelRefFromModel(input.model), usage),
      },
    });
    afterSettlement?.();
    return { response, envelopeSha256: opened.envelope.contentSha256 };
  });
  return { invoke };
}

function invocation(f: Awaited<ReturnType<typeof fixture>>, port?: RunCompactionInvocationPort, signal?: AbortSignal) {
  return {
    host: f.host, run: f.run, budget: f.budget, model: f.model,
    request: prepareRunCompactionRequest({ model: f.model, options: {}, evidence: ["Completed read; verification remains open."], ...(signal ? { signal } : {}) }),
    nextTurnIndex: vi.fn(() => 0), ...(port ? { invocation: port } : {}),
  };
}

describe("Run compactor invocation ownership", () => {
  it("keeps default capture, one response receipt and auxiliary budget accounting", async () => {
    const f = await fixture();
    const input = invocation(f);
    const result = await invokeRunContextCompactor(input);
    expect(result.summary).toEqual(summary);
    expect(input.nextTurnIndex).toHaveBeenCalledOnce();
    const responses = (await f.store.listRunEvents(f.run.id)).filter((event) => event.type === "model.response");
    expect(responses).toHaveLength(1);
    expect(responses[0]!.payload).toMatchObject({ modelCallPurpose: "context_compaction", compactionSummarySha256: sha256(canonicalJson(summary)) });
    expect(f.budget.observed().turns).toBe(0);
    expect(f.budget.observed().rawTotalTokens).toBeGreaterThan(0);
  });

  it("uses the port's settled ModelSession response once and rehydrates its checkpoint", async () => {
    const f = await fixture();
    const port = sessionPort(f);
    const defaultComplete = vi.spyOn(f.host.modelRegistry.models, "completeSimple");
    const nextTurn = vi.fn(() => 99);
    const compactor = new RunContextCompactor(f.host, f.run, f.budget, nextTurn, undefined, port);
    const source = transcript();
    const projected = await compactor.project(f.input(source));
    expect(port.invoke).toHaveBeenCalled();
    expect(defaultComplete).not.toHaveBeenCalled();
    expect(nextTurn).not.toHaveBeenCalled();
    expect(projected.receiptSha256).toBeDefined();
    const events = await f.store.listRunEvents(f.run.id);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(port.invoke.mock.calls.length);
    const calls = port.invoke.mock.calls.length;
    const restored = await new RunContextCompactor(f.host, f.run, f.budget, nextTurn, undefined, port).project(f.input(source));
    expect(restored.context).toEqual(projected.context);
    expect(port.invoke).toHaveBeenCalledTimes(calls);
  });

  it.each([
    ["malformed", fauxAssistantMessage('{"summary":"incomplete"}')],
    ["truncated", fauxAssistantMessage(JSON.stringify(summary), { stopReason: "length" })],
  ])("settles and charges a %s port response before rejecting it", async (_label, response) => {
    const f = await fixture(); f.provider.setResponses([response]);
    const port = sessionPort(f);
    const input = invocation(f, port);
    await expect(invokeRunContextCompactor(input)).rejects.toThrow();
    expect(port.invoke).toHaveBeenCalledOnce();
    expect(input.nextTurnIndex).not.toHaveBeenCalled();
    const responses = (await f.store.listRunEvents(f.run.id)).filter((event) => event.type === "model.response");
    expect(responses).toHaveLength(1);
    expect(responses[0]!.payload).not.toHaveProperty("compactionSummarySha256");
    expect(f.budget.observed().rawTotalTokens).toBeGreaterThan(0);
    expect(f.budget.observed().turns).toBe(0);
  });

  it("leaves transport-failure settlement to the port without adding a second synthetic response", async () => {
    const f = await fixture();
    const port = { invoke: vi.fn<RunCompactionInvocationPort["invoke"]>(async () => { throw new Error("child transport failed"); }) };
    await expect(invokeRunContextCompactor(invocation(f, port))).rejects.toThrow("child transport failed");
    expect(port.invoke).toHaveBeenCalledOnce();
    expect((await f.store.listRunEvents(f.run.id)).filter((event) => event.type === "model.response")).toHaveLength(0);
    expect(f.provider.state.callCount).toBe(0);
    expect(f.budget.observed().rawTotalTokens).toBe(0);
  });

  it("retains canonical usage when cancellation follows settlement and never publishes a checkpoint", async () => {
    const f = await fixture();
    const cancellation = new AbortController();
    const port = sessionPort(f, () => cancellation.abort(new Error("cancel after settlement")));
    await expect(invokeRunContextCompactor(invocation(f, port, cancellation.signal))).rejects.toThrow("cancel after settlement");
    expect(port.invoke).toHaveBeenCalledOnce();
    const events = await f.store.listRunEvents(f.run.id);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(1);
    expect(events.filter((event) => event.type === "context.run_compaction.completed")).toHaveLength(0);
    expect(f.budget.observed().rawTotalTokens).toBeGreaterThan(0);
  });

  it("charges a settled port response once and rejects checkpoint completion at exhausted budget", async () => {
    const f = await fixture();
    const port = sessionPort(f);
    const budget = new RunBudgetTracker({ maxTurns: 64, maxTotalTokens: 10, maxCostUsd: 100, timeoutMs: 60_000 });
    await expect(invokeRunContextCompactor({ ...invocation(f, port), budget })).rejects.toThrow("Run budget exhausted");
    expect(port.invoke).toHaveBeenCalledOnce();
    const responses = (await f.store.listRunEvents(f.run.id)).filter((event) => event.type === "model.response");
    expect(responses).toHaveLength(1);
    const payload = responses[0]!.payload as { usage: ReturnType<typeof mapModelUsage> };
    expect(budget.observed().usage).toEqual(payload.usage);
    expect(budget.observed().turns).toBe(0);
  });
});
