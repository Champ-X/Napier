import { useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";

import type { ThreadSummary } from "@napier/contracts";
import { copy } from "./copy";
import type { TrashedThreadReceipt } from "./use-thread-trash";

const trashCopy = {
  action: "Move ledger to trash",
  activeRun: "Stop the active run before deleting this ledger",
  confirm: "Move this ledger to trash?",
  confirmAction: "Trash",
  cancel: "Cancel deletion",
  trashing: "Trashing...",
  trashed: "Moved to trash",
  undo: "Undo",
  restoring: "Restoring...",
} as const;

export function ThreadList({
  threads,
  selectedThreadId,
  busyThreadId,
  trashedThread,
  onSelect,
  onTrash,
  onRestore,
}: {
  threads: ThreadSummary[];
  selectedThreadId: string | undefined;
  busyThreadId: string | undefined;
  trashedThread: TrashedThreadReceipt | undefined;
  onSelect(threadId: string): void;
  onTrash(threadId: string): void;
  onRestore(): void;
}) {
  const [confirmingThreadId, setConfirmingThreadId] = useState<string>();

  return (
    <>
      <div className="thread-list">
        {threads.length === 0 ? (
          <p className="quiet-copy">{copy.noThreads}</p>
        ) : null}
        {threads.map((thread, index) => {
          const active = thread.id === selectedThreadId;
          const busy = thread.id === busyThreadId;
          const confirming = thread.id === confirmingThreadId;
          const running = thread.status === "running";
          return (
            <div
              className={`thread-row-shell ${active ? "is-active" : ""} ${
                confirming ? "is-confirming" : ""
              }`}
              key={thread.id}
            >
              <button
                className="thread-row"
                type="button"
                onClick={() => onSelect(thread.id)}
                aria-current={active ? "page" : undefined}
              >
                <span className="thread-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="thread-copy">
                  <strong>{thread.title}</strong>
                  <small>
                    {thread.lastMessage || formatThreadDate(thread.updatedAt)}
                  </small>
                </span>
                <StatusDot status={thread.status} />
              </button>
              <button
                className="thread-trash-button"
                type="button"
                disabled={running || busy}
                title={running ? trashCopy.activeRun : trashCopy.action}
                aria-label={`${trashCopy.action}: ${thread.title}`}
                onClick={() =>
                  setConfirmingThreadId((current) =>
                    current === thread.id ? undefined : thread.id,
                  )
                }
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
              {confirming ? (
                <div className="thread-trash-confirm" role="alert">
                  <span>{trashCopy.confirm}</span>
                  <button
                    type="button"
                    onClick={() => setConfirmingThreadId(undefined)}
                    aria-label={trashCopy.cancel}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                  <button
                    className="confirm-trash"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirmingThreadId(undefined);
                      onTrash(thread.id);
                    }}
                  >
                    {busy ? trashCopy.trashing : trashCopy.confirmAction}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {trashedThread ? (
        <div className="thread-undo" role="status" aria-live="polite">
          <div>
            <span>{trashCopy.trashed}</span>
            <strong>{trashedThread.title}</strong>
          </div>
          <button
            type="button"
            disabled={busyThreadId === trashedThread.threadId}
            onClick={onRestore}
          >
            <RotateCcw size={12} aria-hidden="true" />
            {busyThreadId === trashedThread.threadId
              ? trashCopy.restoring
              : trashCopy.undo}
          </button>
        </div>
      ) : null}
    </>
  );
}

export default ThreadList;

function StatusDot({ status }: { status: ThreadSummary["status"] }) {
  return (
    <span
      className={`status-dot status-${status}`}
      title={status}
      aria-label={status}
    />
  );
}

function formatThreadDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
