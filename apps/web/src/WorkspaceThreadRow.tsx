import type { ThreadSummary } from "@napier/contracts";

import {
  formatRelativeThreadTime,
  threadPreview,
  threadStatusLabel,
} from "./workspace-thread-presentation";

export interface WorkspaceThreadRowProps {
  thread: ThreadSummary;
  index: number;
  active?: boolean;
  onSelect(threadId: string): void;
}

export function WorkspaceThreadRow({
  thread,
  index,
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
      <span className="thread-index">{String(index + 1).padStart(2, "0")}</span>
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
}

function ThreadStatusDot({ status }: { status: ThreadSummary["status"] }) {
  const label = threadStatusLabel(status);
  return (
    <span
      className={`status-dot status-${status}`}
      title={label}
      aria-label={label}
    />
  );
}
