import { Download, FileCheck2, FileWarning } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ThreadDetail } from "@napier/contracts";
import {
  artifactSelectionCurrentFact,
  artifactVersionKey,
  assertArtifactReceiptVersion,
} from "./artifact-version-binding";

import "./conversation-artifact-card.css";
import { ArtifactActionSurface } from "./ArtifactActionSurface";
import { ArtifactInlinePreview } from "./ArtifactInlinePreview";
import type { ArtifactInspection } from "./artifact-inspection";
import { formatApiErrorMessage } from "./api-error";
import {
  downloadPlanArtifactFile,
  previewPlanArtifactDiff,
  previewPlanArtifactText,
} from "./artifact-file-api";
import { formatArtifactSizeBytes } from "./artifact-manifest-view-model";
import {
  conversationArtifactTargetId,
  type ConversationArtifact,
} from "./conversation-artifact-view-model";
import { conversationDetailCopy } from "./conversation-detail-copy";
import { getLocale } from "./locale";

export interface ConversationArtifactCardProps {
  item: ConversationArtifact;
  threadId: string;
  onLedgerChanged: () => Promise<void>;
  previewArtifact?: typeof previewPlanArtifactText;
  previewDiff?: typeof previewPlanArtifactDiff;
  downloadArtifact?: typeof downloadPlanArtifactFile;
  onInspect?(inspection: ArtifactInspection): void;
  deliverables?: NonNullable<ThreadDetail["taskNarrative"]>["deliverables"];
}
export function ConversationArtifactCard({
  item,
  threadId,
  onLedgerChanged,
  previewArtifact = previewPlanArtifactText,
  previewDiff = previewPlanArtifactDiff,
  downloadArtifact = downloadPlanArtifactFile,
  onInspect,
  deliverables,
}: ConversationArtifactCardProps) {
  const copy = conversationDetailCopy.artifact;
  const [busy, setBusy] = useState<"download">();
  const [error, setError] = useState<string>();
  const available =
    item.artifact.kind === "file" &&
    (item.artifact.status === "produced" ||
      item.artifact.status === "verified");
  const currentFact = artifactSelectionCurrentFact(item, deliverables);
  const Icon = currentFact === "integrity_observed" ? FileCheck2 : FileWarning;
  const versionKey = artifactVersionKey(item);
  const currentKey = useRef(versionKey);
  currentKey.current = versionKey;
  useEffect(() => {
    currentKey.current = versionKey;
    return () => {
      currentKey.current = "";
    };
  }, [versionKey]);
  useEffect(() => {
    setBusy(undefined);
    setError(undefined);
  }, [versionKey]);
  const statusLabel =
    currentFact === "unchecked"
      ? copy.statuses[item.artifact.status]
      : copy.currentFacts[currentFact];

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
      assertArtifactReceiptVersion(item, result);
      if (currentKey.current !== versionKey) return;
      downloadBlob(result.blob, result.filename);
      await onLedgerChanged();
    } catch (reason) {
      if (currentKey.current === versionKey)
        setError(formatApiErrorMessage(reason));
    } finally {
      if (currentKey.current === versionKey) setBusy(undefined);
    }
  };

  return (
    <article
      id={conversationArtifactTargetId(item)}
      className={`conversation-artifact status-${item.artifact.status}`}
      data-artifact-path={item.artifact.path}
      data-artifact-current-fact={currentFact}
      tabIndex={-1}
    >
      <header>
        <Icon size={16} aria-hidden="true" />
        <div>
          <span>
            {item.attemptScope === "current" ? copy.current : copy.previous}{" "}
            {copy.label} · {statusLabel}
          </span>
          <strong>{item.artifact.path}</strong>
        </div>
        <time dateTime={item.createdAt}>{formatTime(item.createdAt)}</time>
      </header>
      <p>{item.artifact.description}</p>
      <dl>
        <div>
          <dt>{copy.type}</dt>
          <dd>{copy.kinds[item.artifact.kind]}</dd>
        </div>
        {item.artifact.sizeBytes !== undefined ? (
          <div>
            <dt>{copy.size}</dt>
            <dd>{formatArtifactSizeBytes(item.artifact.sizeBytes)}</dd>
          </div>
        ) : null}
        {item.artifact.sha256 ? (
          <div>
            <dt>{copy.digest}</dt>
            <dd title={item.artifact.sha256}>
              {item.artifact.sha256.slice(0, 12)}
            </dd>
          </div>
        ) : null}
      </dl>
      <ArtifactInlinePreview
        item={item}
        {...(onInspect ? { onInspect } : {})}
      />
      <ArtifactActionSurface
        artifact={item.artifact}
        planId={item.planId}
        planRevision={item.planRevision}
        threadId={threadId}
        onLedgerChanged={onLedgerChanged}
        previewArtifact={previewArtifact}
        previewDiff={previewDiff}
        {...(onInspect ? { onInspect } : {})}
      />
      {available ? (
        <div className="conversation-artifact-actions is-export-only">
          <button type="button" disabled={Boolean(busy)} onClick={download}>
            <Download size={12} aria-hidden="true" />
            {busy === "download" ? copy.downloading : copy.download}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="conversation-artifact-error" role="alert">
          {error}
        </p>
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
  return new Intl.DateTimeFormat(getLocale() === "zh" ? "zh-CN" : "en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
