import type {
  ConversationActivityGroup,
  ConversationGroupedActivityItem,
} from "./conversation-feed-grouping";
import { ConversationBrowserActivityCard } from "./ConversationBrowserActivityCard";
import { ConversationGenericActivityCard } from "./ConversationMessageCards";
import { ConversationNetworkActivityCard } from "./ConversationNetworkActivityCard";
import { ConversationThinkingActivity } from "./ConversationThinkingActivity";
import { ConversationToolActivityCard } from "./ConversationToolActivityCard";
import "./conversation-activity-group.css";

export interface ConversationActivityGroupCardProps {
  group: ConversationActivityGroup;
  activeThinkingId?: string;
}

export function ConversationActivityGroupCard({
  group,
  activeThinkingId,
}: ConversationActivityGroupCardProps) {
  const state = activityGroupState(group, activeThinkingId);
  return (
    <section
      className="conversation-activity-group"
      data-state={state}
      aria-label={`${group.label} · ${group.summary}`}
      aria-busy={state === "running"}
    >
      <span className="conversation-activity-group-status" aria-hidden="true" />
      <div className="conversation-activity-group-items">
        {group.items.map((item) => renderGroupedItem(item, activeThinkingId))}
      </div>
    </section>
  );
}

function activityGroupState(
  group: ConversationActivityGroup,
  activeThinkingId: string | undefined,
): "running" | "complete" | "attention" {
  if (
    group.items.some((item) => groupedItemIsRunning(item, activeThinkingId))
  ) {
    return "running";
  }
  return group.attentionCount > 0 ? "attention" : "complete";
}

function groupedItemIsRunning(
  item: ConversationGroupedActivityItem,
  activeThinkingId: string | undefined,
): boolean {
  if (item.kind === "thinking") {
    return item.activity.id === activeThinkingId;
  }
  if (item.kind === "activity") return item.activity.tone === "working";
  return item.activity.status === "working";
}

function renderGroupedItem(
  item: ConversationGroupedActivityItem,
  activeThinkingId?: string,
) {
  if (item.kind === "activity") {
    return (
      <ConversationGenericActivityCard
        key={`activity-${item.activity.id}`}
        activity={item.activity}
      />
    );
  }
  if (item.kind === "thinking") {
    return (
      <ConversationThinkingActivity
        key={`thinking-${item.activity.id}`}
        activity={item.activity}
        active={activeThinkingId === item.activity.id}
      />
    );
  }
  if (item.kind === "network") {
    return (
      <ConversationNetworkActivityCard
        key={`network-${item.activity.callId}`}
        activity={item.activity}
      />
    );
  }
  if (item.kind === "browser") {
    return (
      <ConversationBrowserActivityCard
        key={`browser-${item.activity.callId}`}
        activity={item.activity}
      />
    );
  }
  return (
    <ConversationToolActivityCard
      key={`tool-${item.activity.callId}`}
      activity={item.activity}
    />
  );
}
