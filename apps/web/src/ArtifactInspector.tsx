import "./artifact-consumer-responsive.css";
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

import {
  artifactVersionKey,
  assertArtifactReceiptVersion,
} from "./artifact-version-binding";

import { ArtifactReviewActions } from "./ArtifactReviewActions";
import { formatApiErrorMessage } from "./api-error";
import {
  downloadPlanArtifactFile,
  previewPlanArtifactDiff,
  previewPlanArtifactFile,
  previewPlanArtifactText,
  type PlanArtifactDiffPreviewReceipt,
} from "./artifact-file-api";
import type {
  ArtifactInspection,
  ArtifactPreviewReceipt,
} from "./artifact-inspection";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";
import { ArtifactInspectionContent } from "./ArtifactInspectionContent";
import { previewWorkspaceFile } from "./workspace-directory-api";
import { useArtifactInspectorView } from "./use-artifact-inspector-view";
import {
  inactiveWorkbenchSurface,
  restoreWorkbenchOverlayFocus,
} from "./workbench-overlay-focus";

export interface ArtifactInspectorProps {
  inspection: ArtifactInspection;
  suspended?: boolean;
  onClose(): void;
  onContinueEditing?(path: string): void;
  onLedgerChanged?(): void | Promise<void>;
  previewArtifact?: typeof previewPlanArtifactText;
  previewArtifactFile?: typeof previewPlanArtifactFile;
  previewDiff?: typeof previewPlanArtifactDiff;
  previewFile?: typeof previewWorkspaceFile;
}

export function ArtifactInspector({
  inspection,
  suspended = false,
  onClose,
  onContinueEditing,
  onLedgerChanged,
  previewArtifact = previewPlanArtifactText,
  previewArtifactFile = previewPlanArtifactFile,
  previewDiff = previewPlanArtifactDiff,
  previewFile = previewWorkspaceFile,
}: ArtifactInspectorProps) {
  const inspectorRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const versionKey = artifactVersionKey(inspection);
  const currentKey = useRef(versionKey);
  currentKey.current = versionKey;
  useEffect(() => {
    currentKey.current = versionKey;
    return () => {
      currentKey.current = "";
    };
  }, [versionKey]);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string>();
  useEffect(() => {
    setDownloading(false);
    setDownloadError(undefined);
  }, [versionKey]);
  const { diff, error, load, loadingView, preview, supportsText, view } =
    useArtifactInspectorView({
      inspection,
      previewArtifact,
      previewArtifactFile,
      previewDiff,
      ...(onLedgerChanged ? { onLedgerChanged } : {}),
    });

  useEffect(() => {
    if (suspended) return;
    const restoreFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!inactiveWorkbenchSurface(closeRef.current)) closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        inactiveWorkbenchSurface(closeRef.current)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (suspendedRef.current) return;
      const restorePreviousFocus = () => {
        restoreWorkbenchOverlayFocus(restoreFocus);
      };
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(restorePreviousFocus);
      } else {
        restorePreviousFocus();
      }
    };
  }, [onClose, suspended]);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(undefined);
    try {
      const result =
        preview?.kind === "napier.plan-artifact-file-preview"
          ? preview
          : await downloadPlanArtifactFile(
              inspection.threadId,
              inspection.planId,
              inspection.artifact.id,
            );
      assertArtifactReceiptVersion(inspection, result, "content");
      if (currentKey.current !== versionKey) return;
      downloadBlob(result.blob, result.filename);
    } catch (reason) {
      if (currentKey.current === versionKey)
        setDownloadError(formatApiErrorMessage(reason));
    } finally {
      if (currentKey.current === versionKey) setDownloading(false);
    }
  };

  return (
    <aside
      ref={inspectorRef}
      hidden={suspended}
      inert={suspended}
      style={suspended ? { display: "none" } : undefined}
      className={`artifact-inspector${onContinueEditing ? " has-review-actions" : ""}`}
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
            disabled={Boolean(loadingView) || !supportsText}
            icon={Code2}
            label={copy.source}
            onClick={() => void load("source")}
          />
          <InspectorViewButton
            active={view === "diff"}
            disabled={Boolean(loadingView) || !supportsText}
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
        <button
          ref={closeRef}
          type="button"
          aria-label={copy.close}
          onClick={onClose}
        >
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
        {onContinueEditing ? (
          <ArtifactReviewActions
            integrityRecorded={inspection.artifact.status === "verified"}
            onContinueEditing={() =>
              onContinueEditing(inspection.artifact.path)
            }
          />
        ) : null}
      </div>
      {error || downloadError ? (
        <p className="artifact-inspector-error" role="alert">
          {error ?? downloadError}
        </p>
      ) : null}
      <div className="artifact-inspector-content" key={view}>
        <ArtifactInspectionContent
          path={inspection.artifact.path}
          threadId={inspection.threadId}
          previewFile={previewFile}
          view={view}
          preview={preview}
          diff={diff}
        />
      </div>
    </aside>
  );
}

function inspectionMeta(
  receipt: ArtifactPreviewReceipt | PlanArtifactDiffPreviewReceipt | undefined,
): string {
  if (!receipt) return "—";
  if (receipt.kind === "napier.plan-artifact-file-preview") {
    return `${receipt.sizeBytes} ${copy.bytes}`;
  }
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
