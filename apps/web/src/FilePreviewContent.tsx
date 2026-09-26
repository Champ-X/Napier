import { FileCode2 } from "lucide-react";
import { useEffect, useState } from "react";

import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";
import { FileSourcePreview, limitFilePreviewText } from "./FileSourcePreview";
import { MessageMarkdown } from "./message-markdown";
import type { WorkspaceFilePreview } from "./workspace-directory-api";
import { workspaceEvidenceCopy as workspaceCopy } from "./workspace-evidence-copy";

export function FilePreviewContent({
  preview,
  view,
  threadId,
}: {
  preview: WorkspaceFilePreview;
  view: "preview" | "source";
  threadId?: string;
}) {
  const type = preview.contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const extension = preview.path.split(".").pop()?.toLowerCase();
  if (view === "source") {
    return preview.text !== undefined ? (
      <FileSourcePreview
        text={preview.text}
        truncated={preview.textTruncated === true}
      />
    ) : (
      <p className="artifact-inspector-notice" role="status">
        {preview.textError ?? copy.textUnavailable}
      </p>
    );
  }
  if (
    type === "text/html" &&
    (preview.previewUrl || preview.text !== undefined)
  ) {
    return (
      <iframe
        className="artifact-inspector-frame"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        src={preview.previewUrl}
        srcDoc={preview.previewUrl ? undefined : preview.text}
        title={copy.htmlTitle}
      />
    );
  }
  if (type.startsWith("image/") || type === "application/pdf") {
    return (
      <FileMediaPreview preview={preview} image={type.startsWith("image/")} />
    );
  }
  if (
    preview.text !== undefined &&
    (extension === "md" || extension === "mdx" || extension === "markdown")
  ) {
    const bounded = limitFilePreviewText(preview.text);
    return (
      <>
        {bounded.truncated || preview.textTruncated ? (
          <p className="artifact-inspector-notice" role="status">
            {bounded.truncated
              ? copy.previewTruncated
              : copy.textPreviewPartial}
          </p>
        ) : null}
        <article className="artifact-inspector-markdown">
          <MessageMarkdown
            text={bounded.text}
            workspaceDocument={{
              path: preview.path,
              ...(threadId ? { threadId } : {}),
            }}
          />
        </article>
      </>
    );
  }
  if (preview.text !== undefined) {
    return (
      <FileSourcePreview
        text={preview.text}
        truncated={preview.textTruncated === true}
      />
    );
  }
  if (preview.textError) {
    return (
      <p className="artifact-inspector-notice" role="status">
        {preview.textError}
      </p>
    );
  }
  return (
    <div className="workspace-file-preview-unavailable">
      <FileCode2 size={28} aria-hidden="true" />
      <strong>{preview.filename}</strong>
      <span>{workspaceCopy.previewUnavailable}</span>
    </div>
  );
}

function FileMediaPreview({
  preview,
  image,
}: {
  preview: WorkspaceFilePreview;
  image: boolean;
}) {
  const [resource, setResource] = useState<{
    preview: WorkspaceFilePreview;
    url: string;
  }>();
  const [failedUrl, setFailedUrl] = useState<string>();

  useEffect(() => {
    const url = URL.createObjectURL(preview.blob);
    setResource({ preview, url });
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  // Never reuse another receipt's image while a refresh effect is pending.
  const objectUrl = resource?.preview === preview ? resource.url : undefined;
  if (!objectUrl) return null;
  if (!image) {
    return (
      <iframe
        className="artifact-inspector-frame"
        src={objectUrl}
        title={preview.filename}
      />
    );
  }
  if (failedUrl === objectUrl) {
    return (
      <p className="artifact-inspector-error" role="alert">
        {copy.imageUnavailable}
      </p>
    );
  }
  // An image context preserves SVG animation while disabling scripts and
  // external resources, including when its source text is also available.
  return (
    <div className="workspace-file-image-preview">
      <img
        key={objectUrl}
        src={objectUrl}
        alt={preview.filename}
        onError={() => setFailedUrl(objectUrl)}
      />
    </div>
  );
}
