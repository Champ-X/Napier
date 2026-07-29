import type { ArtifactManifestEntry } from "@napier/contracts";

export interface ArtifactManifestEvidenceProjection {
  digestShort?: string;
  digestFull?: string;
  sizeBytesLabel?: string;
  hasEvidence: boolean;
}

export interface ArtifactManifestActionsProjection {
  canProduce: boolean;
  canVerify: boolean;
  canMarkMissing: boolean;
  canDownload: boolean;
  canPreview: boolean;
  canProfileData: boolean;
  canInspectManifest: boolean;
  canCheckDrift: boolean;
  verifyMode: "verify" | "recheck";
  missingMode: "missing" | "drifted";
  hasActions: boolean;
}

export interface ArtifactDriftCheckProjectionInput {
  artifactId: string;
  result: "current" | "drifted" | "missing";
}

export interface ArtifactDriftCheckActionProjection {
  canRecheck: boolean;
  canMarkDrifted: boolean;
  nextAction?: "verified" | "missing";
  hasAction: boolean;
}

export interface ArtifactDirectoryManifestDownloadProjectionInput {
  artifactId: string;
  sha256: string;
}

export function projectArtifactManifestEvidence(
  artifact: ArtifactManifestEntry,
): ArtifactManifestEvidenceProjection {
  const digestFull = artifact.sha256;
  const sizeBytesLabel =
    artifact.sizeBytes !== undefined
      ? formatArtifactSizeBytes(artifact.sizeBytes)
      : undefined;
  return {
    ...(digestFull ? { digestFull, digestShort: digestFull.slice(0, 16) } : {}),
    ...(sizeBytesLabel ? { sizeBytesLabel } : {}),
    hasEvidence: Boolean(digestFull || sizeBytesLabel || artifact.sourceRunId),
  };
}

export function projectArtifactManifestActions(
  artifact: ArtifactManifestEntry,
): ArtifactManifestActionsProjection {
  const canProduce =
    artifact.status === "expected" || artifact.status === "missing";
  const canVerify =
    (artifact.status === "produced" || artifact.status === "verified") &&
    (artifact.kind === "file" || artifact.kind === "directory");
  const canMarkMissing =
    artifact.status === "expected" ||
    artifact.status === "produced" ||
    (artifact.status === "verified" &&
      (artifact.kind === "file" || artifact.kind === "directory"));
  const canDownload =
    artifact.kind === "file" &&
    (artifact.status === "produced" || artifact.status === "verified");
  const canPreview = canDownload;
  const canProfileData =
    canDownload && /\.(?:csv|json|jsonl|ndjson)$/iu.test(artifact.path);
  const canInspectManifest =
    artifact.kind === "directory" &&
    (artifact.status === "produced" || artifact.status === "verified");
  const canCheckDrift =
    artifact.status === "verified" &&
    (artifact.kind === "file" || artifact.kind === "directory");
  return {
    canProduce,
    canVerify,
    canMarkMissing,
    canDownload,
    canPreview,
    canProfileData,
    canInspectManifest,
    canCheckDrift,
    verifyMode: artifact.status === "verified" ? "recheck" : "verify",
    missingMode: artifact.status === "verified" ? "drifted" : "missing",
    hasActions:
      artifact.status !== "superseded" &&
      (canProduce ||
        canVerify ||
        canMarkMissing ||
        canDownload ||
        canPreview ||
        canProfileData ||
        canInspectManifest ||
        canCheckDrift),
  };
}

export function projectArtifactDriftCheckAction(
  artifact: ArtifactManifestEntry,
  driftCheck: ArtifactDriftCheckProjectionInput | undefined,
): ArtifactDriftCheckActionProjection {
  if (
    !driftCheck ||
    driftCheck.artifactId !== artifact.id ||
    artifact.status !== "verified" ||
    (artifact.kind !== "file" && artifact.kind !== "directory")
  ) {
    return {
      canRecheck: false,
      canMarkDrifted: false,
      hasAction: false,
    };
  }
  if (driftCheck.result === "current") {
    return {
      canRecheck: true,
      canMarkDrifted: false,
      nextAction: "verified",
      hasAction: true,
    };
  }
  return {
    canRecheck: false,
    canMarkDrifted: true,
    nextAction: "missing",
    hasAction: true,
  };
}

export function artifactDirectoryManifestFilename(
  manifest: ArtifactDirectoryManifestDownloadProjectionInput,
): string {
  const safeArtifactId = manifest.artifactId.replace(/[^A-Za-z0-9._-]/g, "_");
  const safeId = safeArtifactId.length > 0 ? safeArtifactId : "artifact";
  return `napier-artifact-manifest-${safeId}-${manifest.sha256.slice(0, 12)}.json`;
}

export function formatArtifactSizeBytes(sizeBytes: number): string {
  return `${sizeBytes.toLocaleString("en-US")} ${
    sizeBytes === 1 ? "byte" : "bytes"
  }`;
}
