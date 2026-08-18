import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronUp,
  Folder,
  FolderOpen,
  Loader2,
  PenLine,
  X,
} from "lucide-react";

import { formatApiErrorMessage } from "./api-error";
import {
  listWorkspaceDirectories,
  type WorkspaceDirectoryListing,
} from "./workspace-directory-api";
import { workspaceTreeCopy as t } from "./workspace-tree-copy";

/**
 * Folder picker dialog opened from the composer's workspace chip. Browses the
 * host filesystem via GET /api/workspace/directories, lets the operator walk
 * up/into folders, and asks the application shell to atomically switch onto
 * the chosen folder. Modal mechanics mirror WorkspaceSettingsSurface
 * (Escape-to-close + focus restore + backdrop).
 */
export function WorkspaceFolderPicker({
  currentRoot,
  onClose,
  onManualEntry,
  onWorkspaceSwitch,
}: {
  currentRoot: string;
  onClose(): void;
  onManualEntry(): void;
  onWorkspaceSwitch(root: string): Promise<void>;
}) {
  const [current, setCurrent] = useState(currentRoot);
  const [listing, setListing] = useState<WorkspaceDirectoryListing | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [switching, setSwitching] = useState(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void listWorkspaceDirectories(current)
      .then((next) => {
        if (active) setListing(next);
      })
      .catch((cause) => {
        if (active) setError(formatApiErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [current]);

  const selectThisFolder = async () => {
    if (switching || current === currentRoot) return;
    setSwitching(true);
    setError(undefined);
    try {
      await onWorkspaceSwitch(current);
      onClose();
    } catch (cause) {
      setError(formatApiErrorMessage(cause));
      setSwitching(false);
    }
  };

  const parent = listing?.parent ?? null;
  const isCurrentActive = current === currentRoot;

  // Portal to <body>: the composer's backdrop-filter establishes a containing
  // block for position:fixed descendants, which would otherwise anchor this
  // dialog to the composer instead of the viewport.
  return createPortal(
    <>
      <button
        type="button"
        className="workspace-settings-backdrop"
        aria-label={t.close}
        onClick={onClose}
      />
      <aside className="folder-picker" aria-label={t.pickerTitle}>
        <header className="folder-picker-heading">
          <div>
            <span>{t.pickerEyebrow}</span>
            <h2>{t.pickerTitle}</h2>
            <p>{t.pickerBody}</p>
          </div>
          <button type="button" aria-label={t.close} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="folder-picker-path" title={current}>
          <FolderOpen size={14} aria-hidden="true" />
          <code>{current}</code>
        </div>

        <div className="folder-picker-list">
          <button
            type="button"
            className="folder-picker-up"
            disabled={parent === null || loading || switching}
            onClick={() => parent && setCurrent(parent)}
          >
            <ChevronUp size={14} aria-hidden="true" />
            <span>{parent === null ? t.atRoot : t.parentDir}</span>
          </button>
          <FolderPickerEntries
            listing={listing}
            loading={loading}
            error={error}
            disabled={switching}
            onOpen={setCurrent}
          />
        </div>

        <footer className="folder-picker-actions">
          <button
            type="button"
            className="folder-picker-manual"
            onClick={() => {
              onClose();
              onManualEntry();
            }}
          >
            <PenLine size={13} aria-hidden="true" />
            {t.manualEntry}
          </button>
          <button
            type="button"
            className="folder-picker-select"
            disabled={switching || isCurrentActive}
            title={isCurrentActive ? t.alreadyHere : current}
            onClick={() => void selectThisFolder()}
          >
            {switching ? (
              <Loader2 size={14} aria-hidden="true" className="spin" />
            ) : (
              <Folder size={14} aria-hidden="true" />
            )}
            {switching ? t.selecting : t.selectThis}
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  );
}

function FolderPickerEntries({
  listing,
  loading,
  error,
  disabled,
  onOpen,
}: {
  listing: WorkspaceDirectoryListing | undefined;
  loading: boolean;
  error: string | undefined;
  disabled: boolean;
  onOpen(path: string): void;
}) {
  if (loading) {
    return (
      <p className="folder-picker-status">
        <Loader2 size={14} aria-hidden="true" className="spin" />
      </p>
    );
  }
  if (error) {
    return (
      <p className="folder-picker-status is-error" role="alert">
        {error}
      </p>
    );
  }
  const entries = listing?.entries ?? [];
  if (entries.length === 0) {
    return <p className="folder-picker-status">{t.empty}</p>;
  }
  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.path}>
          <button
            type="button"
            disabled={disabled}
            title={entry.path}
            onClick={() => onOpen(entry.path)}
          >
            <Folder size={14} aria-hidden="true" />
            <span>{entry.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default WorkspaceFolderPicker;
