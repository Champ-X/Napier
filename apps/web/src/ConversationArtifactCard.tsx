import { Download, FileCheck2, FileWarning, X } from "lucide-react";
import { useState } from "react";

import "./conversation-artifact-card.css";
import { formatApiErrorMessage } from "./api-error";
import {
  downloadPlanArtifactFile,
  previewPlanArtifactText,
  type PlanArtifactTextPreviewReceipt,
} from "./artifact-file-api";
import { formatArtifactSizeBytes } from "./artifact-manifest-view-model";
import {
  conversationArtifactTargetId,
  type ConversationArtifact,
} from "./conversation-artifact-view-model";

export function ConversationArtifactCard({
  item,
  threadId,
  onLedgerChanged,
  previewArtifact = previewPlanArtifactText,
  downloadArtifact = downloadPlanArtifactFile,
}: {
  item: ConversationArtifact;
  threadId: string;
  onLedgerChanged: () => Promise<void>;
  previewArtifact?: typeof previewPlanArtifactText;
  downloadArtifact?: typeof downloadPlanArtifactFile;
}) {
  const [busy, setBusy] = useState<"preview" | "download">();
  const [preview, setPreview] = useState<PlanArtifactTextPreviewReceipt>();
  const [error, setError] = useState<string>();
  const available =
    item.artifact.kind === "file" &&
    (item.artifact.status === "produced" ||
      item.artifact.status === "verified");
  const Icon = item.artifact.status === "verified" ? FileCheck2 : FileWarning;

  const openPreview = async () => {
    if (!available || busy) return;
    setBusy("preview");
    setError(undefined);
    try {
      setPreview(
        await previewArtifact(threadId, item.planId, item.artifact.id),
      );
      await onLedgerChanged();
    } catch (reason) {
      setError(formatApiErrorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const download = async () => {
    if (!available || busy) return;
    setBusy("download");
    setError(undefined);
    try {
      const result = await downloadArtifact(
        threadId,
        item.planId,
        item.artifact.id,
      );
      downloadBlob(result.blob, result.filename);
      await onLedgerChanged();
    } catch (reason) {
      setError(formatApiErrorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <article
      id={conversationArtifactTargetId(item)}
      className={`conversation-artifact status-${item.artifact.status}`}
      data-artifact-path={item.artifact.path}
      tabIndex={-1}
    >
      <header>
        <Icon size={16} aria-hidden="true" />
        <div>
          <span>Artifact · {item.artifact.status}</span>
          <strong>{item.artifact.path}</strong>
        </div>
        <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
      </header>
      <p>{item.artifact.description}</p>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{item.artifact.kind}</dd>
        </div>
        {item.artifact.sizeBytes !== undefined ? (
          <div>
            <dt>Size</dt>
            <dd>{formatArtifactSizeBytes(item.artifact.sizeBytes)}</dd>
          </div>
        ) : null}
        {item.artifact.sha256 ? (
          <div>
            <dt>Digest</dt>
            <dd title={item.artifact.sha256}>
              {item.artifact.sha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
      </dl>
      {available ? (
        <div className="conversation-artifact-actions">
          <button type="button" disabled={Boolean(busy)} onClick={openPreview}>
            {busy === "preview" ? "Opening…" : "Preview"}
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={download}>
            <Download size={12} aria-hidden="true" />
            {busy === "download" ? "Downloading…" : "Download"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="conversation-artifact-error" role="alert">
          {error}
        </p>
      ) : null}
      {preview ? (
        <section
          className="conversation-artifact-preview"
          aria-label={`Preview ${item.artifact.path}`}
        >
          <header>
            <span>
              {preview.lineCount} lines ·{" "}
              {formatArtifactSizeBytes(preview.sizeBytes)}
            </span>
            <button
              type="button"
              aria-label={`Close preview ${item.artifact.path}`}
              onClick={() => setPreview(undefined)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </header>
          <pre>{preview.text}</pre>
        </section>
      ) : null}
    </article>
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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
