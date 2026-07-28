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
  verifyMode: "verify" | "recheck";
  hasActions: boolean;
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
    ...(digestFull
      ? { digestFull, digestShort: digestFull.slice(0, 16) }
      : {}),
    ...(sizeBytesLabel ? { sizeBytesLabel } : {}),
    hasEvidence: Boolean(
      digestFull || sizeBytesLabel || artifact.sourceRunId,
    ),
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
    artifact.status === "expected" || artifact.status === "produced";
  return {
    canProduce,
    canVerify,
    canMarkMissing,
    verifyMode: artifact.status === "verified" ? "recheck" : "verify",
    hasActions:
      artifact.status !== "superseded" &&
      (canProduce || canVerify || canMarkMissing),
  };
}

export function formatArtifactSizeBytes(sizeBytes: number): string {
  return `${sizeBytes.toLocaleString("en-US")} ${
    sizeBytes === 1 ? "byte" : "bytes"
  }`;
}
