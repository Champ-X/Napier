import type {
  ExecutionPlanReplanRecommendation,
  ExecutionPlanReplanRecord,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  projectReplanArtifactRoles,
  projectReplanDraftSummary,
  projectReplanHistorySummary,
  projectReplanRecordSummary,
  projectReplanStepRoles,
} from "../src/replan-draft-view-model";

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

  it("projects applied replan records as inspectable ledger structure", () => {
    const record = {
      id: "replan_123",
      strategy: "artifact_drift",
      reason: "Raw reason should not be needed by the projection.",
      evidence: "Raw evidence should not be needed by the projection.",
      supersededStepIds: ["step_old"],
      supersededArtifactIds: ["artifact_old"],
      dependencyUpdatedStepIds: ["step_downstream"],
      addedStepIds: ["restore-artifact_old"],
      addedArtifactIds: ["replacement-artifact_old"],
      addedStepsSha256: "a".repeat(64),
      addedArtifactsSha256: "b".repeat(64),
      dependencyUpdatesSha256: "c".repeat(64),
      fromRevision: 4,
      toRevision: 5,
      replanSha256: "d".repeat(64),
      createdAt: "2026-07-29T00:00:00.000Z",
    } satisfies ExecutionPlanReplanRecord;

    expect(projectReplanRecordSummary(record)).toEqual({
      supersededStepIds: ["step_old"],
      supersededArtifactIds: ["artifact_old"],
      addedStepIds: ["restore-artifact_old"],
      addedArtifactIds: ["replacement-artifact_old"],
      dependencyUpdatedStepIds: ["step_downstream"],
      structuralChangeCount: 5,
      hasStructuralChanges: true,
      addedStepsSha256: "a".repeat(64),
      addedArtifactsSha256: "b".repeat(64),
      dependencyUpdatesSha256: "c".repeat(64),
      replanSha256: "d".repeat(64),
    });
  });

  it("projects multi-replan history without prose fields", () => {
    const history = projectReplanHistorySummary([
      replanRecordFixture({
        id: "replan_first",
        fromRevision: 1,
        toRevision: 2,
        addedStepIds: ["recover_first"],
        replanSha256: "1".repeat(64),
      }),
      replanRecordFixture({
        id: "replan_second",
        strategy: "recover_blocked",
        fromRevision: 2,
        toRevision: 3,
        supersededStepIds: ["blocked_step"],
        dependencyUpdatedStepIds: ["downstream_step"],
        replanSha256: "2".repeat(64),
      }),
    ]);

    expect(history).toEqual({
      recordCount: 2,
      totalStructuralChangeCount: 3,
      records: [
        {
          id: "replan_first",
          strategy: "artifact_drift",
          fromRevision: 1,
          toRevision: 2,
          structuralChangeCount: 1,
          replanSha256: "1".repeat(64),
        },
        {
          id: "replan_second",
          strategy: "recover_blocked",
          fromRevision: 2,
          toRevision: 3,
          structuralChangeCount: 2,
          replanSha256: "2".repeat(64),
        },
      ],
      hasHistory: true,
      hasMultipleRecords: true,
    });
    expect(JSON.stringify(history)).not.toContain("Raw reason");
    expect(JSON.stringify(history)).not.toContain("Raw evidence");
  });

  it("projects latest replan entity roles for step and artifact cards", () => {
    const record = replanRecordFixture({
      addedStepIds: ["restore_step"],
      supersededStepIds: ["blocked_step"],
      dependencyUpdatedStepIds: ["downstream_step"],
      addedArtifactIds: ["replacement_report"],
      supersededArtifactIds: ["old_report"],
    });

    expect(projectReplanStepRoles("restore_step", record)).toEqual(["added"]);
    expect(projectReplanStepRoles("downstream_step", record)).toEqual([
      "dependency_updated",
    ]);
    expect(projectReplanStepRoles("blocked_step", record)).toEqual([
      "superseded",
    ]);
    expect(projectReplanStepRoles("unrelated_step", record)).toEqual([]);
    expect(projectReplanStepRoles("restore_step", undefined)).toEqual([]);
    expect(projectReplanArtifactRoles("replacement_report", record)).toEqual([
      "added",
    ]);
    expect(projectReplanArtifactRoles("old_report", record)).toEqual([
      "superseded",
    ]);
    expect(projectReplanArtifactRoles("unrelated_report", record)).toEqual([]);
    expect(projectReplanArtifactRoles("old_report", undefined)).toEqual([]);
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

function replanRecordFixture(
  overrides: Partial<ExecutionPlanReplanRecord> = {},
): ExecutionPlanReplanRecord {
  return {
    id: "replan_fixture",
    strategy: "artifact_drift",
    reason: "Raw reason should not enter the history projection.",
    evidence: "Raw evidence should not enter the history projection.",
    supersededStepIds: [],
    supersededArtifactIds: [],
    dependencyUpdatedStepIds: [],
    addedStepIds: [],
    addedArtifactIds: [],
    addedStepsSha256: "a".repeat(64),
    addedArtifactsSha256: "b".repeat(64),
    dependencyUpdatesSha256: "c".repeat(64),
    fromRevision: 1,
    toRevision: 2,
    replanSha256: "d".repeat(64),
    createdAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}
