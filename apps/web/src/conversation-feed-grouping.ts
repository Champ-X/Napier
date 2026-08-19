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
import { conversationActivityCopy } from "./conversation-activity-copy";

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
}

interface PendingGroup {
  descriptor: GroupDescriptor;
  items: ConversationGroupedActivityItem[];
}

const MINIMUM_GROUP_SIZE = 2;
const BUILD_TOOLS = new Set([
  "apply_patch",
  "workspace_file_apply",
  "lsp_rename_apply",
  "lsp_code_action_apply",
  "git_stage_apply",
  "git_commit_apply",
  "git_branch_create_apply",
  "git_branch_switch_apply",
  "git_review_apply",
  "javascript_kernel",
  "python_kernel",
  "data_frame",
  "sqlite_query",
  "workspace_process",
]);
const VERIFY_TOOLS = new Set([
  "verify_workspace",
  "lsp_diagnostics",
  "run_command",
]);

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
  const entries: ConversationFeedEntry[] = [];
  let pending: PendingGroup | undefined;
  const flush = () => {
    if (!pending) return;
    entries.push(
      ...(pending.items.length >= MINIMUM_GROUP_SIZE
        ? [activityGroup(pending)]
        : pending.items),
    );
    pending = undefined;
  };
  for (const item of burst) {
    const descriptor = groupDescriptor(item)!;
    if (pending?.descriptor.key === descriptor.key) {
      pending.items.push(item);
    } else {
      flush();
      pending = { descriptor, items: [item] };
    }
  }
  flush();
  return entries;
}

function activityGroup(pending: PendingGroup): ConversationActivityGroup {
  const first = pending.items[0]!;
  const last = pending.items.at(-1)!;
  const count = pending.items.length;
  return {
    kind: "activity-group",
    id: `${pending.descriptor.key}:${String(first.seq)}`,
    seq: first.seq,
    label: pending.descriptor.label,
    summary: `${pending.descriptor.subject} · ${String(count)} ${conversationActivityCopy.group.steps}`,
    createdAt: last.activity.createdAt,
    items: pending.items,
  };
}

function groupDescriptor(
  item: ConversationFeedItem,
): GroupDescriptor | undefined {
  if (item.kind === "tool" && item.activity.status === "completed") {
    const stage = toolStage(item.activity.toolName);
    return stageDescriptor(stage);
  }
  if (item.kind === "network" && item.activity.status === "completed") {
    return stageDescriptor("research");
  }
  if (item.kind === "browser" && item.activity.status === "completed") {
    return stageDescriptor("inspect");
  }
  return undefined;
}

function toolStage(
  toolName: string,
): "research" | "build" | "verify" | "inspect" {
  if (toolName === "research_source") return "research";
  if (BUILD_TOOLS.has(toolName)) return "build";
  return VERIFY_TOOLS.has(toolName) ? "verify" : "inspect";
}

function stageDescriptor(stage: ReturnType<typeof toolStage>): GroupDescriptor {
  const subject = conversationActivityCopy.group.stages[stage];
  return { key: `stage:${stage}`, label: subject, subject };
}
