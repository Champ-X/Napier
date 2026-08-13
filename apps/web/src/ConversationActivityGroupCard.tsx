import { Layers3 } from "lucide-react";
import { useState } from "react";

import type {
  ConversationActivityGroup,
  ConversationGroupedActivityItem,
} from "./conversation-feed-grouping";
import { ConversationBrowserActivityCard } from "./ConversationBrowserActivityCard";
import { ConversationNetworkActivityCard } from "./ConversationNetworkActivityCard";
import { ConversationToolActivityCard } from "./ConversationToolActivityCard";
import "./conversation-activity-group.css";

export function ConversationActivityGroupCard({
  group,
}: {
  group: ConversationActivityGroup;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="conversation-activity-group"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <Layers3 size={15} aria-hidden="true" />
        <div>
          <span>{group.label} · grouped</span>
          <strong>{group.summary}</strong>
        </div>
        <small>{expanded ? "Hide evidence" : "Show evidence"}</small>
        <time dateTime={group.createdAt}>{formatTime(group.createdAt)}</time>
      </summary>
      {expanded ? (
        <div className="conversation-activity-group-items">
          {group.items.map(renderGroupedItem)}
        </div>
      ) : null}
    </details>
  );
}

function renderGroupedItem(item: ConversationGroupedActivityItem) {
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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
