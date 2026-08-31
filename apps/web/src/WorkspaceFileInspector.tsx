import {
  ArrowLeft,
  Code2,
  Download,
  Eye,
  FileCode2,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";
import { MessageMarkdown } from "./message-markdown";
import {
  previewWorkspaceFile,
  type WorkspaceFilePreview,
} from "./workspace-directory-api";
import { workspaceEvidenceCopy as workspaceCopy } from "./workspace-evidence-copy";

export interface WorkspaceFileInspectorProps {
  path: string;
  onClose(): void;
  previewFile?: typeof previewWorkspaceFile;
}

type WorkspaceFileView = "preview" | "source";

export function WorkspaceFileInspector({
  path,
  onClose,
  previewFile = previewWorkspaceFile,
}: WorkspaceFileInspectorProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<WorkspaceFilePreview>();
  const [view, setView] = useState<WorkspaceFileView>("preview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    setPreview(undefined);
    void previewFile(path, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPreview(result);
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
  }, [path, previewFile, reload]);

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
        <span title={path}>{path}</span>
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
          <WorkspaceFileContent preview={preview} view={activeView} />
        ) : null}
      </div>
    </aside>
  );
}

function WorkspaceFileContent({
  preview,
  view,
}: {
  preview: WorkspaceFilePreview;
  view: WorkspaceFileView;
}) {
  const [objectUrl, setObjectUrl] = useState<string>();
  const type = mediaType(preview.contentType);
  const extension = fileExtension(preview.path);
  useEffect(() => {
    if (preview.text !== undefined) {
      setObjectUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(preview.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  if (view === "source" && preview.text !== undefined) {
    return <SourcePreview text={preview.text} />;
  }
  if (type === "text/html") {
    return (
      <iframe
        className="artifact-inspector-frame"
        sandbox="allow-scripts"
        srcDoc={preview.text ?? ""}
        title={copy.htmlTitle}
      />
    );
  }
  if (
    preview.text !== undefined &&
    (extension === "md" || extension === "mdx" || extension === "markdown")
  ) {
    return (
      <article className="artifact-inspector-markdown">
        <MessageMarkdown text={preview.text} />
      </article>
    );
  }
  if (type.startsWith("image/") && objectUrl) {
    return (
      <div className="workspace-file-image-preview">
        <img src={objectUrl} alt={preview.filename} />
      </div>
    );
  }
  if (type === "application/pdf" && objectUrl) {
    return (
      <iframe
        className="artifact-inspector-frame"
        src={objectUrl}
        title={preview.filename}
      />
    );
  }
  if (preview.text !== undefined) {
    return <SourcePreview text={preview.text} />;
  }
  return (
    <div className="workspace-file-preview-unavailable">
      <FileCode2 size={28} aria-hidden="true" />
      <strong>{preview.filename}</strong>
      <span>{workspaceCopy.previewUnavailable}</span>
    </div>
  );
}

function SourcePreview({ text }: { text: string }) {
  return (
    <ol className="artifact-source-preview">
      {text.split("\n").map((line, index) => (
        <li key={`${String(index)}-${line.slice(0, 20)}`}>
          <code>{line || " "}</code>
        </li>
      ))}
    </ol>
  );
}

function mediaType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? contentType;
}

function fileExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}
