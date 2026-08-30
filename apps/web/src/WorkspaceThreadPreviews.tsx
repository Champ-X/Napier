import type { ThreadSummary } from "@napier/contracts";

import { workspaceTreeCopy as t } from "./workspace-tree-copy";
import { WorkspaceThreadRow } from "./WorkspaceThreadRow";

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
    <div className="thread-list workspace-thread-previews">
      {threads.map((thread) => (
        <div className="thread-row-shell is-preview" key={thread.id}>
          <WorkspaceThreadRow thread={thread} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
