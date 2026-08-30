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

export function ArtifactInlinePreview({
  item,
  onInspect,
  peekArtifact = peekPlanArtifactText,
}: {
  item: ConversationArtifact;
  onInspect?(inspection: ArtifactInspection): void;
  peekArtifact?: typeof peekPlanArtifactText;
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
        <iframe
          sandbox=""
          srcDoc={thumbnailDocument(preview.text)}
          title={`${copy.previewLabel}: ${item.artifact.path}`}
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

function thumbnailDocument(text: string): string {
  const policy =
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">";
  const inert = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, "")
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu, "");
  return /<head(?:\s[^>]*)?>/iu.test(inert)
    ? inert.replace(/<head((?:\s[^>]*)?)>/iu, `<head$1>${policy}`)
    : `${policy}${inert}`;
}
