import type { ArtifactManifestEntry } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  formatArtifactSizeBytes,
  projectArtifactManifestActions,
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

  it("projects artifact actions including verified-byte rechecks", () => {
    expect(
      projectArtifactManifestActions(
        artifactFixture({ status: "expected", kind: "file" }),
      ),
    ).toEqual({
      canProduce: true,
      canVerify: false,
      canMarkMissing: true,
      canDownload: false,
      canPreview: false,
      canCheckDrift: false,
      verifyMode: "verify",
      missingMode: "missing",
      hasActions: true,
    });
    expect(
      projectArtifactManifestActions(
        artifactFixture({ status: "produced", kind: "directory" }),
      ),
    ).toEqual({
      canProduce: false,
      canVerify: true,
      canMarkMissing: true,
      canDownload: false,
      canPreview: false,
      canCheckDrift: false,
      verifyMode: "verify",
      missingMode: "missing",
      hasActions: true,
    });
    expect(
      projectArtifactManifestActions(
        artifactFixture({ status: "verified", kind: "file" }),
      ),
    ).toEqual({
      canProduce: false,
      canVerify: true,
      canMarkMissing: true,
      canDownload: true,
      canPreview: true,
      canCheckDrift: true,
      verifyMode: "recheck",
      missingMode: "drifted",
      hasActions: true,
    });
    expect(
      projectArtifactManifestActions(
        artifactFixture({ status: "verified", kind: "directory" }),
      ),
    ).toEqual(
      expect.objectContaining({
        canDownload: false,
        canPreview: false,
        canCheckDrift: true,
      }),
    );
    expect(
      projectArtifactManifestActions(
        artifactFixture({ status: "superseded", kind: "file" }),
      ),
    ).toEqual({
      canProduce: false,
      canVerify: false,
      canMarkMissing: false,
      canDownload: false,
      canPreview: false,
      canCheckDrift: false,
      verifyMode: "verify",
      missingMode: "missing",
      hasActions: false,
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
