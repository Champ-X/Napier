import type {
  ExecutionPlan,
  ExecutionPlanReplanRecommendation,
  ExecutionPlanReplanRecord,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  projectReplanArtifactRoles,
  projectReplanDraftSummary,
  projectReplanHistorySummary,
  projectReplanRecoveryNextAction,
  projectReplanRecordSummary,
  projectReplanRecoveryProgress,
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

  it("projects latest replan recovery progress from current plan state", () => {
    const record = replanRecordFixture({
      addedStepIds: ["restore_step", "verify_step", "blocked_step"],
      addedArtifactIds: [
        "replacement_report",
        "replacement_data",
        "missing_data",
      ],
    });
    const plan = {
      steps: [
        stepFixture({ id: "restore_step", status: "completed" }),
        stepFixture({ id: "verify_step", status: "ready" }),
        stepFixture({ id: "blocked_step", status: "blocked" }),
        stepFixture({ id: "source_step", status: "completed" }),
      ],
      artifacts: [
        artifactFixture({ id: "replacement_report", status: "verified" }),
        artifactFixture({ id: "replacement_data", status: "produced" }),
        artifactFixture({ id: "missing_data", status: "missing" }),
        artifactFixture({ id: "source_report", status: "verified" }),
      ],
    } satisfies Pick<ExecutionPlan, "steps" | "artifacts">;

    expect(projectReplanRecoveryProgress(plan, record)).toEqual({
      addedStepCount: 3,
      settledStepCount: 1,
      readyStepIds: ["verify_step"],
      readyStepCount: 1,
      runningStepCount: 0,
      blockedStepCount: 1,
      addedArtifactCount: 3,
      verifiedArtifactCount: 1,
      producedArtifactCount: 1,
      missingArtifactCount: 1,
      pendingArtifactCount: 0,
      hasRecoveryWork: true,
      isComplete: false,
    });
    expect(projectReplanRecoveryProgress(plan, undefined)).toBeUndefined();
  });

  it("projects latest replan recovery next actions", () => {
    const base = {
      addedStepCount: 2,
      settledStepCount: 1,
      readyStepIds: ["verify_step"],
      readyStepCount: 1,
      runningStepCount: 0,
      blockedStepCount: 0,
      addedArtifactCount: 1,
      verifiedArtifactCount: 0,
      producedArtifactCount: 0,
      missingArtifactCount: 0,
      pendingArtifactCount: 1,
      hasRecoveryWork: true,
      isComplete: false,
    };

    expect(
      projectReplanRecoveryNextAction(base, {
        planStatus: "active",
        readyStepId: "verify_step",
        running: false,
      }),
    ).toEqual({
      action: "run_ready_step",
      canRun: true,
      readyStepId: "verify_step",
    });
    expect(
      projectReplanRecoveryNextAction(base, {
        planStatus: "active",
        readyStepId: "verify_step",
        running: true,
      }),
    ).toEqual({ action: "running", canRun: false });
    expect(
      projectReplanRecoveryNextAction(
        { ...base, readyStepIds: [], readyStepCount: 0, blockedStepCount: 1 },
        { planStatus: "active", readyStepId: undefined, running: false },
      ),
    ).toEqual({ action: "blocked", canRun: false });
    expect(
      projectReplanRecoveryNextAction(
        {
          ...base,
          readyStepIds: [],
          readyStepCount: 0,
          producedArtifactCount: 1,
          pendingArtifactCount: 0,
        },
        { planStatus: "active", readyStepId: undefined, running: false },
      ),
    ).toEqual({ action: "verify_artifacts", canRun: false });
    expect(
      projectReplanRecoveryNextAction(
        { ...base, readyStepIds: [], readyStepCount: 0 },
        { planStatus: "active", readyStepId: undefined, running: false },
      ),
    ).toEqual({ action: "produce_artifacts", canRun: false });
    expect(
      projectReplanRecoveryNextAction(
        {
          ...base,
          readyStepIds: ["verify_step"],
          pendingArtifactCount: 0,
        },
        { planStatus: "active", readyStepId: "other_step", running: false },
      ),
    ).toEqual({ action: "waiting", canRun: false });
    expect(
      projectReplanRecoveryNextAction(
        {
          ...base,
          settledStepCount: 2,
          verifiedArtifactCount: 1,
          isComplete: true,
        },
        { planStatus: "completed", readyStepId: undefined, running: false },
      ),
    ).toEqual({ action: "complete", canRun: false });
    expect(
      projectReplanRecoveryNextAction(undefined, {
        planStatus: "active",
        readyStepId: "verify_step",
        running: false,
      }),
    ).toEqual({ action: "unavailable", canRun: false });
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

function stepFixture(
  overrides: Partial<ExecutionPlan["steps"][number]> = {},
): ExecutionPlan["steps"][number] {
  return {
    id: "step_fixture",
    title: "Step fixture",
    description: "A fixture step.",
    verification: "Evidence exists.",
    dependsOn: [],
    status: "ready",
    evidence: "",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

function artifactFixture(
  overrides: Partial<ExecutionPlan["artifacts"][number]> = {},
): ExecutionPlan["artifacts"][number] {
  return {
    id: "artifact_fixture",
    path: "artifacts/fixture.md",
    kind: "file",
    description: "Artifact fixture.",
    status: "expected",
    evidence: "",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}
