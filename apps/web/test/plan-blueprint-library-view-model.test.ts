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
  ExecutionPlanBlueprintRecordOutcomeReview,
  ExecutionPlanBlueprintPortfolioCalibration,
  ExecutionPlanBlueprintRecommendationPolicyBacktest,
  ExecutionPlanBlueprintRecommendationPolicyOverride,
  ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  ExecutionPlanBlueprintRecordSelection,
  PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult,
  RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  VerifyExecutionPlanBlueprintRecordReplayEventRequest,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  planBlueprintCreatedReceipt,
  planBlueprintOutcomeBaselineReceipt,
  planBlueprintOutcomeQualificationReceipt,
  planBlueprintOutcomeReviewReceipt,
  planBlueprintPortfolioCalibrationReceipt,
  planBlueprintPreviewReceipt,
  planBlueprintQualificationReceipt,
  planBlueprintRecommendationPolicyBacktestReceipt,
  planBlueprintRecommendationPolicyOverrideReceipt,
  planBlueprintRecommendationPolicyOverrideDriftReviewReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementHistoryReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationReceipt,
  planBlueprintRecommendationPolicyOverrideRetirementReceipt,
  planBlueprintReplayHistoryReceipt,
  planBlueprintReplayHistoryVerificationReceipt,
  planBlueprintReplayOutcomesReceipt,
  planBlueprintReplayOutcomesVerificationReceipt,
  planBlueprintSelectionReceipt,
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

    const reviewedResult: PromoteExecutionPlanBlueprintRecordOutcomeBaselineResult =
      {
        created: true,
        baseline: {
          ...result.baseline,
          id: "outcome_base_reviewed123456789",
          reviewGate: {
            minScore: 80,
            maxRisk: "medium",
          },
          reviewSha256: "a".repeat(64),
          reviewInputSha256: "b".repeat(64),
          reviewResponseSha256: "c".repeat(64),
          reviewVerdict: "promote",
          reviewScore: 91,
          reviewRisk: "low",
          reviewModel: { provider: "faux-review", id: "faux-1" },
          supersedesBaselineId: result.baseline.id,
          contentSha256: "9".repeat(64),
        },
      };

    expect(planBlueprintOutcomeBaselineReceipt(reviewedResult)).toEqual({
      action: "outcomeBaseline",
      recordId: record.id,
      baselineId: reviewedResult.baseline.id,
      baselineSha256: reviewedResult.baseline.contentSha256,
      replayOutcomesSha256: outcomes.contentSha256,
      created: true,
      replayCount: 2,
      completedCount: 1,
      blockedCount: 1,
      invalidCount: 0,
      completionRateBps: 5_000,
      minCompletionRateBps: 5_000,
      reviewGateMinScore: 80,
      reviewGateMaxRisk: "medium",
      reviewSha256: "a".repeat(64),
      reviewVerdict: "promote",
      reviewScore: 91,
      reviewRisk: "low",
      reviewModel: "faux-review/faux-1",
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

  it("projects replay outcome model review receipts", () => {
    const outcomes = replayOutcomesFixture();
    const review: ExecutionPlanBlueprintRecordOutcomeReview = {
      kind: "napier.execution-plan-blueprint-outcome-review",
      schemaVersion: 1,
      policyId: "napier.blueprint-outcome-review.v1",
      recordId: record.id,
      blueprintSha256: record.blueprintSha256,
      model: { provider: "napier", id: "demo" },
      criteria: {
        name: "Reusable workflow delivery",
        criteria: [
          {
            id: "completion",
            name: "Completion",
            description: "The workflow completes.",
          },
          {
            id: "auditability",
            name: "Auditability",
            description: "The workflow is hash-bound.",
          },
        ],
      },
      verdict: "revise",
      score: 62,
      risk: "medium",
      reason: "Replay volume is low.",
      concerns: ["collect_more_replays"],
      scores: [
        {
          criterionId: "completion",
          score: 80,
          reason: "One replay completed.",
        },
      ],
      sourceQualificationStatus: "qualified",
      outcomeQualificationStatus: "qualified",
      replayOutcomesSha256: outcomes.contentSha256,
      replayHistorySha256: outcomes.replayHistorySha256,
      outcomeSetSha256: outcomes.outcomeSetSha256,
      replayCount: outcomes.replayCount,
      completedCount: outcomes.completedCount,
      blockedCount: outcomes.blockedCount,
      invalidCount: outcomes.invalidCount,
      completionRateBps: outcomes.completionRateBps,
      baselineSha256: "8".repeat(64),
      inputSha256: "a".repeat(64),
      promptSha256: "b".repeat(64),
      responseSha256: "c".repeat(64),
      reviewSchemaSha256: "d".repeat(64),
      reviewSha256: "e".repeat(64),
      createdAt: "2026-07-26T00:00:04.000Z",
    };

    expect(planBlueprintOutcomeReviewReceipt(review)).toEqual({
      action: "outcomeReviewed",
      recordId: record.id,
      verdict: "revise",
      risk: "medium",
      score: 62,
      reviewSha256: review.reviewSha256,
      inputSha256: review.inputSha256,
      responseSha256: review.responseSha256,
      replayOutcomesSha256: outcomes.contentSha256,
      baselineSha256: "8".repeat(64),
      replayCount: 2,
      completedCount: 1,
      blockedCount: 1,
      invalidCount: 0,
      completionRateBps: 5_000,
      concerns: ["collect_more_replays"],
    });
  });

  it("projects adaptive template selection receipts", () => {
    const outcomes = replayOutcomesFixture();
    const selection: ExecutionPlanBlueprintRecordSelection = {
      kind: "napier.execution-plan-blueprint-selection",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-26T00:00:05.000Z",
      threadId: "thread_12345678",
      candidateCount: 2,
      qualifiedCandidateCount: 1,
      rejectedCandidateCount: 1,
      selectedRecordId: record.id,
      selectedPreviewSha256: "a".repeat(64),
      selectedBaselineId: "outcome_base_1234567890abcdef1234",
      selectedBaselineSha256: "b".repeat(64),
      selectedScoreBps: 5_000,
      selectedFamilySha256: "3".repeat(64),
      selectedFamilyCompletionRateBps: 5_000,
      selectedRecommendationScoreBps: 5_450,
      selectedRecommendationPolicyTemplate: "balanced",
      selectedRecommendationPolicySha256: "6".repeat(64),
      selectedRecommendationPolicySource: "default",
      recommendationPolicy: {
        templateId: "balanced",
        weights: {
          outcomeCompletionBps: 5_000,
          familyCompletionBps: 2_500,
          reviewedBaselineBps: 1_500,
          replayEvidenceBps: 1_000,
        },
      },
      recommendationPolicySha256: "6".repeat(64),
      familyPolicyOverrideCount: 0,
      familyPolicyOverrideSetSha256: "7".repeat(64),
      portfolioSetSha256: "4".repeat(64),
      selectionSetSha256: "c".repeat(64),
      candidates: [
        {
          recordId: record.id,
          recordStatus: "active",
          recordUpdatedAt: "2026-07-26T00:00:04.000Z",
          selectionStatus: "selected",
          diagnostics: [],
          blueprintSha256: record.blueprintSha256,
          familySha256: "3".repeat(64),
          sourceQualificationStatus: "qualified",
          outcomeQualificationStatus: "qualified",
          familyRecordCount: 1,
          familyOutcomeQualifiedCount: 1,
          familyReviewedBaselineCount: 1,
          familyCompletionRateBps: 5_000,
          recommendationScoreBps: 5_450,
          recommendationPolicyTemplate: "balanced",
          recommendationPolicySha256: "6".repeat(64),
          recommendationPolicySource: "default",
          previewStatus: "ready",
          previewSha256: "a".repeat(64),
          baselineId: "outcome_base_1234567890abcdef1234",
          baselineSha256: "b".repeat(64),
          baselineOutcomesSha256: outcomes.contentSha256,
          baselinePromotedAt: "2026-07-26T00:00:03.000Z",
          currentOutcomesSha256: outcomes.contentSha256,
          currentReplayHistorySha256: outcomes.replayHistorySha256,
          currentOutcomeSetSha256: outcomes.outcomeSetSha256,
          scoreBps: 5_000,
          replayCount: outcomes.replayCount,
          completedCount: outcomes.completedCount,
          blockedCount: outcomes.blockedCount,
          invalidCount: outcomes.invalidCount,
          completionRateBps: outcomes.completionRateBps,
          stepCount: 2,
          artifactCount: 1,
        },
        {
          recordId: "blueprint_rejected",
          recordStatus: "active",
          recordUpdatedAt: "2026-07-26T00:00:02.000Z",
          selectionStatus: "rejected",
          diagnostics: ["outcome_policy_failed"],
          blueprintSha256: "d".repeat(64),
          familySha256: "5".repeat(64),
          sourceQualificationStatus: "qualified",
          outcomeQualificationStatus: "policy_failed",
          familyRecordCount: 1,
          familyOutcomeQualifiedCount: 0,
          familyReviewedBaselineCount: 0,
          familyCompletionRateBps: 0,
          recommendationScoreBps: 0,
          recommendationPolicyTemplate: "balanced",
          recommendationPolicySha256: "6".repeat(64),
          recommendationPolicySource: "default",
          currentOutcomesSha256: "e".repeat(64),
          currentReplayHistorySha256: "f".repeat(64),
          currentOutcomeSetSha256: "1".repeat(64),
          scoreBps: 0,
          replayCount: 1,
          completedCount: 0,
          blockedCount: 1,
          invalidCount: 0,
          completionRateBps: 0,
          stepCount: 1,
          artifactCount: 0,
        },
      ],
      contentSha256: "2".repeat(64),
    };

    expect(planBlueprintSelectionReceipt(selection)).toEqual({
      action: "selection",
      threadId: "thread_12345678",
      contentSha256: selection.contentSha256,
      portfolioSetSha256: selection.portfolioSetSha256,
      selectionSetSha256: selection.selectionSetSha256,
      candidateCount: 2,
      qualifiedCandidateCount: 1,
      rejectedCandidateCount: 1,
      selectedRecordId: record.id,
      selectedPreviewSha256: "a".repeat(64),
      selectedBaselineSha256: "b".repeat(64),
      selectedScoreBps: 5_000,
      selectedFamilySha256: "3".repeat(64),
      selectedFamilyCompletionRateBps: 5_000,
      selectedRecommendationScoreBps: 5_450,
      recommendationPolicyTemplate: "balanced",
      recommendationPolicySha256: "6".repeat(64),
      selectedRecommendationPolicyTemplate: "balanced",
      selectedRecommendationPolicySha256: "6".repeat(64),
      selectedRecommendationPolicySource: "default",
      familyPolicyOverrideCount: 0,
      familyPolicyOverrideSetSha256: "7".repeat(64),
      selectedCompletionRateBps: 5_000,
      selectedReplayCount: 2,
      diagnostics: [],
    });
  });

  it("projects blueprint portfolio calibration receipts", () => {
    const calibration: ExecutionPlanBlueprintPortfolioCalibration = {
      kind: "napier.execution-plan-blueprint-portfolio-calibration",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-26T00:00:06.000Z",
      recordCount: 3,
      activeCount: 2,
      archivedCount: 1,
      familyCount: 2,
      sourceQualifiedCount: 2,
      outcomeQualifiedCount: 1,
      reviewedBaselineCount: 1,
      missingBaselineCount: 1,
      policyFailedCount: 1,
      portfolioSetSha256: "a".repeat(64),
      families: [
        {
          familySha256: "b".repeat(64),
          recordCount: 2,
          activeCount: 2,
          archivedCount: 0,
          sourceQualifiedCount: 2,
          outcomeQualifiedCount: 1,
          reviewedBaselineCount: 1,
          replayCount: 4,
          completedCount: 3,
          blockedCount: 1,
          invalidCount: 0,
          completionRateBps: 7_500,
          topRecordId: record.id,
          topRecordScoreBps: 8_000,
          latestBaselineSha256: "c".repeat(64),
        },
      ],
      contentSha256: "d".repeat(64),
    };

    expect(planBlueprintPortfolioCalibrationReceipt(calibration)).toEqual({
      action: "portfolioCalibrated",
      contentSha256: calibration.contentSha256,
      portfolioSetSha256: calibration.portfolioSetSha256,
      recordCount: 3,
      activeCount: 2,
      archivedCount: 1,
      familyCount: 2,
      sourceQualifiedCount: 2,
      outcomeQualifiedCount: 1,
      reviewedBaselineCount: 1,
      missingBaselineCount: 1,
      policyFailedCount: 1,
      topFamilySha256: "b".repeat(64),
      topRecordId: record.id,
      topRecordScoreBps: 8_000,
    });
  });

  it("projects blueprint recommendation policy backtest receipts", () => {
    const backtest: ExecutionPlanBlueprintRecommendationPolicyBacktest = {
      kind: "napier.execution-plan-blueprint-recommendation-policy-backtest",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      generatedAt: "2026-07-26T00:00:07.000Z",
      recordCount: 2,
      activeCount: 2,
      policyCount: 2,
      divergentSelectionCount: 1,
      portfolioSetSha256: "4".repeat(64),
      policySetSha256: "5".repeat(64),
      results: [
        {
          recommendationPolicy: {
            templateId: "balanced",
            weights: {
              outcomeCompletionBps: 5_000,
              familyCompletionBps: 2_500,
              reviewedBaselineBps: 1_500,
              replayEvidenceBps: 1_000,
            },
          },
          recommendationPolicySha256: "6".repeat(64),
          candidateCount: 2,
          qualifiedCandidateCount: 2,
          rejectedCandidateCount: 0,
          selectedRecordId: record.id,
          selectedFamilySha256: "7".repeat(64),
          selectedRecommendationScoreBps: 5_450,
          averageRecommendationScoreBps: 4_200,
          candidates: [],
        },
        {
          recommendationPolicy: {
            templateId: "portfolio_first",
            weights: {
              outcomeCompletionBps: 3_500,
              familyCompletionBps: 3_500,
              reviewedBaselineBps: 2_000,
              replayEvidenceBps: 1_000,
            },
          },
          recommendationPolicySha256: "8".repeat(64),
          candidateCount: 2,
          qualifiedCandidateCount: 2,
          rejectedCandidateCount: 0,
          selectedRecordId: "blueprint_portfolio",
          selectedFamilySha256: "9".repeat(64),
          selectedRecommendationScoreBps: 6_250,
          averageRecommendationScoreBps: 4_800,
          candidates: [],
        },
      ],
      contentSha256: "a".repeat(64),
    };

    expect(planBlueprintRecommendationPolicyBacktestReceipt(backtest)).toEqual({
      action: "policyBacktested",
      contentSha256: backtest.contentSha256,
      portfolioSetSha256: backtest.portfolioSetSha256,
      policySetSha256: backtest.policySetSha256,
      recordCount: 2,
      activeCount: 2,
      policyCount: 2,
      divergentSelectionCount: 1,
      topPolicyTemplate: "portfolio_first",
      topPolicySha256: "8".repeat(64),
      topSelectedRecordId: "blueprint_portfolio",
      topSelectedFamilySha256: "9".repeat(64),
      topSelectedRecommendationScoreBps: 6_250,
      averageRecommendationScoreBps: 4_800,
    });
  });

  it("projects blueprint recommendation policy override receipts", () => {
    const override: ExecutionPlanBlueprintRecommendationPolicyOverride = {
      kind: "napier.execution-plan-blueprint-recommendation-policy-override",
      schemaVersion: 1,
      apiVersion: "0.1.0",
      familySha256: "4".repeat(64),
      recommendationPolicy: {
        templateId: "portfolio_first",
        weights: {
          outcomeCompletionBps: 3_500,
          familyCompletionBps: 3_500,
          reviewedBaselineBps: 2_000,
          replayEvidenceBps: 1_000,
        },
      },
      recommendationPolicySha256: "5".repeat(64),
      portfolioSetSha256: "6".repeat(64),
      familyRecordCount: 3,
      familyOutcomeQualifiedCount: 2,
      familyCompletionRateBps: 7_500,
      updatedAt: "2026-07-26T00:00:08.000Z",
      contentSha256: "7".repeat(64),
    };

    expect(planBlueprintRecommendationPolicyOverrideReceipt(override)).toEqual({
      action: "policyOverrideApplied",
      contentSha256: override.contentSha256,
      portfolioSetSha256: override.portfolioSetSha256,
      familySha256: override.familySha256,
      recommendationPolicyTemplate: "portfolio_first",
      recommendationPolicySha256: override.recommendationPolicySha256,
      familyRecordCount: 3,
      familyOutcomeQualifiedCount: 2,
      familyCompletionRateBps: 7_500,
    });
  });

  it("projects blueprint recommendation policy override drift receipts", () => {
    const review: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-drift-review",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:09.000Z",
        overrideCount: 2,
        alignedCount: 1,
        retireRecommendedCount: 1,
        missingFamilyCount: 0,
        portfolioSetSha256: "1".repeat(64),
        overrideSetSha256: "2".repeat(64),
        reviewSetSha256: "3".repeat(64),
        reviews: [
          {
            familySha256: "4".repeat(64),
            overrideSha256: "5".repeat(64),
            status: "aligned",
            recommendation: "keep",
            diagnostics: [],
            overridePolicyTemplate: "portfolio_first",
            overridePolicySha256: "6".repeat(64),
            overrideSelectedRecordId: record.id,
            overrideSelectedRecommendationScoreBps: 6_250,
            bestPolicyTemplate: "portfolio_first",
            bestPolicySha256: "6".repeat(64),
            bestSelectedRecordId: record.id,
            bestSelectedRecommendationScoreBps: 6_250,
            familyRecordCount: 1,
            familyOutcomeQualifiedCount: 1,
            familyCompletionRateBps: 7_500,
            reviewSha256: "7".repeat(64),
          },
          {
            familySha256: "8".repeat(64),
            overrideSha256: "9".repeat(64),
            status: "retire_recommended",
            recommendation: "retire",
            diagnostics: ["override_policy_not_best"],
            overridePolicyTemplate: "balanced",
            overridePolicySha256: "a".repeat(64),
            overrideSelectedRecordId: "blueprint_balanced",
            overrideSelectedRecommendationScoreBps: 5_450,
            bestPolicyTemplate: "delivery_first",
            bestPolicySha256: "b".repeat(64),
            bestSelectedRecordId: "blueprint_delivery",
            bestSelectedRecommendationScoreBps: 6_400,
            familyRecordCount: 2,
            familyOutcomeQualifiedCount: 2,
            familyCompletionRateBps: 8_000,
            reviewSha256: "c".repeat(64),
          },
        ],
        contentSha256: "d".repeat(64),
      };

    expect(
      planBlueprintRecommendationPolicyOverrideDriftReviewReceipt(review),
    ).toEqual({
      action: "policyOverrideDriftReviewed",
      contentSha256: review.contentSha256,
      portfolioSetSha256: review.portfolioSetSha256,
      overrideSetSha256: review.overrideSetSha256,
      reviewSetSha256: review.reviewSetSha256,
      overrideCount: 2,
      alignedCount: 1,
      retireRecommendedCount: 1,
      missingFamilyCount: 0,
      reviewedFamilySha256: "8".repeat(64),
      reviewedOverrideSha256: "9".repeat(64),
      reviewedStatus: "retire_recommended",
      reviewedRecommendation: "retire",
      reviewedDiagnostics: ["override_policy_not_best"],
      overridePolicyTemplate: "balanced",
      bestPolicyTemplate: "delivery_first",
      overrideSelectedRecordId: "blueprint_balanced",
      bestSelectedRecordId: "blueprint_delivery",
      overrideSelectedRecommendationScoreBps: 5_450,
      bestSelectedRecommendationScoreBps: 6_400,
    });
  });

  it("projects blueprint recommendation policy override retirement receipts", () => {
    const result: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        familySha256: "1".repeat(64),
        retiredOverrideSha256: "2".repeat(64),
        retiredRecommendationPolicyTemplate: "balanced",
        retiredRecommendationPolicySha256: "3".repeat(64),
        portfolioSetSha256: "4".repeat(64),
        overrideSetSha256: "5".repeat(64),
        driftReviewSetSha256: "6".repeat(64),
        remainingOverrideSetSha256: "7".repeat(64),
        retiredAt: "2026-07-26T00:00:10.000Z",
        contentSha256: "8".repeat(64),
      };

    expect(
      planBlueprintRecommendationPolicyOverrideRetirementReceipt(result),
    ).toEqual({
      action: "policyOverrideRetired",
      contentSha256: result.contentSha256,
      portfolioSetSha256: result.portfolioSetSha256,
      familySha256: result.familySha256,
      retiredOverrideSha256: result.retiredOverrideSha256,
      retiredRecommendationPolicyTemplate: "balanced",
      retiredRecommendationPolicySha256:
        result.retiredRecommendationPolicySha256,
      overrideSetSha256: result.overrideSetSha256,
      driftReviewSetSha256: result.driftReviewSetSha256,
      remainingOverrideSetSha256: result.remainingOverrideSetSha256,
    });
  });

  it("projects blueprint recommendation policy override retirement history receipts", () => {
    const retirement: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        familySha256: "1".repeat(64),
        retiredOverrideSha256: "2".repeat(64),
        retiredRecommendationPolicyTemplate: "balanced",
        retiredRecommendationPolicySha256: "3".repeat(64),
        portfolioSetSha256: "4".repeat(64),
        overrideSetSha256: "5".repeat(64),
        driftReviewSetSha256: "6".repeat(64),
        remainingOverrideSetSha256: "7".repeat(64),
        retiredAt: "2026-07-26T00:00:10.000Z",
        contentSha256: "8".repeat(64),
      };
    const history: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:11.000Z",
        retirementCount: 1,
        portfolioSetSha256: "9".repeat(64),
        currentOverrideSetSha256: "a".repeat(64),
        retirementSetSha256: "b".repeat(64),
        latestRetiredAt: retirement.retiredAt,
        retirements: [retirement],
        contentSha256: "c".repeat(64),
      };

    expect(
      planBlueprintRecommendationPolicyOverrideRetirementHistoryReceipt(
        history,
      ),
    ).toEqual({
      action: "policyOverrideRetirements",
      contentSha256: history.contentSha256,
      portfolioSetSha256: history.portfolioSetSha256,
      currentOverrideSetSha256: history.currentOverrideSetSha256,
      retirementSetSha256: history.retirementSetSha256,
      retirementCount: 1,
      latestRetiredAt: retirement.retiredAt,
      latestFamilySha256: retirement.familySha256,
      latestRetiredOverrideSha256: retirement.retiredOverrideSha256,
      latestRetiredRecommendationPolicyTemplate: "balanced",
      latestRemainingOverrideSetSha256: retirement.remainingOverrideSetSha256,
    });
    const verification: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification =
      {
        kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-verification",
        schemaVersion: 1,
        apiVersion: "0.1.0",
        generatedAt: "2026-07-26T00:00:12.000Z",
        status: "invalid",
        diagnostics: ["retirement_count_mismatch"],
        declaredContentSha256: history.contentSha256,
        recomputedContentSha256: "d".repeat(64),
        observedContentSha256: "e".repeat(64),
        declaredPortfolioSetSha256: history.portfolioSetSha256,
        observedPortfolioSetSha256: "f".repeat(64),
        declaredCurrentOverrideSetSha256: history.currentOverrideSetSha256,
        observedCurrentOverrideSetSha256: "1".repeat(64),
        declaredRetirementSetSha256: history.retirementSetSha256,
        recomputedRetirementSetSha256: history.retirementSetSha256,
        observedRetirementSetSha256: "2".repeat(64),
        retirementCount: 2,
        observedRetirementCount: 1,
        latestRetiredAt: retirement.retiredAt,
        observedLatestRetiredAt: "2026-07-26T00:00:13.000Z",
        contentSha256: "3".repeat(64),
      };

    expect(
      planBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationReceipt(
        verification,
      ),
    ).toEqual({
      action: "policyOverrideRetirementsVerified",
      verificationStatus: "invalid",
      diagnostics: ["retirement_count_mismatch"],
      contentSha256: verification.contentSha256,
      declaredContentSha256: history.contentSha256,
      recomputedContentSha256: "d".repeat(64),
      observedContentSha256: "e".repeat(64),
      declaredPortfolioSetSha256: history.portfolioSetSha256,
      observedPortfolioSetSha256: "f".repeat(64),
      declaredCurrentOverrideSetSha256: history.currentOverrideSetSha256,
      observedCurrentOverrideSetSha256: "1".repeat(64),
      declaredRetirementSetSha256: history.retirementSetSha256,
      recomputedRetirementSetSha256: history.retirementSetSha256,
      observedRetirementSetSha256: "2".repeat(64),
      retirementCount: 2,
      observedRetirementCount: 1,
      latestRetiredAt: retirement.retiredAt,
      observedLatestRetiredAt: "2026-07-26T00:00:13.000Z",
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
