import type { ArtifactManifestEntry } from "@napier/contracts";
import { Download, X } from "lucide-react";
import { useState } from "react";

import { ArtifactActionBar } from "./ArtifactActionBar";
import {
  artifactUsesTextPreview,
  requestArtifactPreview,
  type ArtifactInspection,
  type ArtifactPreviewReceipt,
} from "./artifact-inspection";
import { formatApiErrorMessage } from "./api-error";
import {
  previewPlanArtifactDiff,
  previewPlanArtifactFile,
  previewPlanArtifactText,
  type PlanArtifactDiffPreviewReceipt,
} from "./artifact-file-api";
import {
  artifactActionAvailability,
  type ArtifactActionId,
} from "./artifact-action-model";
import { artifactActionCopy as copy } from "./artifact-action-copy";
import { artifactInspectorCopy } from "./artifact-inspector-copy";
import { FileSourcePreview } from "./FileSourcePreview";
import { ArtifactInspectionContent } from "./ArtifactInspectionContent";

export function ArtifactActionSurface({
  artifact,
  planId,
  threadId,
  onLedgerChanged,
  onOpen,
  onReveal,
  onRestore,
  onApply,
  onInspect,
  displayActions,
  previewArtifact = previewPlanArtifactText,
  previewArtifactFile = previewPlanArtifactFile,
  previewDiff = previewPlanArtifactDiff,
}: {
  artifact: ArtifactManifestEntry;
  planId: string;
  threadId: string;
  onLedgerChanged?(): void | Promise<void>;
  onOpen?(): void | Promise<void>;
  onReveal?(): void | Promise<void>;
  onRestore?(): void | Promise<void>;
  onApply?(): void | Promise<void>;
  onInspect?(inspection: ArtifactInspection): void;
  displayActions?: readonly ArtifactActionId[];
  previewArtifact?: typeof previewPlanArtifactText;
  previewArtifactFile?: typeof previewPlanArtifactFile;
  previewDiff?: typeof previewPlanArtifactDiff;
}) {
  const availability = artifactActionAvailability(artifact, {
    reveal: Boolean(onReveal),
    restore: Boolean(onRestore),
    apply: Boolean(onApply),
  });
  const [busy, setBusy] = useState<
    "open" | "preview" | "diff" | "reveal" | "restore" | "apply"
  >();
  const [preview, setPreview] = useState<ArtifactPreviewReceipt>();
  const [diff, setDiff] = useState<PlanArtifactDiffPreviewReceipt>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const supportsText = artifactUsesTextPreview(artifact.path);

  const inspect = async (mode: "preview" | "diff") => {
    if (busy) return;
    if (mode === "diff" && !supportsText) return;
    setBusy(mode);
    setError(undefined);
    try {
      if (mode === "preview") {
        const receipt = await requestArtifactPreview(
          { artifact, threadId, planId },
          previewArtifact,
          previewArtifactFile,
        );
        if (onInspect) {
          onInspect({ artifact, mode, planId, threadId, receipt });
          setPreview(undefined);
        } else {
          setPreview(receipt);
        }
        setDiff(undefined);
      } else {
        const receipt = await previewDiff(threadId, planId, artifact.id);
        if (onInspect) {
          onInspect({ artifact, mode, planId, threadId, receipt });
          setDiff(undefined);
        } else {
          setDiff(receipt);
        }
        setPreview(undefined);
      }
      await onLedgerChanged?.();
    } catch (reason) {
      setError(formatApiErrorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };
  const open = () => {
    if (onOpen) {
      void perform("open", onOpen);
      return;
    }
    if (artifact.kind === "url") {
      window.open(artifact.path, "_blank", "noopener,noreferrer");
      return;
    }
    void inspect("preview");
  };
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(artifact.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(copy.copyFailed);
    }
  };
  const perform = async (
    action: "open" | "reveal" | "restore" | "apply",
    operation: (() => void | Promise<void>) | undefined,
  ) => {
    if (!operation || busy) return;
    setBusy(action);
    setError(undefined);
    try {
      await operation();
      if (action === "restore" || action === "apply") {
        await onLedgerChanged?.();
      }
    } catch (reason) {
      setError(formatApiErrorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };
  const actions = availability.actions.filter(
    (action) =>
      (action !== "diff" || supportsText) &&
      (!displayActions || displayActions.includes(action)),
  );
  const controls = actions.map((action) => ({
    action,
    busy: busy === action,
    complete: action === "copy_path" && copied,
    disabled: Boolean(busy) && busy !== action,
    onAction: () => {
      if (action === "open") open();
      else if (action === "preview") void inspect("preview");
      else if (action === "diff") void inspect("diff");
      else if (action === "copy_path") void copyPath();
      else if (action === "reveal") void perform(action, onReveal);
      else if (action === "restore") void perform(action, onRestore);
      else void perform(action, onApply);
    },
  }));

  return (
    <div className="artifact-action-surface">
      <ArtifactActionBar
        controls={controls}
        {...(availability.primary
          ? { primaryAction: availability.primary }
          : {})}
      />
      {error ? (
        <p className="artifact-action-error" role="alert">
          {error}
        </p>
      ) : null}
      {preview ? (
        <ArtifactInspection
          title={copy.previewTitle}
          path={artifact.path}
          meta={
            preview.kind === "napier.plan-artifact-file-preview"
              ? `${preview.sizeBytes} ${copy.bytes}`
              : `${preview.lineCount} ${copy.lines} · ${preview.sizeBytes} ${copy.bytes}`
          }
          onClose={() => setPreview(undefined)}
          {...(preview.kind === "napier.plan-artifact-file-preview"
            ? {
                onDownload: () => downloadBlob(preview.blob, preview.filename),
              }
            : {})}
        >
          <ArtifactInspectionContent
            path={artifact.path}
            threadId={threadId}
            preview={preview}
            view="preview"
            diff={undefined}
          />
        </ArtifactInspection>
      ) : null}
      {diff ? (
        <ArtifactInspection
          title={copy.diffTitle}
          path={artifact.path}
          meta={`${diff.hunkCount} ${copy.hunks} · +${diff.addedLineCount} / −${diff.deletedLineCount}`}
          onClose={() => setDiff(undefined)}
        >
          <FileSourcePreview text={diff.text || copy.noDiff} diff />
        </ArtifactInspection>
      ) : null}
    </div>
  );
}

function ArtifactInspection({
  title,
  path,
  meta,
  onClose,
  onDownload,
  children,
}: {
  title: string;
  path: string;
  meta: string;
  onClose(): void;
  onDownload?(): void;
  children: React.ReactNode;
}) {
  return (
    <section className="artifact-action-inspection" aria-label={title}>
      <header>
        <div>
          <strong>{title}</strong>
          <span>{meta}</span>
        </div>
        {onDownload ? (
          <button
            type="button"
            aria-label={artifactInspectorCopy.download}
            onClick={onDownload}
          >
            <Download size={12} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`${copy.close} ${path}`}
          onClick={onClose}
        >
          <X size={12} aria-hidden="true" />
        </button>
      </header>
      {children}
    </section>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
