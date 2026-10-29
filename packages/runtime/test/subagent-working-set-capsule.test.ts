import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { prepareSubagentWorkingSet, resolvePreparedSubagentWorkingSet, subagentWorkingSetCapsules, validateSubagentWorkingSetCapsule } from "../src/subagent-working-set-capsule.js";
import { normalizeSubagentWorkingMessages } from "../src/subagent-working-set-messages.js";
import { SubagentExecutionControl } from "../src/subagent-execution-control.js";
import type { PreparedSubagentWorkingSet, SubagentCheckpointFrontier } from "../src/subagent-working-set-types.js";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const frontier: SubagentCheckpointFrontier = {
  threadId: "thread_12345678", runId: "run_12345678", parentRunId: "run_abcdefgh", taskId: "task_12345678", executionId: "subexec_12345678",
  configurationSha256: "1".repeat(64), parentConfigurationSha256: "2".repeat(64), executionRevision: 1, checkpointRevision: 0,
  runHeadSeq: 1, nextInvocationIndex: 0, usageSha256: "3".repeat(64), turnCount: 0, stepCount: 0,
};

describe("private working set codec", () => {
  it("retains provider signatures, exact tool arguments/results and image bytes across durable read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-working-set-codec-")); roots.push(root);
    const messages = [
      { role: "user", content: "Inspect exactly", timestamp: 1 },
      fauxAssistantMessage([{ type: "thinking", thinking: "private fixture", thinkingSignature: "opaque-signature" },
        { ...fauxToolCall("read_file", { path: "x.txt" }, { id: "call-a" }), thoughtSignature: "tool-signature" }], { stopReason: "toolUse" }),
      { role: "toolResult", toolCallId: "call-a", toolName: "read_file", content: [{ type: "image", mimeType: "image/png", data: "aW1hZ2UtZml4dHVyZQ==" }],
        details: { exact: { nested: [true, null, 42] } }, isError: false, timestamp: 2 },
    ];
    const prepared = await prepareSubagentWorkingSet(root, { frontier, boundary: "before_model", systemPrompt: "role instructions", tools: [], messages,
      mailbox: { consumedThroughSeq: 0, entries: [] } });
    const binding = resolvePreparedSubagentWorkingSet(prepared);
    const actual = await subagentWorkingSetCapsules(root).read(binding.receipt.capsuleSha256);
    expect(actual.messages).toEqual(messages);
    expect(actual.frontier).toEqual(frontier);
    expect(() => resolvePreparedSubagentWorkingSet({} as PreparedSubagentWorkingSet)).toThrow("preparation authority");
    binding.frontier.runId = "run_forgedxx";
    expect(resolvePreparedSubagentWorkingSet(prepared).frontier.runId).toBe(frontier.runId);
    const damaged = structuredClone(actual); damaged.messages[0]!.timestamp++;
    expect(() => validateSubagentWorkingSetCapsule(damaged)).toThrow();
  });

  it("rejects unmatched or outstanding tools and non-JSON values instead of dropping private state", () => {
    const call = fauxAssistantMessage(fauxToolCall("read_file", { path: "x" }, { id: "call-a" }), { stopReason: "toolUse" });
    expect(() => normalizeSubagentWorkingMessages([call])).toThrow("unsettled tool batch");
    expect(() => normalizeSubagentWorkingMessages([{ role: "user", content: "text", timestamp: NaN }])).toThrow();
    expect(() => normalizeSubagentWorkingMessages([{ role: "user", content: "text", timestamp: 1, hidden: () => 0 }])).toThrow();
    expect(() => normalizeSubagentWorkingMessages([call, { role: "toolResult", toolCallId: "call-a", toolName: "wrong", content: [], isError: false, timestamp: 1 }])).toThrow();
  });

  it("recognizes actual mailbox enqueue identity and rejects an equal-text substitute or mutation", async () => {
    const content = { kind: "napier.subagent-message" as const, schemaVersion: 1 as const, id: "submsg_12345678", taskId: frontier.taskId,
      messageKind: "steering" as const, text: "Exact steering", createdAt: "2026-10-29T00:00:00.000Z" };
    const message: SubagentMessage = { ...content, contentSha256: sha256(canonicalJson(content)) };
    const queued: unknown[] = [];
    const control = new SubagentExecutionControl(async () => undefined);
    await control.activate({ abort: () => undefined, steer: (value) => { queued.push(value); } });
    await control.send(message);
    expect(control.consumedBindings(queued)).toMatchObject([{ id: message.id, messageIndex: 0 }]);
    expect(control.consumedBindings(structuredClone(queued))).toEqual([]);
    (queued[0] as { content: string }).content = "Changed steering";
    expect(() => control.consumedBindings(queued)).toThrow("changed after enqueue");
  });
});
