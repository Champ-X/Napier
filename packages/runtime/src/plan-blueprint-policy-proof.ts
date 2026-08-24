import {
  NAPIER_API_VERSION,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle,
  type ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem,
} from "@napier/contracts";
import { nowIso } from "./ids.js";
import {
  compareExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
  executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256,
  retirementHistoryHashContent,
  validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult,
} from "./plan-blueprint-policy-retirement.js";
import {
  isNonNegativeInteger,
  isRecord,
  isSha256,
} from "./plan-blueprint-portfolio-model.js";
import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export function createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle(
  histories: unknown[],
): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle {
  const proofItems = histories.map((history, index) =>
    createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem(
      history,
      index,
    ),
  );
  const validItems = proofItems.filter((item) => item.status === "valid");
  const validContentHashes = validItems
    .map((item) => item.declaredContentSha256)
    .filter(isSha256);
  const validPortfolioSetHashes = validItems
    .map((item) => item.declaredPortfolioSetSha256)
    .filter(isSha256);
  const validCurrentOverrideSetHashes = validItems
    .map((item) => item.declaredCurrentOverrideSetSha256)
    .filter(isSha256);
  const validRetirementSetHashes = validItems
    .map((item) => item.declaredRetirementSetSha256)
    .filter(isSha256);
  const distinctHistoryCount = new Set(validContentHashes).size;
  const distinctPortfolioSetCount = new Set(validPortfolioSetHashes).size;
  const distinctCurrentOverrideSetCount = new Set(validCurrentOverrideSetHashes)
    .size;
  const distinctRetirementSetCount = new Set(validRetirementSetHashes).size;
  const diagnostics: string[] = [];
  if (histories.length < 2) diagnostics.push("history_count_below_min");
  if (proofItems.length !== validItems.length) {
    diagnostics.push("histories_invalid");
  }
  if (distinctPortfolioSetCount > 1)
    diagnostics.push("portfolio_set_divergent");
  if (distinctCurrentOverrideSetCount > 1) {
    diagnostics.push("current_override_set_divergent");
  }
  if (distinctRetirementSetCount > 1) {
    diagnostics.push("retirement_set_divergent");
  }
  const status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle["status"] =
    histories.length < 2 || proofItems.length !== validItems.length
      ? "invalid"
      : diagnostics.length > 0
        ? "divergent"
        : "aligned";
  const content = {
    kind: "napier.execution-plan-blueprint-recommendation-policy-override-retirement-history-proof-bundle" as const,
    schemaVersion: 1 as const,
    apiVersion: NAPIER_API_VERSION,
    status,
    diagnostics,
    historyCount: proofItems.length,
    validHistoryCount: validItems.length,
    invalidHistoryCount: proofItems.length - validItems.length,
    distinctHistoryCount,
    distinctPortfolioSetCount,
    distinctCurrentOverrideSetCount,
    distinctRetirementSetCount,
    historySetSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
        validContentHashes,
      ),
    portfolioSetBundleSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
        validPortfolioSetHashes,
      ),
    currentOverrideSetBundleSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
        validCurrentOverrideSetHashes,
      ),
    retirementSetBundleSha256:
      executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
        validRetirementSetHashes,
      ),
    histories: proofItems,
  };
  return {
    ...content,
    generatedAt: nowIso(),
    contentSha256: sha256(canonicalJson(content)),
  };
}

interface RetirementHistoryProofFields {
  declaredContentSha256: string | undefined;
  recomputedContentSha256: string | undefined;
  declaredPortfolioSetSha256: string | undefined;
  declaredCurrentOverrideSetSha256: string | undefined;
  declaredRetirementSetSha256: string | undefined;
  retirementCount: number | undefined;
  latestRetiredAt: string | undefined;
}

interface RetirementHistoryProofRecomputedFields {
  recomputedRetirementSetSha256: string | undefined;
  recomputedRetirementCount: number | undefined;
  recomputedLatestRetiredAt: string | undefined;
}

function readRetirementHistoryProofFields(
  record: Record<string, unknown> | undefined,
): RetirementHistoryProofFields {
  return {
    declaredContentSha256: isSha256(record?.["contentSha256"])
      ? record["contentSha256"]
      : undefined,
    recomputedContentSha256: record
      ? sha256(canonicalJson(retirementHistoryHashContent(record)))
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

function recomputeRetirementHistoryProofFields(
  record: Record<string, unknown> | undefined,
  diagnostics: string[],
): RetirementHistoryProofRecomputedFields {
  if (!record) {
    return {
      recomputedRetirementSetSha256: undefined,
      recomputedRetirementCount: undefined,
      recomputedLatestRetiredAt: undefined,
    };
  }
  if (!Array.isArray(record["retirements"])) {
    diagnostics.push("retirements_not_array");
    return {
      recomputedRetirementSetSha256: undefined,
      recomputedRetirementCount: undefined,
      recomputedLatestRetiredAt: undefined,
    };
  }
  try {
    const retirements = record["retirements"]
      .map(
        validateExecutionPlanBlueprintRecommendationPolicyOverrideRetirementResult,
      )
      .sort(
        compareExecutionPlanBlueprintRecommendationPolicyOverrideRetirements,
      );
    return {
      recomputedRetirementSetSha256:
        executionPlanBlueprintRecommendationPolicyOverrideRetirementSetSha256(
          retirements,
        ),
      recomputedRetirementCount: retirements.length,
      recomputedLatestRetiredAt: retirements.at(-1)?.retiredAt,
    };
  } catch {
    diagnostics.push("retirements_invalid");
    return {
      recomputedRetirementSetSha256: undefined,
      recomputedRetirementCount: undefined,
      recomputedLatestRetiredAt: undefined,
    };
  }
}

function appendRetirementHistoryProofShapeDiagnostics(
  record: Record<string, unknown> | undefined,
  diagnostics: string[],
): void {
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

function appendRetirementHistoryProofHashDiagnostics(
  fields: RetirementHistoryProofFields,
  recomputed: RetirementHistoryProofRecomputedFields,
  diagnostics: string[],
): void {
  if (!fields.declaredContentSha256) diagnostics.push("content_hash_missing");
  if (
    fields.declaredContentSha256 &&
    fields.recomputedContentSha256 &&
    fields.declaredContentSha256 !== fields.recomputedContentSha256
  ) {
    diagnostics.push("content_hash_mismatch");
  }
  if (!fields.declaredPortfolioSetSha256) {
    diagnostics.push("portfolio_set_missing");
  }
  if (!fields.declaredCurrentOverrideSetSha256) {
    diagnostics.push("current_override_set_missing");
  }
  if (!fields.declaredRetirementSetSha256) {
    diagnostics.push("retirement_set_missing");
  }
  if (
    fields.declaredRetirementSetSha256 &&
    recomputed.recomputedRetirementSetSha256 &&
    fields.declaredRetirementSetSha256 !==
      recomputed.recomputedRetirementSetSha256
  ) {
    diagnostics.push("retirement_set_hash_mismatch");
  }
}

function appendRetirementHistoryProofSummaryDiagnostics(
  record: Record<string, unknown> | undefined,
  fields: RetirementHistoryProofFields,
  recomputed: RetirementHistoryProofRecomputedFields,
  diagnostics: string[],
): void {
  if (
    fields.retirementCount !== undefined &&
    recomputed.recomputedRetirementCount !== undefined &&
    fields.retirementCount !== recomputed.recomputedRetirementCount
  ) {
    diagnostics.push("retirement_count_mismatch");
  }
  if (record?.["latestRetiredAt"] !== undefined && !fields.latestRetiredAt) {
    diagnostics.push("latest_retired_at_invalid");
  }
  if (fields.latestRetiredAt !== recomputed.recomputedLatestRetiredAt) {
    diagnostics.push("latest_retired_at_mismatch");
  }
}

export function createExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem(
  input: unknown,
  index: number,
): ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem {
  const diagnostics: string[] = [];
  const record = isRecord(input) ? input : undefined;
  if (!record) diagnostics.push("history_not_object");
  const fields = readRetirementHistoryProofFields(record);
  const recomputed = recomputeRetirementHistoryProofFields(record, diagnostics);
  appendRetirementHistoryProofShapeDiagnostics(record, diagnostics);
  appendRetirementHistoryProofHashDiagnostics(fields, recomputed, diagnostics);
  appendRetirementHistoryProofSummaryDiagnostics(
    record,
    fields,
    recomputed,
    diagnostics,
  );
  const status: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleItem["status"] =
    diagnostics.length === 0 ? "valid" : "invalid";
  const content = {
    index,
    status,
    diagnostics,
    ...(fields.declaredContentSha256
      ? { declaredContentSha256: fields.declaredContentSha256 }
      : {}),
    ...(fields.recomputedContentSha256
      ? { recomputedContentSha256: fields.recomputedContentSha256 }
      : {}),
    ...(fields.declaredPortfolioSetSha256
      ? { declaredPortfolioSetSha256: fields.declaredPortfolioSetSha256 }
      : {}),
    ...(fields.declaredCurrentOverrideSetSha256
      ? {
          declaredCurrentOverrideSetSha256:
            fields.declaredCurrentOverrideSetSha256,
        }
      : {}),
    ...(fields.declaredRetirementSetSha256
      ? { declaredRetirementSetSha256: fields.declaredRetirementSetSha256 }
      : {}),
    ...(recomputed.recomputedRetirementSetSha256
      ? {
          recomputedRetirementSetSha256:
            recomputed.recomputedRetirementSetSha256,
        }
      : {}),
    ...(fields.retirementCount !== undefined
      ? { retirementCount: fields.retirementCount }
      : {}),
    ...(recomputed.recomputedRetirementCount !== undefined
      ? { recomputedRetirementCount: recomputed.recomputedRetirementCount }
      : {}),
    ...(fields.latestRetiredAt
      ? { latestRetiredAt: fields.latestRetiredAt }
      : {}),
    ...(recomputed.recomputedLatestRetiredAt
      ? { recomputedLatestRetiredAt: recomputed.recomputedLatestRetiredAt }
      : {}),
  };
  return {
    ...content,
    itemSha256: sha256(canonicalJson(content)),
  };
}

export function executionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryBundleSetSha256(
  hashes: string[],
): string {
  return sha256(canonicalJson([...new Set(hashes)].sort()));
}
