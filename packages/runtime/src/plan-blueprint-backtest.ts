import {
  NAPIER_API_VERSION,
  type ExecutionPlanBlueprintPortfolioCalibrationFamily,
  type ExecutionPlanBlueprintRecommendationPolicy,
  type ExecutionPlanBlueprintRecommendationPolicyBacktest,
  type ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate,
  type ExecutionPlanBlueprintRecommendationPolicyBacktestResult
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import { executionPlanBlueprintFamilyReviewedBaselineCoverageBps,executionPlanBlueprintRecommendationPolicySetSha256,executionPlanBlueprintRecommendationPolicySha256,executionPlanBlueprintRecommendationScoreBps,executionPlanBlueprintReplayEvidenceBps,uniqueStrings,type ExecutionPlanBlueprintPortfolioCalibrationEntry } from "./plan-blueprint-portfolio-model.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export function createExecutionPlanBlueprintRecommendationPolicyBacktest(input: {
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[];
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  policies: ExecutionPlanBlueprintRecommendationPolicy[];
  portfolioSetSha256: string;
}): ExecutionPlanBlueprintRecommendationPolicyBacktest {
  const results = input.policies.map((policy) =>
    createExecutionPlanBlueprintRecommendationPolicyBacktestResult({
      entries: input.entries,
      families: input.families,
      policy,
    }),
  );
  const referenceRecordId = results[0]?.selectedRecordId;
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-backtest" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    recordCount: input.entries.length,
    activeCount: input.entries.filter(
      (entry) => entry.recordStatus === "active",
    ).length,
    policyCount: results.length,
    divergentSelectionCount: results.filter(
      (result) => result.selectedRecordId !== referenceRecordId,
    ).length,
    portfolioSetSha256: input.portfolioSetSha256,
    policySetSha256: executionPlanBlueprintRecommendationPolicySetSha256(
      input.policies,
    ),
    results,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createExecutionPlanBlueprintRecommendationPolicyBacktestResult(input: {
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[];
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  policy: ExecutionPlanBlueprintRecommendationPolicy;
}): ExecutionPlanBlueprintRecommendationPolicyBacktestResult {
  const familyBySha256 = new Map(
    input.families.map((family) => [family.familySha256, family]),
  );
  const candidates = input.entries.map((entry) => {
    const family = familyBySha256.get(entry.familySha256);
    if (!family) {
      throw new Error("Execution plan blueprint portfolio family missing");
    }
    return createExecutionPlanBlueprintRecommendationPolicyBacktestCandidate({
      entry,
      family,
      policy: input.policy,
    });
  });
  const selected = candidates
    .filter((candidate) => candidate.selectionStatus === "qualified")
    .sort(compareExecutionPlanBlueprintRecommendationPolicyBacktestCandidates)
    .at(0);
  const selectedCandidates = candidates
    .map((candidate) =>
      selected && candidate.recordId === selected.recordId
        ? { ...candidate, selectionStatus: "selected" as const }
        : candidate,
    )
    .sort(compareExecutionPlanBlueprintRecommendationPolicyBacktestCandidates);
  const qualifiedCandidates = selectedCandidates.filter(
    (candidate) =>
      candidate.selectionStatus === "qualified" ||
      candidate.selectionStatus === "selected",
  );
  const recommendationScoreTotal = qualifiedCandidates.reduce(
    (total, candidate) => total + candidate.recommendationScoreBps,
    0,
  );
  return {
    recommendationPolicy: input.policy,
    recommendationPolicySha256:
      executionPlanBlueprintRecommendationPolicySha256(input.policy),
    candidateCount: selectedCandidates.length,
    qualifiedCandidateCount: qualifiedCandidates.length,
    rejectedCandidateCount: selectedCandidates.filter(
      (candidate) => candidate.selectionStatus === "rejected",
    ).length,
    ...(selected ? { selectedRecordId: selected.recordId } : {}),
    ...(selected ? { selectedFamilySha256: selected.familySha256 } : {}),
    ...(selected
      ? { selectedRecommendationScoreBps: selected.recommendationScoreBps }
      : {}),
    averageRecommendationScoreBps:
      qualifiedCandidates.length > 0
        ? Math.round(recommendationScoreTotal / qualifiedCandidates.length)
        : 0,
    candidates: selectedCandidates,
  };
}

export function compareExecutionPlanBlueprintRecommendationPolicyBacktestResults(
  left: ExecutionPlanBlueprintRecommendationPolicyBacktestResult,
  right: ExecutionPlanBlueprintRecommendationPolicyBacktestResult,
): number {
  const selectedScoreOrder =
    (right.selectedRecommendationScoreBps ?? -1) -
    (left.selectedRecommendationScoreBps ?? -1);
  if (selectedScoreOrder !== 0) return selectedScoreOrder;
  const averageScoreOrder =
    right.averageRecommendationScoreBps - left.averageRecommendationScoreBps;
  if (averageScoreOrder !== 0) return averageScoreOrder;
  const qualifiedOrder =
    right.qualifiedCandidateCount - left.qualifiedCandidateCount;
  if (qualifiedOrder !== 0) return qualifiedOrder;
  const candidateOrder = right.candidateCount - left.candidateCount;
  if (candidateOrder !== 0) return candidateOrder;
  return left.recommendationPolicy.templateId.localeCompare(
    right.recommendationPolicy.templateId,
  );
}

export function createExecutionPlanBlueprintRecommendationPolicyBacktestCandidate(input: {
  entry: ExecutionPlanBlueprintPortfolioCalibrationEntry;
  family: ExecutionPlanBlueprintPortfolioCalibrationFamily;
  policy: ExecutionPlanBlueprintRecommendationPolicy;
}): ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate {
  const ready =
    input.entry.recordStatus === "active" &&
    input.entry.sourceQualificationStatus === "qualified" &&
    input.entry.outcomeQualificationStatus === "qualified";
  const diagnostics = uniqueStrings([
    ...(input.entry.recordStatus === "active" ? [] : ["record_archived"]),
    ...(input.entry.sourceQualificationStatus === "qualified"
      ? []
      : [`source_${input.entry.sourceQualificationStatus}`]),
    ...input.entry.sourceDiagnostics.map(
      (diagnostic) => `source_${diagnostic}`,
    ),
    ...(input.entry.outcomeQualificationStatus === "qualified"
      ? []
      : [`outcome_${input.entry.outcomeQualificationStatus}`]),
    ...input.entry.outcomeDiagnostics.map(
      (diagnostic) => `outcome_${diagnostic}`,
    ),
  ]);
  const reviewedBaselineCoverageBps =
    executionPlanBlueprintFamilyReviewedBaselineCoverageBps(input.family);
  const replayEvidenceBps = executionPlanBlueprintReplayEvidenceBps(
    input.entry.replayCount,
  );
  return {
    recordId: input.entry.recordId,
    recordStatus: input.entry.recordStatus,
    recordUpdatedAt: input.entry.recordUpdatedAt,
    selectionStatus: ready ? "qualified" : "rejected",
    diagnostics,
    familySha256: input.entry.familySha256,
    sourceQualificationStatus: input.entry.sourceQualificationStatus,
    outcomeQualificationStatus: input.entry.outcomeQualificationStatus,
    familyRecordCount: input.family.recordCount,
    familyCompletionRateBps: input.family.completionRateBps,
    familyReviewedBaselineCount: input.family.reviewedBaselineCount,
    reviewedBaselineCoverageBps,
    replayEvidenceBps,
    recommendationScoreBps: ready
      ? executionPlanBlueprintRecommendationScoreBps({
          outcomeCompletionBps: input.entry.completionRateBps,
          familyCompletionBps: input.family.completionRateBps,
          reviewedBaselineCoverageBps,
          replayEvidenceBps,
          policy: input.policy,
        })
      : 0,
    replayCount: input.entry.replayCount,
    completedCount: input.entry.completedCount,
    blockedCount: input.entry.blockedCount,
    invalidCount: input.entry.invalidCount,
    completionRateBps: input.entry.completionRateBps,
    currentOutcomesSha256: input.entry.currentOutcomesSha256,
    currentOutcomeSetSha256: input.entry.currentOutcomeSetSha256,
  };
}

export function compareExecutionPlanBlueprintRecommendationPolicyBacktestCandidates(
  left: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate,
  right: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate,
): number {
  const statusOrder =
    executionPlanBlueprintRecommendationPolicyBacktestStatusRank(right) -
    executionPlanBlueprintRecommendationPolicyBacktestStatusRank(left);
  if (statusOrder !== 0) return statusOrder;
  const recommendationOrder =
    right.recommendationScoreBps - left.recommendationScoreBps;
  if (recommendationOrder !== 0) return recommendationOrder;
  const completionOrder = right.completionRateBps - left.completionRateBps;
  if (completionOrder !== 0) return completionOrder;
  const familyCompletionOrder =
    right.familyCompletionRateBps - left.familyCompletionRateBps;
  if (familyCompletionOrder !== 0) return familyCompletionOrder;
  const reviewedOrder =
    right.familyReviewedBaselineCount - left.familyReviewedBaselineCount;
  if (reviewedOrder !== 0) return reviewedOrder;
  const replayOrder = right.replayCount - left.replayCount;
  if (replayOrder !== 0) return replayOrder;
  const completedOrder = right.completedCount - left.completedCount;
  if (completedOrder !== 0) return completedOrder;
  const recordOrder = right.recordUpdatedAt.localeCompare(left.recordUpdatedAt);
  if (recordOrder !== 0) return recordOrder;
  return left.recordId.localeCompare(right.recordId);
}

export function executionPlanBlueprintRecommendationPolicyBacktestStatusRank(
  candidate: ExecutionPlanBlueprintRecommendationPolicyBacktestCandidate,
): number {
  if (candidate.selectionStatus === "selected") return 2;
  if (candidate.selectionStatus === "qualified") return 1;
  return 0;
}
