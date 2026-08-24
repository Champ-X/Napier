import {
  NAPIER_API_VERSION,
  type ExecutionPlanBlueprintPortfolioCalibrationFamily,
  type ExecutionPlanBlueprintRecommendationPolicy,
  type ExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintRecommendationPolicyTemplateId,
  type ExecutionPlanBlueprintRecord,
  type ExecutionPlanBlueprintRecordOutcomeBaseline,
  type ExecutionPlanBlueprintRecordOutcomeQualification,
  type ExecutionPlanBlueprintRecordQualification
} from "@napier/contracts";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export const EXECUTION_PLAN_BLUEPRINT_RECOMMENDATION_POLICIES: Record<
  ExecutionPlanBlueprintRecommendationPolicyTemplateId,
  ExecutionPlanBlueprintRecommendationPolicy
> = {
  balanced: {
    templateId: "balanced",
    weights: {
      outcomeCompletionBps: 5_000,
      familyCompletionBps: 2_500,
      reviewedBaselineBps: 1_500,
      replayEvidenceBps: 1_000,
    },
  },
  delivery_first: {
    templateId: "delivery_first",
    weights: {
      outcomeCompletionBps: 7_000,
      familyCompletionBps: 1_000,
      reviewedBaselineBps: 1_000,
      replayEvidenceBps: 1_000,
    },
  },
  portfolio_first: {
    templateId: "portfolio_first",
    weights: {
      outcomeCompletionBps: 3_500,
      familyCompletionBps: 3_500,
      reviewedBaselineBps: 2_000,
      replayEvidenceBps: 1_000,
    },
  },
};

export const EXECUTION_PLAN_BLUEPRINT_RECOMMENDATION_POLICY_TEMPLATE_IDS: ExecutionPlanBlueprintRecommendationPolicyTemplateId[] =
  ["balanced", "delivery_first", "portfolio_first"];

export function validateExecutionPlanBlueprintRecommendationPolicyOverride(
  value: unknown,
): ExecutionPlanBlueprintRecommendationPolicyOverride {
  if (!isRecord(value)) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override is invalid",
    );
  }
  const override =
    value as unknown as ExecutionPlanBlueprintRecommendationPolicyOverride;
  const recommendationPolicy =
    normalizeExecutionPlanBlueprintRecommendationPolicy(
      override.recommendationPolicy?.templateId,
    );
  if (
    override.kind !==
      "napier.execution-plan-blueprint-recommendation-policy-override" ||
    override.schemaVersion !== 1 ||
    override.apiVersion !== NAPIER_API_VERSION ||
    !isSha256(override.familySha256) ||
    override.recommendationPolicySha256 !==
      executionPlanBlueprintRecommendationPolicySha256(recommendationPolicy) ||
    !isSha256(override.portfolioSetSha256) ||
    !isNonNegativeInteger(override.familyRecordCount) ||
    !isNonNegativeInteger(override.familyOutcomeQualifiedCount) ||
    !isNonNegativeInteger(override.familyCompletionRateBps) ||
    override.familyCompletionRateBps > 10_000 ||
    !Number.isFinite(Date.parse(override.updatedAt)) ||
    !isSha256(override.contentSha256)
  ) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = {
    ...override,
    recommendationPolicy,
  };
  if (sha256(canonicalJson(content)) !== override.contentSha256) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override hash mismatch",
    );
  }
  return structuredClone({
    ...override,
    recommendationPolicy,
  });
}

export function normalizeExecutionPlanBlueprintSelectionObjective(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 4_000) {
    throw new Error("Execution plan blueprint selection objective is invalid");
  }
  return normalized;
}

export function normalizeExecutionPlanBlueprintRecommendationPolicy(
  templateId: ExecutionPlanBlueprintRecommendationPolicyTemplateId | undefined,
): ExecutionPlanBlueprintRecommendationPolicy {
  const selected = templateId ?? "balanced";
  const policy = EXECUTION_PLAN_BLUEPRINT_RECOMMENDATION_POLICIES[selected];
  if (!policy) {
    throw new Error(
      "Execution plan blueprint recommendation policy is invalid",
    );
  }
  return structuredClone(policy);
}

export function compareExecutionPlanBlueprintRecords(
  left: ExecutionPlanBlueprintRecord,
  right: ExecutionPlanBlueprintRecord,
): number {
  const updatedOrder = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedOrder !== 0) return updatedOrder;
  return left.id.localeCompare(right.id);
}

export interface ExecutionPlanBlueprintPortfolioCalibrationEntry {
  recordId: string;
  recordStatus: ExecutionPlanBlueprintRecord["status"];
  recordUpdatedAt: string;
  familySha256: string;
  blueprintSha256: string;
  sourceQualificationStatus: ExecutionPlanBlueprintRecordQualification["status"];
  outcomeQualificationStatus: ExecutionPlanBlueprintRecordOutcomeQualification["status"];
  sourceDiagnostics: string[];
  outcomeDiagnostics: string[];
  baselineSha256?: string;
  baselinePromotedAt?: string;
  reviewedBaseline: boolean;
  currentOutcomesSha256: string;
  currentOutcomeSetSha256: string;
  replayCount: number;
  completedCount: number;
  blockedCount: number;
  invalidCount: number;
  completionRateBps: number;
  stepCount: number;
  artifactCount: number;
}

export function createExecutionPlanBlueprintPortfolioCalibrationEntry(input: {
  record: ExecutionPlanBlueprintRecord;
  sourceQualification: ExecutionPlanBlueprintRecordQualification;
  outcomeQualification: ExecutionPlanBlueprintRecordOutcomeQualification;
  latestBaseline?: ExecutionPlanBlueprintRecordOutcomeBaseline;
}): ExecutionPlanBlueprintPortfolioCalibrationEntry {
  return {
    recordId: input.record.id,
    recordStatus: input.record.status,
    recordUpdatedAt: input.record.updatedAt,
    familySha256: executionPlanBlueprintFamilySha256(input.record.blueprint),
    blueprintSha256: input.record.blueprintSha256,
    sourceQualificationStatus: input.sourceQualification.status,
    outcomeQualificationStatus: input.outcomeQualification.status,
    sourceDiagnostics: input.sourceQualification.diagnostics,
    outcomeDiagnostics: input.outcomeQualification.diagnostics,
    ...(input.outcomeQualification.baselineSha256
      ? { baselineSha256: input.outcomeQualification.baselineSha256 }
      : {}),
    ...(input.latestBaseline?.promotedAt
      ? { baselinePromotedAt: input.latestBaseline.promotedAt }
      : {}),
    reviewedBaseline: Boolean(input.latestBaseline?.reviewSha256),
    currentOutcomesSha256: input.outcomeQualification.currentOutcomesSha256,
    currentOutcomeSetSha256: input.outcomeQualification.currentOutcomeSetSha256,
    replayCount: input.outcomeQualification.replayCount,
    completedCount: input.outcomeQualification.completedCount,
    blockedCount: input.outcomeQualification.blockedCount,
    invalidCount: input.outcomeQualification.invalidCount,
    completionRateBps: input.outcomeQualification.completionRateBps,
    stepCount: input.record.blueprint.stepCount,
    artifactCount: input.record.blueprint.artifactCount,
  };
}

export function executionPlanBlueprintFamilySha256(
  blueprint: ExecutionPlanBlueprintRecord["blueprint"],
): string {
  return sha256(
    canonicalJson({
      stepCount: blueprint.stepCount,
      artifactCount: blueprint.artifactCount,
      steps: blueprint.steps
        .map((step) => ({
          idSha256: sha256(step.id),
          dependsOnSha256: sha256(
            canonicalJson([...(step.dependsOn ?? [])].sort()),
          ),
        }))
        .sort((left, right) => left.idSha256.localeCompare(right.idSha256)),
      artifacts: (blueprint.artifacts ?? [])
        .map((artifact) => ({
          idSha256: sha256(artifact.id),
          kind: artifact.kind ?? "file",
        }))
        .sort((left, right) => left.idSha256.localeCompare(right.idSha256)),
    }),
  );
}

export function executionPlanBlueprintPortfolioSetSha256(
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[],
): string {
  return sha256(
    canonicalJson(
      entries.map((entry) => ({
        recordId: entry.recordId,
        recordStatus: entry.recordStatus,
        familySha256: entry.familySha256,
        blueprintSha256: entry.blueprintSha256,
        sourceQualificationStatus: entry.sourceQualificationStatus,
        outcomeQualificationStatus: entry.outcomeQualificationStatus,
        ...(entry.baselineSha256
          ? { baselineSha256: entry.baselineSha256 }
          : {}),
        reviewedBaseline: entry.reviewedBaseline,
        currentOutcomesSha256: entry.currentOutcomesSha256,
        currentOutcomeSetSha256: entry.currentOutcomeSetSha256,
        replayCount: entry.replayCount,
        completedCount: entry.completedCount,
        blockedCount: entry.blockedCount,
        invalidCount: entry.invalidCount,
        completionRateBps: entry.completionRateBps,
      })),
    ),
  );
}

export function createExecutionPlanBlueprintPortfolioCalibrationFamilies(
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[],
): ExecutionPlanBlueprintPortfolioCalibrationFamily[] {
  const byFamily = new Map<
    string,
    ExecutionPlanBlueprintPortfolioCalibrationEntry[]
  >();
  for (const entry of entries) {
    const current = byFamily.get(entry.familySha256) ?? [];
    current.push(entry);
    byFamily.set(entry.familySha256, current);
  }
  return [...byFamily.entries()]
    .map(([familySha256, familyEntries]) =>
      createExecutionPlanBlueprintPortfolioCalibrationFamily(
        familySha256,
        familyEntries,
      ),
    )
    .sort((left, right) => {
      const qualifiedOrder =
        right.outcomeQualifiedCount - left.outcomeQualifiedCount;
      if (qualifiedOrder !== 0) return qualifiedOrder;
      const replayOrder = right.replayCount - left.replayCount;
      if (replayOrder !== 0) return replayOrder;
      return left.familySha256.localeCompare(right.familySha256);
    });
}

export function createExecutionPlanBlueprintPortfolioCalibrationFamily(
  familySha256: string,
  entries: ExecutionPlanBlueprintPortfolioCalibrationEntry[],
): ExecutionPlanBlueprintPortfolioCalibrationFamily {
  const replayCount = entries.reduce(
    (total, entry) => total + entry.replayCount,
    0,
  );
  const completedCount = entries.reduce(
    (total, entry) => total + entry.completedCount,
    0,
  );
  const top = entries
    .filter(
      (entry) =>
        entry.recordStatus === "active" &&
        entry.sourceQualificationStatus === "qualified" &&
        entry.outcomeQualificationStatus === "qualified",
    )
    .sort(compareExecutionPlanBlueprintPortfolioEntries)
    .at(0);
  const latestBaseline = entries
    .filter((entry) => entry.baselineSha256 && entry.baselinePromotedAt)
    .sort((left, right) =>
      (right.baselinePromotedAt ?? "").localeCompare(
        left.baselinePromotedAt ?? "",
      ),
    )
    .at(0);
  return {
    familySha256,
    recordCount: entries.length,
    activeCount: entries.filter((entry) => entry.recordStatus === "active")
      .length,
    archivedCount: entries.filter((entry) => entry.recordStatus === "archived")
      .length,
    sourceQualifiedCount: entries.filter(
      (entry) => entry.sourceQualificationStatus === "qualified",
    ).length,
    outcomeQualifiedCount: entries.filter(
      (entry) => entry.outcomeQualificationStatus === "qualified",
    ).length,
    reviewedBaselineCount: entries.filter((entry) => entry.reviewedBaseline)
      .length,
    replayCount,
    completedCount,
    blockedCount: entries.reduce(
      (total, entry) => total + entry.blockedCount,
      0,
    ),
    invalidCount: entries.reduce(
      (total, entry) => total + entry.invalidCount,
      0,
    ),
    completionRateBps:
      replayCount > 0 ? Math.round((completedCount / replayCount) * 10_000) : 0,
    ...(top ? { topRecordId: top.recordId } : {}),
    ...(top ? { topRecordScoreBps: top.completionRateBps } : {}),
    ...(latestBaseline?.baselineSha256
      ? { latestBaselineSha256: latestBaseline.baselineSha256 }
      : {}),
  };
}

export function compareExecutionPlanBlueprintPortfolioEntries(
  left: ExecutionPlanBlueprintPortfolioCalibrationEntry,
  right: ExecutionPlanBlueprintPortfolioCalibrationEntry,
): number {
  const scoreOrder = right.completionRateBps - left.completionRateBps;
  if (scoreOrder !== 0) return scoreOrder;
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

export function executionPlanBlueprintRecommendationScoreBps(input: {
  outcomeCompletionBps: number;
  familyCompletionBps: number;
  reviewedBaselineCoverageBps: number;
  replayEvidenceBps: number;
  policy: ExecutionPlanBlueprintRecommendationPolicy;
}): number {
  const weights = input.policy.weights;
  return Math.round(
    (input.outcomeCompletionBps * weights.outcomeCompletionBps +
      input.familyCompletionBps * weights.familyCompletionBps +
      input.reviewedBaselineCoverageBps * weights.reviewedBaselineBps +
      input.replayEvidenceBps * weights.replayEvidenceBps) /
      10_000,
  );
}

export function executionPlanBlueprintFamilyReviewedBaselineCoverageBps(
  family: ExecutionPlanBlueprintPortfolioCalibrationFamily,
): number {
  return family.recordCount > 0
    ? Math.round((family.reviewedBaselineCount / family.recordCount) * 10_000)
    : 0;
}

export function executionPlanBlueprintReplayEvidenceBps(replayCount: number): number {
  return Math.min(10_000, replayCount * 1_000);
}

export function executionPlanBlueprintRecommendationPolicySha256(
  policy: ExecutionPlanBlueprintRecommendationPolicy,
): string {
  return sha256(canonicalJson(policy));
}

export function executionPlanBlueprintRecommendationPolicySetSha256(
  policies: ExecutionPlanBlueprintRecommendationPolicy[],
): string {
  return sha256(
    canonicalJson(
      policies.map((policy) => ({
        templateId: policy.templateId,
        recommendationPolicySha256:
          executionPlanBlueprintRecommendationPolicySha256(policy),
      })),
    ),
  );
}

export function executionPlanBlueprintRecommendationPolicyOverrideSetSha256(
  overrides: ExecutionPlanBlueprintRecommendationPolicyOverride[],
): string {
  return sha256(
    canonicalJson(
      overrides
        .map((override) => ({
          familySha256: override.familySha256,
          contentSha256: override.contentSha256,
        }))
        .sort((left, right) =>
          left.familySha256.localeCompare(right.familySha256),
        ),
    ),
  );
}

export function listExecutionPlanBlueprintRecommendationPolicies(): ExecutionPlanBlueprintRecommendationPolicy[] {
  return EXECUTION_PLAN_BLUEPRINT_RECOMMENDATION_POLICY_TEMPLATE_IDS.map(
    (templateId) =>
      normalizeExecutionPlanBlueprintRecommendationPolicy(templateId),
  );
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
