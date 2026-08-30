import type { RunEvent } from "@napier/contracts";

export type ConversationThinkingSummaryKind =
  | "research"
  | "inspect"
  | "edit"
  | "verify"
  | "plan"
  | "artifact"
  | "approval"
  | "delegate"
  | "respond"
  | "continue";

export type ConversationThinkingActionKind =
  | "search_web"
  | "read_web"
  | "browse"
  | "read_workspace"
  | "apply_patch"
  | "run_command"
  | "verify_workspace"
  | "update_plan"
  | "update_artifact"
  | "request_approval"
  | "delegate"
  | "respond"
  | "use_tool";

export interface ConversationThinkingActivity {
  id: string;
  runId: string;
  seq: number;
  lastSeq: number;
  createdAt: string;
  summaryKind: ConversationThinkingSummaryKind;
  followingActionKind?: ConversationThinkingActionKind;
  durationSeconds?: number;
  chunkCount?: number;
  deltaBytes?: number;
  transcript?: string;
  redactedChunkCount?: number;
}

const RESEARCH_TOOLS = new Set(["research_source", "web_search"]);
const WEB_READING_TOOLS = new Set(["web_fetch", "web_fetch_save"]);
const WORKSPACE_READING_TOOLS = new Set([
  "git_diff",
  "inspect_code",
  "list_files",
  "list_symbols",
  "read_file",
  "read_symbol",
  "search_files",
]);
const EDITING_TOOLS = new Set([
  "apply_patch",
  "git_branch_create_apply",
  "git_branch_switch_apply",
  "git_commit_apply",
  "git_review_apply",
  "git_stage_apply",
  "lsp_code_action_apply",
  "lsp_rename_apply",
  "workspace_file_apply",
]);
const COMMAND_TOOLS = new Set([
  "data_frame",
  "javascript_kernel",
  "python_kernel",
  "run_command",
  "sqlite_query",
  "workspace_process",
]);
const VERIFY_TOOLS = new Set(["lsp_diagnostics", "verify_workspace"]);
const PLAN_TOOLS = new Set(["create_plan", "update_plan_step"]);
const ARTIFACT_TOOLS = new Set([
  "record_run_milestone",
  "update_plan_artifact",
]);
const DELEGATION_TOOLS = new Set([
  "dispatch_subagent",
  "send_subagent_message",
]);

export function conversationThinkingActivities(
  events: readonly RunEvent[],
): ConversationThinkingActivity[] {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const turnStarts = new Map<string, RunEvent>();
  const activities: ConversationThinkingActivity[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index]!;
    if (event.type === "turn.started") {
      turnStarts.set(event.runId, event);
      continue;
    }
    if (!thinkingDelta(event)) continue;

    const first = event;
    let last = event;
    let chunkCount = boundedInteger(event.payload["chunkCount"]);
    let deltaBytes = boundedInteger(event.payload["deltaBytes"]);
    const transcript: string[] = [];
    let redactedChunkCount = 0;
    collectThinkingContent(event.payload, transcript, () => {
      redactedChunkCount += 1;
    });
    let next = ordered[index + 1];
    while (thinkingDelta(next, event.runId)) {
      last = next;
      chunkCount = sumBounded(
        chunkCount,
        boundedInteger(last.payload["chunkCount"]),
      );
      deltaBytes = sumBounded(
        deltaBytes,
        boundedInteger(last.payload["deltaBytes"]),
      );
      collectThinkingContent(last.payload, transcript, () => {
        redactedChunkCount += 1;
      });
      index += 1;
      next = ordered[index + 1];
    }

    const followingActionKind = findFollowingAction(
      ordered,
      index,
      event.runId,
    );
    const durationSeconds = durationBetween(
      turnStarts.get(event.runId) ?? first,
      last,
    );
    activities.push({
      id: first.id,
      runId: first.runId,
      seq: first.seq,
      lastSeq: last.seq,
      createdAt: last.createdAt,
      summaryKind: summaryKind(followingActionKind),
      ...(followingActionKind ? { followingActionKind } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(chunkCount !== undefined ? { chunkCount } : {}),
      ...(deltaBytes !== undefined ? { deltaBytes } : {}),
      ...(transcript.length > 0 ? { transcript: transcript.join("") } : {}),
      ...(redactedChunkCount > 0 ? { redactedChunkCount } : {}),
    });
  }
  return activities;
}

export function activeConversationThinkingId(
  events: readonly RunEvent[],
  currentRunId: string | undefined,
  runIsActive: boolean,
): string | undefined {
  if (!currentRunId || !runIsActive) return undefined;
  const runEvents = events
    .filter((event) => event.runId === currentRunId)
    .sort((left, right) => left.seq - right.seq);
  const latest = runEvents.at(-1);
  if (latest?.type !== "model.thinking.delta") return undefined;
  return conversationThinkingActivities(runEvents).find(
    (activity) => activity.lastSeq === latest.seq,
  )?.id;
}

function collectThinkingContent(
  payload: Record<string, unknown>,
  transcript: string[],
  onRedacted: () => void,
): void {
  if (typeof payload["delta"] === "string") {
    transcript.push(payload["delta"]);
    return;
  }
  if (payload["redacted"] === true) onRedacted();
}

function thinkingDelta(
  event: RunEvent | undefined,
  runId?: string,
): event is RunEvent & { payload: Record<string, unknown> } {
  return Boolean(
    event &&
    event.type === "model.thinking.delta" &&
    (!runId || event.runId === runId) &&
    record(event.payload),
  );
}

function findFollowingAction(
  events: readonly RunEvent[],
  thinkingIndex: number,
  runId: string,
): ConversationThinkingActionKind | undefined {
  for (let index = thinkingIndex + 1; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.runId !== runId) continue;
    if (event.type === "turn.started" || event.type === "turn.completed") {
      return undefined;
    }
    if (event.type === "model.thinking.delta") return undefined;
    const action = publicActionKind(event);
    if (action) return action;
  }
  return undefined;
}

function publicActionKind(
  event: RunEvent,
): ConversationThinkingActionKind | undefined {
  if (event.visibility !== "user") return undefined;
  if (event.type === "message.user") return undefined;
  if (event.type === "message.assistant") return "respond";
  if (event.type.startsWith("operator.")) return "request_approval";
  if (event.type.startsWith("subagent.")) return "delegate";
  if (
    event.type.startsWith("plan.artifact.") ||
    event.type.startsWith("artifact.")
  ) {
    return "update_artifact";
  }
  if (event.type.startsWith("plan.")) return "update_plan";
  if (!event.type.startsWith("tool.") || !record(event.payload)) {
    return undefined;
  }
  const toolName = event.payload["toolName"];
  if (typeof toolName !== "string") return "use_tool";
  if (RESEARCH_TOOLS.has(toolName)) return "search_web";
  if (WEB_READING_TOOLS.has(toolName)) return "read_web";
  if (toolName === "browser") return "browse";
  if (WORKSPACE_READING_TOOLS.has(toolName)) return "read_workspace";
  if (EDITING_TOOLS.has(toolName)) return "apply_patch";
  if (COMMAND_TOOLS.has(toolName)) return "run_command";
  if (VERIFY_TOOLS.has(toolName)) return "verify_workspace";
  if (PLAN_TOOLS.has(toolName)) return "update_plan";
  if (ARTIFACT_TOOLS.has(toolName)) return "update_artifact";
  if (toolName === "request_operator_decision") return "request_approval";
  return DELEGATION_TOOLS.has(toolName) ? "delegate" : "use_tool";
}

function summaryKind(
  action: ConversationThinkingActionKind | undefined,
): ConversationThinkingSummaryKind {
  if (action === "search_web" || action === "read_web") return "research";
  if (action === "browse" || action === "read_workspace") return "inspect";
  if (action === "apply_patch") return "edit";
  if (action === "run_command" || action === "verify_workspace") {
    return "verify";
  }
  if (action === "update_plan") return "plan";
  if (action === "update_artifact") return "artifact";
  if (action === "request_approval") return "approval";
  if (action === "delegate") return "delegate";
  if (action === "respond") return "respond";
  return "continue";
}

function durationBetween(start: RunEvent, end: RunEvent): number | undefined {
  const milliseconds = Date.parse(end.createdAt) - Date.parse(start.createdAt);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.max(1, Math.round(milliseconds / 1_000))
    : undefined;
}

function sumBounded(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  const total = left + right;
  return Number.isSafeInteger(total) ? total : undefined;
}

function boundedInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
