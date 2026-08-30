import {
  Check,
  ChevronRight,
  CircleDashed,
  MessageSquareText,
} from "lucide-react";

import { agentMilestoneCopy } from "./agent-milestone-copy";
import type { ConversationMilestone } from "./conversation-milestone-view-model";
import "./conversation-milestone.css";

export interface ConversationMilestoneCardProps {
  milestone: ConversationMilestone;
}

export function ConversationMilestoneCard({
  milestone,
}: ConversationMilestoneCardProps) {
  const titleId = `conversation-milestone-${milestone.id}`;
  return (
    <article
      className={`conversation-milestone phase-${milestone.phase}`}
      aria-labelledby={titleId}
    >
      <header>
        <span className="conversation-milestone-icon" aria-hidden="true">
          <MessageSquareText size={15} />
        </span>
        <span>{agentMilestoneCopy.conversation.label}</span>
        <small>{agentMilestoneCopy.phases[milestone.phase]}</small>
      </header>
      <strong id={titleId}>{milestone.title}</strong>
      <p>{milestone.summary}</p>
      {milestone.completedItems.length > 0 || milestone.openLoops.length > 0 ? (
        <details>
          <summary>
            <ChevronRight size={14} aria-hidden="true" />
            <span>{agentMilestoneCopy.conversation.details}</span>
            {milestone.completedItems.length > 0 ? (
              <small>
                {milestone.completedItems.length}{" "}
                {agentMilestoneCopy.conversation.completedCount}
              </small>
            ) : null}
            {milestone.openLoops.length > 0 ? (
              <small>
                {milestone.openLoops.length}{" "}
                {agentMilestoneCopy.conversation.openCount}
              </small>
            ) : null}
          </summary>
          <div className="conversation-milestone-details">
            {milestone.completedItems.length > 0 ? (
              <MilestoneItems
                icon="completed"
                label={agentMilestoneCopy.conversation.completedItems}
                items={milestone.completedItems}
              />
            ) : null}
            {milestone.openLoops.length > 0 ? (
              <MilestoneItems
                icon="open"
                label={agentMilestoneCopy.conversation.openLoops}
                items={milestone.openLoops}
              />
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function MilestoneItems({
  icon,
  label,
  items,
}: {
  icon: "completed" | "open";
  label: string;
  items: readonly string[];
}) {
  const Icon = icon === "completed" ? Check : CircleDashed;
  return (
    <section>
      <strong>{label}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <Icon size={14} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
