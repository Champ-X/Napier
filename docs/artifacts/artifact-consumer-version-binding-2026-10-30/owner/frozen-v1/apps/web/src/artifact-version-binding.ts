import type { ThreadDetail } from "@napier/contracts";
import {
  taskArtifactCurrentFact,
  taskArtifactReceiptMatches,
  type TaskArtifactSelection as ArtifactVersionSelection,
  type TaskArtifactReceipt as ArtifactVersionReceipt,
} from "@napier/contracts/task-narrative";

import { artifactInspectorCopy } from "./artifact-inspector-copy";
import { canonicalJson } from "./stable-digest";

export type { ArtifactVersionSelection, ArtifactVersionReceipt };
export function artifactVersionKey(
  selection: ArtifactVersionSelection,
): string {
  return canonicalJson({
    threadId: selection.threadId,
    planId: selection.planId,
    planRevision: selection.planRevision,
    artifact: selection.artifact,
  });
}

export function artifactSelectionCurrentFact(
  selection: ArtifactVersionSelection,
  deliverables: NonNullable<ThreadDetail["taskNarrative"]>["deliverables"] = [],
) {
  const entry = deliverables.find(
    (candidate) =>
      candidate.source === "plan" &&
      candidate.planId === selection.planId &&
      candidate.planRevision === selection.planRevision &&
      candidate.path === selection.artifact.path &&
      canonicalJson(candidate.artifact) === canonicalJson(selection.artifact),
  );
  return entry ? taskArtifactCurrentFact(entry) : "unchecked";
}

export function assertArtifactReceiptVersion(
  selection: ArtifactVersionSelection,
  receipt: ArtifactVersionReceipt,
): void {
  if (!taskArtifactReceiptMatches(selection, receipt)) {
    throw new Error(artifactInspectorCopy.versionChanged);
  }
}
