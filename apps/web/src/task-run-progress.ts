import type { RunEvent } from "@napier/contracts";

export interface TaskRunProgress {
  currentAction?: string;
  completedItems: string[];
}

interface ToolCallProgress {
  toolName: string;
  startedSeq?: number;
  terminalSeq?: number;
  terminalType?: "tool.completed" | "tool.failed" | "tool.blocked";
  commandSucceeded?: boolean;
}

interface ToolGroup {
  toolName: string;
  count: number;
  latestSeq: number;
}

const TOOL_EVENT = /^tool\.(started|completed|failed|blocked)$/u;

export function taskRunProgress(
  events: readonly RunEvent[],
  runId: string | undefined,
): TaskRunProgress {
  if (!runId) return { completedItems: [] };
  const calls = new Map<string, ToolCallProgress>();
  for (const event of events) {
    if (
      event.runId !== runId ||
      event.visibility !== "user" ||
      !TOOL_EVENT.test(event.type)
    ) {
      continue;
    }
    const callId = payloadString(event.payload, "callId");
    const toolName = payloadString(event.payload, "toolName");
    if (!callId || !toolName) continue;
    const prior = calls.get(callId);
    if (event.type === "tool.started") {
      calls.set(callId, {
        toolName,
        ...(prior ?? {}),
        startedSeq: event.seq,
      });
      continue;
    }
    const terminalType =
      event.type === "tool.completed" ||
      event.type === "tool.failed" ||
      event.type === "tool.blocked"
        ? event.type
        : undefined;
    if (!terminalType) continue;
    const commandOutcome =
      toolName === "run_command" ? commandSucceeded(event.payload) : undefined;
    calls.set(callId, {
      toolName: prior?.toolName ?? toolName,
      ...prior,
      terminalSeq: event.seq,
      terminalType,
      ...(commandOutcome !== undefined
        ? { commandSucceeded: commandOutcome }
        : {}),
    });
  }

  const current = [...calls.values()]
    .filter((call) => call.startedSeq !== undefined && !call.terminalType)
    .sort((left, right) => (left.startedSeq ?? 0) - (right.startedSeq ?? 0))
    .at(-1);
  return {
    ...(current
      ? { currentAction: `Running ${humanize(current.toolName)}` }
      : {}),
    completedItems: completedMilestones(calls.values()),
  };
}

function completedMilestones(calls: Iterable<ToolCallProgress>): string[] {
  const groups = new Map<string, ToolGroup>();
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

function groupLabel(group: ToolGroup): string {
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

function commandSucceeded(payload: unknown): boolean | undefined {
  if (!record(payload) || !record(payload["details"])) return undefined;
  const status = payload["details"]["status"];
  return typeof status === "string" ? status === "succeeded" : undefined;
}

function payloadString(value: unknown, key: string): string | undefined {
  if (!record(value)) return undefined;
  const entry = value[key];
  return typeof entry === "string" ? entry : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
