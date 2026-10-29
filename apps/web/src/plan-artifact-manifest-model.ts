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
import {
  artifactVersionKey,
  type ArtifactVersionSelection,
} from "./artifact-version-binding";
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
  selection: ArtifactVersionSelection,
  state: PlanArtifactManifestState,
): PlanArtifactDetailState {
  const artifactId = selection.artifact.id;
  const bound = state.selectionKey === artifactVersionKey(selection);
  const receipt = <T extends { artifactId: string }>(value: T | undefined) =>
    bound ? matchingArtifact(value, artifactId) : undefined;
  return {
    fileDownload: receipt(state.fileDownload),
    fileVerification: receipt(state.fileVerification),
    textPreview: receipt(state.textPreview),
    dataProfile: receipt(state.dataProfile),
    dataProfileVerification: receipt(state.dataProfileVerification),
    directoryManifest: receipt(state.directoryManifest),
    directoryManifestVerification: receipt(state.directoryManifestVerification),
    driftCheck: receipt(state.driftCheck),
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
