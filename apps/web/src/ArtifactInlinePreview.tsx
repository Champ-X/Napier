import { FileCode2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  artifactNeedsFilePreview,
  artifactTextPreviewNeedsFileFallback,
  type ArtifactInspection,
} from "./artifact-inspection";
import { formatApiErrorMessage } from "./api-error";
import {
  peekPlanArtifactText,
  peekPlanArtifactFile,
  type PlanArtifactFilePreview,
  type PlanArtifactTextPeek,
} from "./artifact-file-api";
import type { ConversationArtifact } from "./conversation-artifact-view-model";
import { conversationDetailCopy } from "./conversation-detail-copy";
import { HtmlArtifactPreview } from "./HtmlArtifactPreview";
import { previewWorkspaceFile } from "./workspace-directory-api";

export function ArtifactInlinePreview({
  item,
  onInspect,
  peekArtifact = peekPlanArtifactText,
  peekArtifactFile = peekPlanArtifactFile,
  previewFile = previewWorkspaceFile,
}: {
  item: ConversationArtifact;
  onInspect?(inspection: ArtifactInspection): void;
  peekArtifact?: typeof peekPlanArtifactText;
  peekArtifactFile?: typeof peekPlanArtifactFile;
  previewFile?: typeof previewWorkspaceFile;
}) {
  const [preview, setPreview] = useState<
    PlanArtifactTextPeek | PlanArtifactFilePreview
  >();
  const [error, setError] = useState<string>();
  const isHtml = /\.html?$/iu.test(item.artifact.path);

  useEffect(() => {
    if (!isHtml || !isAvailable(item)) return;
    let active = true;
    setPreview(undefined);
    setError(undefined);
    const peek = async () => {
      if (artifactNeedsFilePreview(item.artifact)) {
        return peekArtifactFile(item.threadId, item.planId, item.artifact.id);
      }
      try {
        return await peekArtifact(item.threadId, item.planId, item.artifact.id);
      } catch (reason) {
        if (!artifactTextPreviewNeedsFileFallback(reason)) throw reason;
        return peekArtifactFile(item.threadId, item.planId, item.artifact.id);
      }
    };
    void peek()
      .then((receipt) => {
        if (active) setPreview(receipt);
      })
      .catch((reason: unknown) => {
        if (active) setError(formatApiErrorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [
    isHtml,
    item.artifact.id,
    item.artifact.path,
    item.artifact.sizeBytes,
    item.artifact.status,
    item.artifact.updatedAt,
    item.planId,
    item.threadId,
    peekArtifact,
    peekArtifactFile,
  ]);

  if (!isHtml || !isAvailable(item)) return null;
  const copy = conversationDetailCopy.artifact;
  const inspect = () =>
    onInspect?.({
      artifact: item.artifact,
      mode: "preview",
      planId: item.planId,
      threadId: item.threadId,
    });

  return (
    <section
      className={`artifact-inline-preview${preview ? " is-ready" : " is-loading"}`}
      aria-label={`${copy.previewLabel}: ${item.artifact.path}`}
    >
      <header>
        <span>
          <FileCode2 size={13} aria-hidden="true" />
          {fileName(item.artifact.path)}
        </span>
        <small>
          {preview
            ? copy.livePreview
            : error
              ? copy.previewUnavailable
              : copy.loadingPreview}
        </small>
      </header>
      {preview ? (
        <HtmlArtifactPreview
          path={item.artifact.path}
          refreshKey={preview}
          sha256={preview.sha256}
          previewFile={previewFile}
        />
      ) : (
        <div className="artifact-inline-preview-placeholder" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
      {onInspect ? (
        <button type="button" onClick={inspect}>
          <span>{copy.openPreview}</span>
        </button>
      ) : null}
    </section>
  );
}

function isAvailable(item: ConversationArtifact): boolean {
  return (
    item.artifact.kind === "file" &&
    (item.artifact.status === "produced" || item.artifact.status === "verified")
  );
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}
