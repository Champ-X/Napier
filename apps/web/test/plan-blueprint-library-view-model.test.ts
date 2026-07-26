import type {
  ExecutionPlan,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ExecutionPlanBlueprintRecordReplayEventVerification,
  ExecutionPlanBlueprintRecordReplayHistory,
  ExecutionPlanBlueprintRecordReplayHistoryVerification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
  ExecutionPlanBlueprintRecordReplayOutcomesVerification,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  VerifyExecutionPlanBlueprintRecordReplayEventRequest,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  planBlueprintCreatedReceipt,
  planBlueprintOutcomeBaselineReceipt,
  planBlueprintOutcomeQualificationReceipt,
  planBlueprintPreviewReceipt,
  planBlueprintQualificationReceipt,
  planBlueprintReplayHistoryReceipt,
  planBlueprintReplayHistoryVerificationReceipt,
  planBlueprintReplayOutcomesReceipt,
  planBlueprintReplayOutcomesVerificationReceipt,
} from "../src/plan-blueprint-library-view-model";

const record = {
  id: "blueprint_12345678",
  blueprintSha256: "a".repeat(64),
};

const plan = {
  id: "plan_12345678",
  steps: [{ id: "inspect" }, { id: "apply" }],
  artifacts: [{ id: "report" }],
};

const replayEvent: VerifyExecutionPlanBlueprintRecordReplayEventRequest = {
  threadId: "thread_12345678",
  eventId: "event_12345678",
  seq: 7,
  eventSha256: "b".repeat(64),
};

describe("Plan blueprint library view model", () => {
  it("projects a valid create-from-template replay event verification", () => {
    const verification: ExecutionPlanBlueprintRecordReplayEventVerification = {
      schemaVersion: 1,
      status: "valid",
      diagnostics: [],
      expectedRecordId: record.id,
      threadId: replayEvent.threadId,
      eventId: replayEvent.eventId,
      seq: replayEvent.seq,
      declaredEventSha256: replayEvent.eventSha256,
      observedEventSha256: replayEvent.eventSha256,
      contentSha256: "c".repeat(64),
    };

    expect(
      planBlueprintCreatedReceipt({
        record,
        plan,
        replayEvent,
        replayEventVerification: verification,
      }),
    ).toEqual({
      action: "created",
      recordId: record.id,
      blueprintSha256: record.blueprintSha256,
      planId: plan.id,
      stepCount: 2,
      artifactCount: 1,
      replayEventId: replayEvent.eventId,
      replayEventSha256: replayEvent.eventSha256,
      replayEventVerificationStatus: "valid",
      replayEventVerificationSha256: verification.contentSha256,
      replayEventDiagnostics: [],
    });
  });

  it("makes a missing replay event anchor fail visible", () => {
    expect(planBlueprintCreatedReceipt({ record, plan })).toEqual(
      expect.objectContaining({
        action: "created",
        planId: plan.id,
        replayEventVerificationStatus: "invalid",
        replayEventDiagnostics: ["replay_event_anchor_missing"],
      }),
    );
  });

  it("makes a verifier transport failure fail visible while retaining the anchor", () => {
    expect(
      planBlueprintCreatedReceipt({
        record,
        plan,
        replayEvent,
        replayEventDiagnostics: ["Request failed (HTTP 500)"],
      }),
    ).toEqual(
      expect.objectContaining({
        replayEventId: replayEvent.eventId,
        replayEventSha256: replayEvent.eventSha256,
        replayEventVerificationStatus: "invalid",
        replayEventDiagnostics: ["Request failed (HTTP 500)"],
      }),
    );
  });

  it("summarizes replay history from the latest replay only", () => {
    const history: ExecutionPlanBlueprintRecordReplayHistory = {
      kind: "napier.execution-plan-blueprint-replay-history",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      generatedAt: "2026-07-26T00:00:00.000Z",
      recordId: record.id,
      replayCount: 2,
      threadCount: 1,
      planCount: 2,
      eventSetSha256: "d".repeat(64),
      firstSeq: 1,
      lastSeq: 2,
      replays: [
        replayHistoryEntry("plan_old", 1, "e".repeat(64), 1, 0),
        replayHistoryEntry("plan_new", 2, "f".repeat(64), 3, 1),
      ],
      contentSha256: "1".repeat(64),
    };

    expect(planBlueprintReplayHistoryReceipt(history)).toEqual({
      action: "history",
      recordId: record.id,
      contentSha256: history.contentSha256,
      eventSetSha256: history.eventSetSha256,
      replayCount: 2,
      threadCount: 1,
      planCount: 2,
      latestPlanId: "plan_new",
      latestPreviewSha256: "f".repeat(64),
      stepCount: 3,
      artifactCount: 1,
    });
  });

  it("summarizes an empty replay history without optional latest fields", () => {
    const history: ExecutionPlanBlueprintRecordReplayHistory = {
      kind: "napier.execution-plan-blueprint-replay-history",
      schemaVersion: 1,
      apiVersion: "2026-07-25",
      generatedAt: "2026-07-26T00:00:00.000Z",
      recordId: record.id,
      replayCount: 0,
      threadCount: 0,
      planCount: 0,
      eventSetSha256: "0".repeat(64),
      replays: [],
      contentSha256: "1".repeat(64),
    };

    expect(planBlueprintReplayHistoryReceipt(history)).toEqual({
      action: "history",
      recordId: record.id,
      contentSha256: history.contentSha256,
      eventSetSha256: history.eventSetSha256,
      replayCount: 0,
      threadCount: 0,
      planCount: 0,
      stepCount: 0,
      artifactCount: 0,
    });
  });

  it("prefers observed replay verification counts over declared counts", () => {
    const verification: ExecutionPlanBlueprintRecordReplayHistoryVerification =
      {
        schemaVersion: 1,
        status: "invalid",
        diagnostics: ["replay_count_mismatch"],
        recordId: record.id,
        expectedRecordId: record.id,
        declaredContentSha256: "1".repeat(64),
        recomputedContentSha256: "2".repeat(64),
        observedContentSha256: "3".repeat(64),
        declaredEventSetSha256: "4".repeat(64),
        observedEventSetSha256: "5".repeat(64),
        replayCount: 99,
        observedReplayCount: 2,
        threadCount: 99,
        observedThreadCount: 1,
        planCount: 99,
        observedPlanCount: 2,
        contentSha256: "6".repeat(64),
      };

    expect(planBlueprintReplayHistoryVerificationReceipt(verification)).toEqual(
      {
        action: "historyVerified",
        recordId: record.id,
        verificationStatus: "invalid",
        diagnostics: ["replay_count_mismatch"],
        contentSha256: verification.contentSha256,
        declaredContentSha256: verification.declaredContentSha256,
        observedContentSha256: verification.observedContentSha256,
        declaredEventSetSha256: verification.declaredEventSetSha256,
        observedEventSetSha256: verification.observedEventSetSha256,
        replayCount: 2,
        threadCount: 1,
        planCount: 2,
      },
    );
  });

  it("summarizes replay delivery outcomes and the latest plan state", () => {
    const outcomes = replayOutcomesFixture();

    expect(planBlueprintReplayOutcomesReceipt(outcomes)).toEqual({
      action: "outcomes",
      recordId: record.id,
      contentSha256: outcomes.contentSha256,
      replayHistorySha256: outcomes.replayHistorySha256,
      outcomeSetSha256: outcomes.outcomeSetSha256,
      replayCount: 2,
      activeCount: 0,
      completedCount: 1,
      blockedCount: 1,
      cancelledCount: 0,
      invalidCount: 0,
      completionRateBps: 5_000,
      latestPlanId: "plan_blocked",
      latestStatus: "blocked",
    });
  });

  it("prefers observed replay outcome verification counts", () => {
    const verification: ExecutionPlanBlueprintRecordReplayOutcomesVerification =
      {
        schemaVersion: 1,
        status: "invalid",
        diagnostics: ["completed_count_mismatch"],
        recordId: record.id,
        expectedRecordId: record.id,
        declaredContentSha256: "1".repeat(64),
        recomputedContentSha256: "2".repeat(64),
        observedContentSha256: "3".repeat(64),
        declaredOutcomeSetSha256: "4".repeat(64),
        observedOutcomeSetSha256: "5".repeat(64),
        replayCount: 99,
        observedReplayCount: 2,
        completedCount: 99,
        observedCompletedCount: 1,
        blockedCount: 99,
        observedBlockedCount: 1,
        invalidCount: 99,
        observedInvalidCount: 0,
        contentSha256: "6".repeat(64),
      };

    expect(
      planBlueprintReplayOutcomesVerificationReceipt(verification),
    ).toEqual({
      action: "outcomesVerified",
      recordId: record.id,
      verificationStatus: "invalid",
      diagnostics: ["completed_count_mismatch"],
      contentSha256: verification.contentSha256,
      declaredContentSha256: verification.declaredContentSha256,
      observedContentSha256: verification.observedContentSha256,
      declaredOutcomeSetSha256: verification.declaredOutcomeSetSha256,
      observedOutcomeSetSha256: verification.observedOutcomeSetSha256,
      replayCount: 2,
      completedCount: 1,
      blockedCount: 1,
      invalidCount: 0,
    });
  });

  it("projects replay outcome baseline promotion receipts", () => {
    const outcomes = replayOutcomesFixture();
    const result: PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult = {
      created: true,
      baseline: {
        id: "outcome_base_1234567890abcdef1234",
        recordId: record.id,
        replayOutcomesSha256: outcomes.contentSha256,
        replayHistorySha256: outcomes.replayHistorySha256,
        outcomeSetSha256: outcomes.outcomeSetSha256,
        replayCount: outcomes.replayCount,
        completedCount: outcomes.completedCount,
        blockedCount: outcomes.blockedCount,
        invalidCount: outcomes.invalidCount,
        completionRateBps: outcomes.completionRateBps,
        policy: {
          minReplayCount: 1,
          minCompletionRateBps: 5_000,
          maxBlockedCount: 1,
          maxInvalidCount: 0,
        },
        promotedAt: "2026-07-26T00:00:04.000Z",
        contentSha256: "8".repeat(64),
      },
    };

    expect(planBlueprintOutcomeBaselineReceipt(result)).toEqual({
      action: "outcomeBaseline",
      recordId: record.id,
      baselineId: result.baseline.id,
      baselineSha256: result.baseline.contentSha256,
      replayOutcomesSha256: outcomes.contentSha256,
      created: true,
      replayCount: 2,
      completedCount: 1,
      blockedCount: 1,
      invalidCount: 0,
      completionRateBps: 5_000,
      minCompletionRateBps: 5_000,
    });
  });

  it("projects replay outcome qualification diagnostics", () => {
    const outcomes = replayOutcomesFixture();
    const qualification: ExecutionPlanBlueprintRecordOutcomeQualification = {
      schemaVersion: 1,
      status: "policy_failed",
      diagnostics: ["completion_rate_below_min"],
      recordId: record.id,
      baselineId: "outcome_base_1234567890abcdef1234",
      baselineSha256: "8".repeat(64),
      baselineOutcomesSha256: outcomes.contentSha256,
      currentOutcomesSha256: outcomes.contentSha256,
      currentReplayHistorySha256: outcomes.replayHistorySha256,
      currentOutcomeSetSha256: outcomes.outcomeSetSha256,
      replayCount: outcomes.replayCount,
      completedCount: outcomes.completedCount,
      blockedCount: outcomes.blockedCount,
      invalidCount: outcomes.invalidCount,
      completionRateBps: outcomes.completionRateBps,
      policy: {
        minReplayCount: 1,
        minCompletionRateBps: 10_000,
        maxBlockedCount: 1,
        maxInvalidCount: 0,
      },
      contentSha256: "9".repeat(64),
    };

    expect(planBlueprintOutcomeQualificationReceipt(qualification)).toEqual({
      action: "outcomeQualified",
      recordId: record.id,
      qualificationStatus: "policy_failed",
      diagnostics: ["completion_rate_below_min"],
      contentSha256: qualification.contentSha256,
      baselineId: qualification.baselineId,
      baselineSha256: qualification.baselineSha256,
      currentOutcomesSha256: outcomes.contentSha256,
      replayCount: 2,
      completedCount: 1,
      blockedCount: 1,
      invalidCount: 0,
      completionRateBps: 5_000,
      minCompletionRateBps: 10_000,
    });
  });

  it("projects blueprint record qualification hash evidence", () => {
    const qualification = qualificationFixture({
      status: "source_drift",
      diagnostics: ["source_drift"],
    });

    expect(planBlueprintQualificationReceipt(qualification)).toEqual({
      action: "qualified",
      recordId: record.id,
      qualificationStatus: "source_drift",
      diagnostics: ["source_drift"],
      blueprintSha256: record.blueprintSha256,
      expectedPlanArchiveSha256: qualification.expectedPlanArchiveSha256,
      actualPlanArchiveSha256: qualification.actualPlanArchiveSha256,
      stepCount: 2,
      artifactCount: 1,
    });
  });

  it("projects ready previews from the unpersisted plan shape", () => {
    const preview: ExecutionPlanBlueprintRecordPreview = {
      status: "ready",
      diagnostics: [],
      threadId: replayEvent.threadId,
      recordId: record.id,
      qualification: qualificationFixture(),
      hasOpenPlan: false,
      plan: executionPlanFixture(),
      previewSha256: "d".repeat(64),
    };

    expect(planBlueprintPreviewReceipt(preview)).toEqual({
      action: "previewed",
      recordId: record.id,
      previewStatus: "ready",
      qualificationStatus: "qualified",
      diagnostics: [],
      planId: "plan_preview",
      blueprintSha256: record.blueprintSha256,
      stepCount: 3,
      artifactCount: 2,
    });
  });

  it("projects blocked previews from qualification counts when no plan exists", () => {
    const preview: ExecutionPlanBlueprintRecordPreview = {
      status: "blocked",
      diagnostics: ["thread_has_open_plan"],
      threadId: replayEvent.threadId,
      recordId: record.id,
      qualification: qualificationFixture(),
      hasOpenPlan: true,
      previewSha256: "d".repeat(64),
    };

    expect(planBlueprintPreviewReceipt(preview)).toEqual({
      action: "previewed",
      recordId: record.id,
      previewStatus: "blocked",
      qualificationStatus: "qualified",
      diagnostics: ["thread_has_open_plan"],
      blueprintSha256: record.blueprintSha256,
      stepCount: 2,
      artifactCount: 1,
    });
  });
});

function replayOutcomesFixture(): ExecutionPlanBlueprintRecordReplayOutcomes {
  return {
    kind: "napier.execution-plan-blueprint-replay-outcomes",
    schemaVersion: 1,
    apiVersion: "2026-07-25",
    generatedAt: "2026-07-26T00:00:03.000Z",
    recordId: record.id,
    replayHistorySha256: "1".repeat(64),
    replayCount: 2,
    activeCount: 0,
    completedCount: 1,
    blockedCount: 1,
    cancelledCount: 0,
    invalidCount: 0,
    completionRateBps: 5_000,
    outcomeSetSha256: "2".repeat(64),
    outcomes: [
      {
        replayEventId: "event_00000001",
        replayEventSeq: 1,
        threadId: replayEvent.threadId,
        planId: "plan_completed",
        createdAt: "2026-07-26T00:00:01.000Z",
        status: "completed",
        planRevision: 4,
        stepCount: 2,
        completedStepCount: 2,
        skippedStepCount: 0,
        blockedStepCount: 0,
        artifactCount: 1,
        verifiedArtifactCount: 1,
        missingArtifactCount: 0,
        replanCount: 0,
        planProjectionSha256: "3".repeat(64),
        outcomeSha256: "4".repeat(64),
      },
      {
        replayEventId: "event_00000002",
        replayEventSeq: 2,
        threadId: replayEvent.threadId,
        planId: "plan_blocked",
        createdAt: "2026-07-26T00:00:02.000Z",
        status: "blocked",
        planRevision: 3,
        stepCount: 2,
        completedStepCount: 1,
        skippedStepCount: 0,
        blockedStepCount: 1,
        artifactCount: 1,
        verifiedArtifactCount: 0,
        missingArtifactCount: 1,
        replanCount: 1,
        planProjectionSha256: "5".repeat(64),
        outcomeSha256: "6".repeat(64),
      },
    ],
    contentSha256: "7".repeat(64),
  };
}

function replayHistoryEntry(
  planId: string,
  seq: number,
  previewSha256: string,
  stepCount: number,
  artifactCount: number,
): ExecutionPlanBlueprintRecordReplayHistory["replays"][number] {
  return {
    eventId: `event_${seq.toString().padStart(8, "0")}`,
    threadId: replayEvent.threadId,
    runId: "runctl_12345678",
    seq,
    createdAt: `2026-07-26T00:00:0${seq}.000Z`,
    recordId: record.id,
    planId,
    objectiveSha256: "7".repeat(64),
    status: "active",
    stepCount,
    artifactCount,
    blueprintSha256: record.blueprintSha256,
    sourcePlanId: "plan_source",
    sourcePlanRevision: 1,
    sourcePlanArchiveSha256: "8".repeat(64),
    qualificationStatus: "qualified",
    qualificationSha256: "9".repeat(64),
    qualificationDiagnosticsSha256: "a".repeat(64),
    previewSha256,
  };
}

function qualificationFixture(
  overrides: Partial<ExecutionPlanBlueprintRecordQualification> = {},
): ExecutionPlanBlueprintRecordQualification {
  return {
    status: "qualified",
    diagnostics: [],
    recordId: record.id,
    recordStatus: "active",
    blueprintSha256: record.blueprintSha256,
    sourceThreadId: replayEvent.threadId,
    sourcePlanId: "plan_source",
    sourcePlanRevision: 1,
    expectedPlanArchiveSha256: "b".repeat(64),
    expectedEventStreamSha256: "c".repeat(64),
    actualSourcePlanRevision: 1,
    actualPlanArchiveSha256: "d".repeat(64),
    actualEventStreamSha256: "e".repeat(64),
    stepCount: 2,
    artifactCount: 1,
    qualifiedAt: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

function executionPlanFixture(): ExecutionPlan {
  const timestamp = "2026-07-26T00:00:00.000Z";
  return {
    id: "plan_preview",
    threadId: replayEvent.threadId,
    objective: "Preview a reusable workflow.",
    status: "active",
    steps: [
      planStepFixture("inspect"),
      planStepFixture("apply"),
      planStepFixture("audit"),
    ],
    artifacts: [
      artifactFixture("report", "artifacts/report.md"),
      artifactFixture("trace", "artifacts/trace.json"),
    ],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: ["inspect", "apply", "audit"],
    readyStepIds: ["inspect"],
    blockedStepIds: [],
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function planStepFixture(id: string): ExecutionPlan["steps"][number] {
  const timestamp = "2026-07-26T00:00:00.000Z";
  return {
    id,
    title: id,
    description: `${id} step`,
    verification: `${id} verified`,
    dependsOn: [],
    status: "ready",
    evidence: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function artifactFixture(
  id: string,
  path: string,
): ExecutionPlan["artifacts"][number] {
  const timestamp = "2026-07-26T00:00:00.000Z";
  return {
    id,
    path,
    kind: "file",
    description: `${id} artifact`,
    status: "expected",
    evidence: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
