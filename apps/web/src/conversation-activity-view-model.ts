import type { RunEvent, ThreadDetail } from "@napier/contracts";

import { conversationActivityCopy } from "./conversation-activity-copy";

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

export type ConversationActivityCandidate = NonNullable<
  ThreadDetail["activityCandidates"]
>[number];

export interface ConversationActivityExclusions {
  eventIds: ReadonlySet<string>;
  callIds: ReadonlySet<string>;
  planIds: ReadonlySet<string>;
  decisionIds: ReadonlySet<string>;
  taskIds: ReadonlySet<string>;
  artifactKeys: ReadonlySet<string>;
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
  const candidates = events.flatMap(
    (event): ConversationActivityCandidate[] => {
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
        },
      ];
    },
  );
  return conversationActivitiesFromCandidates(candidates, limit);
}

export function conversationActivitiesFromCandidates(
  candidates: readonly ConversationActivityCandidate[],
  limit = 12,
): ConversationActivity[] {
  return collapseActivities(
    candidates.map((candidate) => ({
      ...localizedCandidate(candidate),
      count: 1,
    })),
  ).slice(-limit);
}

export function excludeConversationActivityCandidates(
  candidates: readonly ConversationActivityCandidate[],
  exclusions: ConversationActivityExclusions,
): ConversationActivityCandidate[] {
  return candidates.filter(
    (candidate) =>
      !exclusions.eventIds.has(candidate.id) &&
      (!candidate.callId || !exclusions.callIds.has(candidate.callId)) &&
      (!candidate.planId || !exclusions.planIds.has(candidate.planId)) &&
      (!candidate.decisionId ||
        !exclusions.decisionIds.has(candidate.decisionId)) &&
      (!candidate.taskId || !exclusions.taskIds.has(candidate.taskId)) &&
      (!candidate.artifactKey ||
        !exclusions.artifactKeys.has(candidate.artifactKey)),
  );
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
  const labels = conversationActivityCopy.generic.labels;
  if (type.startsWith("tool.")) return labels.tool;
  if (type.startsWith("plan.")) return labels.plan;
  if (type.startsWith("operator.")) return labels.approval;
  if (type.startsWith("artifact.")) return labels.artifact;
  if (type.startsWith("subagent.")) return labels.delegate;
  if (type.startsWith("workflow.")) return labels.workflow;
  if (type.startsWith("workspace.")) return labels.workspace;
  if (type.startsWith("browser.")) return labels.browser;
  if (type.startsWith("research.")) return labels.research;
  return labels.run;
}

function activitySummary(event: RunEvent): string {
  if (event.type.startsWith("tool.")) {
    const tool = payloadString(event.payload, "toolName");
    const action = localizedAction(event.type.slice("tool.".length));
    const toolLabel = isChineseActivityCopy() ? tool : tool && humanize(tool);
    return toolLabel ? `${action} · ${toolLabel}` : action;
  }
  if (event.type === "operator.decision.requested") {
    return (
      payloadString(event.payload, "header") ??
      conversationActivityCopy.generic.operatorInputRequested
    );
  }
  return localizedEventSummary(event.type);
}

function localizedCandidate(
  candidate: ConversationActivityCandidate,
): ConversationActivityCandidate {
  if (!isChineseActivityCopy()) return candidate;
  const summary = localizedCandidateSummary(candidate);
  return { ...candidate, label: activityLabel(candidate.type), summary };
}

function localizedCandidateSummary(
  candidate: ConversationActivityCandidate,
): string {
  if (candidate.type === "operator.decision.requested") {
    return candidate.summary === "Operator input requested"
      ? conversationActivityCopy.generic.operatorInputRequested
      : candidate.summary;
  }
  if (candidate.type.startsWith("tool.")) {
    const detail = candidate.summary.split(" · ").slice(1).join(" · ");
    const action = localizedAction(candidate.type.slice("tool.".length));
    return detail ? `${action} · ${detail}` : action;
  }
  return candidate.summary === humanize(candidate.type)
    ? localizedEventSummary(candidate.type)
    : candidate.summary;
}

function localizedEventSummary(type: string): string {
  if (!isChineseActivityCopy()) return humanize(type);
  const action = localizedAction(type.slice(type.indexOf(".") + 1));
  return action === type ? type : `${activityLabel(type)} · ${action}`;
}

function localizedAction(action: string): string {
  if (!isChineseActivityCopy()) return humanize(action);
  const actions: Readonly<Record<string, string>> =
    conversationActivityCopy.generic.actions;
  return actions[action] ?? action;
}

function isChineseActivityCopy(): boolean {
  return String(conversationActivityCopy.generic.labels.run) === "运行";
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
  if (!value || Array.isArray(value) || typeof value !== "object")
    return undefined;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === "string" ? entry : undefined;
}

function humanize(value: string): string {
  const normalized = value.replaceAll(".", " ").replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
