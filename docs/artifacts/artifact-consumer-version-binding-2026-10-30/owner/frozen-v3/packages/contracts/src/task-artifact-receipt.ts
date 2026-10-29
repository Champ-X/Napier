import type { ArtifactManifestEntry } from "./execution-workflows.js";
import { sha256 } from "./skill-load-validation.js";

export interface TaskArtifactSelection {
  artifact: ArtifactManifestEntry;
  planId: string;
  planRevision?: number;
  threadId?: string;
}

export interface TaskArtifactReceipt {
  kind?: string;
  planId: string;
  artifactId: string;
  planRevision: number;
  status: string;
  artifactKind?: string;
  pathSha256: string;
  threadId?: string;
  sha256?: string;
  sizeBytes?: number;
  expectedSha256?: string;
  expectedSizeBytes?: number;
}

export type TaskArtifactReceiptMode = "content" | "expected" | "identity";

function receiptMode(receipt: TaskArtifactReceipt): TaskArtifactReceiptMode {
  if (
    [
      "napier.plan-artifact-text-preview",
      "napier.plan-artifact-text-peek",
      "napier.plan-artifact-file-preview",
      "napier.plan-artifact-data-profile",
      "napier.plan-artifact-directory-manifest",
    ].includes(receipt.kind ?? "")
  )
    return "content";
  if (
    [
      "napier.plan-artifact-file-verification",
      "napier.plan-artifact-drift-check",
    ].includes(receipt.kind ?? "")
  )
    return "expected";
  return "identity";
}

export function taskArtifactReceiptMatches(
  selection: TaskArtifactSelection,
  receipt: TaskArtifactReceipt,
  mode?: TaskArtifactReceiptMode,
): boolean {
  if (!receipt || typeof receipt !== "object") return false;
  return (
    validReceiptComponents(receipt, mode ?? receiptMode(receipt)) &&
    receiptIdentityMatches(selection, receipt) &&
    receiptDeclaredValuesMatch(selection.artifact, receipt)
  );
}

function validReceiptComponents(
  receipt: TaskArtifactReceipt,
  mode: TaskArtifactReceiptMode,
): boolean {
  if (mode === "content")
    return (
      /^[a-f0-9]{64}$/u.test(receipt.sha256 ?? "") &&
      Number.isSafeInteger(receipt.sizeBytes) &&
      (receipt.sizeBytes ?? -1) >= 0
    );
  if (mode === "expected")
    return /^[a-f0-9]{64}$/u.test(receipt.expectedSha256 ?? "");
  return true;
}

function receiptIdentityMatches(
  selection: TaskArtifactSelection,
  receipt: TaskArtifactReceipt,
): boolean {
  const { artifact } = selection;
  return (
    receipt.planId === selection.planId &&
    receipt.artifactId === artifact.id &&
    (selection.planRevision === undefined ||
      receipt.planRevision === selection.planRevision) &&
    Number.isSafeInteger(receipt.planRevision) &&
    receipt.planRevision >= 1 &&
    receipt.status === artifact.status &&
    (receipt.artifactKind === undefined ||
      receipt.artifactKind === artifact.kind) &&
    (receipt.threadId === undefined ||
      selection.threadId === undefined ||
      receipt.threadId === selection.threadId) &&
    receipt.pathSha256 === sha256(artifact.path)
  );
}

function receiptDeclaredValuesMatch(
  artifact: ArtifactManifestEntry,
  receipt: TaskArtifactReceipt,
): boolean {
  if (
    artifact.sha256 !== undefined &&
    ((receipt.sha256 !== undefined && receipt.sha256 !== artifact.sha256) ||
      (receipt.expectedSha256 !== undefined &&
        receipt.expectedSha256 !== artifact.sha256))
  )
    return false;
  if (
    artifact.sizeBytes !== undefined &&
    ((receipt.sha256 !== undefined &&
      receipt.sizeBytes !== artifact.sizeBytes) ||
      (receipt.expectedSizeBytes !== undefined &&
        receipt.expectedSizeBytes !== artifact.sizeBytes))
  )
    return false;
  return true;
}
