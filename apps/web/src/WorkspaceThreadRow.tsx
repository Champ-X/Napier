import type { ThreadSummary } from "@napier/contracts";
import { MessageSquareText } from "lucide-react";
import { memo } from "react";

import {
  formatRelativeThreadTime,
  threadPreview,
  threadStatusLabel,
} from "./workspace-thread-presentation";

export interface WorkspaceThreadRowProps {
  thread: ThreadSummary;
  active?: boolean;
  onSelect(threadId: string): void;
}

export const WorkspaceThreadRow = memo(function WorkspaceThreadRow({
  thread,
  active = false,
  onSelect,
}: WorkspaceThreadRowProps) {
  return (
    <button
      className="thread-row"
      type="button"
      onClick={() => onSelect(thread.id)}
      aria-current={active ? "page" : undefined}
    >
      <span className="thread-icon" aria-hidden="true">
        <MessageSquareText size={14} strokeWidth={1.8} />
      </span>
      <span className="thread-copy">
        <span className="thread-title-line">
          <strong>{thread.title}</strong>
          <time dateTime={thread.updatedAt}>
            {formatRelativeThreadTime(thread.updatedAt)}
          </time>
        </span>
        <small>{threadPreview(thread)}</small>
      </span>
      <ThreadStatusDot status={thread.status} />
    </button>
  );
});

function ThreadStatusDot({ status }: { status: ThreadSummary["status"] }) {
  if (status === "idle") return null;
  const label = threadStatusLabel(status);
  return (
    <span
      className={`status-dot status-${status}`}
      title={label}
      aria-label={label}
    />
  );
}
