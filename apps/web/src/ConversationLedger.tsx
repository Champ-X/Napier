import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitBranch,
} from "lucide-react";

import type { RunEvent } from "@napier/contracts";
import { copy } from "./copy";
import {
  conversationActivities,
  type ConversationActivity,
} from "./conversation-activity-view-model";
import type { MessageView } from "./use-workspace-view-model";

type FeedItem =
  | { kind: "message"; seq: number; message: MessageView }
  | { kind: "activity"; seq: number; activity: ConversationActivity };

export function ConversationLedger({
  messages,
  events,
  streamingText,
  endRef,
  onBranch,
}: {
  messages: MessageView[];
  events: RunEvent[];
  streamingText: string;
  endRef: React.RefObject<HTMLDivElement | null>;
  onBranch: (seq: number) => void;
}) {
  const feed: FeedItem[] = [
    ...messages.map((message) => ({
      kind: "message" as const,
      seq: message.seq,
      message,
    })),
    ...conversationActivities(events).map((activity) => ({
      kind: "activity" as const,
      seq: activity.seq,
      activity,
    })),
  ].sort((left, right) => left.seq - right.seq);

  return (
    <div className="message-ledger">
      {feed.map((item) =>
        item.kind === "message" ? (
          <MessageCard
            key={`message-${item.message.id}`}
            message={item.message}
            {...(item.message.role === "assistant"
              ? { onBranch: () => onBranch(item.message.seq) }
              : {})}
          />
        ) : (
          <ActivityCard key={`activity-${item.activity.id}`} activity={item.activity} />
        ),
      )}
      {streamingText ? <StreamingCard text={streamingText} /> : null}
      <div ref={endRef} />
    </div>
  );
}

export default ConversationLedger;

function ActivityCard({ activity }: { activity: ConversationActivity }) {
  const Icon =
    activity.tone === "completed"
      ? CheckCircle2
      : activity.tone === "blocked"
        ? AlertTriangle
        : activity.tone === "waiting"
          ? Clock3
          : Activity;
  return (
    <details className={`activity-card tone-${activity.tone}`}>
      <summary>
        <Icon size={13} aria-hidden="true" />
        <span>{activity.label}</span>
        <strong>{activity.summary}</strong>
        {activity.count > 1 ? <small>×{activity.count}</small> : null}
        <time dateTime={activity.createdAt}>{formatTime(activity.createdAt)}</time>
      </summary>
      <code>{activity.type}</code>
    </details>
  );
}

function MessageCard({
  message,
  onBranch,
}: {
  message: MessageView;
  onBranch?: () => void;
}) {
  return (
    <article className={`message-card role-${message.role}`}>
      <div className="message-gutter">
        <span>{String(message.seq).padStart(3, "0")}</span>
        <i />
      </div>
      <div className="message-content">
        <header>
          <span>{message.role === "user" ? "Operator" : "Napier"}</span>
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {message.model ? <small>{message.model}</small> : null}
        </header>
        <div className="message-text">
          {message.text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={`${message.id}-${index}`}>{paragraph}</p>
          ))}
        </div>
        {onBranch ? (
          <button className="branch-action" type="button" onClick={onBranch}>
            <GitBranch size={13} aria-hidden="true" />
            {copy.branch}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function StreamingCard({ text }: { text: string }) {
  return (
    <article
      className="message-card role-assistant is-streaming"
      aria-live="polite"
    >
      <div className="message-gutter">
        <span>•••</span>
        <i />
      </div>
      <div className="message-content">
        <header>
          <span>Napier</span>
          <small>{copy.running}</small>
        </header>
        <div className="message-text">
          <p>{text}</p>
          <span className="ink-caret" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
