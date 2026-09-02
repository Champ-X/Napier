import { useCallback } from "react";

import type { MessageSkillResourceLink } from "./message-markdown";
import { previewSkillResource } from "./skill-resource-api";
import { WorkspaceFileInspector } from "./WorkspaceFileInspector";

export interface SkillResourceInspectorProps {
  reference: MessageSkillResourceLink;
  onClose(): void;
}

export function SkillResourceInspector({
  reference,
  onClose,
}: SkillResourceInspectorProps) {
  const previewFile = useCallback(
    (_path: string, signal?: AbortSignal) =>
      previewSkillResource(reference, signal),
    [
      reference.rawContentSha256,
      reference.resourcePath,
      reference.rootKind,
      reference.skillName,
      reference.virtualPath,
    ],
  );
  return (
    <WorkspaceFileInspector
      path={reference.virtualPath}
      onClose={onClose}
      previewFile={previewFile}
    />
  );
}
