import type { ArtifactManifestEntry } from "@napier/contracts";
import { Clipboard, ExternalLink, FileDiff, FileSearch, X } from "lucide-react";
import { useState } from "react";

import "./artifact-action-surface.css";
import { formatApiErrorMessage } from "./api-error";
import {
  previewPlanArtifactDiff,
  previewPlanArtifactText,
  type PlanArtifactDiffPreviewReceipt,
  type PlanArtifactTextPreviewReceipt,
} from "./artifact-file-api";
import { artifactActionAvailability } from "./artifact-action-model";
import { artifactActionCopy as copy } from "./artifact-action-copy";

export function ArtifactActionSurface({
  artifact,
  planId,
  threadId,
  onLedgerChanged,
  previewArtifact = previewPlanArtifactText,
  previewDiff = previewPlanArtifactDiff,
}: {
  artifact: ArtifactManifestEntry;
  planId: string;
  threadId: string;
  onLedgerChanged?(): void | Promise<void>;
  previewArtifact?: typeof previewPlanArtifactText;
  previewDiff?: typeof previewPlanArtifactDiff;
}) {
  const availability = artifactActionAvailability(artifact);
  const [busy, setBusy] = useState<"preview" | "diff">();
  const [preview, setPreview] = useState<PlanArtifactTextPreviewReceipt>();
  const [diff, setDiff] = useState<PlanArtifactDiffPreviewReceipt>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const inspect = async (mode: "preview" | "diff") => {
    if (busy) return;
    setBusy(mode);
    setError(undefined);
    try {
      if (mode === "preview") {
        setPreview(await previewArtifact(threadId, planId, artifact.id));
        setDiff(undefined);
      } else {
        setDiff(await previewDiff(threadId, planId, artifact.id));
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

  return (
    <div className="artifact-action-surface">
      <div className="artifact-action-bar" aria-label={copy.actions}>
        {availability.actions.includes("open") ? (
          <button type="button" data-artifact-action="open" disabled={Boolean(busy)} onClick={open}>
            <ExternalLink size={12} aria-hidden="true" />
            {busy === "preview" ? copy.opening : copy.open}
          </button>
        ) : null}
        {availability.actions.includes("preview") ? (
          <button type="button" data-artifact-action="preview" disabled={Boolean(busy)} onClick={() => void inspect("preview")}>
            <FileSearch size={12} aria-hidden="true" />
            {copy.preview}
          </button>
        ) : null}
        {availability.actions.includes("diff") ? (
          <button type="button" data-artifact-action="diff" disabled={Boolean(busy)} onClick={() => void inspect("diff")}>
            <FileDiff size={12} aria-hidden="true" />
            {busy === "diff" ? copy.diffing : copy.diff}
          </button>
        ) : null}
        <button type="button" data-artifact-action="copy_path" onClick={() => void copyPath()}>
          <Clipboard size={12} aria-hidden="true" />
          {copied ? copy.copied : copy.copyPath}
        </button>
      </div>
      {error ? <p className="artifact-action-error" role="alert">{error}</p> : null}
      {preview ? (
        <ArtifactInspection title={copy.previewTitle} path={artifact.path} meta={`${preview.lineCount} ${copy.lines} · ${preview.sizeBytes} ${copy.bytes}`} onClose={() => setPreview(undefined)}>
          <pre>{preview.text}</pre>
        </ArtifactInspection>
      ) : null}
      {diff ? (
        <ArtifactInspection title={copy.diffTitle} path={artifact.path} meta={`${diff.hunkCount} ${copy.hunks} · +${diff.addedLineCount} / −${diff.deletedLineCount}`} onClose={() => setDiff(undefined)}>
          <pre>{diff.text || copy.noDiff}</pre>
        </ArtifactInspection>
      ) : null}
    </div>
  );
}

function ArtifactInspection({ title, path, meta, onClose, children }: { title: string; path: string; meta: string; onClose(): void; children: React.ReactNode }) {
  return (
    <section className="artifact-action-inspection" aria-label={title}>
      <header><div><strong>{title}</strong><span>{meta}</span></div><button type="button" aria-label={`${copy.close} ${path}`} onClick={onClose}><X size={12} aria-hidden="true" /></button></header>
      {children}
    </section>
  );
}
