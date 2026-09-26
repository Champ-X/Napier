import { useEffect, useState } from "react";

import type { PlanArtifactTextPreview } from "./artifact-file-api";
import { artifactInspectorCopy as copy } from "./artifact-inspector-copy";

export function SvgArtifactPreview({
  preview,
  filename,
}: {
  preview: PlanArtifactTextPreview;
  filename: string;
}) {
  const [image, setImage] = useState<{
    preview: PlanArtifactTextPreview;
    url: string;
  }>();
  const [failedUrl, setFailedUrl] = useState<string>();

  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([preview.text], { type: "image/svg+xml;charset=utf-8" }),
    );
    setImage({ preview, url });
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  // Only display the current receipt, including while a refresh effect is pending.
  const url = image?.preview === preview ? image.url : undefined;
  if (!url) return null;
  if (failedUrl === url) {
    return (
      <p className="artifact-inspector-error" role="alert">
        {copy.svgUnavailable}
      </p>
    );
  }

  // The image context preserves SMIL while disabling SVG scripts and external
  // resources. Do not inject the markup into the application document.
  return (
    <div className="workspace-file-image-preview">
      <img
        key={url}
        src={url}
        alt={filename}
        onError={() => setFailedUrl(url)}
      />
    </div>
  );
}
