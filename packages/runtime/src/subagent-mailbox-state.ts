import type { JsonObject, RunEvent, SubagentTask } from "@napier/contracts";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";
import { canonicalJson, sha256 } from "./ed25519.js";
import { durableTerminalRunStatus } from "./run-event-admission.js";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
import { listSubagentMailboxAdmissionEvents } from "./subagent-mailbox-events.js";
import type { AcceptSubagentMessageInput, AcceptSubagentMessageResult, SubagentMailboxAcceptedBinding,
  SubagentMailboxConsumedBinding } from "./subagent-working-set-types.js";

export function validateSubagentMailboxMessage(value: unknown, taskId: string): SubagentMessage {
  const message = (record(value) ?? {}) as unknown as SubagentMessage;
  const { contentSha256, ...content } = message;
  if (message.kind !== "napier.subagent-message" || message.schemaVersion !== 1 || message.taskId !== taskId ||
      typeof message.id !== "string" || !/^submsg_[a-z0-9]{8,80}$/u.test(message.id) ||
      !["steering", "input"].includes(message.messageKind) ||
      typeof message.text !== "string" || !message.text.trim() || message.text.length > 8_000 ||
      !Number.isFinite(Date.parse(message.createdAt)) || sha256(canonicalJson(content)) !== contentSha256)
    throw new Error("Subagent mailbox message binding is invalid");
  return structuredClone(message);
}

export function acceptedSubagentMailbox(events: readonly RunEvent[], task: SubagentTask): SubagentMailboxAcceptedBinding[] {
  const accepted: SubagentMailboxAcceptedBinding[] = [];
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== "subagent.message.accepted" || record(event.payload)?.["taskId"] !== task.id) continue;
    const message = validateSubagentMailboxMessage(event.payload, task.id);
    if (event.runId !== task.runId || event.threadId !== task.threadId || ids.has(message.id))
      throw new Error("Subagent mailbox accepted identity is ambiguous");
    ids.add(message.id);
    accepted.push({ id: message.id, acceptedSeq: event.seq, contentSha256: message.contentSha256,
      messageSha256: sha256(canonicalJson({ role: "user", content: message.text, timestamp: Date.parse(message.createdAt) })) });
  }
  return accepted.sort((a, b) => a.acceptedSeq - b.acceptedSeq);
}

export function validateConsumedSubagentMailbox(accepted: readonly SubagentMailboxAcceptedBinding[],
  consumed: readonly SubagentMailboxConsumedBinding[], previous: readonly SubagentMailboxConsumedBinding[]): number {
  const byId = new Map(accepted.map((entry) => [entry.id, entry]));
  const consumedById = new Map<string, SubagentMailboxConsumedBinding>();
  for (const entry of consumed) {
    const source = byId.get(entry.id);
    if (!source || consumedById.has(entry.id) || entry.acceptedSeq !== source.acceptedSeq ||
        entry.contentSha256 !== source.contentSha256 || entry.messageSha256 !== source.messageSha256 ||
        entry.originTaskId !== source.originTaskId || entry.originParentRunId !== source.originParentRunId ||
        !Number.isSafeInteger(entry.messageIndex) || entry.messageIndex < 0)
      throw new Error("Subagent mailbox consumed binding is invalid");
    consumedById.set(entry.id, entry);
  }
  for (const entry of previous) {
    if (canonicalJson(consumedById.get(entry.id) ?? null) !== canonicalJson(entry))
      throw new Error("Subagent checkpoint cannot drop or rewrite consumed mailbox entries");
  }
  let through = 0;
  for (const entry of accepted) {
    if (!consumedById.has(entry.id)) break;
    through = entry.acceptedSeq;
  }
  return through;
}

export async function acceptSubagentMessage(host: SubagentChildRunHost,
  input: AcceptSubagentMessageInput): Promise<AcceptSubagentMessageResult> {
  input = { ...input, message: validateSubagentMailboxMessage(input.message, input.taskId) };
  host.assertInitialized();
  return host.stateQueue.run(async () => {
    const task = host.state.subagents.find((candidate) => candidate.id === input.taskId);
    if (!task || task.executionId !== input.executionId) throw new Error("Subagent mailbox execution binding is invalid");
    const parentEvents = listSubagentMailboxAdmissionEvents(host.requireLedger(), task.runId);
    const prior = parentEvents.find((event) => event.type === "subagent.message.accepted" &&
      record(event.payload)?.["id"] === input.message.id);
    if (prior) {
      if (canonicalJson(prior.payload) !== canonicalJson(input.message)) throw new Error("Subagent mailbox message conflicts");
      return { event: structuredClone(prior), appended: false };
    }
    assertAccepting(host, task, parentEvents);
    const events = host.appendEventsToThread(host.mutableThread(task.threadId), [{
      threadId: task.threadId, runId: task.runId, type: "subagent.message.accepted",
      category: "subagent", visibility: "user", payload: JSON.parse(canonicalJson(input.message)) as JsonObject,
    }]);
    await host.persistState(events);
    return { event: events[0]!, appended: true };
  });
}

function assertAccepting(host: SubagentChildRunHost, task: SubagentTask, events: RunEvent[]): void {
  const parent = host.mutableRun(task.runId);
  if ((task.status !== "pending" && task.status !== "running") || task.supervisorStatus === "reviewing" ||
      task.supervisorStatus === "orphaned" || parent.status !== "running" ||
      (parent.lease && Date.parse(parent.lease.expiresAt) <= Date.now()) ||
      durableTerminalRunStatus(events, parent.threadId, parent.id))
    throw new Error("Subagent task is not accepting messages");
}
function record(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}
