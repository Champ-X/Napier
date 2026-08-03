import { describe, expect, it } from "vitest";

import { parsePlanArtifactDataProfileVerificationRequest } from "../src/plan-artifact-data-verification.js";
import { parsePlanArtifactDirectoryManifestVerificationRequest } from "../src/plan-artifact-directory-verification.js";

const SHA256 = "a".repeat(64);

describe("Plan Artifact verification requests", () => {
  it("accepts bounded data profiles and rejects unknown or unsafe cells", () => {
    const profile = {
      kind: "napier.plan-artifact-data-profile",
      schemaVersion: 1,
      planId: "plan_1",
      artifactId: "scores",
      planRevision: 2,
      status: "verified",
      artifactKind: "file",
      pathSha256: SHA256,
      sha256: SHA256,
      sizeBytes: 12,
      format: "csv",
      rowCount: 1,
      columnCount: 2,
      truncated: false,
      columnSetSha256: SHA256,
      sampleSha256: SHA256,
      columns: ["name", "score"],
      sampleRows: [{ name: "alpha", score: 1 }],
    } as const;

    expect(
      parsePlanArtifactDataProfileVerificationRequest({ profile }),
    ).toEqual(profile);
    expect(
      parsePlanArtifactDataProfileVerificationRequest({
        profile,
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parsePlanArtifactDataProfileVerificationRequest({
        profile: {
          ...profile,
          sampleRows: [{ name: { secret: true } }],
        },
      }),
    ).toBeUndefined();
  });

  it("accepts exact directory entries and rejects extra entry fields", () => {
    const manifest = {
      kind: "napier.plan-artifact-directory-manifest",
      schemaVersion: 1,
      planId: "plan_1",
      artifactId: "bundle",
      planRevision: 2,
      status: "verified",
      artifactKind: "directory",
      pathSha256: SHA256,
      sha256: SHA256,
      sizeBytes: 12,
      entryCount: 2,
      fileCount: 1,
      directoryCount: 1,
      entries: [
        { kind: "directory", path: "." },
        { kind: "file", path: "report.md", sha256: SHA256, sizeBytes: 12 },
      ],
    } as const;

    expect(
      parsePlanArtifactDirectoryManifestVerificationRequest({ manifest }),
    ).toEqual(manifest);
    expect(
      parsePlanArtifactDirectoryManifestVerificationRequest({
        manifest: {
          ...manifest,
          entries: [{ kind: "directory", path: ".", mode: "755" }],
        },
      }),
    ).toBeUndefined();
    expect(
      parsePlanArtifactDirectoryManifestVerificationRequest({
        manifest: { ...manifest, entries: [{ kind: "file", path: "../x" }] },
      }),
    ).toBeUndefined();
  });
});
