import type { ThreadSummary } from "@napier/contracts";

import { getLocale } from "./locale";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";

export interface WorkspaceThreadPreviewsProps {
  threads: ThreadSummary[];
  onSelect(threadId: string): void;
}

export function WorkspaceThreadPreviews({
  threads,
  onSelect,
}: WorkspaceThreadPreviewsProps) {
  if (threads.length === 0) {
    return <p className="workspace-tree-message">{t.noSessions}</p>;
  }
  return (
    <div className="workspace-thread-previews">
      {threads.map((thread) => (
        <button
          type="button"
          key={thread.id}
          onClick={() => onSelect(thread.id)}
        >
          <span>{thread.title}</span>
          <time dateTime={thread.updatedAt}>
            {relativeDate(thread.updatedAt)}
          </time>
        </button>
      ))}
    </div>
  );
}

export function relativeDate(value: string, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - Date.parse(value)) / 86_400_000));
  return new Intl.RelativeTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    numeric: "auto",
  }).format(-days, "day");
}
