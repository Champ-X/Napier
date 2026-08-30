import type { ArtifactManifestEntry } from "@napier/contracts";

import type {
  PlanArtifactDiffPreviewReceipt,
  PlanArtifactTextPreview,
  PlanArtifactTextPreviewReceipt,
} from "./artifact-file-api";

export type ArtifactInspection =
  | {
      artifact: ArtifactManifestEntry;
      mode: "preview";
      planId: string;
      threadId: string;
      receipt?: PlanArtifactTextPreview | PlanArtifactTextPreviewReceipt;
    }
  | {
      artifact: ArtifactManifestEntry;
      mode: "diff";
      planId: string;
      threadId: string;
      receipt?: PlanArtifactDiffPreviewReceipt;
    };
