import type { RunEvent } from "@napier/contracts";

export type ConversationActivityTone =
  | "working"
  | "completed"
  | "waiting"
  | "blocked"
  | "info";

export interface ConversationActivity {
  id: string;
  seq: number;
  type: string;
  label: string;
  summary: string;
  tone: ConversationActivityTone;
  createdAt: string;
  count: number;
}

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

export function conversationActivities(
  events: RunEvent[],
  limit = 12,
): ConversationActivity[] {
  const activities = events.flatMap((event): ConversationActivity[] => {
    if (!isConversationActivity(event)) return [];
    return [
      {
        id: event.id,
        seq: event.seq,
        type: event.type,
        label: activityLabel(event.type),
        summary: activitySummary(event),
        tone: activityTone(event.type),
        createdAt: event.createdAt,
        count: 1,
      },
    ];
  });
  return collapseActivities(activities).slice(-limit);
}

function isConversationActivity(event: RunEvent): boolean {
  if (event.visibility !== "user") return false;
  if (event.type.startsWith("message.") || event.type.startsWith("model.")) {
    return false;
  }
  return ACTIVITY_PREFIXES.some((prefix) => event.type.startsWith(prefix));
}

function collapseActivities(
  activities: ConversationActivity[],
): ConversationActivity[] {
  const collapsed: ConversationActivity[] = [];
  for (const activity of activities) {
    const previous = collapsed.at(-1);
    if (
      previous &&
      previous.type === activity.type &&
      previous.tone === activity.tone
    ) {
      collapsed[collapsed.length - 1] = {
        ...activity,
        id: previous.id,
        count: previous.count + 1,
      };
    } else {
      collapsed.push(activity);
    }
  }
  return collapsed;
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

function activitySummary(event: RunEvent): string {
  if (event.type.startsWith("tool.")) {
    const tool = payloadString(event.payload, "toolName");
    const action = event.type.slice("tool.".length).replaceAll(".", " ");
    return tool ? `${humanize(action)} · ${humanize(tool)}` : humanize(action);
  }
  if (event.type === "operator.decision.requested") {
    return payloadString(event.payload, "header") ?? "Operator input requested";
  }
  return humanize(event.type);
}

function activityTone(type: string): ConversationActivityTone {
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
  if (type.endsWith(".started") || type.endsWith(".queued")) {
    return "working";
  }
  return "info";
}

function payloadString(value: unknown, key: string): string | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}

function humanize(value: string): string {
  const normalized = value.replaceAll(".", " ").replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
