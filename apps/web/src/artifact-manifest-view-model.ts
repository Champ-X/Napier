import type { ArtifactManifestEntry } from "@napier/contracts";

export interface ArtifactManifestEvidenceProjection {
  digestShort?: string;
  digestFull?: string;
  sizeBytesLabel?: string;
  hasEvidence: boolean;
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

export function formatArtifactSizeBytes(sizeBytes: number): string {
  return `${sizeBytes.toLocaleString("en-US")} ${
    sizeBytes === 1 ? "byte" : "bytes"
  }`;
}
