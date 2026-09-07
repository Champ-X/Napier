import { useEffect, useState } from "react";

import { formatApiErrorMessage } from "./api-error";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";
import { previewWorkspaceFile } from "./workspace-directory-api";

export function HtmlArtifactPreview({
  path,
  sha256,
  previewFile = previewWorkspaceFile,
}: {
  path: string;
  sha256: string;
  previewFile?: typeof previewWorkspaceFile;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setUrl(undefined);
    setError(undefined);
    void previewFile(path, controller.signal)
      .then((file) => {
        if (controller.signal.aborted) return;
        if (file.sha256 !== sha256) throw new Error(copy.fileChanged);
        if (!file.previewUrl) throw new Error(copy.siteUnavailable);
        setUrl(file.previewUrl);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(formatApiErrorMessage(reason));
      });
    return () => controller.abort();
  }, [path, sha256, previewFile]);
  if (error)
    return (
      <p className="artifact-inspector-error" role="alert">
        {error}
      </p>
    );
  if (!url) return null;
  return (
    <iframe
      className="artifact-inspector-frame"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      src={url}
      title={copy.htmlTitle}
    />
  );
}
