import {
  NAPIER_API_VERSION,
  type ExecutionPlanBlueprintRecommendationPolicyOverride,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification,
  type RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import {
  isNonNegativeInteger,
  isRecord,
  isSha256,
} from "./plan-blueprint-portfolio-model.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export function createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult(input: {
  override: ExecutionPlanBlueprintRecommendationPolicyOverride;
  portfolioSetSha256: string;
  overrideSetSha256: string;
  driftReviewSetSha256: string;
  remainingOverrideSetSha256: string;
  retiredAt: string;
}): RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult {
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    familySha256: input.override.familySha256,
    retiredOverrideSha256: input.override.contentSha256,
    retiredRecommendationPolicyTemplate:
      input.override.recommendationPolicy.templateId,
    retiredRecommendationPolicySha256:
      input.override.recommendationPolicySha256,
    portfolioSetSha256: input.portfolioSetSha256,
    overrideSetSha256: input.overrideSetSha256,
    driftReviewSetSha256: input.driftReviewSetSha256,
    remainingOverrideSetSha256: input.remainingOverrideSetSha256,
    retiredAt: input.retiredAt,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult(
  value: unknown,
): RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult {
  if (!isRecord(value)) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override retirement is invalid",
    );
  }
  const retirement =
    value as unknown as RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult;
  if (
    retirement.kind !==
      "napier.execution-plan-blueprint-recommendation-policy-override-retirement" ||
    retirement.schemaVersion !== 1 ||
    retirement.apiVersion !== NAPIER_API_VERSION ||
    !isSha256(retirement.familySha256) ||
    !isSha256(retirement.retiredOverrideSha256) ||
    (retirement.retiredRecommendationPolicyTemplate !== "balanced" &&
      retirement.retiredRecommendationPolicyTemplate !== "delivery_first" &&
      retirement.retiredRecommendationPolicyTemplate !== "portfolio_first") ||
    !isSha256(retirement.retiredRecommendationPolicySha256) ||
    !isSha256(retirement.portfolioSetSha256) ||
    !isSha256(retirement.overrideSetSha256) ||
    !isSha256(retirement.driftReviewSetSha256) ||
    !isSha256(retirement.remainingOverrideSetSha256) ||
    !Number.isFinite(Date.parse(retirement.retiredAt)) ||
    !isSha256(retirement.contentSha256)
  ) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override retirement is invalid",
    );
  }
  const { contentSha256: _contentSha256, ...content } = retirement;
  if (sha256(canonicalJson(content)) !== retirement.contentSha256) {
    throw new Error(
      "Execution Plan blueprint recommendation policy override retirement hash mismatch",
    );
  }
  return structuredClone(retirement);
}

export function createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory(input: {
  retirements: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult[];
  portfolioSetSha256: string;
  currentOverrideSetSha256: string;
}): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory {
  const retirements = input.retirements
    .map(
      validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult,
    )
    .sort(compareExecutionPlanBlueprintRecommendationPolicyOverrideRetirements);
  const latest = retirements.at(-1);
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    retirementCount: retirements.length,
    portfolioSetSha256: input.portfolioSetSha256,
    currentOverrideSetSha256: input.currentOverrideSetSha256,
    retirementSetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256(
        retirements,
      ),
    ...(latest ? { latestRetiredAt: latest.retiredAt } : {}),
    retirements,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

interface RetirementHistoryDeclaredFields {
  declaredContentSha256: string | undefined;
  declaredPortfolioSetSha256: string | undefined;
  declaredCurrentOverrideSetSha256: string | undefined;
  declaredRetirementSetSha256: string | undefined;
  retirementCount: number | undefined;
  latestRetiredAt: string | undefined;
}

function readRetirementHistoryDeclaredFields(
  record: Record<string, unknown> | undefined,
): RetirementHistoryDeclaredFields {
  return {
    declaredContentSha256: isSha256(record?.["contentSha256"])
      ? record["contentSha256"]
      : undefined,
    declaredPortfolioSetSha256: isSha256(record?.["portfolioSetSha256"])
      ? record["portfolioSetSha256"]
      : undefined,
    declaredCurrentOverrideSetSha256: isSha256(
      record?.["currentOverrideSetSha256"],
    )
      ? record["currentOverrideSetSha256"]
      : undefined,
    declaredRetirementSetSha256: isSha256(record?.["retirementSetSha256"])
      ? record["retirementSetSha256"]
      : undefined,
    retirementCount: isNonNegativeInteger(record?.["retirementCount"])
      ? record["retirementCount"]
      : undefined,
    latestRetiredAt:
      typeof record?.["latestRetiredAt"] === "string" &&
      Number.isFinite(Date.parse(record["latestRetiredAt"]))
        ? record["latestRetiredAt"]
        : undefined,
  };
}

function recomputeRetirementHistorySetSha256(
  record: Record<string, unknown> | undefined,
  diagnostics: string[],
): string | undefined {
  if (!record) return undefined;
  if (!Array.isArray(record["retirements"])) {
    diagnostics.push("retirements_not_array");
    return undefined;
  }
  try {
    return executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256(
      record["retirements"].map(
        validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult,
      ),
    );
  } catch {
    diagnostics.push("retirements_invalid");
    return undefined;
  }
}

function appendRetirementHistoryShapeDiagnostics(
  record: Record<string, unknown> | undefined,
  diagnostics: string[],
): void {
  if (!record) diagnostics.push("history_not_object");
  if (
    record?.["kind"] !==
    "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history"
  ) {
    diagnostics.push("kind_mismatch");
  }
  if (record?.["schemaVersion"] !== 1) diagnostics.push("schema_mismatch");
  if (record?.["apiVersion"] !== NAPIER_API_VERSION) {
    diagnostics.push("api_version_mismatch");
  }
}

function appendRetirementHistoryContentDiagnostics(
  declared: RetirementHistoryDeclaredFields,
  recomputedContentSha256: string | undefined,
  observed: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  diagnostics: string[],
): void {
  if (!declared.declaredContentSha256) diagnostics.push("content_hash_missing");
  if (
    declared.declaredContentSha256 &&
    recomputedContentSha256 &&
    declared.declaredContentSha256 !== recomputedContentSha256
  ) {
    diagnostics.push("content_hash_mismatch");
  }
  if (
    declared.declaredContentSha256 &&
    declared.declaredContentSha256 !== observed.contentSha256
  ) {
    diagnostics.push("current_history_mismatch");
  }
}

function appendRetirementHistorySetDiagnostics(
  declared: RetirementHistoryDeclaredFields,
  recomputedRetirementSetSha256: string | undefined,
  observed: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  diagnostics: string[],
): void {
  if (!declared.declaredPortfolioSetSha256) {
    diagnostics.push("portfolio_set_missing");
  }
  if (declared.declaredPortfolioSetSha256 !== observed.portfolioSetSha256) {
    diagnostics.push("portfolio_set_mismatch");
  }
  if (!declared.declaredCurrentOverrideSetSha256) {
    diagnostics.push("current_override_set_missing");
  }
  if (
    declared.declaredCurrentOverrideSetSha256 !==
    observed.currentOverrideSetSha256
  ) {
    diagnostics.push("current_override_set_mismatch");
  }
  if (!declared.declaredRetirementSetSha256) {
    diagnostics.push("retirement_set_missing");
  }
  if (
    declared.declaredRetirementSetSha256 &&
    recomputedRetirementSetSha256 &&
    declared.declaredRetirementSetSha256 !== recomputedRetirementSetSha256
  ) {
    diagnostics.push("retirement_set_hash_mismatch");
  }
  if (declared.declaredRetirementSetSha256 !== observed.retirementSetSha256) {
    diagnostics.push("retirement_set_mismatch");
  }
}

function appendRetirementHistorySummaryDiagnostics(
  record: Record<string, unknown> | undefined,
  declared: RetirementHistoryDeclaredFields,
  observed: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
  diagnostics: string[],
): void {
  if (declared.retirementCount !== observed.retirementCount) {
    diagnostics.push("retirement_count_mismatch");
  }
  if (record?.["latestRetiredAt"] !== undefined && !declared.latestRetiredAt) {
    diagnostics.push("latest_retired_at_invalid");
  }
  if (declared.latestRetiredAt !== observed.latestRetiredAt) {
    diagnostics.push("latest_retired_at_mismatch");
  }
}

export function verifyExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProjection(
  input: unknown,
  observed: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory,
): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification {
  const diagnostics: string[] = [];
  const record = isRecord(input) ? input : undefined;
  const declared = readRetirementHistoryDeclaredFields(record);
  const recomputedContentSha256 = record
    ? sha256(canonicalJson(retirementHistoryHashContent(record)))
    : undefined;
  const recomputedRetirementSetSha256 = recomputeRetirementHistorySetSha256(
    record,
    diagnostics,
  );
  appendRetirementHistoryShapeDiagnostics(record, diagnostics);
  appendRetirementHistoryContentDiagnostics(
    declared,
    recomputedContentSha256,
    observed,
    diagnostics,
  );
  appendRetirementHistorySetDiagnostics(
    declared,
    recomputedRetirementSetSha256,
    observed,
    diagnostics,
  );
  appendRetirementHistorySummaryDiagnostics(
    record,
    declared,
    observed,
    diagnostics,
  );
  const status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-verification" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    status,
    diagnostics,
    ...(declared.declaredContentSha256
      ? { declaredContentSha256: declared.declaredContentSha256 }
      : {}),
    ...(recomputedContentSha256 ? { recomputedContentSha256 } : {}),
    observedContentSha256: observed.contentSha256,
    ...(declared.declaredPortfolioSetSha256
      ? { declaredPortfolioSetSha256: declared.declaredPortfolioSetSha256 }
      : {}),
    observedPortfolioSetSha256: observed.portfolioSetSha256,
    ...(declared.declaredCurrentOverrideSetSha256
      ? {
          declaredCurrentOverrideSetSha256:
            declared.declaredCurrentOverrideSetSha256,
        }
      : {}),
    observedCurrentOverrideSetSha256: observed.currentOverrideSetSha256,
    ...(declared.declaredRetirementSetSha256
      ? { declaredRetirementSetSha256: declared.declaredRetirementSetSha256 }
      : {}),
    ...(recomputedRetirementSetSha256 ? { recomputedRetirementSetSha256 } : {}),
    observedRetirementSetSha256: observed.retirementSetSha256,
    ...(declared.retirementCount !== undefined
      ? { retirementCount: declared.retirementCount }
      : {}),
    observedRetirementCount: observed.retirementCount,
    ...(declared.latestRetiredAt
      ? { latestRetiredAt: declared.latestRetiredAt }
      : {}),
    ...(observed.latestRetiredAt
      ? { observedLatestRetiredAt: observed.latestRetiredAt }
      : {}),
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

export function compareExecutionPlanBlueprintRecommendationPolicyOverrideRetirements(
  left: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
  right: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult,
): number {
  const retiredOrder = left.retiredAt.localeCompare(right.retiredAt);
  if (retiredOrder !== 0) return retiredOrder;
  return left.contentSha256.localeCompare(right.contentSha256);
}

export function executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256(
  retirements: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult[],
): string {
  return sha256(
    canonicalJson(
      retirements
        .map((retirement) => ({
          familySha256: retirement.familySha256,
          retiredOverrideSha256: retirement.retiredOverrideSha256,
          contentSha256: retirement.contentSha256,
        }))
        .sort((left, right) => {
          const familyOrder = left.familySha256.localeCompare(
            right.familySha256,
          );
          if (familyOrder !== 0) return familyOrder;
          return left.contentSha256.localeCompare(right.contentSha256);
        }),
    ),
  );
}

export function retirementHistoryHashContent(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const {
    generatedAt: _generatedAt,
    contentSha256: _contentSha256,
    ...content
  } = record;
  return content;
}
