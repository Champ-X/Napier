import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
} from "lucide-react";

import { copy } from "./copy";
import { getLocale } from "./locale";
import { shellCopy } from "./shell-copy";
import type { ConversationActivity } from "./conversation-activity-view-model";
import type { ArtifactInspection } from "./artifact-inspection";
import {
  MessageMarkdown,
  type MessageCitationLink,
  type MessageSkillResourceLink,
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
  workspaceLinks: readonly MessageWorkspaceLink[];
  skillResourceLinks?: readonly MessageSkillResourceLink[];
  citationLinks: readonly MessageCitationLink[];
  onInspectArtifact?(inspection: ArtifactInspection): void;
  onOpenWorkspaceFile?(path: string): void;
  onOpenSkillResource?(reference: MessageSkillResourceLink): void;
}

export function ConversationMessageCard({
  message,
  workspaceLinks,
  skillResourceLinks = [],
  citationLinks,
  onInspectArtifact,
  onOpenWorkspaceFile,
  onOpenSkillResource,
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
        </header>
        <div className="message-text">
          <MessageMarkdown
            text={message.text}
            workspaceLinks={workspaceLinks}
            skillResourceLinks={skillResourceLinks}
            citationLinks={citationLinks}
            {...(onInspectArtifact ? { onInspectArtifact } : {})}
            {...(onOpenWorkspaceFile ? { onOpenWorkspaceFile } : {})}
            {...(onOpenSkillResource ? { onOpenSkillResource } : {})}
          />
        </div>
        <MessageCopyAction message={message} />
      </div>
    </article>
  );
}

function MessageCopyAction({
  message,
}: Pick<ConversationMessageCardProps, "message">) {
  const tooltipId = `message-copy-tooltip-${String(message.seq)}`;
  return (
    <button
      type="button"
      className="message-copy-action"
      aria-label={shellCopy.conversationFeed.copyMessage}
      aria-describedby={tooltipId}
      onClick={() => void navigator.clipboard?.writeText(message.text)}
    >
      <Copy size={15} aria-hidden="true" />
      <span id={tooltipId} role="tooltip">
        {shellCopy.conversationFeed.copyMessage}
      </span>
    </button>
  );
}

export interface ConversationStreamingCardProps {
  text: string;
  workspaceLinks: readonly MessageWorkspaceLink[];
  skillResourceLinks?: readonly MessageSkillResourceLink[];
  citationLinks: readonly MessageCitationLink[];
  onInspectArtifact?(inspection: ArtifactInspection): void;
  onOpenWorkspaceFile?(path: string): void;
  onOpenSkillResource?(reference: MessageSkillResourceLink): void;
}

export function ConversationStreamingCard({
  text,
  workspaceLinks,
  skillResourceLinks = [],
  citationLinks,
  onInspectArtifact,
  onOpenWorkspaceFile,
  onOpenSkillResource,
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
            skillResourceLinks={skillResourceLinks}
            citationLinks={citationLinks}
            {...(onInspectArtifact ? { onInspectArtifact } : {})}
            {...(onOpenWorkspaceFile ? { onOpenWorkspaceFile } : {})}
            {...(onOpenSkillResource ? { onOpenSkillResource } : {})}
          />
          <span className="ink-caret" aria-hidden="true" />
        </div>
      </div>
    </article>
  );
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
