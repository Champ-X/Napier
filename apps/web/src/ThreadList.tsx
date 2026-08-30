import { useState } from "react";
import { Archive, Ellipsis } from "lucide-react";

import type { ThreadSummary } from "@napier/contracts";
import { copy } from "./copy";
import { WorkspaceThreadRow } from "./WorkspaceThreadRow";

const trashCopy = copy.trash;
const menuLabel = copy.recentThreads;

export function ThreadList({
  threads,
  selectedThreadId,
  busyThreadId,
  onSelect,
  onTrash,
}: {
  threads: ThreadSummary[];
  selectedThreadId: string | undefined;
  busyThreadId: string | undefined;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
}) {
  const [menuThreadId, setMenuThreadId] = useState<string>();

  return (
    <div className="thread-list">
      {threads.length === 0 ? (
        <p className="quiet-copy">{copy.noThreads}</p>
      ) : null}
      {threads.map((thread) => {
        const active = thread.id === selectedThreadId;
        const busy = thread.id === busyThreadId;
        const menuOpen = thread.id === menuThreadId;
        const running = thread.status === "running";
        return (
          <div
            className={`thread-row-shell ${active ? "is-active" : ""} ${
              menuOpen ? "has-open-menu" : ""
            }`}
            key={thread.id}
          >
            <WorkspaceThreadRow
              thread={thread}
              active={active}
              onSelect={onSelect}
            />
            <div
              className="thread-actions"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setMenuThreadId(undefined);
                }
              }}
            >
              <button
                className="thread-menu-trigger"
                type="button"
                aria-label={`${menuLabel}: ${thread.title}`}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                onClick={() =>
                  setMenuThreadId((current) =>
                    current === thread.id ? undefined : thread.id,
                  )
                }
              >
                <Ellipsis size={16} aria-hidden="true" />
              </button>
              {menuOpen ? (
                <div className="thread-action-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={running || busy}
                    title={running ? trashCopy.activeRun : trashCopy.action}
                    onClick={() => {
                      setMenuThreadId(undefined);
                      onTrash(thread.id);
                    }}
                  >
                    <Archive size={16} aria-hidden="true" />
                    {busy ? trashCopy.trashing : trashCopy.confirmAction}
                  </button>
                  {running ? <small>{trashCopy.activeRun}</small> : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
