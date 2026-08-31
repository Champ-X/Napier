import type { ArtifactInspection } from "./artifact-inspection";
import type { ConversationProgressNote as ProgressNote } from "./conversation-progress-view-model";
import {
  MessageMarkdown,
  type MessageCitationLink,
  type MessageWorkspaceLink,
} from "./message-markdown";
import { shellCopy } from "./shell-copy";
import "./conversation-progress-note.css";

export interface ConversationProgressNoteProps {
  note: ProgressNote;
  workspaceLinks: readonly MessageWorkspaceLink[];
  citationLinks: readonly MessageCitationLink[];
  onInspectArtifact?(inspection: ArtifactInspection): void;
  onOpenWorkspaceFile?(path: string): void;
}

export function ConversationProgressNote({
  note,
  workspaceLinks,
  citationLinks,
  onInspectArtifact,
  onOpenWorkspaceFile,
}: ConversationProgressNoteProps) {
  return (
    <article
      className={`conversation-progress-note${note.fallback ? " is-fallback" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={shellCopy.conversationFeed.progressUpdate}
    >
      <div>
        <MessageMarkdown
          text={note.text}
          workspaceLinks={workspaceLinks}
          citationLinks={citationLinks}
          {...(onInspectArtifact ? { onInspectArtifact } : {})}
          {...(onOpenWorkspaceFile ? { onOpenWorkspaceFile } : {})}
        />
      </div>
    </article>
  );
}
