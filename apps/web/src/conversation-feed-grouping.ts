import type { MessageView } from "./use-workspace-view-model";
import type { ConversationActivity } from "./conversation-activity-view-model";
import type { ConversationApproval } from "./conversation-approval-view-model";
import type { ConversationArtifact } from "./conversation-artifact-view-model";
import type { ConversationBrowserActivity } from "./conversation-browser-activity-view-model";
import type { ConversationCitation } from "./conversation-citation-view-model";
import type { ConversationNetworkActivity } from "./conversation-network-activity-view-model";
import type { ConversationMilestone } from "./conversation-milestone-view-model";
import type { ConversationPlan } from "./conversation-plan-view-model";
import type { ConversationProgressNote } from "./conversation-progress-view-model";
import type { ConversationRecovery } from "./conversation-recovery-view-model";
import type { ConversationSubagent } from "./conversation-subagent-view-model";
import type { ConversationToolActivity } from "./conversation-tool-activity-view-model";
import type { ConversationThinkingActivity } from "./conversation-thinking-view-model";
import { conversationActivityCopy } from "./conversation-activity-copy";

export type ConversationGroupedActivityItem =
  | { kind: "activity"; seq: number; activity: ConversationActivity }
  | { kind: "thinking"; seq: number; activity: ConversationThinkingActivity }
  | { kind: "network"; seq: number; activity: ConversationNetworkActivity }
  | { kind: "browser"; seq: number; activity: ConversationBrowserActivity }
  | { kind: "tool"; seq: number; activity: ConversationToolActivity };

export type ConversationFeedItem =
  | { kind: "message"; seq: number; message: MessageView }
  | { kind: "artifact"; seq: number; artifact: ConversationArtifact }
  | { kind: "citation"; seq: number; citation: ConversationCitation }
  | { kind: "milestone"; seq: number; milestone: ConversationMilestone }
  | { kind: "progress"; seq: number; note: ConversationProgressNote }
  | ConversationGroupedActivityItem
  | { kind: "plan"; seq: number; plan: ConversationPlan }
  | { kind: "approval"; seq: number; approval: ConversationApproval }
  | { kind: "subagent"; seq: number; subagent: ConversationSubagent }
  | { kind: "recovery"; seq: number; recovery: ConversationRecovery };

export interface ConversationActivityGroup {
  kind: "activity-group";
  id: string;
  seq: number;
  label: string;
  summary: string;
  createdAt: string;
  attentionCount: number;
  items: ConversationGroupedActivityItem[];
}

export type ConversationFeedEntry =
  | ConversationFeedItem
  | ConversationActivityGroup;

export function groupConversationFeed(
  feed: readonly ConversationFeedItem[],
): ConversationFeedEntry[] {
  const grouped: ConversationFeedEntry[] = [];
  let burst: ConversationGroupedActivityItem[] = [];
  const flush = () => {
    grouped.push(...groupActivityBurst(burst));
    burst = [];
  };
  for (const item of feed) {
    if (isGroupableActivity(item)) {
      burst.push(item as ConversationGroupedActivityItem);
      continue;
    }
    flush();
    grouped.push(item);
  }
  flush();
  return grouped;
}

function groupActivityBurst(
  burst: ConversationGroupedActivityItem[],
): ConversationFeedEntry[] {
  if (burst.length === 0) return [];
  return [activityGroup(burst)];
}

function activityGroup(
  items: ConversationGroupedActivityItem[],
): ConversationActivityGroup {
  const first = items[0]!;
  const last = items.at(-1)!;
  const attentionCount = items.filter(needsAttention).length;
  const stepUnit =
    items.length === 1
      ? conversationActivityCopy.group.step
      : conversationActivityCopy.group.steps;
  return {
    kind: "activity-group",
    id: `execution:${String(first.seq)}`,
    seq: first.seq,
    label: conversationActivityCopy.group.execution,
    summary: `${String(items.length)} ${stepUnit}${attentionCount > 0 ? ` · ${String(attentionCount)} ${conversationActivityCopy.group.attention}` : ""}`,
    createdAt: last.activity.createdAt,
    attentionCount,
    items,
  };
}

function isGroupableActivity(
  item: ConversationFeedItem,
): item is ConversationGroupedActivityItem {
  return (
    item.kind === "activity" ||
    item.kind === "thinking" ||
    item.kind === "network" ||
    item.kind === "browser" ||
    item.kind === "tool"
  );
}

function needsAttention(item: ConversationGroupedActivityItem): boolean {
  if (item.kind === "thinking") return false;
  if (item.kind === "activity") return item.activity.tone === "blocked";
  return (
    item.activity.status === "failed" || item.activity.status === "blocked"
  );
}
