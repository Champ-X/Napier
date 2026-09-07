import { FileCode2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { ArtifactInspection } from "./artifact-inspection";
import { formatApiErrorMessage } from "./api-error";
import {
  peekPlanArtifactText,
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
  previewFile = previewWorkspaceFile,
}: {
  item: ConversationArtifact;
  onInspect?(inspection: ArtifactInspection): void;
  peekArtifact?: typeof peekPlanArtifactText;
  previewFile?: typeof previewWorkspaceFile;
}) {
  const [preview, setPreview] = useState<PlanArtifactTextPeek>();
  const [error, setError] = useState<string>();
  const isHtml = /\.html?$/iu.test(item.artifact.path);

  useEffect(() => {
    if (!isHtml || !isAvailable(item)) return;
    let active = true;
    setPreview(undefined);
    setError(undefined);
    void peekArtifact(item.threadId, item.planId, item.artifact.id)
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
    item.artifact.status,
    item.artifact.updatedAt,
    item.planId,
    item.threadId,
    peekArtifact,
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
