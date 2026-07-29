import { describe, expect, it } from "vitest";

import type { PlanArtifactDataProfile } from "../src/artifact-file-api";
import { projectArtifactDataProfileView } from "../src/artifact-data-profile-view-model";

describe("artifact data profile view model", () => {
  it("projects user-facing labels, short hashes, and stable duplicate column ids", () => {
    const profile = dataProfileFixture({
      format: "markdown_table",
      columns: ["name", "name", "score"],
      sampleRows: [{ name: "Ada", score: null }],
    });

    expect(projectArtifactDataProfileView(profile)).toEqual({
      formatLabel: "Markdown table",
      columnSetShortSha256: "a".repeat(16),
      sampleShortSha256: "b".repeat(16),
      hasColumns: true,
      hasSampleRows: true,
      columns: [
        { id: "0:name", label: "name" },
        { id: "1:name", label: "name" },
        { id: "2:score", label: "score" },
      ],
      rows: [
        {
          id: "artifact_1234567890:0",
          cells: [
            { id: "0:0", value: "Ada" },
            { id: "0:1", value: "Ada" },
            { id: "0:2", value: "null" },
          ],
        },
      ],
    });
  });

  it("distinguishes known columns from an empty bounded sample", () => {
    const profile = dataProfileFixture({
      columns: ["name", "score"],
      sampleRows: [],
    });

    expect(projectArtifactDataProfileView(profile)).toMatchObject({
      hasColumns: true,
      hasSampleRows: false,
      columns: [
        { id: "0:name", label: "name" },
        { id: "1:score", label: "score" },
      ],
      rows: [],
    });
  });
});

function dataProfileFixture(
  overrides: Partial<PlanArtifactDataProfile> = {},
): PlanArtifactDataProfile {
  return {
    kind: "napier.plan-artifact-data-profile",
    schemaVersion: 1,
    planId: "plan_1234567890",
    artifactId: "artifact_1234567890",
    planRevision: 1,
    status: "verified",
    artifactKind: "file",
    pathSha256: "c".repeat(64),
    sha256: "d".repeat(64),
    sizeBytes: 256,
    format: "csv",
    rowCount: 1,
    columnCount: 2,
    truncated: false,
    columnSetSha256: "a".repeat(64),
    sampleSha256: "b".repeat(64),
    columns: ["name", "score"],
    sampleRows: [{ name: "Ada", score: 98 }],
    ...overrides,
  };
}
