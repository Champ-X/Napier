import type { JsonObject, RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import type { SubagentWorkingSetBinding, SubagentWorkingSetTranscriptEvidence } from "./subagent-working-set-types.js";
import { isDeliveredChildResponse } from "./subagent-response-disposition.js";

/** A self-hashed capsule is storage evidence; these bindings prove the actual child source. */
export function assertChildCheckpointTranscript(binding: SubagentWorkingSetBinding, run: RunRecord,
  task: SubagentTask, events: readonly RunEvent[], parentEvents: readonly RunEvent[], inherited?: SubagentWorkingSetBinding): void {
  if (binding.systemPromptSha256 !== run.configuration?.systemPromptSha256)
    throw new Error("Child checkpoint system prompt differs from its frozen configuration");
  assertAuthorizedTools(binding.toolNames, run, task);
  assertUserSource(binding, task);
  const responses = events.filter((event) => event.type === "model.response" &&
    record(event.payload)["subagentPhase"] === "subagent_turn" &&
    isDeliveredChildResponse(record(event.payload)) &&
    !["error", "aborted"].includes(String(record(event.payload)["stopReason"])));
  const hashes = [...(inherited?.transcript.assistantMessageSha256s ?? []), ...responses.map((event) => record(event.payload)["responseSha256"])];
  if (canonicalJson(hashes) !== canonicalJson(binding.transcript.assistantMessageSha256s))
    throw new Error("Child checkpoint assistant source differs from canonical responses");
  if (responses.some((event) => {
    const captured = record(event.payload)["modelContextToolDefinitionSetSha256"];
    return captured !== undefined && captured !== binding.toolDefinitionSetSha256;
  })) throw new Error("Child checkpoint tool definitions differ from captured model requests");
  const inheritedResults = inherited?.transcript.toolResults ?? [];
  if (canonicalJson(binding.transcript.toolResults.slice(0, inheritedResults.length)) !== canonicalJson(inheritedResults))
    throw new Error("Child checkpoint rewrites inherited tool result evidence");
  assertToolResults(binding.transcript.toolResults.slice(inheritedResults.length), responses, events, sdkToolReceipts(parentEvents, run, task));
}

function assertAuthorizedTools(names: readonly string[], run: RunRecord, task: SubagentTask): void {
  const configuration = run.configuration!;
  const allowed = new Set(configuration.enabledTools);
  allowed.delete("skill_resource");
  allowed.delete("candidate_file");
  if (allowed.has("skill_load")) allowed.add("skill_resource");
  if (task.role === "coder" && configuration.toolPolicy !== "observe" &&
      allowed.has("apply_patch") && allowed.has("lsp_diagnostics") && task.writePaths?.length)
    allowed.add("candidate_file");
  if (new Set(names).size !== names.length || names.some((name) => !allowed.has(name)))
    throw new Error("Child checkpoint has duplicated or unauthorized tool definitions");
}

function assertUserSource(binding: SubagentWorkingSetBinding, task: SubagentTask): void {
  const users = binding.transcript.users;
  const initial = users[0];
  if (!initial || initial.messageIndex !== 0 || ![sha256(canonicalJson(task.prompt)), sha256(canonicalJson([{ type: "text", text: task.prompt }]))].includes(initial.contentSha256))
    throw new Error("Child checkpoint initial source differs from its Task prompt");
  const byIndex = new Map(binding.mailbox.entries.map((entry) => [entry.messageIndex, entry]));
  if (byIndex.size !== binding.mailbox.entries.length || users.length !== byIndex.size + 1)
    throw new Error("Child checkpoint contains unbound or duplicated mailbox source");
  for (const user of users.slice(1)) {
    const entry = byIndex.get(user.messageIndex);
    if (!entry || entry.messageSha256 !== user.messageSha256)
      throw new Error("Child checkpoint user source differs from its consumed mailbox");
  }
}

function sdkToolReceipts(events: readonly RunEvent[], run: RunRecord, task: SubagentTask): RunEvent[] {
  return events.filter((event) => {
    const payload = record(event.payload);
    return event.type === "subagent.step" && event.runId === task.runId && event.threadId === task.threadId &&
      payload["kind"] === "tool" && payload["taskId"] === task.id && payload["childRunId"] === run.id &&
      payload["executionId"] === task.executionId;
  });
}

function assertToolResults(results: SubagentWorkingSetTranscriptEvidence["toolResults"],
  responses: readonly RunEvent[], events: readonly RunEvent[], receipts: readonly RunEvent[]): void {
  const declared = responses.flatMap((event) => {
    const calls = record(event.payload)["toolCalls"];
    return Array.isArray(calls) ? calls.map(record) : [];
  });
  const used = new Set<string>();
  for (const result of results) {
    if (!declared.some((call) => call["id"] === result.providerCallId && call["name"] === result.toolName))
      throw new Error("Child checkpoint tool result has no canonical assistant call");
    const receipt = receipts.find((event) => !used.has(event.id) &&
      record(event.payload)["providerCallId"] === result.providerCallId &&
      record(event.payload)["toolName"] === result.toolName);
    if (!receipt) throw new Error("Child checkpoint tool result has no exact SDK receipt");
    const payload = record(receipt.payload);
    if (["outputTextSha256", "resultContentSha256", "resultDetailsSha256", "resultPayloadSha256", "isError"].some((key) =>
        payload[key] !== result[key as keyof typeof result]))
      throw new Error("Child checkpoint tool result differs from its canonical SDK output");
    if (!result.isError && !events.some((event) => event.type === "tool.completed" &&
        record(event.payload)["providerCallId"] === result.providerCallId && record(event.payload)["toolName"] === result.toolName))
      throw new Error("Child checkpoint successful tool result has no settled execution");
    used.add(receipt.id);
  }
  if (used.size !== receipts.length)
    throw new Error("Child checkpoint omits a final SDK tool result");
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
