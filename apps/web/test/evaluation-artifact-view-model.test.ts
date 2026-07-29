import { describe, expect, it } from "vitest";

import {
  evaluationCasebookArtifactFilename,
  evaluationCasebookQualificationReceiptFilename,
  evaluationSuiteGateReceiptFilename,
} from "../src/evaluation-artifact-view-model";

describe("Evaluation artifact view model", () => {
  it("builds safe evaluation gate receipt filenames", () => {
    expect(
      evaluationSuiteGateReceiptFilename({
        contentSha256: "abcdef1234567890".padEnd(64, "0"),
        suite: {
          id: "suite:bad/path",
          revision: 4,
        },
      }),
    ).toBe("napier-gate-suite_bad_path-r4-abcdef123456.json");
  });

  it("builds safe casebook artifact filenames", () => {
    expect(
      evaluationCasebookArtifactFilename({
        contentSha256: "123456abcdef7890".padEnd(64, "0"),
        casebook: {
          id: "casebook:bad/path",
          currentRevision: 3,
        },
      }),
    ).toBe("napier-casebook-casebook_bad_path-r3-123456abcdef.json");
  });

  it("builds safe casebook qualification receipt filenames", () => {
    expect(
      evaluationCasebookQualificationReceiptFilename({
        contentSha256: "fedcba6543217890".padEnd(64, "0"),
        casebook: {
          id: "casebook:bad/path",
          currentRevision: 5,
        },
      }),
    ).toBe(
      "napier-casebook-qualification-casebook_bad_path-r5-fedcba654321.json",
    );
  });
});
