import type { RunEvent, SubagentTask } from "@napier/contracts";

export interface ConversationSubagent {
  id: string;
  seq: number;
  createdAt: string;
  task: SubagentTask;
  itemCount: number;
  evidenceCount: number;
  unknownCount: number;
  blockerCount: number;
  warningCount: number;
}

const SUBAGENT_EVENT =
  /^subagent\.(queued|started|step|completed|failed|cancelled|timed_out|outcome\.(repair\.(requested|outcome)|accepted|rejected))$/u;
const TASK_ID = /^task_[a-z0-9]{8,80}$/u;

export function conversationSubagents(
  events: RunEvent[],
  tasks: SubagentTask[],
  limit = 8,
): ConversationSubagent[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const latest = new Map<string, ConversationSubagent>();
  for (const event of events) {
    const taskId = conversationSubagentEventId(event);
    if (!taskId) continue;
    const task = tasksById.get(taskId);
    if (!task) continue;
    latest.set(taskId, projectSubagent(event, task));
  }
  return [...latest.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-limit);
}

export function conversationSubagentEventId(
  event: RunEvent,
): string | undefined {
  if (
    event.visibility !== "user" ||
    !SUBAGENT_EVENT.test(event.type) ||
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const taskId = event.payload["taskId"];
  return typeof taskId === "string" && TASK_ID.test(taskId)
    ? taskId
    : undefined;
}

function projectSubagent(
  event: RunEvent,
  task: SubagentTask,
): ConversationSubagent {
  const items = task.outcome?.items ?? [];
  return {
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    task,
    itemCount: task.outcome?.itemCount ?? items.length,
    evidenceCount:
      task.outcome?.evidenceCount ??
      items.reduce((total, item) => total + item.evidence.length, 0),
    unknownCount: task.outcome?.unknownCount ?? task.outcome?.unknowns.length ?? 0,
    blockerCount: items.filter((item) => item.severity === "blocker").length,
    warningCount: items.filter((item) => item.severity === "warning").length,
  };
}
