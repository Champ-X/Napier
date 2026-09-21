import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxProvider, fauxAssistantMessage, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { LocalStore } from "../src/store.js";
import { ModelRegistry } from "../src/models.js";
import { createHarnessPolicyProfile, presetHarnessPolicy } from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { ComposableAgentModelCallPipeline } from "../src/kernel-model-call-pipeline.js";
import { installBuiltinModelCallExtensions } from "../src/builtin-model-call-extensions.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { applyProviderWireCompatibility } from "../src/model-provider-wire-compatibility.js";

const roots: string[] = [], stores: LocalStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.unstubAllGlobals();
});

it.each([false, true])("binds budget through Agent, SQLite and capsule; mutating finalizer=%s", async (mutate) => {
  const root = await mkdtemp(path.join(tmpdir(), "napier-model-budget-")); roots.push(root);
  const store = new LocalStore({ workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "data") }); stores.push(store);
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, { toolPolicy: "observe", enabledTools: [], thinkingLevel: "medium" });
  const thread = await store.createThread({ title: "Budget policy", agentId: agent.id });
  const provider = fauxProvider({ provider: "budget-test", models: [{ id: "budget-model", reasoning: true, maxTokens: 384000 }] });
  provider.getModel().thinkingLevelMap = { minimal: null, low: null, medium: null, high: "high", max: "max" };
  const received: SimpleStreamOptions[] = [];
  provider.setResponses([(_context, options) => {
    received.push(options as SimpleStreamOptions);
    return fauxAssistantMessage("Done.");
  }, fauxAssistantMessage('{"facts":[]}')]);
  const models = new ModelRegistry(); models.registerProvider(provider.provider);
  const runtime = processReadyAgentRuntime(store, models);
  const pipeline = new ComposableAgentModelCallPipeline();
  installBuiltinModelCallExtensions(pipeline, runtime);
  pipeline.use({ id: "budget-observer", order: 9999, finalize(call) {
    expect(call.options).toMatchObject({ maxTokens: 8192, reasoning: "high" });
    if (mutate) call.options.maxTokens = 16384;
  } });
  runtime.attachKernelModelCallPipeline(pipeline);
  const { schemaVersion: _s, contentSha256: _h, ...base } = presetHarnessPolicy("coding-node.v1");
  const profile = createModelHarnessExperimentProfile({ id: "budget-integration.v1", maxActiveTools: 20,
    policies: createHarnessPolicyProfile({ ...base, modelCall: "bounded-thinking-v1" }) });
  const run = await runtime.runPrompt({ threadId: thread.id, text: "Reply briefly.", model: { provider: "budget-test", id: "budget-model" }, harnessExperimentProfile: profile });
  const events = await store.listRunEvents(run.id);
  const captures = events.filter(event => event.type === "context.model_invocation" && event.payload.purpose === "agent_turn");
  if (mutate) {
    expect(run.status).toBe("failed");
    expect(received).toHaveLength(0);
    expect(captures).toHaveLength(0);
  } else {
    expect(run.status, run.error).toBe("completed");
    expect(received[0]).toMatchObject({ maxTokens: 8192, reasoning: "high" });
    expect(captures).toHaveLength(1);
    const capsule = await runtime.modelInvocationCapsules.read(String(captures[0]!.payload.capsuleSha256));
    expect(capsule.options).toMatchObject({ maxTokens: received[0]!.maxTokens, reasoning: received[0]!.reasoning });
    expect(events.some(event => event.payload.profileSha256 === profile.contentSha256)).toBe(true);
  }
});

it("uses native DeepSeek output limit through actual registry SDK boundary without HTTP", async () => {
  const models = new ModelRegistry();
  const model = models.resolve({ provider: "deepseek", id: "deepseek-v4-flash" })!;
  const fetch = vi.fn(async () => { throw Error("Unexpected HTTP"); }); vi.stubGlobal("fetch", fetch);
  let payload: unknown;
  await models.models.streamSimple(model, { messages: [{ role: "user", content: "Offline", timestamp: 0 }] }, {
    apiKey: "offline-not-a-credential", reasoning: "high", maxTokens: 8192, maxRetries: 0,
    onPayload(value) { payload = value; throw Error("Stop before HTTP"); },
  }).result();
  expect(payload).toMatchObject({ max_tokens: 8192, reasoning_effort: "high" });
  expect(payload).not.toHaveProperty("max_completion_tokens");
  expect(fetch).not.toHaveBeenCalled();
  expect(model.compat?.maxTokensField).toBeUndefined();
  expect(applyProviderWireCompatibility({ ...model, baseUrl: "https://proxy.example.test" }).compat).toBe(model.compat);
});
