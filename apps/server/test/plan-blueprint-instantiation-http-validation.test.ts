import { describe, expect, it } from "vitest";

import {
  parseCreateExecutionPlanFromBlueprintRecordRequest,
  parseCreateExecutionPlanFromBlueprintRequest,
} from "../src/plan-blueprint-instantiation-http-validation.js";

describe("Plan Blueprint instantiation HTTP validation", () => {
  it("preserves direct Blueprint objectives and rejects unknown fields", () => {
    const blueprint = { kind: "napier.execution-plan-blueprint" };
    expect(
      parseCreateExecutionPlanFromBlueprintRequest({
        blueprint,
        objective: "  preserve whitespace  ",
      }),
    ).toEqual({
      blueprint,
      objective: "  preserve whitespace  ",
    });
    expect(
      parseCreateExecutionPlanFromBlueprintRequest({
        blueprint,
        unexpected: true,
      }),
    ).toBeUndefined();
  });

  it("requires bounded Record IDs and exact preview digests", () => {
    expect(
      parseCreateExecutionPlanFromBlueprintRecordRequest({
        recordId: "blueprint_123",
        expectedPreviewSha256: "a".repeat(64),
      }),
    ).toEqual({
      recordId: "blueprint_123",
      expectedPreviewSha256: "a".repeat(64),
    });
    expect(
      parseCreateExecutionPlanFromBlueprintRecordRequest({
        recordId: "",
      }),
    ).toBeUndefined();
    expect(
      parseCreateExecutionPlanFromBlueprintRecordRequest({
        recordId: "blueprint_123",
        expectedPreviewSha256: "A".repeat(64),
      }),
    ).toBeUndefined();
  });
});
