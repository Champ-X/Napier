import type { MessageView } from "./use-workspace-view-model";
import type { ConversationActivity } from "./conversation-activity-view-model";
import type { ConversationApproval } from "./conversation-approval-view-model";
import type { ConversationArtifact } from "./conversation-artifact-view-model";
import type { ConversationBrowserActivity } from "./conversation-browser-activity-view-model";
import type { ConversationCitation } from "./conversation-citation-view-model";
import type { ConversationNetworkActivity } from "./conversation-network-activity-view-model";
import type { ConversationPlan } from "./conversation-plan-view-model";
import type { ConversationRecovery } from "./conversation-recovery-view-model";
import type { ConversationSubagent } from "./conversation-subagent-view-model";
import type { ConversationToolActivity } from "./conversation-tool-activity-view-model";

export type ConversationGroupedActivityItem =
  | { kind: "network"; seq: number; activity: ConversationNetworkActivity }
  | { kind: "browser"; seq: number; activity: ConversationBrowserActivity }
  | { kind: "tool"; seq: number; activity: ConversationToolActivity };

export type ConversationFeedItem =
  | { kind: "message"; seq: number; message: MessageView }
  | { kind: "activity"; seq: number; activity: ConversationActivity }
  | { kind: "artifact"; seq: number; artifact: ConversationArtifact }
  | { kind: "citation"; seq: number; citation: ConversationCitation }
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
  items: ConversationGroupedActivityItem[];
}

export type ConversationFeedEntry =
  | ConversationFeedItem
  | ConversationActivityGroup;

interface GroupDescriptor {
  key: string;
  label: string;
  subject: string;
  singular: string;
  plural: string;
}

interface PendingGroup {
  descriptor: GroupDescriptor;
  items: ConversationGroupedActivityItem[];
}

const MINIMUM_GROUP_SIZE = 3;

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
    if (groupDescriptor(item)) {
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
  const groups = new Map<string, PendingGroup>();
  for (const item of burst) {
    const descriptor = groupDescriptor(item);
    if (!descriptor) continue;
    const pending = groups.get(descriptor.key);
    if (pending) pending.items.push(item);
    else groups.set(descriptor.key, { descriptor, items: [item] });
  }
  const emitted = new Set<string>();
  const entries: ConversationFeedEntry[] = [];
  for (const item of burst) {
    const descriptor = groupDescriptor(item)!;
    const pending = groups.get(descriptor.key)!;
    if (pending.items.length < MINIMUM_GROUP_SIZE) {
      entries.push(item);
      continue;
    }
    if (emitted.has(descriptor.key)) continue;
    emitted.add(descriptor.key);
    entries.push(activityGroup(pending));
  }
  return entries;
}

function activityGroup(pending: PendingGroup): ConversationActivityGroup {
  const first = pending.items[0]!;
  const last = pending.items.at(-1)!;
  const count = pending.items.length;
  const noun =
    count === 1 ? pending.descriptor.singular : pending.descriptor.plural;
  return {
    kind: "activity-group",
    id: `${pending.descriptor.key}:${String(first.seq)}`,
    seq: first.seq,
    label: pending.descriptor.label,
    summary: `${pending.descriptor.subject} · ${String(count)} ${noun}`,
    createdAt: last.activity.createdAt,
    items: pending.items,
  };
}

function groupDescriptor(
  item: ConversationFeedItem,
): GroupDescriptor | undefined {
  if (item.kind === "tool" && item.activity.status === "completed") {
    return {
      key: `tool:${item.activity.kind}:${item.activity.toolName}`,
      label: item.activity.kind === "shell" ? "Shell" : "Tool",
      subject: humanize(item.activity.toolName),
      singular: "call",
      plural: "calls",
    };
  }
  if (item.kind === "network" && item.activity.status === "completed") {
    return {
      key: `network:${item.activity.kind}`,
      label: "Network",
      subject: item.activity.kind === "search" ? "Web search" : "Web fetch",
      singular: item.activity.kind === "search" ? "search" : "fetch",
      plural: item.activity.kind === "search" ? "searches" : "fetches",
    };
  }
  if (item.kind === "browser" && item.activity.status === "completed") {
    const action = item.activity.action ?? "action";
    return {
      key: `browser:${action}`,
      label: "Browser",
      subject: humanize(action),
      singular: "step",
      plural: "steps",
    };
  }
  return undefined;
}

function humanize(value: string): string {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
