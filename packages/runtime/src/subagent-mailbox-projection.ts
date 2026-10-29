import type { RunEvent, SubagentTask } from "@napier/contracts";
import type { SubagentSnapshot } from "@napier/contracts/subagent-supervisor";

/** Mailbox progress follows the logical Task; delivery retries do not add messages. */
export function projectSubagentMailbox(task: SubagentTask, tasks: readonly SubagentTask[],
  events: readonly RunEvent[]): SubagentSnapshot["mailbox"] {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  const lineage = new Set<string>();
  let current: SubagentTask | undefined = task;
  let consumedCount: number | undefined;
  let consumedThroughSeq: number | undefined;
  while (current) {
    if (lineage.has(current.id) || lineage.size >= 32) throw new Error("Subagent mailbox projection lineage is invalid");
    lineage.add(current.id);
    consumedCount ??= current.mailboxConsumedCount;
    consumedThroughSeq ??= current.mailboxConsumedThroughSeq;
    if (!current.continuedFromTaskId) break;
    current = byId.get(current.continuedFromTaskId);
    if (!current) throw new Error("Subagent mailbox projection predecessor is unavailable");
  }
  const accepted = new Map<string, RunEvent>();
  const delivered = new Map<string, RunEvent>();
  for (const event of events) {
    const payload = record(event.payload);
    if (!lineage.has(String(payload["taskId"]))) continue;
    if (event.type === "subagent.message.accepted" && typeof payload["id"] === "string" && !accepted.has(payload["id"]))
      accepted.set(payload["id"], event);
    if (event.type === "subagent.message.delivered" && typeof payload["messageId"] === "string")
      delivered.set(payload["messageId"], event);
  }
  const deliveries = [...delivered].filter(([id]) => accepted.has(id)).map(([, event]) => event);
  const lastAccepted = latest([...accepted.values()]);
  const lastDelivered = latest(deliveries);
  return { acceptedCount: accepted.size, deliveredCount: deliveries.length, consumedCount: consumedCount ?? 0,
    consumedThroughSeq: consumedThroughSeq ?? 0,
    pendingConsumptionCount: Math.max(0, accepted.size - (consumedCount ?? 0)),
    pendingCount: Math.max(0, accepted.size - deliveries.length),
    ...(lastAccepted ? { lastAcceptedAt: lastAccepted.createdAt } : {}),
    ...(lastDelivered ? { lastDeliveredAt: lastDelivered.createdAt } : {}) };
}
function latest(events: RunEvent[]): RunEvent | undefined {
  return events.reduce<RunEvent | undefined>((last, event) => !last || event.seq > last.seq ? event : last, undefined);
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
