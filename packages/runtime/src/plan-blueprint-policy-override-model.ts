import {
  NAPIER_API_VERSION,
  type ExecutionPlanBlueprintPortfolioCalibrationFamily,
  type ExecutionPlanBlueprintRecommendationPolicy,
  type ExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideList
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import {
  compareExecutionPlanBlueprintRecommendationPolicyBacktestResults,
  createExecutionPlanBlueprintRecommendationPolicyBacktestResult,
} from "./plan-blueprint-backtest.js";
import {
  executionPlanBlueprintRecommendationPolicyOverrideSetSha256,
  executionPlanBlueprintRecommendationPolicySha256,
  uniqueStrings,
  validateExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintPortfolioCalibrationEntry
} from "./plan-blueprint-portfolio-model.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export function createExecutionPlanBlueprintRecommendationPolicyOverride(input: {
  family: ExecutionPlanBlueprintPortfolioCalibrationFamily;
  recommendationPolicy: ExecutionPlanBlueprintRecommendationPolicy;
  portfolioSetSha256: string;
  updatedAt: string;
}): ExecutionPlanBlueprintRecommendationPolicyOverride {
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    familySha256: input.family.familySha256,
    recommendationPolicy: input.recommendationPolicy,
    recommendationPolicySha256:
      executionPlanBlueprintRecommendationPolicySha256(
        input.recommendationPolicy,
      ),
    portfolioSetSha256: input.portfolioSetSha256,
    familyRecordCount: input.family.recordCount,
    familyOutcomeQualifiedCount: input.family.outcomeQualifiedCount,
    familyCompletionRateBps: input.family.completionRateBps,
    updatedAt: input.updatedAt,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createExecutionPlanBlueprintRecommendationPolicyOverrideList(input: {
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
  portfolioSetSha256: string;
}): ExecutionPlanBlueprintRecommendationPolicyOverrideList {
  const overrides = input.overrides
    .map(validateExecutionPlanBlueprintRecommendationPolicyOverride)
    .sort((left, right) => left.familySha256.localeCompare(right.familySha256));
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-overrides" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    overrideCount: overrides.length,
    portfolioSetSha256: input.portfolioSetSha256,
    overrideSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideSetSha256(overrides),
    overrides,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview(input: {
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[];
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverride[];
  policies: ExecutionPlanBlueprintRecommendationPolicy[];
  portfolioSetSha256: string;
}): ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview {
  const overrides = input.overrides
    .map(validateExecutionPlanBlueprintRecommendationPolicyOverride)
    .sort((left, right) => left.familySha256.localeCompare(right.familySha256));
  const reviews = overrides.map((override) =>
    createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem({
      entries: input.entries,
      families: input.families,
      override,
      policies: input.policies,
    }),
  );
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-drift-review" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    overrideCount: reviews.length,
    alignedCount: reviews.filter((review) => review.status === "aligned")
      .length,
    retireRecommendedCount: reviews.filter(
      (review) => review.recommendation === "retire",
    ).length,
    missingFamilyCount: reviews.filter(
      (review) => review.status === "family_missing",
    ).length,
    portfolioSetSha256: input.portfolioSetSha256,
    overrideSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideSetSha256(overrides),
    reviewSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideDriftReviewSetSha256(
        reviews,
      ),
    reviews,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem(input: {
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[];
  families: ExecutionPlanBlueprintPortfolioCalibrationFamily[];
  override: ExecutionPlanBlueprintRecommendationPolicyOverride;
  policies: ExecutionPlanBlueprintRecommendationPolicy[];
}): ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem {
  const family = input.families.find(
    (candidate) => candidate.familySha256 === input.override.familySha256,
  );
  if (!family) {
    return createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewContent(
      {
        familySha256: input.override.familySha256,
        overrideSha256: input.override.contentSha256,
        status: "family_missing",
        recommendation: "retire",
        diagnostics: ["family_missing"],
        overridePolicyTemplate: input.override.recommendationPolicy.templateId,
        overridePolicySha256: input.override.recommendationPolicySha256,
      },
    );
  }
  const familyEntries = input.entries.filter(
    (entry) => entry.familySha256 === family.familySha256,
  );
  const familyResults = input.policies.map((policy) =>
    createExecutionPlanBlueprintRecommendationPolicyBacktestResult({
      entries: familyEntries,
      families: [family],
      policy,
    }),
  );
  const best = [...familyResults].sort(
    compareExecutionPlanBlueprintRecommendationPolicyBacktestResults,
  )[0];
  const overrideResult = familyResults.find(
    (result) =>
      result.recommendationPolicy.templateId ===
      input.override.recommendationPolicy.templateId,
  );
  const diagnostics = uniqueStrings([
    ...(best?.selectedRecordId ? [] : ["no_qualified_candidate"]),
    ...(best &&
    best.recommendationPolicy.templateId !==
      input.override.recommendationPolicy.templateId
      ? ["override_policy_not_best"]
      : []),
    ...(overrideResult?.selectedRecordId &&
    best?.selectedRecordId &&
    overrideResult.selectedRecordId !== best.selectedRecordId
      ? ["override_selected_record_differs"]
      : []),
  ]);
  const aligned = diagnostics.length === 0;
  return createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewContent(
    {
      familySha256: input.override.familySha256,
      overrideSha256: input.override.contentSha256,
      status: aligned ? "aligned" : "retire_recommended",
      recommendation: aligned ? "keep" : "retire",
      diagnostics,
      overridePolicyTemplate: input.override.recommendationPolicy.templateId,
      overridePolicySha256: input.override.recommendationPolicySha256,
      ...(overrideResult?.selectedRecordId
        ? { overrideSelectedRecordId: overrideResult.selectedRecordId }
        : {}),
      ...(overrideResult?.selectedRecommendationScoreBps !== undefined
        ? {
            overrideSelectedRecommendationScoreBps:
              overrideResult.selectedRecommendationScoreBps,
          }
        : {}),
      ...(best
        ? { bestPolicyTemplate: best.recommendationPolicy.templateId }
        : {}),
      ...(best ? { bestPolicySha256: best.recommendationPolicySha256 } : {}),
      ...(best?.selectedRecordId
        ? { bestSelectedRecordId: best.selectedRecordId }
        : {}),
      ...(best?.selectedRecommendationScoreBps !== undefined
        ? {
            bestSelectedRecommendationScoreBps:
              best.selectedRecommendationScoreBps,
          }
        : {}),
      familyRecordCount: family.recordCount,
      familyOutcomeQualifiedCount: family.outcomeQualifiedCount,
      familyCompletionRateBps: family.completionRateBps,
    },
  );
}

export function createExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewContent(
  content: Omit<
    ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem,
    "reviewSha256"
  >,
): ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem {
  return {
    ...content,
    reviewSha256: sha256(canonicalJson(content)),
  };
}

export function executionPlanBlueprintRecommendationPolicyOverrideDriftReviewSetSha256(
  reviews: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewItem[],
): string {
  return sha256(
    canonicalJson(
      reviews
        .map((review) => ({
          familySha256: review.familySha256,
          overrideSha256: review.overrideSha256,
          reviewSha256: review.reviewSha256,
        }))
        .sort((left, right) =>
          left.familySha256.localeCompare(right.familySha256),
        ),
    ),
  );
}
