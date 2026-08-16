import type { RunEvent, SubagentTask, ThreadDetail } from "@napier/contracts";

export type ConversationSubagent = NonNullable<
  ThreadDetail["subagentCards"]
>[number];

export interface ConversationSubagentEventState {
  latest: Map<string, { id: string; seq: number; createdAt: string }>;
}

const SUBAGENT_EVENT =
  /^subagent\.(queued|started|step|completed|failed|cancelled|timed_out|outcome\.(repair\.(requested|outcome)|accepted|rejected))$/u;
const TASK_ID = /^task_[a-z0-9]{8,80}$/u;
const MAX_TASKS = 8;

export function createConversationSubagentEventState(): ConversationSubagentEventState {
  return { latest: new Map() };
}

export function applyConversationSubagentEvent(
  source: ConversationSubagentEventState,
  event: RunEvent,
): ConversationSubagentEventState {
  const taskId = conversationSubagentEventId(event);
  if (!taskId) return source;
  const latest = new Map(source.latest);
  latest.set(taskId, {
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
  });
  return {
    latest: new Map(
      [...latest.entries()]
        .sort(([, left], [, right]) => left.seq - right.seq)
        .slice(-MAX_TASKS),
    ),
  };
}

export function projectConversationSubagents(
  tasks: SubagentTask[],
  state: ConversationSubagentEventState,
): ConversationSubagent[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  return [...state.latest]
    .flatMap(([taskId, ref]): ConversationSubagent[] => {
      const task = tasksById.get(taskId);
      return task ? [subagentView(ref, task)] : [];
    })
    .sort((left, right) => left.seq - right.seq);
}

export function conversationSubagentEventId(
  event: RunEvent,
): string | undefined {
  if (
    event.visibility !== "user" ||
    !SUBAGENT_EVENT.test(event.type) ||
    !record(event.payload)
  ) {
    return undefined;
  }
  const taskId = event.payload["taskId"];
  return typeof taskId === "string" && TASK_ID.test(taskId)
    ? taskId
    : undefined;
}

function subagentView(
  ref: { id: string; seq: number; createdAt: string },
  task: SubagentTask,
): ConversationSubagent {
  const items = task.outcome?.items ?? [];
  return {
    ...ref,
    task: {
      id: task.id,
      role: task.role,
      description: task.description,
      status: task.status,
      model: { ...task.model },
      stepCount: task.stepCount,
      turnCount: task.turnCount,
      usage: {
        inputTokens: task.usage.inputTokens,
        outputTokens: task.usage.outputTokens,
      },
      ...(task.stopReason ? { stopReason: task.stopReason } : {}),
      ...(task.error ? { hasError: true as const } : {}),
      ...(task.outcome
        ? {
            outcome: {
              summary: task.outcome.summary,
              items: items.slice(0, 5).map((item) => ({
                kind: item.kind,
                severity: item.severity,
                title: item.title,
                evidenceCount: item.evidence.length,
              })),
            },
          }
        : {}),
    },
    itemCount: task.outcome?.itemCount ?? items.length,
    evidenceCount:
      task.outcome?.evidenceCount ??
      items.reduce((total, item) => total + item.evidence.length, 0),
    unknownCount:
      task.outcome?.unknownCount ?? task.outcome?.unknowns.length ?? 0,
    blockerCount: items.filter((item) => item.severity === "blocker").length,
    warningCount: items.filter((item) => item.severity === "warning").length,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
