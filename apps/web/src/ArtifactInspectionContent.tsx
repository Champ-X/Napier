import { useMemo } from "react";

import type {
  PlanArtifactDiffPreviewReceipt,
  PlanArtifactTextPreview,
  PlanArtifactTextPreviewReceipt,
} from "./artifact-file-api";
import type { ArtifactPreviewReceipt } from "./artifact-inspection";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";
import { FilePreviewContent } from "./FilePreviewContent";
import { FileSourcePreview } from "./FileSourcePreview";
import { HtmlArtifactPreview } from "./HtmlArtifactPreview";
import { SvgArtifactPreview } from "./SvgArtifactPreview";
import { previewWorkspaceFile } from "./workspace-directory-api";
import type { ArtifactInspectorView } from "./use-artifact-inspector-view";

export function ArtifactInspectionContent({
  path,
  threadId,
  previewFile = previewWorkspaceFile,
  view,
  preview,
  diff,
}: {
  path: string;
  threadId: string;
  previewFile?: typeof previewWorkspaceFile;
  view: ArtifactInspectorView;
  preview: ArtifactPreviewReceipt | undefined;
  diff: PlanArtifactDiffPreviewReceipt | undefined;
}) {
  const extension = fileExtension(path);
  if (view === "diff") {
    return <FileSourcePreview text={diff?.text || copy.noDiff} diff />;
  }
  if (preview?.kind === "napier.plan-artifact-file-preview") {
    if (view === "preview" && (extension === "html" || extension === "htm")) {
      return (
        <HtmlArtifactPreview
          path={path}
          refreshKey={preview}
          sha256={preview.sha256}
          previewFile={previewFile}
        />
      );
    }
    return (
      <FilePreviewContent preview={preview} view={view} threadId={threadId} />
    );
  }
  const text = preview?.text ?? "";
  if (preview && view === "preview" && extension === "svg") {
    return <SvgArtifactPreview preview={preview} filename={fileName(path)} />;
  }
  if (
    preview &&
    view === "preview" &&
    (extension === "html" || extension === "htm")
  ) {
    return (
      <HtmlArtifactPreview
        key={preview.textSha256}
        path={path}
        refreshKey={preview}
        sha256={preview.sha256}
        previewFile={previewFile}
      />
    );
  }
  if (
    view === "preview" &&
    (extension === "md" || extension === "mdx" || extension === "markdown")
  ) {
    return (
      <MarkdownArtifactPreview
        path={path}
        threadId={threadId}
        preview={preview}
      />
    );
  }
  return <FileSourcePreview text={text} />;
}

function MarkdownArtifactPreview({
  path,
  threadId,
  preview,
}: {
  path: string;
  threadId: string;
  preview: PlanArtifactTextPreview | PlanArtifactTextPreviewReceipt | undefined;
}) {
  const file = useMemo(
    () =>
      preview
        ? {
            path,
            filename: fileName(path),
            contentType: "text/markdown; charset=utf-8",
            blob: new Blob([preview.text], {
              type: "text/markdown; charset=utf-8",
            }),
            text: preview.text,
            sha256: preview.sha256,
            sizeBytes: preview.sizeBytes,
          }
        : undefined,
    [path, preview],
  );
  return file ? (
    <FilePreviewContent preview={file} view="preview" threadId={threadId} />
  ) : null;
}

function fileExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}
