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
  conversationArtifactWorkspaceLinks,
  conversationArtifacts,
  type ConversationArtifact,
} from "./conversation-artifact-view-model";
import {
  conversationCitationLinks,
  conversationCitations,
  type ConversationCitation,
} from "./conversation-citation-view-model";
import { copy } from "./copy";
import {
  conversationActivities,
  type ConversationActivity,
} from "./conversation-activity-view-model";
import { ConversationArtifactCard } from "./ConversationArtifactCard";
import { ConversationCitationCard } from "./ConversationCitationCard";
import {
  MessageMarkdown,
  type MessageCitationLink,
  type MessageWorkspaceLink,
} from "./message-markdown";
import type { MessageView } from "./use-workspace-view-model";

type FeedItem =
  | { kind: "message"; seq: number; message: MessageView }
  | { kind: "activity"; seq: number; activity: ConversationActivity }
  | { kind: "artifact"; seq: number; artifact: ConversationArtifact }
  | { kind: "citation"; seq: number; citation: ConversationCitation };

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
  const workspaceLinks: MessageWorkspaceLink[] =
    conversationArtifactWorkspaceLinks(artifacts);
  const citations = conversationCitations(events);
  const citationLinks: MessageCitationLink[] =
    conversationCitationLinks(citations);
  const citationEventIds = new Set(citations.map((citation) => citation.id));
  const activityEvents = events.filter((event) => {
    const key = conversationArtifactEventKey(event);
    return (
      !citationEventIds.has(event.id) &&
      (!key || !artifactKeys.has(`${key[0]}:${key[1]}`))
    );
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
    ...citations.map((citation) => ({
      kind: "citation" as const,
      seq: citation.seq,
      citation,
    })),
  ].sort((left, right) => left.seq - right.seq);

  return (
    <div className="message-ledger">
      {feed.map((item) =>
        item.kind === "message" ? (
          <MessageCard
            key={`message-${item.message.id}`}
            message={item.message}
            workspaceLinks={workspaceLinks}
            citationLinks={citationLinks}
            {...(item.message.role === "assistant"
              ? { onBranch: () => onBranch(item.message.seq) }
              : {})}
          />
        ) : item.kind === "activity" ? (
          <ActivityCard key={`activity-${item.activity.id}`} activity={item.activity} />
        ) : item.kind === "artifact" ? (
          <ConversationArtifactCard
            key={`artifact-${item.artifact.planId}-${item.artifact.artifact.id}`}
            item={item.artifact}
            threadId={item.artifact.threadId}
            onLedgerChanged={onLedgerChanged}
          />
        ) : (
          <ConversationCitationCard
            key={`citation-${item.citation.citationId}`}
            citation={item.citation}
            index={
              citationLinks.find(
                (link) => link.citationId === item.citation.citationId,
              )?.index ?? 1
            }
          />
        ),
      )}
      {streamingText ? (
        <StreamingCard
          text={streamingText}
          workspaceLinks={workspaceLinks}
          citationLinks={citationLinks}
        />
      ) : null}
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
  workspaceLinks,
  citationLinks,
}: {
  message: MessageView;
  onBranch?: () => void;
  workspaceLinks: readonly MessageWorkspaceLink[];
  citationLinks: readonly MessageCitationLink[];
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
          <MessageMarkdown
            text={message.text}
            workspaceLinks={workspaceLinks}
            citationLinks={citationLinks}
          />
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

function StreamingCard({
  text,
  workspaceLinks,
  citationLinks,
}: {
  text: string;
  workspaceLinks: readonly MessageWorkspaceLink[];
  citationLinks: readonly MessageCitationLink[];
}) {
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
          <MessageMarkdown
            text={text}
            workspaceLinks={workspaceLinks}
            citationLinks={citationLinks}
          />
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
