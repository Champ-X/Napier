import { ChevronRight } from "lucide-react";
import { useId, useRef, useState } from "react";

import type {
  ConversationActivityGroup,
  ConversationGroupedActivityItem,
} from "./conversation-feed-grouping";
import { conversationActivityCopy } from "./conversation-activity-copy";
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
  const [expanded, setExpanded] = useState(false);
  const itemsRef = useRef<HTMLDivElement>(null);
  const itemsId = useId();
  const state = activityGroupState(group, activeThinkingId);
  const collapsible =
    state === "complete" &&
    group.items.length >= 4 &&
    !group.items.some(groupedItemNeedsInteraction);
  const collapsed = collapsible && !expanded;
  const copy = conversationActivityCopy.group;
  return (
    <section
      className={`conversation-activity-group${collapsible ? " is-summary-group" : ""}`}
      data-state={state}
      aria-label={`${group.label} · ${group.summary}`}
      aria-busy={state === "running"}
    >
      <span className="conversation-activity-group-status" aria-hidden="true" />
      {collapsible ? (
        <button
          type="button"
          className="conversation-activity-group-toggle"
          aria-expanded={!collapsed}
          aria-controls={itemsId}
          onClick={(event) => {
            if (
              expanded &&
              itemsRef.current?.contains(document.activeElement)
            ) {
              event.currentTarget.focus();
            }
            setExpanded((value) => !value);
          }}
        >
          <ChevronRight size={15} aria-hidden="true" />
          <span className="conversation-activity-group-label">
            {group.label}
          </span>
          <span className="conversation-activity-group-summary">
            {group.summary}
          </span>
          <span className="conversation-activity-group-action">
            {collapsed ? copy.showEvidence : copy.hideEvidence}
          </span>
        </button>
      ) : null}
      <div
        ref={itemsRef}
        id={itemsId}
        className="conversation-activity-group-items"
        hidden={collapsed}
        // Inspecting evidence is expansion intent: completion must not hide focus.
        onFocusCapture={() => setExpanded(true)}
      >
        {group.items.map((item) => renderGroupedItem(item, activeThinkingId))}
      </div>
    </section>
  );
}

function groupedItemNeedsInteraction(
  item: ConversationGroupedActivityItem,
): boolean {
  if (item.kind === "activity") return item.activity.tone === "waiting";
  return item.kind === "browser" && item.activity.takeoverRecommended === true;
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
