import type { RunEvent, SubagentTask } from "@napier/contracts";
import type {
  SubagentHubControlAvailabilityV1,
  SubagentHubProjectionV1,
  SubagentHubTaskV1,
  SubagentHubTranscriptEntryV1,
  SubagentHubWorktreeV1,
} from "@napier/contracts/subagent-hub";

const MAX_HUB_TASKS = 24;
const MAX_TRANSCRIPT_ENTRIES = 80;
const SHA256 = /^[a-f0-9]{64}$/u;

interface HubTaskEventState {
  lastSeq: number;
  transcript: SubagentHubTranscriptEntryV1[];
  mailbox: {
    acceptedCount: number;
    deliveredCount: number;
    lastAcceptedAt?: string;
    lastDeliveredAt?: string;
  };
  worktree: SubagentHubWorktreeV1;
}

export interface SubagentHubEventState {
  tasks: Map<string, HubTaskEventState>;
}

export function createSubagentHubEventState(): SubagentHubEventState {
  return { tasks: new Map() };
}

export function applySubagentHubEvent(
  source: SubagentHubEventState,
  event: RunEvent,
): SubagentHubEventState {
  const taskId = subagentHubEventTaskId(event);
  if (!taskId) return source;
  const tasks = new Map(source.tasks);
  const current = tasks.get(taskId) ?? {
    lastSeq: 0,
    transcript: [],
    mailbox: { acceptedCount: 0, deliveredCount: 0 },
    worktree: { state: "none" as const },
  };
  const transcript = transcriptEntry(event);
  const next: HubTaskEventState = {
    lastSeq: event.seq,
    transcript: transcript
      ? [...current.transcript, transcript].slice(-MAX_TRANSCRIPT_ENTRIES)
      : current.transcript,
    mailbox: updateMailbox(current.mailbox, event),
    worktree: updateWorktree(current.worktree, event),
  };
  tasks.set(taskId, next);
  if (tasks.size > MAX_HUB_TASKS) {
    const retained = [...tasks.entries()]
      .sort(([, left], [, right]) => right.lastSeq - left.lastSeq)
      .slice(0, MAX_HUB_TASKS);
    return { tasks: new Map(retained) };
  }
  return { tasks };
}

export function projectSubagentHub(
  threadId: string,
  tasks: SubagentTask[],
  state: SubagentHubEventState,
  eventWatermark: number,
  availability: (
    task: SubagentTask,
  ) => SubagentHubControlAvailabilityV1 = defaultAvailability,
): SubagentHubProjectionV1 {
  const selected = selectTasks(tasks);
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.revivedFromTaskId) continue;
    const taskIds = children.get(task.revivedFromTaskId) ?? [];
    taskIds.push(task.id);
    children.set(task.revivedFromTaskId, taskIds);
  }
  const projected = selected.map((task) =>
    projectTask(task, state.tasks.get(task.id), children, availability(task)),
  );
  return {
    kind: "napier.subagent-hub-projection",
    schemaVersion: 1,
    threadId,
    taskCount: tasks.length,
    selectedTaskCount: projected.length,
    activeTaskCount: tasks.filter(activeTask).length,
    terminalTaskCount: tasks.filter((task) => !activeTask(task)).length,
    orphanedTaskCount: tasks.filter(
      (task) => task.supervisorStatus === "orphaned",
    ).length,
    omittedTaskCount: Math.max(0, tasks.length - projected.length),
    eventWatermark,
    tasks: projected,
  };
}

export function subagentHubEventTaskId(event: RunEvent): string | undefined {
  const payload = record(event.payload);
  if (event.visibility !== "user" || !payload) return undefined;
  if (event.type.startsWith("subagent.")) {
    return resourceId(payload["taskId"]);
  }
  if (
    (event.type === "tool.completed" || event.type === "tool.failed") &&
    payload["toolName"] === "subagent_worktree_apply"
  ) {
    return resourceId(record(payload["details"])?.["taskId"]);
  }
  return undefined;
}

function selectTasks(tasks: SubagentTask[]): SubagentTask[] {
  return [...tasks]
    .sort((left, right) => {
      const activity = Number(activeTask(right)) - Number(activeTask(left));
      return activity || right.createdAt.localeCompare(left.createdAt);
    })
    .slice(0, MAX_HUB_TASKS);
}

function projectTask(
  task: SubagentTask,
  state: HubTaskEventState | undefined,
  children: Map<string, string[]>,
  control: SubagentHubControlAvailabilityV1,
): SubagentHubTaskV1 {
  const items = task.outcome?.items ?? [];
  return {
    taskId: task.id,
    runId: task.runId,
    role: task.role,
    description: task.description,
    status: task.supervisorStatus ?? fallbackSupervisorStatus(task),
    taskStatus: task.status,
    model: { ...task.model },
    ...(task.routePlanId ? { routePlanId: task.routePlanId } : {}),
    stepCount: task.stepCount,
    turnCount: task.turnCount,
    usage: { ...task.usage },
    revision: task.revision,
    createdAt: task.createdAt,
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
    ...(task.stopReason ? { stopReason: task.stopReason } : {}),
    mailbox: {
      acceptedCount: state?.mailbox.acceptedCount ?? 0,
      deliveredCount: state?.mailbox.deliveredCount ?? 0,
      pendingCount: Math.max(
        0,
        (state?.mailbox.acceptedCount ?? 0) -
          (state?.mailbox.deliveredCount ?? 0),
      ),
      ...(state?.mailbox.lastAcceptedAt
        ? { lastAcceptedAt: state.mailbox.lastAcceptedAt }
        : {}),
      ...(state?.mailbox.lastDeliveredAt
        ? { lastDeliveredAt: state.mailbox.lastDeliveredAt }
        : {}),
    },
    lineage: {
      ...(task.revivedFromTaskId
        ? { parentTaskId: task.revivedFromTaskId }
        : {}),
      childTaskIds: [...(children.get(task.id) ?? [])],
    },
    transcript: structuredClone(state?.transcript ?? []),
    ...(task.outputSchemaSha256 && task.output !== undefined
      ? {
          typedOutput: {
            schemaSha256: task.outputSchemaSha256,
            value: structuredClone(task.output),
          },
        }
      : {}),
    ...(task.outcome
      ? {
          outcome: {
            contentSha256: task.outcome.contentSha256,
            summary: task.outcome.summary,
            itemCount: task.outcome.itemCount,
            evidenceCount:
              task.outcome.evidenceCount ??
              items.reduce((total, item) => total + item.evidence.length, 0),
            unknownCount: task.outcome.unknownCount,
            blockerCount: items.filter((item) => item.severity === "blocker")
              .length,
            warningCount: items.filter((item) => item.severity === "warning")
              .length,
            items: items.slice(0, 8).map((item) => ({
              kind: item.kind,
              severity: item.severity,
              title: item.title,
              evidenceCount: item.evidence.length,
            })),
          },
        }
      : {}),
    worktree: state?.worktree ?? { state: "none" },
    control,
  };
}

function transcriptEntry(
  event: RunEvent,
): SubagentHubTranscriptEntryV1 | undefined {
  const payload = record(event.payload);
  if (!payload) return undefined;
  const base = {
    id: event.id,
    seq: event.seq,
    createdAt: event.createdAt,
    eventType: event.type,
  };
  if (event.type === "subagent.step") {
    const entry = {
      ...base,
      kind: payload["kind"] === "tool" ? "tool" : "assistant",
      ...optionalText(payload["text"], "text"),
      ...optionalHash(payload["textSha256"], "textSha256"),
      ...optionalInteger(payload["textBytes"], "textBytes"),
      ...(payload["contentRedacted"] === true
        ? { contentRedacted: true as const }
        : {}),
      ...optionalText(payload["toolName"], "toolName"),
      ...(typeof payload["isError"] === "boolean"
        ? { isError: payload["isError"] }
        : {}),
    };
    return entry as SubagentHubTranscriptEntryV1;
  }
  if (event.type === "subagent.message.accepted") {
    return {
      ...base,
      kind: "message",
      status: "accepted",
      ...messageKind(payload["messageKind"]),
      ...optionalText(payload["text"], "text"),
      ...optionalHash(payload["contentSha256"], "textSha256"),
    };
  }
  if (event.type === "subagent.message.delivered") {
    return {
      ...base,
      kind: "message",
      status: "delivered",
      ...messageKind(payload["messageKind"]),
      ...optionalHash(payload["contentSha256"], "textSha256"),
      contentRedacted: true,
    };
  }
  if (event.type === "tool.completed" || event.type === "tool.failed") {
    const details = record(payload["details"]);
    return {
      ...base,
      kind: "worktree",
      status:
        text(details?.["status"]) ??
        (event.type === "tool.failed" ? "failed" : "completed"),
      toolName: "subagent_worktree_apply",
      isError: event.type === "tool.failed",
      ...optionalHash(details?.["resultSha256"], "textSha256"),
      contentRedacted: true,
    };
  }
  return {
    ...base,
    kind:
      event.type.includes("outcome") || event.type.includes("output")
        ? "outcome"
        : "lifecycle",
    status:
      text(payload["supervisorStatus"]) ??
      text(payload["status"]) ??
      event.type.slice("subagent.".length),
  };
}

function updateMailbox(
  current: HubTaskEventState["mailbox"],
  event: RunEvent,
): HubTaskEventState["mailbox"] {
  if (event.type === "subagent.message.accepted") {
    return {
      ...current,
      acceptedCount: current.acceptedCount + 1,
      lastAcceptedAt: event.createdAt,
    };
  }
  if (event.type === "subagent.message.delivered") {
    return {
      ...current,
      deliveredCount: current.deliveredCount + 1,
      lastDeliveredAt: event.createdAt,
    };
  }
  return current;
}

function updateWorktree(
  current: SubagentHubWorktreeV1,
  event: RunEvent,
): SubagentHubWorktreeV1 {
  const payload = record(event.payload);
  if (!payload) return current;
  if (
    event.type === "subagent.started" &&
    payload["workspaceMode"] === "isolated_write"
  ) {
    return {
      state: "isolated",
      ...optionalInteger(payload["writeScopeCount"], "writeScopeCount"),
    };
  }
  if (
    (event.type === "subagent.completed" ||
      event.type === "subagent.output.accepted") &&
    payload["mergePreviewAvailable"] === true
  ) {
    return {
      state: "preview_ready",
      ...worktreeCounts(payload),
      ...optionalHash(payload["changedFileSetSha256"], "changedFileSetSha256"),
    };
  }
  if (
    (event.type === "tool.completed" || event.type === "tool.failed") &&
    payload["toolName"] === "subagent_worktree_apply"
  ) {
    const details = record(payload["details"]);
    if (!details) return current;
    const applyStatus = applyStatusValue(details["status"]);
    return {
      ...current,
      state: applyStatus ?? "indeterminate",
      ...(applyStatus ? { applyStatus } : {}),
      ...worktreeCounts(details),
      ...(postconditionValue(details["postcondition"])
        ? { postcondition: postconditionValue(details["postcondition"])! }
        : {}),
      ...(text(record(details["diagnostics"])?.["status"])
        ? {
            diagnosticsStatus: text(
              record(details["diagnostics"])?.["status"],
            )!,
          }
        : {}),
      ...(typeof details["durable"] === "boolean"
        ? { durable: details["durable"] }
        : {}),
      ...(typeof details["rollbackAttempted"] === "boolean"
        ? { rollbackAttempted: details["rollbackAttempted"] }
        : {}),
      ...(typeof details["rollbackVerified"] === "boolean"
        ? { rollbackVerified: details["rollbackVerified"] }
        : {}),
      ...optionalHash(details["changedFileSetSha256"], "changedFileSetSha256"),
      ...optionalHash(details["resultSha256"], "resultSha256"),
    };
  }
  return current;
}

function worktreeCounts(value: Record<string, unknown>) {
  return {
    ...optionalInteger(value["writeScopeCount"], "writeScopeCount"),
    ...optionalInteger(
      value["changedFileCount"] ?? value["fileCount"],
      "changedFileCount",
    ),
    ...optionalInteger(value["candidateAddedFileCount"], "addedFileCount"),
    ...optionalInteger(
      value["candidateModifiedFileCount"],
      "modifiedFileCount",
    ),
    ...optionalInteger(value["candidateDeletedFileCount"], "deletedFileCount"),
    ...optionalInteger(value["candidateRenamedFileCount"], "renamedFileCount"),
  };
}

function defaultAvailability(
  task: SubagentTask,
): SubagentHubControlAvailabilityV1 {
  return {
    steer: false,
    cancel: false,
    revive: false,
    unavailableReason:
      task.status === "pending" || task.status === "running"
        ? "execution_unavailable"
        : task.role === "coder" && !task.writePaths
          ? "coder_write_scope_unavailable"
          : "parent_run_not_running",
  };
}

function fallbackSupervisorStatus(
  task: SubagentTask,
): SubagentHubTaskV1["status"] {
  return task.status === "pending" ? "queued" : task.status;
}

function activeTask(task: SubagentTask): boolean {
  return task.status === "pending" || task.status === "running";
}

function applyStatusValue(
  value: unknown,
): "applied" | "rolled_back" | "indeterminate" | undefined {
  return value === "applied" ||
    value === "rolled_back" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function postconditionValue(
  value: unknown,
): "verified" | "drifted" | "indeterminate" | undefined {
  return value === "verified" ||
    value === "drifted" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function messageKind(
  value: unknown,
): { messageKind: "steering" | "input" } | Record<string, never> {
  return value === "steering" || value === "input"
    ? { messageKind: value }
    : {};
}

function optionalText<K extends string>(value: unknown, key: K) {
  return typeof value === "string" && value.length > 0
    ? ({ [key]: value } as Record<K, string>)
    : {};
}

function optionalHash<K extends string>(value: unknown, key: K) {
  return typeof value === "string" && SHA256.test(value)
    ? ({ [key]: value } as Record<K, string>)
    : {};
}

function optionalInteger<K extends string>(value: unknown, key: K) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? ({ [key]: value } as Record<K, number>)
    : {};
}

function resourceId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{2,80}$/u.test(value)
    ? value
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
