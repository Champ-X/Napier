import type { RunEvent } from "@napier/contracts";

interface ToolCallProgress {
  toolName: string;
  startedSeq?: number;
  terminalSeq?: number;
  terminalType?: "tool.completed" | "tool.failed" | "tool.blocked";
  commandSucceeded?: boolean;
}

interface DecisionProgress {
  runId: string;
  header: string;
  status: "pending" | "answered" | "closed";
  seq: number;
}

export interface TaskNarrativeEventState {
  callsByRun: Record<string, Record<string, ToolCallProgress>>;
  decisions: Record<string, DecisionProgress>;
}

const TOOL_EVENT = /^tool\.(started|completed|failed|blocked)$/u;

export function createTaskNarrativeEventState(): TaskNarrativeEventState {
  return { callsByRun: {}, decisions: {} };
}

export function applyTaskNarrativeEvent(
  state: TaskNarrativeEventState,
  event: RunEvent,
): TaskNarrativeEventState {
  const next = structuredClone(state);
  applyToolProgress(next, event);
  applyDecisionProgress(next, event);
  return next;
}

export function taskRunProgress(
  state: TaskNarrativeEventState,
  runId: string | undefined,
): { currentAction?: string; completedItems: string[] } {
  if (!runId) return { completedItems: [] };
  const calls = Object.values(state.callsByRun[runId] ?? {});
  const current = calls
    .filter((call) => call.startedSeq !== undefined && !call.terminalType)
    .sort((left, right) => (left.startedSeq ?? 0) - (right.startedSeq ?? 0))
    .at(-1);
  return {
    ...(current
      ? { currentAction: `Running ${humanize(current.toolName)}` }
      : {}),
    completedItems: completedMilestones(calls),
  };
}

function completedMilestones(calls: ToolCallProgress[]): string[] {
  const groups = new Map<
    string,
    { toolName: string; count: number; latestSeq: number }
  >();
  for (const call of calls) {
    if (
      call.terminalType !== "tool.completed" ||
      call.terminalSeq === undefined ||
      call.commandSucceeded === false
    ) {
      continue;
    }
    const prior = groups.get(call.toolName);
    groups.set(call.toolName, {
      toolName: call.toolName,
      count: (prior?.count ?? 0) + 1,
      latestSeq: Math.max(prior?.latestSeq ?? 0, call.terminalSeq),
    });
  }
  const ordered = [...groups.values()].sort(
    (left, right) => left.latestSeq - right.latestSeq,
  );
  if (ordered.length <= 3) return ordered.map(groupLabel);
  const latest = ordered.slice(-2);
  const earlierCount = ordered
    .slice(0, -2)
    .reduce((total, group) => total + group.count, 0);
  return [
    `${String(earlierCount)} earlier ${earlierCount === 1 ? "action" : "actions"}`,
    ...latest.map(groupLabel),
  ];
}

function applyToolProgress(
  state: TaskNarrativeEventState,
  event: RunEvent,
): void {
  if (event.visibility !== "user" || !TOOL_EVENT.test(event.type)) return;
  const callId = payloadString(event, "callId");
  const toolName = payloadString(event, "toolName");
  if (!callId || !toolName) return;
  const calls = (state.callsByRun[event.runId] ??= {});
  const prior = calls[callId];
  if (event.type === "tool.started") {
    calls[callId] = { toolName, ...(prior ?? {}), startedSeq: event.seq };
    return;
  }
  const terminalType =
    event.type === "tool.completed" ||
    event.type === "tool.failed" ||
    event.type === "tool.blocked"
      ? event.type
      : undefined;
  if (!terminalType) return;
  const commandOutcome =
    toolName === "run_command" ? commandSucceeded(event) : undefined;
  calls[callId] = {
    toolName: prior?.toolName ?? toolName,
    ...prior,
    terminalSeq: event.seq,
    terminalType,
    ...(commandOutcome !== undefined
      ? { commandSucceeded: commandOutcome }
      : {}),
  };
}

function applyDecisionProgress(
  state: TaskNarrativeEventState,
  event: RunEvent,
): void {
  const decisionId = payloadString(event, "decisionId");
  if (!decisionId) return;
  if (event.type === "operator.decision.requested") {
    const header = payloadString(event, "header");
    if (header) {
      state.decisions[decisionId] = {
        runId: event.runId,
        header,
        status: "pending",
        seq: event.seq,
      };
    }
    return;
  }
  const current = state.decisions[decisionId];
  if (!current) return;
  if (event.type === "operator.decision.answered") {
    current.status = "answered";
  } else if (
    event.type === "operator.decision.continued" ||
    event.type === "operator.decision.cancelled"
  ) {
    current.status = "closed";
  }
}

function payloadString(event: RunEvent, key: string): string | undefined {
  return event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload) &&
    typeof event.payload[key] === "string"
    ? event.payload[key]
    : undefined;
}

function commandSucceeded(event: RunEvent): boolean | undefined {
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return undefined;
  }
  const details = event.payload["details"];
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  const status = details["status"];
  return typeof status === "string" ? status === "succeeded" : undefined;
}

function groupLabel(group: { toolName: string; count: number }): string {
  const count = String(group.count);
  switch (group.toolName) {
    case "read_file":
      return `Read ${count} ${group.count === 1 ? "file" : "files"}`;
    case "run_command":
      return `Ran ${count} ${group.count === 1 ? "command" : "commands"}`;
    case "web_search":
      return `Searched the web ${count} ${group.count === 1 ? "time" : "times"}`;
    case "web_fetch":
      return `Fetched ${count} ${group.count === 1 ? "source" : "sources"}`;
    case "browser":
      return `Completed ${count} browser ${group.count === 1 ? "step" : "steps"}`;
    case "apply_patch":
      return `Applied ${count} ${group.count === 1 ? "patch" : "patches"}`;
    case "write_file":
      return `Wrote ${count} ${group.count === 1 ? "file" : "files"}`;
    case "skill_load":
      return `Loaded ${count} ${group.count === 1 ? "skill" : "skills"}`;
    default:
      return `${humanize(group.toolName)} ×${count}`;
  }
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
