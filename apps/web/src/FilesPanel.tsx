import { ArchiveRestore, FolderArchive, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  WorkspaceTrashItem,
  WorkspaceTrashRestoreResult,
} from "@napier/contracts";

import { ArtifactActionBar } from "./ArtifactActionBar";
import { workspaceTrashActionAvailability } from "./artifact-action-model";
import { artifactActionCopy } from "./artifact-action-copy";
import {
  listWorkspaceTrash,
  restoreWorkspaceTrashItem,
} from "./workspace-file-api";
import { copy as appCopy } from "./copy";
import { workspaceFileCopy as copy } from "./workspace-file-copy";
import {
  workspaceFileRequestIsCurrent,
  workspaceTrashCardView,
} from "./workspace-file-view-model";

const trashActionAvailability = workspaceTrashActionAvailability({
  restore: true,
});

export default function FilesPanel({ threadId }: { threadId: string }) {
  const [items, setItems] = useState<WorkspaceTrashItem[]>([]);
  const [loadedThreadId, setLoadedThreadId] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [restored, setRestored] = useState<WorkspaceTrashRestoreResult>();
  const [copiedId, setCopiedId] = useState<string>();
  const [error, setError] = useState<string>();
  const activeThreadIdRef = useRef(threadId);
  const loadSequenceRef = useRef(0);
  const restoreSequenceRef = useRef(0);
  const activeControllersRef = useRef(new Set<AbortController>());
  activeThreadIdRef.current = threadId;

  const load = useCallback(async () => {
    const token = {
      threadId,
      sequence: (loadSequenceRef.current += 1),
    };
    const controller = new AbortController();
    activeControllersRef.current.add(controller);
    try {
      const list = await listWorkspaceTrash(threadId, controller.signal);
      if (
        !workspaceFileRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          loadSequenceRef.current,
        )
      ) {
        return;
      }
      setItems(list.items);
      setError(undefined);
      setLoadedThreadId(threadId);
    } catch {
      if (
        !controller.signal.aborted &&
        workspaceFileRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          loadSequenceRef.current,
        )
      ) {
        setError(copy.error);
        setLoadedThreadId(threadId);
      }
    } finally {
      activeControllersRef.current.delete(controller);
    }
  }, [threadId]);

  useEffect(() => {
    setItems([]);
    setLoadedThreadId(undefined);
    setRestored(undefined);
    setCopiedId(undefined);
    setError(undefined);
    void load();
    return () => {
      loadSequenceRef.current += 1;
      restoreSequenceRef.current += 1;
      for (const controller of activeControllersRef.current) {
        controller.abort();
      }
      activeControllersRef.current.clear();
    };
  }, [load]);

  const cards = useMemo(
    () => items.map((item) => workspaceTrashCardView(item)),
    [items],
  );
  const ready = loadedThreadId === threadId;

  const restore = async (trashId: string) => {
    const token = {
      threadId,
      sequence: (restoreSequenceRef.current += 1),
    };
    const controller = new AbortController();
    activeControllersRef.current.add(controller);
    setBusyId(trashId);
    setRestored(undefined);
    setError(undefined);
    try {
      const result = await restoreWorkspaceTrashItem(
        threadId,
        trashId,
        controller.signal,
      );
      if (
        !workspaceFileRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          restoreSequenceRef.current,
        )
      ) {
        return;
      }
      setRestored(result);
      await load();
    } catch {
      if (
        !controller.signal.aborted &&
        workspaceFileRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          restoreSequenceRef.current,
        )
      ) {
        setError(copy.conflict);
      }
    } finally {
      activeControllersRef.current.delete(controller);
      if (
        workspaceFileRequestIsCurrent(
          token,
          activeThreadIdRef.current,
          restoreSequenceRef.current,
        )
      ) {
        setBusyId(undefined);
      }
    }
  };
  const copyPath = async (trashId: string, path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedId(trashId);
      window.setTimeout(() => setCopiedId(undefined), 1600);
    } catch {
      setError(artifactActionCopy.copyFailed);
    }
  };

  if (!ready) return null;

  if (cards.length === 0 && !restored) {
    return error ? (
      <p className="inline-error task-recovery-error" role="alert">
        {error}
      </p>
    ) : null;
  }

  return (
    <details className="task-recovery-disclosure">
      <summary>
        <ArchiveRestore size={15} aria-hidden="true" />
        <span>
          <strong>{appCopy.taskView.changes.recovery}</strong>
          <small>{appCopy.taskView.changes.recoveryBody}</small>
        </span>
      </summary>
      <section
        className="panel-section files-panel"
        aria-labelledby="files-panel-title"
      >
        <div className="panel-heading">
          <div>
            <span>{copy.eyebrow}</span>
            <h3 id="files-panel-title">{copy.title}</h3>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={() => void load()}
            aria-label={copy.refresh}
            title={copy.refresh}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
        <p className="quiet-copy">{copy.description}</p>
        <p className="files-safety">{copy.safety}</p>
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {restored ? (
          <div className="files-restored" role="status">
            <ArchiveRestore size={14} aria-hidden="true" />
            <div>
              <strong>{copy.restored}</strong>
              <code>{restored.restoredPath}</code>
              <span>
                {copy.evidence} {restored.evidence.contentSha256.slice(0, 12)}
              </span>
            </div>
          </div>
        ) : null}
        {cards.length === 0 ? (
          <p className="empty-panel">{copy.noItems}</p>
        ) : (
          <div className="files-list">
            {cards.map((card) => (
              <article className="files-card" key={card.id}>
                <header>
                  <FolderArchive size={15} aria-hidden="true" />
                  <div>
                    <strong>{card.kindLabel}</strong>
                    <span>{card.id}</span>
                  </div>
                </header>
                <dl>
                  <div>
                    <dt>{copy.originalPath}</dt>
                    <dd>
                      <code>{card.originalPath}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.scope}</dt>
                    <dd>{card.scopeLabel}</dd>
                  </div>
                  <div>
                    <dt>{copy.trashedAt}</dt>
                    <dd>{formatDate(card.trashedAt)}</dd>
                  </div>
                  <div>
                    <dt>{copy.snapshot}</dt>
                    <dd>{card.snapshotHash}</dd>
                  </div>
                </dl>
                <ArtifactActionBar
                  {...(trashActionAvailability.primary
                    ? { primaryAction: trashActionAvailability.primary }
                    : {})}
                  controls={trashActionAvailability.actions.map((action) => ({
                    action,
                    busy: action === "restore" && busyId === card.id,
                    complete: action === "copy_path" && copiedId === card.id,
                    disabled:
                      Boolean(busyId) &&
                      (action !== "restore" || busyId !== card.id),
                    ...(action === "restore"
                      ? { className: "files-restore-button" }
                      : {}),
                    onAction: () => {
                      if (action === "restore") void restore(card.id);
                      else void copyPath(card.id, card.originalPath);
                    },
                  }))}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </details>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}
