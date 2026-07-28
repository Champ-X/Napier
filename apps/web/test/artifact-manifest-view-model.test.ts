import type { ArtifactManifestEntry } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  formatArtifactSizeBytes,
  projectArtifactManifestEvidence,
} from "../src/artifact-manifest-view-model";

describe("artifact manifest view model", () => {
  it("projects digest and byte evidence without losing full hashes", () => {
    const sha256 = "a".repeat(64);
    const artifact = artifactFixture({
      sha256,
      sizeBytes: 4096,
      sourceRunId: "run_artifact_1234567890",
    });

    expect(projectArtifactManifestEvidence(artifact)).toEqual({
      digestFull: sha256,
      digestShort: sha256.slice(0, 16),
      sizeBytesLabel: "4,096 bytes",
      hasEvidence: true,
    });
  });

  it("keeps source-run-only artifacts visible as evidence", () => {
    expect(
      projectArtifactManifestEvidence(
        artifactFixture({ sourceRunId: "run_1234567890" }),
      ),
    ).toEqual({
      hasEvidence: true,
    });
  });

  it("formats exact byte counts", () => {
    expect(formatArtifactSizeBytes(1)).toBe("1 byte");
    expect(formatArtifactSizeBytes(1024)).toBe("1,024 bytes");
  });
});

function artifactFixture(
  overrides: Partial<ArtifactManifestEntry> = {},
): ArtifactManifestEntry {
  return {
    id: "artifact_12345678",
    path: "artifacts/report.md",
    kind: "file",
    description: "Generated report.",
    status: "verified",
    evidence: "Verified from workspace bytes.",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}
