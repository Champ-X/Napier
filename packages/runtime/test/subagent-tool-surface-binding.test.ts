import type { JsonObject, RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { assertChildCheckpointTranscript } from "../src/subagent-checkpoint-transcript.js";
import { bindChildInvocationCapture } from "../src/subagent-child-invocation-capture.js";
import type { SubagentWorkingSetBinding } from "../src/subagent-working-set-types.js";

const tools = ["read_file", "list_files"].map(name => ({ name, description: name, parameters: { type: "object", properties: {} } }));
const full = createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: "role", tools, messages: [] });
const createdAt = new Date(0).toISOString();
const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
const model = { provider: "faux", id: "faux-1" };
const task: SubagentTask = {
  id: "task", threadId: "thread", runId: "parent", childRunId: "child", executionId: "execution",
  prompt: "bounded task", role: "researcher", description: "Bounded tool surface fixture", status: "completed",
  model, stepCount: 0, turnCount: 1, usage, createdAt, revision: 1,
};
const configuration = {
  schemaVersion: 1, agentRevision: 1, model, thinkingLevel: "off", toolPolicy: "observe",
  enabledTools: tools.map(tool => tool.name), enabledSkills: [], enabledSubagents: [],
  subagentLimits: { maxConcurrent: 1, maxTotal: 1, maxTurns: 3, timeoutMs: 10_000 },
  runLimits: { maxTurns: 3, maxTotalTokens: 10_000, maxCostUsd: 1, timeoutMs: 10_000 },
  systemPromptSha256: full.systemPromptSha256, contentSha256: sha256("configuration"),
} satisfies NonNullable<RunRecord["configuration"]>;
const run: RunRecord = {
  id: "child", threadId: "thread", agentId: "agent", status: "completed", source: "subagent",
  parentRunId: "parent", startedAt: createdAt, usage, configuration,
};
const binding: SubagentWorkingSetBinding = {
  systemPromptSha256: full.systemPromptSha256, toolDefinitionSetSha256: full.toolDefinitionSetSha256,
  toolNames: tools.map(tool => tool.name), tools,
  transcript: { users: [{ messageIndex: 0, messageSha256: sha256("task-message"), contentSha256: sha256(canonicalJson(task.prompt)) }],
    assistantMessageSha256s: ["assistant"], toolResults: [] },
  receipt: { schemaVersion: 1, capsuleSha256: sha256("capsule"), capsuleBytes: 1, messageCount: 2,
    messageSetSha256: sha256("messages") },
  previousCapsuleSha256: sha256("previous-capsule"), previousMessageSetSha256: sha256("previous-messages"),
  frontier: { threadId: "thread", runId: run.id, taskId: task.id, executionId: "execution", parentRunId: "parent",
    parentConfigurationSha256: sha256("parent-configuration"), configurationSha256: configuration.contentSha256,
    executionRevision: 1, checkpointRevision: 1, runHeadSeq: 1, nextInvocationIndex: 1,
    usageSha256: sha256(canonicalJson(usage)), turnCount: 1, stepCount: 0 },
  mailbox: { consumedThroughSeq: 0, entries: [] },
};

function response(activeTools = tools.slice(0, 1)): RunEvent<JsonObject> {
  const envelope = createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: "compiled role", tools: activeTools, messages: [] });
  const captured = bindChildInvocationCapture({ payload: {}, capture: { envelope, toolNames: activeTools.map(tool => tool.name) } }, 1);
  return { id: "response", threadId: task.threadId, runId: run.id, seq: 1, category: "model", visibility: "debug", createdAt,
    type: "model.response", payload: { ...captured.payload, subagentPhase: "subagent_turn", stopReason: "stop", responseSha256: "assistant" } };
}

it("allows an exact authorized subset while retaining the full raw checkpoint tool definitions", () => {
  expect(() => assertChildCheckpointTranscript(binding, run, task, [response()], [])).not.toThrow();
  expect(binding.tools).toHaveLength(2);
});

it.each(["definition", "missing_names", "extra_name"])("rejects %s when proving a request-local tool subset", (kind) => {
  const event = response(kind === "definition" ? [{ ...tools[0]!, description: "Changed authority surface" }] : undefined);
  const payload = event.payload;
  if (kind === "missing_names") delete payload["modelContextToolNames"];
  if (kind === "extra_name") payload["modelContextToolNames"] = ["read_file", "forbidden_write"];
  expect(() => assertChildCheckpointTranscript(binding, run, task, [event], [])).toThrow("tool definitions differ");
});

it("rejects tool-name metadata that is not bound to the exact captured envelope", () => {
  const envelope = createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: "role", tools: tools.slice(0, 1), messages: [] });
  expect(() => bindChildInvocationCapture({ payload: {}, capture: { envelope, toolNames: ["forbidden_write"] } }, 1))
    .toThrow("tool names differ");
  expect(() => bindChildInvocationCapture({ payload: { modelContextToolNames: ["read_file"] }, capture: { envelope } }, 1))
    .toThrow("captured envelope binding");
});
