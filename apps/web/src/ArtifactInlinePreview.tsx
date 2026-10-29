import "./artifact-consumer-responsive.css";
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
import {
  artifactVersionKey,
  assertArtifactReceiptVersion,
} from "./artifact-version-binding";

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
  const [loadedKey, setLoadedKey] = useState<string>();
  const isHtml = /\.html?$/iu.test(item.artifact.path);
  const versionKey = artifactVersionKey(item);

  useEffect(() => {
    setPreview(undefined);
    setError(undefined);
    setLoadedKey(versionKey);
    if (!isHtml || !isAvailable(item)) return;
    let active = true;
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
      .then(async (receipt) => {
        assertArtifactReceiptVersion(item, receipt, "content");
        if (active) setPreview(receipt);
      })
      .catch((reason: unknown) => {
        if (active) setError(formatApiErrorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [isHtml, versionKey, peekArtifact, peekArtifactFile]);

  if (!isHtml || !isAvailable(item)) return null;
  const copy = conversationDetailCopy.artifact;
  const currentPreview = loadedKey === versionKey ? preview : undefined;
  const currentError = loadedKey === versionKey ? error : undefined;
  const inspect = () =>
    onInspect?.({
      artifact: item.artifact,
      mode: "preview",
      planId: item.planId,
      planRevision: item.planRevision,
      threadId: item.threadId,
    });

  return (
    <section
      className={`artifact-inline-preview${currentPreview ? " is-ready" : " is-loading"}`}
      aria-label={`${copy.previewLabel}: ${item.artifact.path}`}
    >
      <header>
        <span>
          <FileCode2 size={13} aria-hidden="true" />
          {fileName(item.artifact.path)}
        </span>
        <small>
          {currentPreview
            ? copy.livePreview
            : currentError
              ? copy.previewUnavailable
              : copy.loadingPreview}
        </small>
      </header>
      {currentPreview ? (
        <HtmlArtifactPreview
          path={item.artifact.path}
          refreshKey={currentPreview}
          sha256={currentPreview.sha256}
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
