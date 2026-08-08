import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitBranch,
} from "lucide-react";

import type { ExecutionPlan, RunEvent } from "@napier/contracts";
import {
  conversationArtifactEventKey,
  conversationArtifacts,
  type ConversationArtifact,
} from "./conversation-artifact-view-model";
import { copy } from "./copy";
import {
  conversationActivities,
  type ConversationActivity,
} from "./conversation-activity-view-model";
import { ConversationArtifactCard } from "./ConversationArtifactCard";
import { MessageMarkdown } from "./message-markdown";
import type { MessageView } from "./use-workspace-view-model";

type FeedItem =
  | { kind: "message"; seq: number; message: MessageView }
  | { kind: "activity"; seq: number; activity: ConversationActivity }
  | { kind: "artifact"; seq: number; artifact: ConversationArtifact };

export function ConversationLedger({
  messages,
  events,
  plans,
  streamingText,
  endRef,
  onBranch,
  onLedgerChanged,
}: {
  messages: MessageView[];
  events: RunEvent[];
  plans: ExecutionPlan[];
  streamingText: string;
  endRef: React.RefObject<HTMLDivElement | null>;
  onBranch: (seq: number) => void;
  onLedgerChanged: () => Promise<void>;
}) {
  const artifacts = conversationArtifacts(events, plans);
  const artifactKeys = new Set(
    artifacts.map((item) => `${item.planId}:${item.artifact.id}`),
  );
  const activityEvents = events.filter((event) => {
    const key = conversationArtifactEventKey(event);
    return !key || !artifactKeys.has(`${key[0]}:${key[1]}`);
  });
  const feed: FeedItem[] = [
    ...messages.map((message) => ({
      kind: "message" as const,
      seq: message.seq,
      message,
    })),
    ...conversationActivities(activityEvents).map((activity) => ({
      kind: "activity" as const,
      seq: activity.seq,
      activity,
    })),
    ...artifacts.map((artifact) => ({
      kind: "artifact" as const,
      seq: artifact.seq,
      artifact,
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
        ) : item.kind === "activity" ? (
          <ActivityCard key={`activity-${item.activity.id}`} activity={item.activity} />
        ) : (
          <ConversationArtifactCard
            key={`artifact-${item.artifact.planId}-${item.artifact.artifact.id}`}
            item={item.artifact}
            threadId={item.artifact.threadId}
            onLedgerChanged={onLedgerChanged}
          />
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
          <MessageMarkdown text={message.text} />
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
          <MessageMarkdown text={text} />
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
