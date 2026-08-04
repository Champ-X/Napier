import type {
  ExecutionPlanBlueprintRecordOutcomeBaseline,
  ExecutionPlanBlueprintRecordOutcomeBaselinePolicy,
  ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate,
  ExecutionPlanBlueprintRecordOutcomeQualification,
  ExecutionPlanBlueprintRecordReplayOutcomes,
} from "@napier/contracts";

import {
  storeCanonicalJson as canonicalJson,
  storeSha256 as sha256,
} from "./store-hashing.js";

export const DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy =
  {
    minReplayCount: 1,
    minCompletionRateBps: 10_000,
    maxBlockedCount: 0,
    maxInvalidCount: 0,
  };

export const DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE: ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate =
  {
    minScore: 80,
    maxRisk: "medium",
  };

export function normalizeExecutionPlanBlueprintOutcomeBaselinePolicy(
  policy:
    | Partial<ExecutionPlanBlueprintRecordOutcomeBaselinePolicy>
    | undefined,
): ExecutionPlanBlueprintRecordOutcomeBaselinePolicy {
  const normalized = {
    minReplayCount:
      policy?.minReplayCount ??
      DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY.minReplayCount,
    minCompletionRateBps:
      policy?.minCompletionRateBps ??
      DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY.minCompletionRateBps,
    maxBlockedCount:
      policy?.maxBlockedCount ??
      DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY.maxBlockedCount,
    maxInvalidCount:
      policy?.maxInvalidCount ??
      DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_POLICY.maxInvalidCount,
  };
  if (!validOutcomePolicy(normalized)) {
    throw new Error(
      "Execution plan blueprint outcome baseline policy is invalid",
    );
  }
  return normalized;
}

export function normalizeExecutionPlanBlueprintOutcomeBaselineReviewGate(
  gate:
    | Partial<ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate>
    | undefined,
): ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate {
  const normalized = {
    minScore:
      gate?.minScore ??
      DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE.minScore,
    maxRisk:
      gate?.maxRisk ??
      DEFAULT_EXECUTION_PLAN_BLUEPRINT_OUTCOME_BASELINE_REVIEW_GATE.maxRisk,
  };
  if (
    !nonNegativeInteger(normalized.minScore) ||
    normalized.minScore > 100 ||
    !validRisk(normalized.maxRisk)
  ) {
    throw new Error(
      "Execution plan blueprint outcome baseline review gate is invalid",
    );
  }
  return normalized;
}

export function executionPlanBlueprintOutcomePolicyDiagnostics(
  outcomes: Pick<
    ExecutionPlanBlueprintRecordReplayOutcomes,
    "replayCount" | "completionRateBps" | "blockedCount" | "invalidCount"
  >,
  policy: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy,
): string[] {
  const diagnostics: string[] = [];
  pushDiagnostic(
    diagnostics,
    outcomes.replayCount < policy.minReplayCount,
    "replay_count_below_min",
  );
  pushDiagnostic(
    diagnostics,
    outcomes.completionRateBps < policy.minCompletionRateBps,
    "completion_rate_below_min",
  );
  pushDiagnostic(
    diagnostics,
    outcomes.blockedCount > policy.maxBlockedCount,
    "blocked_count_above_max",
  );
  pushDiagnostic(
    diagnostics,
    outcomes.invalidCount > policy.maxInvalidCount,
    "invalid_count_above_max",
  );
  return diagnostics;
}

export function createExecutionPlanBlueprintOutcomeQualification(
  recordId: string,
  outcomes: ExecutionPlanBlueprintRecordReplayOutcomes,
  baseline: ExecutionPlanBlueprintRecordOutcomeBaseline | undefined,
): ExecutionPlanBlueprintRecordOutcomeQualification {
  const diagnostics = baseline
    ? executionPlanBlueprintOutcomePolicyDiagnostics(outcomes, baseline.policy)
    : ["baseline_missing"];
  const status: ExecutionPlanBlueprintRecordOutcomeQualification["status"] =
    !baseline
      ? "missing_baseline"
      : diagnostics.length === 0
        ? "qualified"
        : "policy_failed";
  const content = {
    schemaVersion: 1 as const,
    status,
    diagnostics,
    recordId,
    ...(baseline
      ? {
          baselineId: baseline.id,
          baselineSha256: baseline.contentSha256,
          baselineOutcomesSha256: baseline.replayOutcomesSha256,
          policy: baseline.policy,
        }
      : {}),
    currentOutcomesSha256: outcomes.contentSha256,
    currentReplayHistorySha256: outcomes.replayHistorySha256,
    currentOutcomeSetSha256: outcomes.outcomeSetSha256,
    replayCount: outcomes.replayCount,
    completedCount: outcomes.completedCount,
    blockedCount: outcomes.blockedCount,
    invalidCount: outcomes.invalidCount,
    completionRateBps: outcomes.completionRateBps,
  };
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}

function validOutcomePolicy(
  policy: ExecutionPlanBlueprintRecordOutcomeBaselinePolicy,
): boolean {
  return (
    nonNegativeInteger(policy.minReplayCount) &&
    policy.minReplayCount >= 1 &&
    policy.minReplayCount <= 10_000 &&
    nonNegativeInteger(policy.minCompletionRateBps) &&
    policy.minCompletionRateBps <= 10_000 &&
    nonNegativeInteger(policy.maxBlockedCount) &&
    policy.maxBlockedCount <= 10_000 &&
    nonNegativeInteger(policy.maxInvalidCount) &&
    policy.maxInvalidCount <= 10_000
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validRisk(
  value: string,
): value is ExecutionPlanBlueprintRecordOutcomeBaselineReviewGate["maxRisk"] {
  return value === "low" || value === "medium" || value === "high";
}

function pushDiagnostic(
  diagnostics: string[],
  condition: boolean,
  diagnostic: string,
): void {
  if (condition) diagnostics.push(diagnostic);
}
