import type { ExecutionPlanReplanRecommendation } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { projectReplanDraftSummary } from "../src/replan-draft-view-model";

type ReplanDraftFixtureOverride = Partial<
  Omit<ExecutionPlanReplanRecommendation["draft"], "request" | "evaluation">
> & {
  request?: Partial<ExecutionPlanReplanRecommendation["draft"]["request"]>;
  evaluation?: Partial<
    ExecutionPlanReplanRecommendation["draft"]["evaluation"]
  >;
};

type ReplanRecommendationFixtureOverride = Partial<
  Omit<ExecutionPlanReplanRecommendation, "draft">
> & {
  draft?: ReplanDraftFixtureOverride;
};

describe("replan draft view model", () => {
  it("projects artifact drift replacement work before the operator applies it", () => {
    const recommendation = recommendationFixture({
      supersedeArtifactIds: ["artifact_report"],
      affectedArtifactIds: ["artifact_report"],
      draft: {
        request: {
          expectedRevision: 7,
          strategy: "artifact_drift",
          reason: "Artifact drift.",
          evidence: "Workspace digest changed.",
          supersedeArtifactIds: ["artifact_report"],
          addSteps: [
            {
              id: "restore-artifact_report",
              title: "Restore artifact_report",
              description: "Recreate the report.",
              verification: "Verify the report digest.",
            },
          ],
          addArtifacts: [
            {
              id: "replacement-artifact_report",
              path: "reports/summary.md",
              kind: "file",
              description: "Replacement report.",
            },
          ],
        },
      },
    });

    expect(projectReplanDraftSummary(recommendation)).toEqual({
      expectedRevision: 7,
      supersededStepIds: [],
      supersededArtifactIds: ["artifact_report"],
      addedSteps: [
        {
          id: "restore-artifact_report",
          title: "Restore artifact_report",
          dependsOn: [],
        },
      ],
      addedArtifacts: [
        {
          id: "replacement-artifact_report",
          path: "reports/summary.md",
          kind: "file",
        },
      ],
      dependencyUpdates: [],
      structuralChangeCount: 3,
      hasStructuralChanges: true,
    });
  });

  it("projects blocked-step recovery dependencies without requiring prose", () => {
    const recommendation = recommendationFixture({
      strategy: "recover_blocked",
      supersedeStepIds: ["blocked_step"],
      affectedStepIds: ["blocked_step", "downstream_step"],
      draft: {
        request: {
          expectedRevision: 4,
          strategy: "recover_blocked",
          reason: "Critical path blocked.",
          evidence: "The step cannot continue.",
          supersedeStepIds: ["blocked_step"],
          addSteps: [
            {
              id: "recover-blocked_step",
              title: "Recover blocked step",
              description: "Find replacement work.",
              verification: "Replacement path is verified.",
              dependsOn: ["prep_step"],
            },
          ],
          dependencyUpdates: [
            {
              stepId: "downstream_step",
              dependsOn: ["recover-blocked_step"],
            },
          ],
        },
      },
    });

    expect(projectReplanDraftSummary(recommendation)).toEqual(
      expect.objectContaining({
        expectedRevision: 4,
        supersededStepIds: ["blocked_step"],
        supersededArtifactIds: [],
        addedSteps: [
          {
            id: "recover-blocked_step",
            title: "Recover blocked step",
            dependsOn: ["prep_step"],
          },
        ],
        addedArtifacts: [],
        dependencyUpdates: [
          {
            stepId: "downstream_step",
            dependsOn: ["recover-blocked_step"],
          },
        ],
        structuralChangeCount: 3,
        hasStructuralChanges: true,
      }),
    );
  });
});

function recommendationFixture(
  overrides: ReplanRecommendationFixtureOverride = {},
): ExecutionPlanReplanRecommendation {
  const request = {
    expectedRevision: 1,
    strategy: overrides.strategy ?? "artifact_drift",
    reason: "Replan reason.",
    evidence: "Replan evidence.",
    ...overrides.draft?.request,
  } satisfies ExecutionPlanReplanRecommendation["draft"]["request"];
  const evaluation = {
    policyId: "napier.plan-replan-draft.v1",
    posture: "balanced",
    score: 100,
    risk: "low",
    maxDraftSteps: 2,
    addStepCount: request.addSteps?.length ?? 0,
    addArtifactCount: request.addArtifacts?.length ?? 0,
    dependencyUpdateCount: request.dependencyUpdates?.length ?? 0,
    supersedeStepCount: request.supersedeStepIds?.length ?? 0,
    supersedeArtifactCount: request.supersedeArtifactIds?.length ?? 0,
    checks: [],
    evaluationSha256: "e".repeat(64),
    ...overrides.draft?.evaluation,
  } satisfies ExecutionPlanReplanRecommendation["draft"]["evaluation"];
  const draft = {
    policyId: "napier.plan-replan-draft.v1",
    draftSha256: "d".repeat(64),
    ...overrides.draft,
    request,
    evaluation,
  } satisfies ExecutionPlanReplanRecommendation["draft"];
  const { draft: _draftOverride, ...recommendationOverrides } = overrides;
  return {
    strategy: request.strategy,
    reason: request.reason,
    evidence: request.evidence,
    expectedRevision: request.expectedRevision,
    supersedeStepIds: request.supersedeStepIds ?? [],
    supersedeArtifactIds: request.supersedeArtifactIds ?? [],
    affectedStepIds: [],
    affectedArtifactIds: [],
    recommendationSha256: "f".repeat(64),
    ...recommendationOverrides,
    draft,
  };
}
