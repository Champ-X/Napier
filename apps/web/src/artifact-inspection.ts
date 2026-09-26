import type { ArtifactManifestEntry } from "@napier/contracts";
import {
  filePreviewContentType,
  isTextPreviewContentType,
  MAX_TEXT_FILE_PREVIEW_BYTES,
} from "@napier/contracts/file-preview";

import type {
  PlanArtifactDiffPreviewReceipt,
  PlanArtifactFilePreviewReceipt,
  PlanArtifactTextPreview,
  PlanArtifactTextPreviewReceipt,
  previewPlanArtifactFile,
  previewPlanArtifactText,
} from "./artifact-file-api";

export type ArtifactPreviewReceipt =
  | PlanArtifactTextPreview
  | PlanArtifactTextPreviewReceipt
  | PlanArtifactFilePreviewReceipt;

export function artifactUsesTextPreview(path: string): boolean {
  return isTextPreviewContentType(filePreviewContentType(path));
}

export function artifactNeedsFilePreview(
  artifact: Pick<ArtifactManifestEntry, "path" | "sizeBytes">,
): boolean {
  return (
    !artifactUsesTextPreview(artifact.path) ||
    (artifact.sizeBytes ?? 0) > MAX_TEXT_FILE_PREVIEW_BYTES
  );
}

export function artifactTextPreviewNeedsFileFallback(reason: unknown): boolean {
  return (
    reason instanceof Error &&
    (reason.message.startsWith(
      `Artifact preview exceeds the ${MAX_TEXT_FILE_PREVIEW_BYTES / 1024 / 1024} MiB text limit`,
    ) ||
      reason.message.startsWith(
        "Text preview requires valid UTF-8 or BOM-marked UTF-16 text",
      ))
  );
}

export async function requestArtifactPreview(
  inspection: Pick<ArtifactInspection, "artifact" | "threadId" | "planId">,
  previewText: typeof previewPlanArtifactText,
  previewFile: typeof previewPlanArtifactFile,
): Promise<ArtifactPreviewReceipt> {
  const { artifact, threadId, planId } = inspection;
  if (artifactNeedsFilePreview(artifact)) {
    return previewFile(threadId, planId, artifact.id);
  }
  try {
    return await previewText(threadId, planId, artifact.id);
  } catch (reason) {
    if (artifactTextPreviewNeedsFileFallback(reason)) {
      return previewFile(threadId, planId, artifact.id);
    }
    throw reason;
  }
}

export type ArtifactInspection =
  | {
      artifact: ArtifactManifestEntry;
      mode: "preview";
      planId: string;
      threadId: string;
      receipt?: ArtifactPreviewReceipt;
    }
  | {
      artifact: ArtifactManifestEntry;
      mode: "diff";
      planId: string;
      threadId: string;
      receipt?: PlanArtifactDiffPreviewReceipt;
    };
