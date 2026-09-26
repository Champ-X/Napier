import {
  ArrowLeft,
  Code2,
  Download,
  Eye,
  ExternalLink,
  FileCode2,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";
import { FilePreviewContent } from "./FilePreviewContent";
import {
  previewWorkspaceFile,
  type WorkspaceFilePreview,
} from "./workspace-directory-api";
import { workspaceEvidenceCopy as workspaceCopy } from "./workspace-evidence-copy";

export interface WorkspaceFileInspectorProps {
  path: string;
  threadId?: string;
  onClose(): void;
  previewFile?: typeof previewWorkspaceFile;
}

type WorkspaceFileView = "preview" | "source";

export function WorkspaceFileInspector({
  path,
  threadId,
  onClose,
  previewFile = previewWorkspaceFile,
}: WorkspaceFileInspectorProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [loadedPreview, setLoadedPreview] = useState<{
    requestedPath: string;
    threadId: string | undefined;
    file: WorkspaceFilePreview;
  }>();
  const preview =
    loadedPreview?.requestedPath === path && loadedPreview.threadId === threadId
      ? loadedPreview.file
      : undefined;
  const [view, setView] = useState<WorkspaceFileView>("preview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setLoadedPreview(undefined);
    const request = threadId
      ? previewFile(path, controller.signal, threadId)
      : previewFile(path, controller.signal);
    void request
      .then((result) => {
        if (!controller.signal.aborted) {
          setLoadedPreview({ requestedPath: path, threadId, file: result });
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(formatApiErrorMessage(reason));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, threadId, previewFile, reload]);

  useEffect(() => {
    const restoreFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      const restorePreviousFocus = () => {
        if (restoreFocus?.isConnected && restoreFocus.getClientRects().length) {
          restoreFocus.focus();
          return;
        }
        document.getElementById("workspace-rail-toggle")?.focus();
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(restorePreviousFocus);
      } else {
        restorePreviousFocus();
      }
    };
  }, [onClose]);

  const download = useCallback(() => {
    if (!preview) return;
    const url = URL.createObjectURL(preview.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = preview.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [preview]);

  const sourceAvailable = preview?.text !== undefined;
  const activeView = sourceAvailable ? view : "preview";

  return (
    <aside
      className="artifact-inspector workspace-file-inspector"
      aria-label={`${workspaceCopy.previewFile}: ${path}`}
    >
      <header className="artifact-inspector-header">
        <nav className="artifact-inspector-views" aria-label={copy.viewMode}>
          <button
            type="button"
            aria-pressed={activeView === "preview"}
            disabled={loading}
            title={copy.preview}
            onClick={() => setView("preview")}
          >
            <Eye size={15} aria-hidden="true" />
            <span>{copy.preview}</span>
          </button>
          {sourceAvailable ? (
            <button
              type="button"
              aria-pressed={activeView === "source"}
              disabled={loading}
              title={copy.source}
              onClick={() => setView("source")}
            >
              <Code2 size={15} aria-hidden="true" />
              <span>{copy.source}</span>
            </button>
          ) : null}
        </nav>
        <div className="artifact-inspector-identity">
          <FileCode2 size={15} aria-hidden="true" />
          <strong>{preview?.filename ?? fileName(path)}</strong>
        </div>
        <button
          type="button"
          aria-label={copy.refresh}
          title={copy.refresh}
          aria-busy={loading}
          disabled={loading}
          onClick={() => setReload((current) => current + 1)}
        >
          <RotateCw
            className={loading ? "is-spinning" : undefined}
            size={15}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          aria-label={copy.download}
          title={copy.download}
          disabled={!preview}
          onClick={download}
        >
          <Download size={15} aria-hidden="true" />
        </button>
        {preview?.previewUrl ? (
          <a
            href={preview.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={copy.openInTab}
            title={copy.openInTab}
          >
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        ) : null}
        <button
          ref={closeRef}
          type="button"
          className="artifact-inspector-back"
          aria-label={workspaceCopy.backToFiles}
          title={workspaceCopy.backToFiles}
          onClick={onClose}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span>{workspaceCopy.backToFiles}</span>
        </button>
      </header>
      <div className="artifact-inspector-meta">
        <span title={preview?.path ?? path}>{preview?.path ?? path}</span>
        <span>
          {loading
            ? copy.refreshing
            : preview
              ? `${preview.sizeBytes} ${copy.bytes} · ${mediaType(preview.contentType)}`
              : "—"}
        </span>
      </div>
      {error ? (
        <p className="artifact-inspector-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="artifact-inspector-content" key={activeView}>
        {preview ? (
          <FilePreviewContent
            preview={preview}
            view={activeView}
            {...(threadId ? { threadId } : {})}
          />
        ) : null}
      </div>
    </aside>
  );
}

function mediaType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? contentType;
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
