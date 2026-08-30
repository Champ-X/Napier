import {
  Code2,
  Download,
  Eye,
  FileCode2,
  GitCompare,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import {
  downloadPlanArtifactFile,
  previewPlanArtifactDiff,
  previewPlanArtifactText,
  type PlanArtifactDiffPreviewReceipt,
  type PlanArtifactTextPreview,
  type PlanArtifactTextPreviewReceipt,
} from "./artifact-file-api";
import type { ArtifactInspection } from "./artifact-inspection";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";
import { MessageMarkdown } from "./message-markdown";
import {
  type ArtifactInspectorView,
  useArtifactInspectorView,
} from "./use-artifact-inspector-view";

export interface ArtifactInspectorProps {
  inspection: ArtifactInspection;
  onClose(): void;
  onLedgerChanged?(): void | Promise<void>;
  previewArtifact?: typeof previewPlanArtifactText;
  previewDiff?: typeof previewPlanArtifactDiff;
}

export function ArtifactInspector({
  inspection,
  onClose,
  onLedgerChanged,
  previewArtifact = previewPlanArtifactText,
  previewDiff = previewPlanArtifactDiff,
}: ArtifactInspectorProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>();
  const { diff, error, load, loadingView, preview, view } =
    useArtifactInspectorView({
      inspection,
      previewArtifact,
      previewDiff,
      ...(onLedgerChanged ? { onLedgerChanged } : {}),
    });

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const result = await downloadPlanArtifactFile(
        inspection.threadId,
        inspection.planId,
        inspection.artifact.id,
      );
      downloadBlob(result.blob, result.filename);
    } catch (reason) {
      setDownloadError(formatApiErrorMessage(reason));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <aside
      className="artifact-inspector"
      aria-label={`${copy.preview}: ${inspection.artifact.path}`}
    >
      <header className="artifact-inspector-header">
        <nav className="artifact-inspector-views" aria-label={copy.viewMode}>
          <InspectorViewButton
            active={view === "preview"}
            disabled={Boolean(loadingView)}
            icon={Eye}
            label={copy.preview}
            onClick={() => void load("preview")}
          />
          <InspectorViewButton
            active={view === "source"}
            disabled={Boolean(loadingView)}
            icon={Code2}
            label={copy.source}
            onClick={() => void load("source")}
          />
          <InspectorViewButton
            active={view === "diff"}
            disabled={Boolean(loadingView)}
            icon={GitCompare}
            label={copy.diff}
            onClick={() => void load("diff")}
          />
        </nav>
        <div className="artifact-inspector-identity">
          <FileCode2 size={15} aria-hidden="true" />
          <strong>{fileName(inspection.artifact.path)}</strong>
        </div>
        <button
          type="button"
          aria-label={copy.refresh}
          title={copy.refresh}
          aria-busy={Boolean(loadingView)}
          disabled={Boolean(loadingView)}
          onClick={() => void load(view, true)}
        >
          <RotateCw
            className={loadingView ? "is-spinning" : undefined}
            size={15}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          aria-label={copy.download}
          title={copy.download}
          disabled={downloading}
          onClick={() => void download()}
        >
          <Download size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label={copy.close} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="artifact-inspector-meta">
        <span title={inspection.artifact.path}>{inspection.artifact.path}</span>
        <span>
          {loadingView
            ? copy.refreshing
            : downloading
              ? copy.downloading
              : inspectionMeta(view === "diff" ? diff : preview)}
        </span>
      </div>
      {error || downloadError ? (
        <p className="artifact-inspector-error" role="alert">
          {error ?? downloadError}
        </p>
      ) : null}
      <div className="artifact-inspector-content" key={view}>
        <ArtifactInspectionContent
          extension={fileExtension(inspection.artifact.path)}
          view={view}
          preview={preview}
          diff={diff}
        />
      </div>
    </aside>
  );
}

function ArtifactInspectionContent({
  extension,
  view,
  preview,
  diff,
}: {
  extension: string;
  view: ArtifactInspectorView;
  preview: PlanArtifactTextPreview | PlanArtifactTextPreviewReceipt | undefined;
  diff: PlanArtifactDiffPreviewReceipt | undefined;
}) {
  if (view === "diff") {
    return <SourcePreview text={diff?.text || copy.noDiff} diff />;
  }
  const text = preview?.text ?? "";
  if (view === "preview" && (extension === "html" || extension === "htm")) {
    return (
      <HtmlArtifactPreview key={preview?.textSha256 ?? "empty"} text={text} />
    );
  }
  if (
    view === "preview" &&
    (extension === "md" || extension === "mdx" || extension === "markdown")
  ) {
    return (
      <article className="artifact-inspector-markdown">
        <MessageMarkdown text={text} />
      </article>
    );
  }
  return <SourcePreview text={text} />;
}

function HtmlArtifactPreview({ text }: { text: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.srcdoc = text;
  }, [text]);

  return (
    <iframe
      className="artifact-inspector-frame"
      ref={frameRef}
      sandbox="allow-scripts"
      srcDoc={text}
      title={copy.htmlTitle}
    />
  );
}

function SourcePreview({
  text,
  diff = false,
}: {
  text: string;
  diff?: boolean;
}) {
  return (
    <ol className={`artifact-source-preview${diff ? " is-diff" : ""}`}>
      {text.split("\n").map((line, index) => (
        <li
          className={
            diff
              ? line.startsWith("+")
                ? "is-added"
                : line.startsWith("-")
                  ? "is-removed"
                  : undefined
              : undefined
          }
          key={`${String(index)}-${line.slice(0, 20)}`}
        >
          <code>{line || " "}</code>
        </li>
      ))}
    </ol>
  );
}

function fileExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function inspectionMeta(
  receipt:
    | PlanArtifactTextPreviewReceipt
    | PlanArtifactTextPreview
    | PlanArtifactDiffPreviewReceipt
    | undefined,
): string {
  if (!receipt) return "—";
  if (receipt.kind !== "napier.plan-artifact-diff-preview") {
    return `${receipt.lineCount} ${copy.lines} · ${receipt.sizeBytes} ${copy.bytes}`;
  }
  return `${receipt.hunkCount} hunks · +${receipt.addedLineCount} / −${receipt.deletedLineCount}`;
}

function InspectorViewButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: typeof Eye;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={label}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).pop() || path;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
