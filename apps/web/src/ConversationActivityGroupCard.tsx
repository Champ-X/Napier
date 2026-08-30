import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type {
  ConversationActivityGroup,
  ConversationGroupedActivityItem,
} from "./conversation-feed-grouping";
import { ConversationBrowserActivityCard } from "./ConversationBrowserActivityCard";
import { ConversationNetworkActivityCard } from "./ConversationNetworkActivityCard";
import { ConversationToolActivityCard } from "./ConversationToolActivityCard";
import "./conversation-activity-group.css";

export interface ConversationActivityGroupCardProps {
  group: ConversationActivityGroup;
}

export function ConversationActivityGroupCard({
  group,
}: ConversationActivityGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details
      className="conversation-activity-group"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <ChevronRight size={15} aria-hidden="true" />
        <strong>{group.summary}</strong>
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
