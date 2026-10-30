import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall, type Context, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { JsonObject, JsonValue } from "@napier/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { validateCompiledPromptPackageReceiptV3 } from "../src/compiled-prompt-package.js";
import { sha256 } from "../src/ed25519.js";
import { validateModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { validateModelInvocationCapsuleReceipt } from "../src/model-invocation-capsule.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";
import { RUN_CONTEXT_COMPACTED_EVENT } from "../src/run-context-checkpoint.js";
import { readSubagentWorkingSetForRestore } from "../src/subagent-working-set-capsule.js";
import { cleanupModelSessionFixtures, createModelSessionFixture, SYNTHETIC_ROUTE_KEY } from "./subagent-model-session-fixture.js";

function jsonObject(value: JsonValue | undefined): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected JSON object in model evidence");
  return value;
}

function jsonArray(value: JsonValue | undefined): JsonValue[] {
  if (!Array.isArray(value)) throw new Error("Expected JSON array in model evidence");
  return value;
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External model requests forbidden"); })));
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await cleanupModelSessionFixtures(); });

it("captures the auxiliary compiler package against the exact child request without resetting route, turns or accounting", async () => {
  const f = await createModelSessionFixture({ timeoutMs: 15_000, maxTurns: 3, routeCredential: true, nativeAccounting: true });
  Object.assign(f.model, { contextWindow: 10_000, maxTokens: 1_200, reasoning: false });
  for (const name of ["first", "second"]) await writeFile(path.join(f.store.workspaceRoot, `${name}.txt`), `${name} source evidence `.repeat(400));
  const summary = { summary: "Both source files were inspected; final answer remains unfinished.",
    decisions: ["Preserve source evidence."], openLoops: ["Return the final answer."], artifacts: ["first.txt", "second.txt"] };
  const calls: Array<{ auxiliary: boolean; context: Context; options: SimpleStreamOptions | undefined }> = [];
  let normal = 0;
  const dispatch: typeof f.registry.models.streamSimple = (model, context, options) => {
    const auxiliary = context.systemPrompt?.includes("checkpoint inside an unfinished Run") ?? false;
    calls.push({ auxiliary, context: structuredClone(context), options });
    if (!auxiliary) normal += 1;
    const response = auxiliary ? fauxAssistantMessage(JSON.stringify(summary)) : normal <= 2
      ? fauxAssistantMessage(fauxToolCall("read_file", { path: normal === 1 ? "first.txt" : "second.txt" }, { id: `read-${normal}` }), { stopReason: "toolUse" })
      : fauxAssistantMessage('{"answer":"verified"}');
    Object.assign(response, { api: model.api, provider: model.provider, model: model.id });
    response.usage = { input: auxiliary ? 3_000 : 1_000, output: auxiliary ? 300 : 100, cacheRead: 0, cacheWrite: 0,
      totalTokens: auxiliary ? 3_300 : 1_100,
      cost: { input: auxiliary ? 0.003 : 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: auxiliary ? 0.003 : 0.001 } };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: response.stopReason === "toolUse" ? "toolUse" : "stop", message: response });
    return stream;
  };
  f.registry.registerProvider({ ...f.faux.provider, stream: dispatch, streamSimple: dispatch });
  const result = await f.supervisor.collect(await f.supervisor.start(f.request({ outputSchema: {
    type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false,
  } })));
  expect(result.status, result.task.error).toBe("completed");
  expect(result.task.turnCount).toBe(3);
  expect(calls).toHaveLength(4);
  const auxiliary = calls.filter(call => call.auxiliary);
  expect(auxiliary).toHaveLength(1);
  expect(auxiliary[0]!.options).toMatchObject({ apiKey: SYNTHETIC_ROUTE_KEY, maxRetries: 0, maxTokens: 1_200 });
  expect(auxiliary[0]!.options?.onResponse).toBeUndefined();
  expect(auxiliary[0]!.context.tools).toEqual([]);
  expect(auxiliary[0]!.context.systemPrompt).not.toContain("You are an isolated research subagent.");
  const child = f.store.listRuns(f.thread.id).find(run => run.id === result.task.childRunId)!;
  const events = await f.store.listRunEvents(child.id);
  const packages = events.filter(event => event.type === "context.prompt_package" && jsonObject(event.payload)["purpose"] === "context_compaction");
  expect(packages).toHaveLength(1);
  const compiled = validateCompiledPromptPackageReceiptV3(packages[0]!.payload);
  expect(compiled).toMatchObject({ purpose: "context_compaction", systemPromptSha256: sha256(auxiliary[0]!.context.systemPrompt!),
    systemPromptBytes: Buffer.byteLength(auxiliary[0]!.context.systemPrompt!), effectiveCapabilities: { toolCount: 0 } });
  const envelope = validateModelContextEnvelopeReceipt(events.find(event => event.type === "context.model_envelope" &&
    jsonObject(event.payload)["turnIndex"] === compiled.turnIndex)!.payload);
  expect(compiled).toMatchObject({ systemPromptSha256: envelope.systemPromptSha256,
    effectiveCapabilities: { toolDefinitionSetSha256: envelope.toolDefinitionSetSha256 } });
  const receipts = (await f.store.listRunEvents(f.run.id)).filter(event => event.type === "subagent.model.invocation" && jsonObject(event.payload)["phase"] === "context_compaction");
  expect(receipts).toHaveLength(1);
  expect(receipts[0]!.payload).toMatchObject({ owner: { childRunId: child.id }, contextEnvelopeSha256: envelope.contentSha256 });
  const captures = jsonArray(jsonObject(receipts[0]!.payload)["captures"]).map(jsonObject);
  const invocation = captures.find(capture => capture["kind"] === "invocation")!;
  const invocationReceipt = validateModelInvocationCapsuleReceipt(invocation["payload"]);
  const capsule = await new ModelInvocationCapsuleStore(f.store.dataRoot).read(invocationReceipt.capsuleSha256);
  expect(capsule).toMatchObject({ sourceRunId: child.id, purpose: "context_compaction", turnIndex: compiled.turnIndex,
    contextEnvelopeSha256: envelope.contentSha256 });
  expect(capsule.context).toEqual(auxiliary[0]!.context);
  expect(events.filter(event => event.type === "model.response")).toHaveLength(4);
  expect(events.filter(event => event.type === "model.response" && jsonObject(event.payload)["modelCallPurpose"] === "context_compaction")).toHaveLength(1);
  expect(events.filter(event => event.type === "model.accounting.prepared")).toHaveLength(4);
  expect(events.filter(event => event.type === "model.usage.reconciled")).toHaveLength(4);
  expect(result.task.usage).toEqual({ inputTokens: 6_000, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.006 });
  expect(child.usage).toEqual(result.task.usage);
  expect((await f.store.modelAccountingRepository.readRunAccounting(f.run.id)).usage).toEqual(result.task.usage);
  expect(f.source!.pending()).toHaveLength(0);
  expect(events.filter(event => event.type === RUN_CONTEXT_COMPACTED_EVENT)).toHaveLength(1);
  const raw = await readSubagentWorkingSetForRestore(f.store.dataRoot, child.subagent!.checkpoint!.capsuleSha256);
  expect(JSON.stringify(raw.capsule.messages)).toContain("first source evidence ".repeat(400));
  expect(JSON.stringify(raw.capsule.messages)).not.toContain(summary.summary);
  expect(JSON.stringify(calls.at(-1)!.context.messages)).toContain(summary.summary);
});
