import { describe, expect, it } from "vitest";

import {
  executionPlanArchiveFilename,
  executionPlanBlueprintFilename,
} from "../src/plan-archive-artifact-view-model";

describe("Plan archive artifact view model", () => {
  it("builds safe execution plan archive filenames", () => {
    expect(
      executionPlanArchiveFilename({
        contentSha256: "abcdef1234567890".padEnd(64, "0"),
        plan: {
          id: "plan:bad/path",
          revision: 7,
        },
      }),
    ).toBe("napier-plan-plan_bad_path-r7-abcdef123456.json");
  });

  it("builds safe execution plan blueprint filenames", () => {
    expect(
      executionPlanBlueprintFilename({
        contentSha256: "123456abcdef7890".padEnd(64, "0"),
        source: {
          planId: "plan:bad/path",
          planRevision: 5,
        },
      }),
    ).toBe("napier-plan-blueprint-plan_bad_path-r5-123456abcdef.json");
  });
});
