import type { Message, Tool } from "@earendil-works/pi-ai";
import { canonicalJson, sha256 } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import { createModelContextEnvelopeReceipt } from "./model-context-envelope.js";
import { normalizeSubagentWorkingMessages } from "./subagent-working-set-messages.js";
import { subagentToolResultEvidence } from "./subagent-tool-result-evidence.js";
import type { PreparedSubagentWorkingSet, SubagentCheckpointFrontier, SubagentWorkingSetBinding, SubagentWorkingSetReceipt } from "./subagent-working-set-types.js";

export const MAX_SUBAGENT_WORKING_SET_BYTES = 16 * 1024 * 1024;
export interface SubagentWorkingSetCapsule {
  kind: "napier.subagent-working-set";
  schemaVersion: 1;
  frontier: SubagentCheckpointFrontier;
  boundary: "before_model" | "turn_complete";
  systemPrompt: string;
  tools: Tool[];
  messages: Message[];
  systemPromptSha256: string;
  toolDefinitionSetSha256: string;
  messageSetSha256: string;
  previousCapsuleSha256: string;
  previousMessageSetSha256: string;
  previousMessageCount: number;
  mailbox: SubagentWorkingSetBinding["mailbox"];
  contentSha256: string;
}
const preparedBindings = new WeakMap<PreparedSubagentWorkingSet, SubagentWorkingSetBinding>();

export function subagentWorkingSetCapsules(dataRoot: string) {
  return new LocalPrivateCapsuleStore({
    dataRoot, directory: "subagent-working-sets", label: "Child working set",
    requireDurableDirectory: true,
    maxObjectBytes: MAX_SUBAGENT_WORKING_SET_BYTES, maxObjects: 4_096,
    maxStorageBytes: 512 * 1024 * 1024,
    parse: (serialized) => validateSubagentWorkingSetCapsule(JSON.parse(serialized)),
    contentSha256: (value) => value.contentSha256,
  });
}

/** Immutable file installation and fsync precede minting the pointer-write authority. */
export async function prepareSubagentWorkingSet(dataRoot: string, input: {
  frontier: SubagentCheckpointFrontier;
  boundary: SubagentWorkingSetCapsule["boundary"];
  systemPrompt: string;
  tools: readonly Tool[];
  messages: readonly unknown[];
  mailbox: SubagentWorkingSetBinding["mailbox"];
  previousCheckpoint?: SubagentWorkingSetReceipt;
}): Promise<PreparedSubagentWorkingSet> {
  const messages = normalizeSubagentWorkingMessages(input.messages);
  const tools = input.tools.map((tool) => ({ name: tool.name, description: tool.description,
    parameters: tool.parameters, ...(tool.constrainedSampling !== undefined ? { constrainedSampling: tool.constrainedSampling } : {}) }));
  const envelope = createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: input.systemPrompt, tools, messages });
  const content = JSON.parse(canonicalJson({ kind: "napier.subagent-working-set", schemaVersion: 1,
    frontier: input.frontier, boundary: input.boundary, systemPrompt: input.systemPrompt, tools, messages,
    systemPromptSha256: envelope.systemPromptSha256, toolDefinitionSetSha256: envelope.toolDefinitionSetSha256,
    messageSetSha256: envelope.messageSetSha256, mailbox: input.mailbox,
    previousCapsuleSha256: input.previousCheckpoint?.capsuleSha256 ?? "", previousMessageCount: input.previousCheckpoint?.messageCount ?? 0,
    previousMessageSetSha256: input.previousCheckpoint ? messageSetHash(messages.slice(0, input.previousCheckpoint.messageCount)) : "",
  })) as Omit<SubagentWorkingSetCapsule, "contentSha256">;
  const capsule = validateSubagentWorkingSetCapsule({ ...content, contentSha256: sha256(canonicalJson(content)) });
  const stored = await subagentWorkingSetCapsules(dataRoot).put(capsule.contentSha256, canonicalJson(capsule));
  const prepared = Object.freeze({}) as PreparedSubagentWorkingSet;
  preparedBindings.set(prepared, binding(stored.value, stored.bytes));
  return prepared;
}

export function resolvePreparedSubagentWorkingSet(prepared: PreparedSubagentWorkingSet): SubagentWorkingSetBinding {
  const value = preparedBindings.get(prepared);
  if (!value) throw new Error("Child working set requires durable preparation authority");
  return structuredClone(value);
}

export async function readSubagentWorkingSetBinding(dataRoot: string, capsuleSha256: string): Promise<SubagentWorkingSetBinding> {
  const stored = await subagentWorkingSetCapsules(dataRoot).readWithBytes(capsuleSha256);
  return binding(stored.value, stored.bytes);
}

export async function readSubagentWorkingSetForRestore(dataRoot: string, capsuleSha256: string) {
  const stored = await subagentWorkingSetCapsules(dataRoot).readWithBytes(capsuleSha256);
  return { capsule: stored.value, binding: binding(stored.value, stored.bytes) };
}

export function validateSubagentWorkingSetCapsule(input: unknown): SubagentWorkingSetCapsule {
  if (!record(input) || Object.keys(input).sort().join(",") !== ["kind", "schemaVersion", "frontier", "boundary",
    "systemPrompt", "tools", "messages", "systemPromptSha256", "toolDefinitionSetSha256", "messageSetSha256", "mailbox", "contentSha256",
    "previousCapsuleSha256", "previousMessageSetSha256", "previousMessageCount"].sort().join(",")) invalid();
  const value = input as unknown as SubagentWorkingSetCapsule;
  if (value.kind !== "napier.subagent-working-set" || value.schemaVersion !== 1 ||
      !["before_model", "turn_complete"].includes(value.boundary) || typeof value.systemPrompt !== "string" ||
      !Array.isArray(value.tools) || value.tools.length > 256 || value.tools.some((tool) =>
        !record(tool) || typeof tool.name !== "string" || typeof tool.description !== "string" || !record(tool.parameters))) invalid();
  validateFrontier(value.frontier);
  const messages = normalizeSubagentWorkingMessages(value.messages);
  const envelope = createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: value.systemPrompt, tools: value.tools, messages });
  if (value.systemPromptSha256 !== envelope.systemPromptSha256 || value.toolDefinitionSetSha256 !== envelope.toolDefinitionSetSha256 ||
      value.messageSetSha256 !== envelope.messageSetSha256) invalid();
  validateMailbox(value.mailbox, messages);
  if (!integer(value.previousMessageCount) || value.previousMessageCount > messages.length ||
      (value.previousCapsuleSha256 === "" ? value.previousMessageSetSha256 !== "" || value.previousMessageCount !== 0 :
        !hash(value.previousCapsuleSha256) || value.previousMessageSetSha256 !== messageSetHash(messages.slice(0, value.previousMessageCount)))) invalid();
  const { contentSha256, ...content } = value;
  if (sha256(canonicalJson(content)) !== contentSha256 || Buffer.byteLength(canonicalJson(value), "utf8") > MAX_SUBAGENT_WORKING_SET_BYTES) invalid();
  return structuredClone(value);
}

function binding(capsule: SubagentWorkingSetCapsule, capsuleBytes: number): SubagentWorkingSetBinding {
  return { receipt: { schemaVersion: 1, capsuleSha256: capsule.contentSha256, capsuleBytes,
    messageCount: capsule.messages.length, messageSetSha256: capsule.messageSetSha256 },
    frontier: structuredClone(capsule.frontier), mailbox: structuredClone(capsule.mailbox),
    toolNames: capsule.tools.map((tool) => tool.name), tools: structuredClone(capsule.tools),
    systemPromptSha256: capsule.systemPromptSha256, toolDefinitionSetSha256: capsule.toolDefinitionSetSha256,
    previousCapsuleSha256: capsule.previousCapsuleSha256, previousMessageSetSha256: capsule.previousMessageSetSha256,
    transcript: {
      users: capsule.messages.flatMap((message, messageIndex) => message.role === "user"
        ? [{ messageIndex, messageSha256: sha256(canonicalJson(message)), contentSha256: sha256(canonicalJson(message.content)) }] : []),
      assistantMessageSha256s: capsule.messages.filter((message) => message.role === "assistant").map((message) => sha256(canonicalJson(message))),
      toolResults: capsule.messages.flatMap((message) => message.role === "toolResult" ? [{ providerCallId: message.toolCallId,
        toolName: message.toolName, isError: message.isError, ...subagentToolResultEvidence(message) }] : []),
    } };
}

function validateFrontier(frontier: SubagentCheckpointFrontier): void {
  if (!record(frontier) || Object.keys(frontier).length !== 14 ||
      !/^thread_[a-z0-9]{8,80}$/u.test(frontier.threadId) ||
      ![frontier.runId, frontier.parentRunId].every((id) => /^run_[a-z0-9_-]{8,80}$/u.test(id)) ||
      !/^task_[a-z0-9_-]{8,80}$/u.test(frontier.taskId) || !/^subexec_[a-z0-9_-]{8,80}$/u.test(frontier.executionId) ||
      ![frontier.configurationSha256, frontier.parentConfigurationSha256, frontier.usageSha256].every(hash) ||
      ![frontier.executionRevision, frontier.checkpointRevision, frontier.runHeadSeq, frontier.nextInvocationIndex,
        frontier.turnCount, frontier.stepCount].every(integer) || frontier.executionRevision < 1) invalid();
}

function validateMailbox(mailbox: SubagentWorkingSetBinding["mailbox"], messages: Message[]): void {
  if (!record(mailbox) || Object.keys(mailbox).length !== 2 || !integer(mailbox.consumedThroughSeq) || !Array.isArray(mailbox.entries)) invalid();
  const ids = new Set<string>(), sequences = new Set<number>(), messageIndices = new Set<number>();
  for (const entry of mailbox.entries) {
    if (!record(entry) || Object.keys(entry).length !== (entry.originTaskId === undefined ? 5 : 7) || !/^submsg_[a-z0-9_-]{8,80}$/u.test(entry.id) ||
        !integer(entry.acceptedSeq) || entry.acceptedSeq < 1 || !integer(entry.messageIndex) ||
        !hash(entry.contentSha256) || !hash(entry.messageSha256) || ids.has(entry.id) || sequences.has(entry.acceptedSeq) || messageIndices.has(entry.messageIndex) ||
        !validMailboxOrigin(entry)) invalid();
    const message = messages[entry.messageIndex];
    if (message?.role !== "user" || sha256(canonicalJson(message)) !== entry.messageSha256) invalid();
    ids.add(entry.id); sequences.add(entry.acceptedSeq); messageIndices.add(entry.messageIndex);
  }
}
function validMailboxOrigin(entry: SubagentWorkingSetBinding["mailbox"]["entries"][number]): boolean {
  if (entry.originTaskId === undefined && entry.originParentRunId === undefined) return true;
  return /^task_[a-z0-9_-]{8,80}$/u.test(entry.originTaskId ?? "") && /^run_[a-z0-9_-]{8,80}$/u.test(entry.originParentRunId ?? "");
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function messageSetHash(messages: Message[]): string {
  return createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: "", tools: [], messages }).messageSetSha256;
}
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }
function invalid(): never { throw new Error("Child working set capsule is invalid"); }
