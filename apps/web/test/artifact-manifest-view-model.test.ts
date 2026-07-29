import type { ArtifactManifestEntry } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  artifactDirectoryManifestFilename,
  formatArtifactSizeBytes,
  projectArtifactDriftCheckAction,
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
      canProfileData: false,
      canInspectManifest: false,
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
      canProfileData: false,
      canInspectManifest: true,
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
      canProfileData: false,
      canInspectManifest: false,
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
        canProfileData: false,
        canInspectManifest: true,
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
      canProfileData: false,
      canInspectManifest: false,
      canCheckDrift: false,
      verifyMode: "verify",
      missingMode: "missing",
      hasActions: false,
    });
    expect(
      projectArtifactManifestActions(
        artifactFixture({
          status: "verified",
          kind: "file",
          path: "artifacts/scores.csv",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        canProfileData: true,
      }),
    );
    expect(
      projectArtifactManifestActions(
        artifactFixture({
          status: "produced",
          kind: "file",
          path: "artifacts/scores.tsv",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        canProfileData: true,
      }),
    );
  });

  it("formats exact byte counts", () => {
    expect(formatArtifactSizeBytes(1)).toBe("1 byte");
    expect(formatArtifactSizeBytes(1024)).toBe("1,024 bytes");
  });

  it("builds safe directory manifest download filenames", () => {
    expect(
      artifactDirectoryManifestFilename({
        artifactId: "bundle/report",
        sha256: "abcdef1234567890".padEnd(64, "0"),
      }),
    ).toBe("napier-artifact-manifest-bundle_report-abcdef123456.json");
  });

  it("projects drift check follow-up actions only for the matching verified artifact", () => {
    const artifact = artifactFixture({ status: "verified", kind: "file" });

    expect(
      projectArtifactDriftCheckAction(artifact, {
        artifactId: artifact.id,
        result: "current",
      }),
    ).toEqual({
      canRecheck: true,
      canMarkDrifted: false,
      nextAction: "verified",
      hasAction: true,
    });
    expect(
      projectArtifactDriftCheckAction(artifact, {
        artifactId: artifact.id,
        result: "drifted",
      }),
    ).toEqual({
      canRecheck: false,
      canMarkDrifted: true,
      nextAction: "missing",
      hasAction: true,
    });
    expect(
      projectArtifactDriftCheckAction(artifact, {
        artifactId: artifact.id,
        result: "missing",
      }),
    ).toEqual({
      canRecheck: false,
      canMarkDrifted: true,
      nextAction: "missing",
      hasAction: true,
    });
    expect(
      projectArtifactDriftCheckAction(artifact, {
        artifactId: "artifact_other",
        result: "drifted",
      }),
    ).toEqual({
      canRecheck: false,
      canMarkDrifted: false,
      hasAction: false,
    });
    expect(
      projectArtifactDriftCheckAction(
        artifactFixture({ status: "missing", kind: "file" }),
        {
          artifactId: artifact.id,
          result: "drifted",
        },
      ),
    ).toEqual({
      canRecheck: false,
      canMarkDrifted: false,
      hasAction: false,
    });
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
