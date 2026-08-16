import type { ArtifactManifestStatus } from "@napier/contracts";

export const ARTIFACT_MANIFEST_STATUSES = new Set<ArtifactManifestStatus>([
  "expected",
  "candidate",
  "produced",
  "verified",
  "missing",
  "superseded",
]);

export function artifactRequiresEvidence(
  status: ArtifactManifestStatus,
): boolean {
  return status !== "expected" && status !== "superseded";
}
