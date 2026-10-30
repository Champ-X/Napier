import { writeFile } from "node:fs/promises";
import path from "node:path";
import { contentText, fauxAssistantMessage, fauxToolCall, type Context } from "@earendil-works/pi-ai";
import type { JsonObject, JsonValue, RunRecord } from "@napier/contracts";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "../src/agent-runtime.js";
import { installBuiltinModelCallExtensions } from "../src/builtin-model-call-extensions.js";
import { validateCompiledPromptPackageReceiptV3 } from "../src/compiled-prompt-package.js";
import { validateModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { validateModelInvocationCapsuleReceipt } from "../src/model-invocation-capsule.js";
import { ComposableAgentModelCallPipeline } from "../src/kernel-model-call-pipeline.js";
import { subagentRoleInstructions, subagentRoleInstructionsForSchema } from "../src/subagent-role-instructions.js";
import { readSubagentWorkingSetForRestore } from "../src/subagent-working-set-capsule.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { createModelSessionFixture, cleanupModelSessionFixtures } from "./subagent-model-session-fixture.js";
import { continuationRunnerFixture, continuationOutputSchema, cleanupContinuationRunnerFixtures } from "./subagent-continuation-runner-fixture.js";

const PREPARE_MARKER = "G03_PARITY_PREPARE_SENTINEL";
const FINALIZE_MARKER = "G03_PARITY_FINALIZE_SENTINEL";
const METER_ID = "test.parity-custom-meter";
const outcome = '{"summary":"done","items":[],"unknowns":[]}';

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External model requests forbidden"); })));
afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanupModelSessionFixtures();
  await cleanupContinuationRunnerFixtures();
});

function jsonObject(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected JSON object in model evidence");
  return value;
}

function jsonArray(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) throw new Error("Expected JSON array in model evidence");
  return value;
}

function instrument(runtime: AgentRuntime) {
  const hooks: Array<{ phase: string; runId: string; source: RunRecord["source"] }> = [];
  let measurements = 0;
  runtime.tokenMeters.register({ id: METER_ID, supports: () => true, measure(input) {
    measurements += 1;
    return { estimatedTokens: input.conservativeFallbackTokens, method: "parity-counterexample-v1" };
  } });
  const pipeline = new ComposableAgentModelCallPipeline();
  installBuiltinModelCallExtensions(pipeline, runtime);
  pipeline.use({ id: "test.parity-extension",
    prepare(call) {
      hooks.push({ phase: "prepare", runId: call.run.id, source: call.run.source });
      return { context: { ...call.context, messages: [...call.context.messages,
        { role: "user", content: PREPARE_MARKER, timestamp: 1 }] } };
    },
    finalize(call) {
      hooks.push({ phase: "finalize", runId: call.run.id, source: call.run.source });
      return { context: { ...call.context, messages: [...call.context.messages,
        { role: "user", content: FINALIZE_MARKER, timestamp: 1 }] } };
    },
    around(call, next) {
      hooks.push({ phase: "around", runId: call.run.id, source: call.run.source });
      return next();
    },
  });
  runtime.attachKernelModelCallPipeline(pipeline);
  return { pipeline, hooks, measurements: () => measurements };
}

async function assertChildEvidence(runtime: AgentRuntime, child: RunRecord, context: Context, rolePrompt: string, parentRunId: string,
  activeToolNames?: string[]) {
  expect(child).toMatchObject({ source: "subagent", status: "completed" });
  expect(context.systemPrompt).toContain(rolePrompt);
  expect(JSON.stringify(context.messages)).toContain(PREPARE_MARKER);
  expect(JSON.stringify(context.messages)).toContain(FINALIZE_MARKER);
  const events = await runtime.store.listRunEvents(child.id);
  expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
    "model.harness.resolved", "context.projected", "context.prompt_package",
  ]));
  expect(events.filter(event => event.type === "model.context.token_pressure").map(event => event.payload))
    .toEqual(expect.arrayContaining([expect.objectContaining({ meterProviderId: METER_ID })]));
  const packages = events.filter(event => event.type === "context.prompt_package");
  expect(packages).toHaveLength(1);
  const compiled = validateCompiledPromptPackageReceiptV3(packages[0]!.payload);
  const envelope = validateModelContextEnvelopeReceipt(events.find(event => event.type === "context.model_envelope")!.payload);
  expect(compiled).toMatchObject({ purpose: "agent_turn", systemPromptSha256: envelope.systemPromptSha256,
    effectiveCapabilities: { toolDefinitionSetSha256: envelope.toolDefinitionSetSha256 } });
  const receipts = (await runtime.store.listRunEvents(parentRunId)).filter(event => event.type === "subagent.model.invocation")
    .map(event => jsonObject(event.payload))
    .filter(receipt => jsonObject(receipt["owner"])["childRunId"] === child.id);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ phase: "subagent_turn", contextEnvelopeSha256: envelope.contentSha256 });
  const capture = jsonArray(receipts[0]!["captures"]).map(jsonObject).find(item => item["kind"] === "invocation")!;
  const invocationReceipt = validateModelInvocationCapsuleReceipt(capture["payload"]);
  const invocation = await runtime.modelInvocationCapsules.read(invocationReceipt.capsuleSha256);
  expect(invocation.sourceRunId).toBe(child.id);
  expect(invocation.context).toEqual(context);
  const restored = await readSubagentWorkingSetForRestore(runtime.store.dataRoot, child.subagent!.checkpoint!.capsuleSha256);
  expect(restored.capsule.systemPrompt).toBe(rolePrompt);
  expect((context.tools ?? []).map(tool => tool.name).sort()).toEqual(activeToolNames ?? restored.capsule.tools.map(tool => tool.name).sort());
  expect(JSON.stringify(restored.capsule.messages)).not.toContain(PREPARE_MARKER);
  expect(JSON.stringify(restored.capsule.messages)).not.toContain(FINALIZE_MARKER);
  expect((context.tools ?? []).map(tool => tool.name)).not.toContain("delegate_task");
  return restored.capsule;
}

async function delegationFixture() {
  const fixture = await createModelSessionFixture();
  await fixture.store.updateAgent(fixture.run.agentId, { enabledSubagents: ["researcher"], enabledTools: ["list_files"], toolPolicy: "observe" });
  const thread = await fixture.store.createThread({ title: "Child pipeline parity", agentId: fixture.run.agentId });
  const runtime = processReadyAgentRuntime(fixture.store, fixture.registry);
  const observation = instrument(runtime);
  const delegate = fauxAssistantMessage(fauxToolCall("delegate_task", {
    role: "researcher", description: "Bounded parity task", task: "Return a summary as JSON.",
  }), { stopReason: "toolUse" });
  return { ...fixture, thread, runtime, observation, delegate,
    runPrompt: (signal?: AbortSignal) => runtime.runPrompt({ threadId: thread.id, text: "Delegate a small task.",
      model: { provider: fixture.faux.provider.id, id: "faux-1" }, ...(signal ? { signal } : {}) }) };
}

describe("main and child compiler and model-call extension parity", () => {
  it.each([false, true])("uses the attached pipeline and meter for a first-launch child with its raw checkpoint intact; narrow tools=%s", async narrow => {
    const f = await delegationFixture();
    if (narrow) f.observation.pipeline.use({ id: "test.child-subset", prepare(call) {
      if (call.run.source === "subagent") return { context: { ...call.context, tools: [] } };
    } });
    let beforeChildMeasurements = 0;
    let childMeasurements = 0;
    let childContext: Context | undefined;
    f.faux.setResponses([
      () => { beforeChildMeasurements = f.observation.measurements(); return f.delegate; },
      context => { childContext = structuredClone(context); childMeasurements = f.observation.measurements(); return fauxAssistantMessage(outcome); },
      fauxAssistantMessage("Collected the delegated result."), fauxAssistantMessage('{"facts":[]}'),
    ]);
    const parent = await f.runPrompt();
    expect(parent.status, parent.error).toBe("completed");
    const tasks = f.store.listSubagentTasks(f.thread.id, parent.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.status, tasks[0]!.error).toBe("completed");
    const child = f.store.listRuns(f.thread.id).find(run => run.id === tasks[0]!.childRunId)!;
    expect(f.observation.hooks.filter(hook => hook.runId === child.id).map(hook => hook.phase)).toEqual(["prepare", "finalize", "around"]);
    expect(f.observation.hooks.filter(hook => hook.runId === child.id).every(hook => hook.source === "subagent")).toBe(true);
    expect(childMeasurements).toBeGreaterThan(beforeChildMeasurements);
    const raw = await assertChildEvidence(f.runtime, child, childContext!, subagentRoleInstructions("researcher"), parent.id, narrow ? [] : undefined);
    expect(raw.messages[0]).toMatchObject({ role: "user" });
    expect(contentText(raw.messages[0]!.content)).toBe(tasks[0]!.prompt);
    expect(raw.tools.map(tool => tool.name)).toEqual(["list_files"]);
  });

  it.each([false, true])("uses the same pipeline for a continued child and preserves inherited read evidence; narrow tools=%s", async narrow => {
    const f = await continuationRunnerFixture({ enabledTools: ["read_file", "list_files"] });
    await writeFile(path.join(f.workspaceRoot, "source.txt"), "inherited parity source");
    await f.assistant(fauxAssistantMessage(fauxToolCall("read_file", { path: "source.txt" }, { id: "inherited-read" }), { stopReason: "toolUse" }));
    const interrupted = await f.interrupt();
    const runtime = processReadyAgentRuntime(interrupted.store, f.registry);
    const observation = instrument(runtime);
    if (narrow) observation.pipeline.use({ id: "test.child-subset", prepare(call) {
      if (call.run.source === "subagent") return { context: { ...call.context, tools: call.context.tools!.filter(tool => tool.name === "read_file") } };
    } });
    let childContext: Context | undefined;
    let childMeasurements = 0;
    f.faux.setResponses([
      context => { childContext = structuredClone(context); childMeasurements = observation.measurements(); return fauxAssistantMessage('{"answer":"continued"}'); },
      fauxAssistantMessage("Child collected."), fauxAssistantMessage('{"facts":[]}'),
    ]);
    const parent = await runtime.resumeInterruptedRun({ threadId: f.thread.id, runId: f.parent.run.id });
    expect(parent.status, parent.error).toBe("completed");
    const successor = interrupted.store.listSubagentTasks(f.thread.id).find(task => task.continuedFromTaskId === f.task.id)!;
    expect(successor.status, successor.error).toBe("completed");
    const child = interrupted.store.listRuns(f.thread.id).find(run => run.id === successor.childRunId)!;
    expect(observation.hooks.filter(hook => hook.runId === child.id).map(hook => hook.phase)).toEqual(["prepare", "finalize", "around"]);
    expect(childMeasurements).toBeGreaterThan(0);
    const raw = await assertChildEvidence(runtime, child, childContext!, subagentRoleInstructionsForSchema("researcher", continuationOutputSchema), parent.id,
      narrow ? ["read_file"] : undefined);
    expect(raw.tools.map(tool => tool.name).sort()).toEqual(["list_files", "read_file"]);
    expect(raw.messages.slice(0, f.messages.length)).toEqual(f.messages);
    expect(JSON.stringify(childContext!.messages)).toContain("inherited parity source");
    expect((await interrupted.store.listRunEvents(child.id)).filter(event => event.type === "tool.started")).toEqual([]);
    expect(successor.turnCount).toBe(1);
  });

  it.each(["returned patch", "in-place mutation"] as const)("rejects a policy-excluded child tool before provider dispatch: %s", async mode => {
    const f = await delegationFixture();
    let childPhysicalCalls = 0;
    let excludedChildToolAttempted = false;
    f.observation.pipeline.use({ id: "test.child-excluded-tool", prepare(call) {
      if (call.run.source !== "subagent") return;
      excludedChildToolAttempted = true;
      if (mode === "in-place mutation") {
        call.context.tools!.push({ name: "forbidden_write", description: "Not granted to this child", parameters: Type.Object({}) });
        return;
      }
      return { context: { ...call.context, tools: [...(call.context.tools ?? []),
        { name: "forbidden_write", description: "Not granted to this child", parameters: Type.Object({}) }] } };
    } });
    f.faux.setResponses([f.delegate, fauxAssistantMessage("The child was denied before dispatch."), fauxAssistantMessage('{"facts":[]}')]
      .map(response => context => {
        if (context.systemPrompt?.includes(subagentRoleInstructions("researcher"))) childPhysicalCalls += 1;
        return response;
      }));
    const parent = await f.runPrompt();
    const task = f.store.listSubagentTasks(f.thread.id, parent.id)[0]!;
    expect(task.status).toBe("failed");
    expect(task.error).toMatch(/tool|policy/iu);
    expect(excludedChildToolAttempted).toBe(true);
    expect(childPhysicalCalls).toBe(0);
    expect(f.observation.hooks.filter(hook => hook.runId === task.childRunId).map(hook => hook.phase)).not.toContain("around");
    const events = await f.store.listRunEvents(task.childRunId!);
    expect(events.filter(event => event.type === "subagent.child.invocation_reserved" || event.type === "model.response")).toEqual([]);
  });

  it("keeps parent cancellation effective while a child finalizer is awaiting completion", async () => {
    const f = await delegationFixture();
    const abort = new AbortController();
    let childFinalized = false;
    f.observation.pipeline.use({ id: "test.child-finalize-cancel", async finalize(call) {
      if (call.run.source !== "subagent") return;
      await Promise.resolve();
      childFinalized = true;
      abort.abort(new Error("Cancelled in child finalizer"));
    } });
    f.faux.setResponses([f.delegate, fauxAssistantMessage(outcome)]);
    const parent = await f.runPrompt(abort.signal);
    expect(childFinalized).toBe(true);
    expect(parent.status).toBe("cancelled");
    const task = f.store.listSubagentTasks(f.thread.id, parent.id)[0]!;
    expect(task.status).toBe("cancelled");
    expect(f.faux.state.callCount).toBe(1);
    expect((await f.store.listRunEvents(task.childRunId!)).some(event => event.type === "run.completed")).toBe(false);
  });
});
