import type { ArtifactManifestEntry } from "@napier/contracts";

import {
  projectArtifactDriftCheckAction,
  projectArtifactManifestActions,
  projectArtifactManifestEvidence,
} from "./artifact-manifest-view-model";
import type {
  PlanArtifactDetailState,
  PlanArtifactManifestState,
} from "./plan-artifact-manifest-types";
import { planCopy } from "./plan-copy";

export interface PlanArtifactManifestItemView {
  evidence: ReturnType<typeof projectArtifactManifestEvidence>;
  actions: ReturnType<typeof projectArtifactManifestActions>;
  driftCheckAction: ReturnType<typeof projectArtifactDriftCheckAction>;
  verifyLabel: string;
  verifyingLabel: string;
  missingLabel: string;
  markingMissingLabel: string;
}

export function projectPlanArtifactManifestItem(
  artifact: ArtifactManifestEntry,
  details: PlanArtifactDetailState,
): PlanArtifactManifestItemView {
  const actions = projectArtifactManifestActions(artifact);
  return {
    evidence: projectArtifactManifestEvidence(artifact),
    actions,
    driftCheckAction: projectArtifactDriftCheckAction(
      artifact,
      details.driftCheck,
    ),
    verifyLabel:
      actions.verifyMode === "recheck"
        ? planCopy.artifactActions.recheck
        : planCopy.artifactActions.verify,
    verifyingLabel:
      actions.verifyMode === "recheck"
        ? planCopy.artifactActions.rechecking
        : planCopy.artifactActions.verifying,
    missingLabel:
      actions.missingMode === "drifted"
        ? planCopy.artifactActions.markDrifted
        : planCopy.artifactActions.markMissing,
    markingMissingLabel:
      actions.missingMode === "drifted"
        ? planCopy.artifactActions.markingDrifted
        : planCopy.artifactActions.markingMissing,
  };
}

export function planArtifactDetails(
  artifactId: string,
  state: PlanArtifactManifestState,
): PlanArtifactDetailState {
  return {
    fileDownload: matchingArtifact(state.fileDownload, artifactId),
    fileVerification: matchingArtifact(state.fileVerification, artifactId),
    textPreview: matchingArtifact(state.textPreview, artifactId),
    dataProfile: matchingArtifact(state.dataProfile, artifactId),
    dataProfileVerification: matchingArtifact(
      state.dataProfileVerification,
      artifactId,
    ),
    directoryManifest: matchingArtifact(state.directoryManifest, artifactId),
    directoryManifestVerification: matchingArtifact(
      state.directoryManifestVerification,
      artifactId,
    ),
    driftCheck: matchingArtifact(state.driftCheck, artifactId),
  };
}

export function shortPlanArtifactId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}

function matchingArtifact<T extends { artifactId: string }>(
  value: T | undefined,
  artifactId: string,
): T | undefined {
  return value?.artifactId === artifactId ? value : undefined;
}
