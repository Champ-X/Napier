import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall, type Context } from "@earendil-works/pi-ai";
import type { JsonObject, JsonValue } from "@napier/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { validateModelInvocationCapsuleReceipt } from "../src/model-invocation-capsule.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { cleanupModelSessionFixtures, createModelSessionFixture } from "./subagent-model-session-fixture.js";

function jsonObject(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected JSON object in model evidence");
  return value;
}

function jsonArray(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) throw new Error("Expected JSON array in model evidence");
  return value;
}

function parseJsonObject(text: string): JsonObject {
  const value: JsonValue = JSON.parse(text);
  return jsonObject(value);
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External model requests forbidden"); })));
afterEach(async () => { vi.unstubAllGlobals(); await cleanupModelSessionFixtures(); });

it.each([false, true])("refreshes the child request and capsule budget after compaction (native accounting=%s)", async (nativeAccounting) => {
  const f = await createModelSessionFixture({ timeoutMs: 20_000, maxTurns: 3, nativeAccounting,
    runLimits: { maxTotalTokens: 50_000, maxTurns: 10 } });
  await f.store.updateAgent(f.run.agentId, { enabledTools: ["read_file"], enabledSubagents: ["researcher"], toolPolicy: "observe" });
  Object.assign(f.model, { contextWindow: 16_000, maxTokens: 1_200, reasoning: false });
  for (const name of ["first", "second"])
    await writeFile(path.join(f.store.workspaceRoot, `${name}.txt`), `${name} source `.repeat(2_000));
  const thread = await f.store.createThread({ title: "Child compaction budget", agentId: f.run.agentId });
  const runtime = processReadyAgentRuntime(f.store, f.registry);
  const childRequests: Array<{ context: Context; expectedTokens: number; auxiliaryCalls: number }> = [];
  let childTurns = 0;
  let parentTurns = 0;
  let auxiliaryCalls = 0;
  let childTokens = 0;
  const dispatch: typeof f.registry.models.streamSimple = (model, context) => {
    const auxiliary = context.systemPrompt?.includes("checkpoint inside an unfinished Run") ?? false;
    const child = context.systemPrompt?.includes("You are an isolated research subagent.") ?? false;
    let response;
    if (auxiliary) {
      auxiliaryCalls += 1;
      response = fauxAssistantMessage(JSON.stringify({ summary: "Both files inspected; deliver the final answer.",
        decisions: ["Retain filenames."], openLoops: ["Return requested result."], artifacts: ["first.txt", "second.txt"] }));
    } else if (child) {
      childRequests.push({ context: structuredClone(context), expectedTokens: childTokens, auxiliaryCalls });
      childTurns += 1;
      response = childTurns <= 2 ? fauxAssistantMessage(fauxToolCall("read_file", {
        path: childTurns === 1 ? "first.txt" : "second.txt",
      }, { id: `child-read-${childTurns}` }), { stopReason: "toolUse" })
        : fauxAssistantMessage('{"summary":"Both files inspected.","items":[],"unknowns":[]}');
    } else {
      parentTurns += 1;
      response = parentTurns === 1 ? fauxAssistantMessage(fauxToolCall("delegate_task", {
        role: "researcher", description: "Read both sources", task: "Read first.txt and second.txt and return a JSON summary.",
      }), { stopReason: "toolUse" }) : fauxAssistantMessage("Delegated inspection completed.");
    }
    Object.assign(response, { api: model.api, provider: model.provider, model: model.id });
    response.usage = { input: auxiliary ? 3_000 : 1_000, output: auxiliary ? 300 : 100,
      cacheRead: 0, cacheWrite: 0, totalTokens: auxiliary ? 3_300 : 1_100,
      cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } };
    if (child || auxiliary) childTokens += response.usage.totalTokens;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: response.stopReason === "toolUse" ? "toolUse" : "stop", message: response });
    return stream;
  };
  f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
  const parent = await runtime.runPrompt({ threadId: thread.id, text: "Delegate the two-file inspection. PARENT_ONLY_SCOPE_SENTINEL",
    model: { provider: f.model.provider, id: f.model.id },
    harnessExperimentProfile: createModelHarnessExperimentProfile({ id: "test.child-compaction-budget", maxActiveTools: 20,
      policies: createHarnessPolicyProfile({ id: "test.child-budget", revision: 1,
        context: { prompt: "stable-v1", delivery: "tail-v1", memory: "task-aware-v1", workingState: "evidence-v1", finalization: "request-aware-v2" },
        toolSurface: { editReferences: false }, verification: "node-v1" }) }),
  });
  expect(parent.status, parent.error).toBe("completed");
  const task = f.store.listSubagentTasks(thread.id, parent.id)[0]!;
  expect(task.status, task.error).toBe("completed");
  expect(childRequests).toHaveLength(3);
  expect(JSON.stringify(childRequests)).not.toContain("PARENT_ONLY_SCOPE_SENTINEL");
  expect(auxiliaryCalls).toBeGreaterThan(0);
  const afterCompaction = childRequests.filter(request => request.auxiliaryCalls > 0);
  expect(afterCompaction.length).toBeGreaterThan(0);
  for (const request of afterCompaction) {
    const tail = request.context.messages.at(-1)!;
    const runtimeContext = parseJsonObject(String(tail.content));
    const budgetSource = jsonArray(runtimeContext["sources"]).map(jsonObject)
      .find(source => source["sourceId"] === "workspace.run_budget")!;
    const budgetContent = budgetSource["content"];
    if (typeof budgetContent !== "string") throw new Error("Expected run budget source content");
    const budget = parseJsonObject(budgetContent);
    const observed = jsonObject(budget["observed"]);
    const remaining = jsonObject(budget["remaining"]);
    expect(observed["accountedTokens"]).toBe(request.expectedTokens);
    expect(observed["primaryTurns"]).toBe(childRequests.indexOf(request));
    expect(remaining["primaryTurns"]).toBe(3 - childRequests.indexOf(request));
    expect(remaining["accountedTokens"]).toBe(50_000 - request.expectedTokens);
    expect(observed["accountedTokens"]).toBeGreaterThanOrEqual(5_500);
  }
  const receipts = (await f.store.listRunEvents(parent.id)).filter(event => event.type === "subagent.model.invocation" &&
    jsonObject(event.payload)["phase"] === "subagent_turn");
  const last = jsonArray(jsonObject(receipts.at(-1)!.payload)["captures"]).map(jsonObject);
  const invocationReceipt = validateModelInvocationCapsuleReceipt(last.find(item => item["kind"] === "invocation")!["payload"]);
  const captured = await runtime.modelInvocationCapsules.read(invocationReceipt.capsuleSha256);
  expect(captured.context).toEqual(childRequests.at(-1)!.context);
  expect(task.usage.inputTokens + task.usage.outputTokens).toBe(childTokens);
  expect((await f.store.listRunEvents(task.childRunId!)).filter(event => event.type === "model.response" &&
    jsonObject(event.payload)["modelCallPurpose"] === "context_compaction")).toHaveLength(auxiliaryCalls);
});
