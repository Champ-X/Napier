import {
  NAPIER_API_VERSION,
  type ExecutionPlanBlueprintPortfolioCalibrationFamily,
  type ExecutionPlanBlueprintRecommendationPolicy,
  type ExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintRecommendationPolicySource,
  type ExecutionPlanBlueprintRecord,
  type ExecutionPlanBlueprintRecordOutcomeBaseline,
  type ExecutionPlanBlueprintRecordOutcomeQualification,
  type ExecutionPlanBlueprintRecordPreview,
  type ExecutionPlanBlueprintRecordQualification,
  type ExecutionPlanBlueprintRecordSelection,
  type ExecutionPlanBlueprintRecordSelectionCandidate
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import { executionPlanBlueprintFamilyReviewedBaselineCoverageBps,executionPlanBlueprintRecommendationPolicyOverrideSetSha256,executionPlanBlueprintRecommendationPolicySha256,executionPlanBlueprintRecommendationScoreBps,executionPlanBlueprintReplayEvidenceBps,uniqueStrings } from "./plan-blueprint-portfolio-model.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export function createExecutionPlanBlueprintSelectionCandidate(input: {
  record: ExecutionPlanBlueprintRecord;
  sourceQualification: ExecutionPlanBlueprintRecordQualification;
  outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
  family: ExecutionPlanBlueprintPortfolioCalibrationFamily;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  recommendationPolicySource: ExecutionPlanBlueprintRecommendationPolicySource;
  familyPolicyOverrideSha256?: string;
  latestBaseline?: ExecutionPlanBlueprintRecordOutcomeBaseline;
  preview?: ExecutionPlanBlueprintRecordPreview;
}): ExecutionPlanBlueprintRecordSelectionCandidate {
  const ready =
    input.sourceQualification.status === "qualified" &&
    input.outcomeQualification.status === "qualified" &&
    input.preview?.status === "ready";
  const diagnostics = uniqueStrings([
    ...(input.sourceQualification.status === "qualified"
      ? []
      : [`source_${input.sourceQualification.status}`]),
    ...input.sourceQualification.diagnostics.map(
      (diagnostic) => `source_${diagnostic}`,
    ),
    ...(input.outcomeQualification.status === "qualified"
      ? []
      : [`outcome_${input.outcomeQualification.status}`]),
    ...input.outcomeQualification.diagnostics.map(
      (diagnostic) => `outcome_${diagnostic}`,
    ),
    ...(input.preview && input.preview.status !== "ready"
      ? [`preview_${input.preview.status}`]
      : []),
    ...(input.preview?.diagnostics.map(
      (diagnostic) => `preview_${diagnostic}`,
    ) ?? []),
  ]);
  return {
    recordId: input.record.id,
    recordStatus: input.record.status,
    recordUpdatedAt: input.record.updatedAt,
    selectionStatus: ready ? "qualified" : "rejected",
    diagnostics,
    blueprintSha256: input.record.blueprintSha256,
    familySha256: input.family.familySha256,
    sourceQualificationStatus: input.sourceQualification.status,
    outcomeQualificationStatus: input.outcomeQualification.status,
    familyRecordCount: input.family.recordCount,
    familyOutcomeQualifiedCount: input.family.outcomeQualifiedCount,
    familyReviewedBaselineCount: input.family.reviewedBaselineCount,
    familyCompletionRateBps: input.family.completionRateBps,
    recommendationScoreBps: ready
      ? executionPlanBlueprintRecommendationScoreBps({
          outcomeCompletionBps: input.outcomeQualification.completionRateBps,
          familyCompletionBps: input.family.completionRateBps,
          reviewedBaselineCoverageBps:
            executionPlanBlueprintFamilyReviewedBaselineCoverageBps(
              input.family,
            ),
          replayEvidenceBps: executionPlanBlueprintReplayEvidenceBps(
            input.outcomeQualification.replayCount,
          ),
          policy: input.recommendationPolicy,
        })
      : 0,
    recommendationPolicyTemplate: input.recommendationPolicy.templateId,
    recommendationPolicySha256:
      executionPlanBlueprintRecommendationPolicySha256(
        input.recommendationPolicy,
      ),
    recommendationPolicySource: input.recommendationPolicySource,
    ...(input.familyPolicyOverrideSha256
      ? { familyPolicyOverrideSha256: input.familyPolicyOverrideSha256 }
      : {}),
    ...(input.preview ? { previewStatus: input.preview.status } : {}),
    ...(input.preview?.previewSha256
      ? { previewSha256: input.preview.previewSha256 }
      : {}),
    ...(input.outcomeQualification.baselineId
      ? { baselineId: input.outcomeQualification.baselineId }
      : {}),
    ...(input.outcomeQualification.baselineSha256
      ? { baselineSha256: input.outcomeQualification.baselineSha256 }
      : {}),
    ...(input.outcomeQualification.baselineOutcomesSha256
      ? {
          baselineOutcomesSha256:
            input.outcomeQualification.baselineOutcomesSha256,
        }
      : {}),
    ...(input.latestBaseline?.promotedAt
      ? { baselinePromotedAt: input.latestBaseline.promotedAt }
      : {}),
    currentOutcomesSha256: input.outcomeQualification.currentOutcomesSha256,
    currentReplayHistorySha256:
      input.outcomeQualification.currentReplayHistorySha256,
    currentOutcomeSetSha256: input.outcomeQualification.currentOutcomeSetSha256,
    scoreBps: ready ? input.outcomeQualification.completionRateBps : 0,
    replayCount: input.outcomeQualification.replayCount,
    completedCount: input.outcomeQualification.completedCount,
    blockedCount: input.outcomeQualification.blockedCount,
    invalidCount: input.outcomeQualification.invalidCount,
    completionRateBps: input.outcomeQualification.completionRateBps,
    stepCount: input.record.blueprint.stepCount,
    artifactCount: input.record.blueprint.artifactCount,
  };
}

export function selectExecutionPlanBlueprintCandidate(
  candidates: ExecutionPlanBlueprintRecordSelectionCandidate[],
): ExecutionPlanBlueprintRecordSelectionCandidate | undefined {
  return candidates
    .filter((candidate) => candidate.selectionStatus === "qualified")
    .sort(compareExecutionPlanBlueprintSelectionCandidates)
    .at(0);
}

export function compareExecutionPlanBlueprintSelectionCandidates(
  left: ExecutionPlanBlueprintRecordSelectionCandidate,
  right: ExecutionPlanBlueprintRecordSelectionCandidate,
): number {
  const recommendationOrder =
    right.recommendationScoreBps - left.recommendationScoreBps;
  if (recommendationOrder !== 0) return recommendationOrder;
  const scoreOrder = right.scoreBps - left.scoreBps;
  if (scoreOrder !== 0) return scoreOrder;
  const familyCompletionOrder =
    right.familyCompletionRateBps - left.familyCompletionRateBps;
  if (familyCompletionOrder !== 0) return familyCompletionOrder;
  const familyReviewedOrder =
    right.familyReviewedBaselineCount - left.familyReviewedBaselineCount;
  if (familyReviewedOrder !== 0) return familyReviewedOrder;
  const familyQualifiedOrder =
    right.familyOutcomeQualifiedCount - left.familyOutcomeQualifiedCount;
  if (familyQualifiedOrder !== 0) return familyQualifiedOrder;
  const replayOrder = right.replayCount - left.replayCount;
  if (replayOrder !== 0) return replayOrder;
  const completedOrder = right.completedCount - left.completedCount;
  if (completedOrder !== 0) return completedOrder;
  const baselineOrder = (right.baselinePromotedAt ?? "").localeCompare(
    left.baselinePromotedAt ?? "",
  );
  if (baselineOrder !== 0) return baselineOrder;
  const recordOrder = right.recordUpdatedAt.localeCompare(left.recordUpdatedAt);
  if (recordOrder !== 0) return recordOrder;
  return left.recordId.localeCompare(right.recordId);
}

export function createExecutionPlanBlueprintRecordSelection(input: {
  threadId: string;
  objective?: string;
  candidates: ExecutionPlanBlueprintRecordSelectionCandidate[];
  portfolioSetSha256: string;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  familyPolicyOverrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
}): ExecutionPlanBlueprintRecordSelection {
  const selected = input.candidates.find(
    (candidate) => candidate.selectionStatus === "selected",
  );
  const qualifiedCandidateCount = input.candidates.filter(
    (candidate) =>
      candidate.selectionStatus === "qualified" ||
      candidate.selectionStatus === "selected",
  ).length;
  const content = {
    kind: "napier.execution-plan-blueprint-selection" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    threadId: input.threadId,
    ...(input.objective ? { objectiveSha256: sha256(input.objective) } : {}),
    candidateCount: input.candidates.length,
    qualifiedCandidateCount,
    rejectedCandidateCount: input.candidates.filter(
      (candidate) => candidate.selectionStatus === "rejected",
    ).length,
    ...(selected ? { selectedRecordId: selected.recordId } : {}),
    ...(selected?.previewSha256
      ? { selectedPreviewSha256: selected.previewSha256 }
      : {}),
    ...(selected?.baselineId
      ? { selectedBaselineId: selected.baselineId }
      : {}),
    ...(selected?.baselineSha256
      ? { selectedBaselineSha256: selected.baselineSha256 }
      : {}),
    ...(selected ? { selectedScoreBps: selected.scoreBps } : {}),
    ...(selected ? { selectedFamilySha256: selected.familySha256 } : {}),
    ...(selected
      ? { selectedFamilyCompletionRateBps: selected.familyCompletionRateBps }
      : {}),
    ...(selected
      ? { selectedRecommendationScoreBps: selected.recommendationScoreBps }
      : {}),
    ...(selected
      ? {
          selectedRecommendationPolicyTemplate:
            selected.recommendationPolicyTemplate,
        }
      : {}),
    ...(selected
      ? {
          selectedRecommendationPolicySha256:
            selected.recommendationPolicySha256,
        }
      : {}),
    ...(selected
      ? {
          selectedRecommendationPolicySource:
            selected.recommendationPolicySource,
        }
      : {}),
    ...(selected?.familyPolicyOverrideSha256
      ? {
          selectedFamilyPolicyOverrideSha256:
            selected.familyPolicyOverrideSha256,
        }
      : {}),
    recommendationPolicy: input.recommendationPolicy,
    recommendationPolicySha256:
      executionPlanBlueprintRecommendationPolicySha256(
        input.recommendationPolicy,
      ),
    familyPolicyOverrideCount: input.familyPolicyOverrides.length,
    familyPolicyOverrideSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideSetSha256(
        input.familyPolicyOverrides,
      ),
    portfolioSetSha256: input.portfolioSetSha256,
    selectionSetSha256: sha256(
      canonicalJson(
        input.candidates.map((candidate) => ({
          recordId: candidate.recordId,
          selectionStatus: candidate.selectionStatus,
          diagnostics: candidate.diagnostics,
          scoreBps: candidate.scoreBps,
          recommendationScoreBps: candidate.recommendationScoreBps,
          recommendationPolicyTemplate: candidate.recommendationPolicyTemplate,
          recommendationPolicySha256: candidate.recommendationPolicySha256,
          recommendationPolicySource: candidate.recommendationPolicySource,
          ...(candidate.familyPolicyOverrideSha256
            ? {
                familyPolicyOverrideSha256:
                  candidate.familyPolicyOverrideSha256,
              }
            : {}),
          familySha256: candidate.familySha256,
          familyRecordCount: candidate.familyRecordCount,
          familyOutcomeQualifiedCount: candidate.familyOutcomeQualifiedCount,
          familyReviewedBaselineCount: candidate.familyReviewedBaselineCount,
          familyCompletionRateBps: candidate.familyCompletionRateBps,
          sourceQualificationStatus: candidate.sourceQualificationStatus,
          outcomeQualificationStatus: candidate.outcomeQualificationStatus,
          ...(candidate.previewStatus
            ? { previewStatus: candidate.previewStatus }
            : {}),
          ...(candidate.previewSha256
            ? { previewSha256: candidate.previewSha256 }
            : {}),
          ...(candidate.baselineSha256
            ? { baselineSha256: candidate.baselineSha256 }
            : {}),
          currentOutcomesSha256: candidate.currentOutcomesSha256,
          currentOutcomeSetSha256: candidate.currentOutcomeSetSha256,
        })),
      ),
    ),
    candidates: input.candidates,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}
