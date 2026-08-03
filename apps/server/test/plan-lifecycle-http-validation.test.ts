import { describe, expect, it } from "vitest";

import {
  parseCreateExecutionPlanRequest,
  parseReplanExecutionPlanRequest,
  parseReviewExecutionPlanReplanDraftRequest,
  parseVerifyExecutionPlanArchiveRequest,
  parseVerifyExecutionPlanBlueprintRequest,
} from "../src/plan-lifecycle-http-validation.js";

describe("Plan lifecycle HTTP validation", () => {
  it("accepts exact bounded Plan steps and artifacts", () => {
    const request = {
      objective: "Ship one evidence-bound Plan.",
      steps: [
        {
          id: "inspect",
          title: "Inspect",
          description: "Inspect the current state.",
          verification: "Record a current-state hash.",
        },
        {
          id: "deliver",
          title: "Deliver",
          description: "Produce the reviewed output.",
          verification: "Verify the final artifact.",
          dependsOn: ["inspect"],
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "report.md",
          kind: "file",
          description: "The verified report.",
        },
      ],
    } as const;
    expect(parseCreateExecutionPlanRequest(request)).toEqual(request);
    expect(
      parseCreateExecutionPlanRequest({ ...request, unexpected: true }),
    ).toBeUndefined();
    expect(
      parseCreateExecutionPlanRequest({ ...request, steps: [] }),
    ).toBeUndefined();
  });

  it("requires a revision-bound Replan with at least one mutation", () => {
    expect(
      parseReplanExecutionPlanRequest({
        expectedRevision: 2,
        strategy: "scope_change",
        reason: "The accepted scope changed.",
        evidence: "Operator decision decision_12345678.",
        dependencyUpdates: [
          { stepId: "deliver", dependsOn: ["inspect", "review"] },
        ],
        addArtifacts: [
          {
            id: "review",
            path: "review.md",
            description: "Independent review evidence.",
          },
        ],
      }),
    ).toEqual({
      expectedRevision: 2,
      strategy: "scope_change",
      reason: "The accepted scope changed.",
      evidence: "Operator decision decision_12345678.",
      dependencyUpdates: [
        { stepId: "deliver", dependsOn: ["inspect", "review"] },
      ],
      addArtifacts: [
        {
          id: "review",
          path: "review.md",
          description: "Independent review evidence.",
        },
      ],
    });
    expect(
      parseReplanExecutionPlanRequest({
        expectedRevision: 2,
        strategy: "scope_change",
        reason: "No mutation.",
        evidence: "No mutation.",
      }),
    ).toBeUndefined();
  });

  it("preserves optional review bodies and normalized ModelRefs", () => {
    expect(parseReviewExecutionPlanReplanDraftRequest(undefined)).toEqual({});
    expect(
      parseReviewExecutionPlanReplanDraftRequest({
        model: { provider: " DeepSeek ", id: " deepseek-v4-flash " },
      }),
    ).toEqual({
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
    });
    expect(
      parseReviewExecutionPlanReplanDraftRequest({ extra: true }),
    ).toBeUndefined();
  });

  it("accepts only exact Archive and Blueprint wrappers", () => {
    const archive = { kind: "napier.execution-plan-archive" };
    const blueprint = { kind: "napier.execution-plan-blueprint" };
    expect(parseVerifyExecutionPlanArchiveRequest({ archive })).toEqual({
      archive,
    });
    expect(parseVerifyExecutionPlanBlueprintRequest({ blueprint })).toEqual({
      blueprint,
    });
    expect(
      parseVerifyExecutionPlanArchiveRequest({ archive, extra: true }),
    ).toBeUndefined();
    expect(
      parseVerifyExecutionPlanBlueprintRequest({ blueprint, extra: true }),
    ).toBeUndefined();
  });
});
