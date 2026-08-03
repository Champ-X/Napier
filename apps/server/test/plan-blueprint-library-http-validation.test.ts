import { describe, expect, it } from "vitest";

import {
  parseSaveExecutionPlanBlueprintRequest,
  parseSelectExecutionPlanBlueprintRecordRequest,
  parseSetExecutionPlanBlueprintRecordStatusRequest,
} from "../src/plan-blueprint-library-http-validation.js";

describe("Plan Blueprint Library HTTP validation", () => {
  it("preserves bounded save metadata and rejects unknown fields", () => {
    const blueprint = { kind: "napier.execution-plan-blueprint" };
    expect(
      parseSaveExecutionPlanBlueprintRequest({
        blueprint,
        name: "  raw name  ",
        description: "",
      }),
    ).toEqual({
      blueprint,
      name: "  raw name  ",
      description: "",
    });
    expect(
      parseSaveExecutionPlanBlueprintRequest({
        blueprint,
        name: "",
      }),
    ).toBeUndefined();
    expect(
      parseSaveExecutionPlanBlueprintRequest({
        blueprint,
        unexpected: true,
      }),
    ).toBeUndefined();
  });

  it("normalizes selection objectives and bounds policy templates", () => {
    expect(
      parseSelectExecutionPlanBlueprintRecordRequest({
        objective: "  ship safely  ",
        policyTemplate: "delivery_first",
      }),
    ).toEqual({
      objective: "ship safely",
      policyTemplate: "delivery_first",
    });
    expect(
      parseSelectExecutionPlanBlueprintRecordRequest({
        objective: "   ",
      }),
    ).toBeUndefined();
    expect(
      parseSelectExecutionPlanBlueprintRecordRequest({
        policyTemplate: "fastest",
      }),
    ).toBeUndefined();
  });

  it("accepts only exact active or archived status requests", () => {
    expect(
      parseSetExecutionPlanBlueprintRecordStatusRequest({
        status: "archived",
      }),
    ).toEqual({ status: "archived" });
    expect(
      parseSetExecutionPlanBlueprintRecordStatusRequest({
        status: "active",
        reason: "restore",
      }),
    ).toBeUndefined();
  });
});
