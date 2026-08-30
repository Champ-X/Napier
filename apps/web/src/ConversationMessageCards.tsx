import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  Ellipsis,
  GitBranch,
  Link2,
} from "lucide-react";

import { copy } from "./copy";
import { getLocale } from "./locale";
import { shellCopy } from "./shell-copy";
import type { ConversationActivity } from "./conversation-activity-view-model";
import type { ArtifactInspection } from "./artifact-inspection";
import {
  MessageMarkdown,
  type MessageCitationLink,
  type MessageWorkspaceLink,
} from "./message-markdown";
import type { MessageView } from "./use-workspace-view-model";

export interface ConversationGenericActivityCardProps {
  activity: ConversationActivity;
}

export function ConversationGenericActivityCard({
  activity,
}: ConversationGenericActivityCardProps) {
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
        {activity.count > 1 ? (
          <small>×{formatNumber(activity.count)}</small>
        ) : null}
        <time dateTime={activity.createdAt}>
          {formatTime(activity.createdAt)}
        </time>
      </summary>
      <code>{activity.type}</code>
    </details>
  );
}

export interface ConversationMessageCardProps {
  message: MessageView;
  onBranch?: () => void;
  workspaceLinks: readonly MessageWorkspaceLink[];
  citationLinks: readonly MessageCitationLink[];
  onInspectArtifact?(inspection: ArtifactInspection): void;
}

export function ConversationMessageCard({
  message,
  onBranch,
  workspaceLinks,
  citationLinks,
  onInspectArtifact,
}: ConversationMessageCardProps) {
  const anchorId = `message-${String(message.seq)}`;
  return (
    <article id={anchorId} className={`message-card role-${message.role}`}>
      <div className="message-gutter">
        <span>{String(message.seq).padStart(3, "0")}</span>
        <i />
      </div>
      <div className="message-content">
        <header>
          <span>
            {message.role === "user"
              ? shellCopy.conversationFeed.operator
              : "Napier"}
          </span>
          <time dateTime={message.createdAt}>
            {formatTime(message.createdAt)}
          </time>
          {message.model ? <small>{message.model}</small> : null}
          <MessageActions
            message={message}
            anchorId={anchorId}
            {...(onBranch ? { onBranch } : {})}
          />
        </header>
        <div className="message-text">
          <MessageMarkdown
            text={message.text}
            workspaceLinks={workspaceLinks}
            citationLinks={citationLinks}
            {...(onInspectArtifact ? { onInspectArtifact } : {})}
          />
        </div>
      </div>
    </article>
  );
}

function MessageActions({
  message,
  anchorId,
  onBranch,
}: Pick<ConversationMessageCardProps, "message" | "onBranch"> & {
  anchorId: string;
}) {
  return (
    <details className="message-actions">
      <summary aria-label={shellCopy.conversationFeed.messageActions}>
        <Ellipsis size={16} aria-hidden="true" />
      </summary>
      <div>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(message.text)}
        >
          <Copy size={14} aria-hidden="true" />
          {shellCopy.conversationFeed.copyMessage}
        </button>
        <button type="button" onClick={() => copyMessageLink(anchorId)}>
          <Link2 size={14} aria-hidden="true" />
          {shellCopy.conversationFeed.copyLink}
        </button>
        {onBranch ? (
          <button type="button" onClick={onBranch}>
            <GitBranch size={14} aria-hidden="true" />
            {copy.branch}
          </button>
        ) : null}
      </div>
    </details>
  );
}

export interface ConversationStreamingCardProps {
  text: string;
  workspaceLinks: readonly MessageWorkspaceLink[];
  citationLinks: readonly MessageCitationLink[];
  onInspectArtifact?(inspection: ArtifactInspection): void;
}

export function ConversationStreamingCard({
  text,
  workspaceLinks,
  citationLinks,
  onInspectArtifact,
}: ConversationStreamingCardProps) {
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
            {...(onInspectArtifact ? { onInspectArtifact } : {})}
          />
          <span className="ink-caret" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
}

function copyMessageLink(anchorId: string): void {
  const url = new URL(window.location.href);
  url.hash = anchorId;
  window.history.replaceState(null, "", url);
  void navigator.clipboard?.writeText(url.toString());
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getLocale() === "zh" ? "zh-CN" : "en").format(
    value,
  );
}
