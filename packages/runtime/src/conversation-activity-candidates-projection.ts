import type { RunEvent, ThreadDetail } from "@napier/contracts";

export type ConversationActivityCandidate = NonNullable<
  ThreadDetail["activityCandidates"]
>[number];

const ACTIVITY_PREFIXES = [
  "run.",
  "tool.",
  "plan.",
  "operator.",
  "artifact.",
  "subagent.",
  "workflow.",
  "workspace.",
  "browser.",
  "research.",
] as const;
const MAX_CANDIDATES = 256;

export function applyConversationActivityCandidate(
  candidates: ConversationActivityCandidate[],
  event: RunEvent,
): ConversationActivityCandidate[] {
  const candidate = createConversationActivityCandidate(event);
  return candidate
    ? [...candidates, candidate].slice(-MAX_CANDIDATES)
    : candidates;
}

export function projectConversationActivityCandidates(
  events: readonly RunEvent[],
): ConversationActivityCandidate[] {
  return events.reduce(applyConversationActivityCandidate, []);
}

export function createConversationActivityCandidate(
  event: RunEvent,
): ConversationActivityCandidate | undefined {
  if (
    event.visibility !== "user" ||
    event.type === "run.progress.message" ||
    event.type.startsWith("message.") ||
    event.type.startsWith("model.") ||
    !ACTIVITY_PREFIXES.some((prefix) => event.type.startsWith(prefix))
  ) {
    return undefined;
  }
  const payload = record(event.payload) ? event.payload : {};
  const callId = token(payload["callId"]);
  const planId = resourceId(payload["planId"], "plan");
  const decisionId = resourceId(payload["decisionId"], "decision");
  const taskId = resourceId(payload["taskId"], "task");
  const artifactId = token(payload["artifactId"]);
  return {
    id: event.id,
    seq: event.seq,
    type: event.type,
    label: activityLabel(event.type),
    summary: activitySummary(event.type, payload),
    tone: activityTone(event.type),
    createdAt: event.createdAt,
    ...(callId ? { callId } : {}),
    ...(planId ? { planId } : {}),
    ...(decisionId ? { decisionId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(planId && artifactId ? { artifactKey: `${planId}:${artifactId}` } : {}),
  };
}

function activityLabel(type: string): string {
  if (type.startsWith("tool.")) return "Tool";
  if (type.startsWith("plan.")) return "Plan";
  if (type.startsWith("operator.")) return "Approval";
  if (type.startsWith("artifact.")) return "Artifact";
  if (type.startsWith("subagent.")) return "Delegate";
  if (type.startsWith("workflow.")) return "Workflow";
  if (type.startsWith("workspace.")) return "Workspace";
  if (type.startsWith("browser.")) return "Browser";
  if (type.startsWith("research.")) return "Research";
  return "Run";
}

function activitySummary(
  type: string,
  payload: Record<string, unknown>,
): string {
  if (type.startsWith("tool.")) {
    const tool = token(payload["toolName"]);
    const action = type.slice("tool.".length).replaceAll(".", " ");
    return tool ? `${humanize(action)} · ${humanize(tool)}` : humanize(action);
  }
  if (type === "operator.decision.requested") {
    return boundedText(payload["header"], 128) ?? "Operator input requested";
  }
  return humanize(type);
}

function activityTone(type: string): ConversationActivityCandidate["tone"] {
  if (
    type.endsWith(".failed") ||
    type.endsWith(".blocked") ||
    type.includes(".blocked")
  ) {
    return "blocked";
  }
  if (
    type.includes("waiting") ||
    type.startsWith("operator.decision.requested")
  ) {
    return "waiting";
  }
  if (
    type.endsWith(".completed") ||
    type.endsWith(".produced") ||
    type.endsWith(".verified")
  ) {
    return "completed";
  }
  if (type.endsWith(".started") || type.endsWith(".queued")) return "working";
  return "info";
}

function humanize(value: string): string {
  const normalized = value.replaceAll(".", " ").replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function token(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/u.test(value)
    ? value
    : undefined;
}

function resourceId(value: unknown, prefix: string): string | undefined {
  return typeof value === "string" &&
    new RegExp(`^${prefix}_[a-z0-9]{8,80}$`, "u").test(value)
    ? value
    : undefined;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
