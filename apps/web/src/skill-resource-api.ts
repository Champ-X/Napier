import type { MessageSkillResourceLink } from "./message-markdown";
import {
  readFilePreviewResponse,
  type WorkspaceFilePreview,
} from "./workspace-directory-api";

export async function previewSkillResource(
  reference: MessageSkillResourceLink,
  signal?: AbortSignal,
): Promise<WorkspaceFilePreview> {
  const endpoint = `/api/skills/resource?${new URLSearchParams({
    name: reference.skillName,
    path: reference.resourcePath,
    rootKind: reference.rootKind,
    sha256: reference.rawContentSha256,
  }).toString()}`;
  const response = await fetch(endpoint, signal ? { signal } : undefined);
  return readFilePreviewResponse(response, endpoint, reference.virtualPath);
}
