import type { RunLimits, RunRecord } from "@napier/contracts";
import type {
  HarnessComparisonDimension,
  HarnessComparisonFairness,
  RunHarnessComparison,
  RunHarnessEffectDelta,
  RunHarnessEffectMetrics,
} from "@napier/contracts/run-harness-effects";

import { canonicalJson, sha256 } from "./ed25519.js";

export const HARNESS_BUDGET_RELATIVE_TOLERANCE = 0.05;

export function compareRunHarnessEffects(
  leftRun: RunRecord,
  left: RunHarnessEffectMetrics,
  rightRun: RunRecord,
  right: RunHarnessEffectMetrics,
): RunHarnessComparison {
  const delta = effectDelta(left, right);
  const fairness = comparisonFairness(leftRun, left, rightRun, right);
  const harnessResolution = compareDigest(
    left.harnessResolution.resolutionSequenceSha256,
    right.harnessResolution.resolutionSequenceSha256,
  );
  const content = { left, right, delta, fairness, harnessResolution };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function effectDelta(
  left: RunHarnessEffectMetrics,
  right: RunHarnessEffectMetrics,
): RunHarnessEffectDelta {
  return {
    firstReadElapsedMs: optionalDelta(
      left.firstAction.read.elapsedMs,
      right.firstAction.read.elapsedMs,
    ),
    firstWriteElapsedMs: optionalDelta(
      left.firstAction.write.elapsedMs,
      right.firstAction.write.elapsedMs,
    ),
    firstVerifyElapsedMs: optionalDelta(
      left.firstAction.verify.elapsedMs,
      right.firstAction.verify.elapsedMs,
    ),
    repeatedCallCount:
      right.toolEfficiency.repeatedCallCount -
      left.toolEfficiency.repeatedCallCount,
    repeatedCallRate: optionalDelta(
      left.toolEfficiency.repeatedCallRate,
      right.toolEfficiency.repeatedCallRate,
    ),
    noNewInformationCount:
      right.toolEfficiency.noNewInformationCount -
      left.toolEfficiency.noNewInformationCount,
    noNewInformationRate: optionalDelta(
      left.toolEfficiency.noNewInformationRate,
      right.toolEfficiency.noNewInformationRate,
    ),
    systemPromptTokenShare: optionalDelta(
      left.contextTokens.systemPromptTokenShare,
      right.contextTokens.systemPromptTokenShare,
    ),
    toolDefinitionTokenShare: optionalDelta(
      left.contextTokens.toolDefinitionTokenShare,
      right.contextTokens.toolDefinitionTokenShare,
    ),
    overflowAttemptCount:
      right.overflow.attemptCount - left.overflow.attemptCount,
    overflowRecoveredCount:
      right.overflow.recoveredCount - left.overflow.recoveredCount,
    overflowFailedCount: right.overflow.failedCount - left.overflow.failedCount,
    interventionCount: right.interventions.count - left.interventions.count,
    taskOutcomeChanged: left.taskOutcome.status !== right.taskOutcome.status,
  };
}

function comparisonFairness(
  leftRun: RunRecord,
  left: RunHarnessEffectMetrics,
  rightRun: RunRecord,
  right: RunHarnessEffectMetrics,
): HarnessComparisonFairness {
  const leftModel = runModel(leftRun);
  const rightModel = runModel(rightRun);
  const dimensions = {
    provider: compareIdentity(leftModel?.provider, rightModel?.provider),
    model: compareIdentity(leftModel?.id, rightModel?.id),
    task: compareDigest(left.taskInputSha256, right.taskInputSha256),
    environment: compareDigest(
      environmentSha256(leftRun),
      environmentSha256(rightRun),
    ),
    budget: compareBudgets(runLimits(leftRun), runLimits(rightRun)),
  };
  const diagnostics = Object.entries(dimensions).flatMap(([name, dimension]) =>
    dimension.status === "matched" ? [] : [`${name}_${dimension.status}`],
  );
  const statuses = Object.values(dimensions).map(
    (dimension) => dimension.status,
  );
  const content = {
    kind: "napier.harness-comparison-fairness" as const,
    schemaVersion: 1 as const,
    status: statuses.includes("mismatched")
      ? ("not_comparable" as const)
      : statuses.includes("unavailable")
        ? ("insufficient_evidence" as const)
        : ("comparable" as const),
    ...dimensions,
    diagnostics,
    leftMetricsSha256: left.contentSha256,
    rightMetricsSha256: right.contentSha256,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function compareIdentity(
  left: string | undefined,
  right: string | undefined,
): HarnessComparisonDimension {
  return compareDigest(
    left === undefined ? undefined : sha256(left),
    right === undefined ? undefined : sha256(right),
  );
}

function compareDigest(
  leftSha256: string | undefined,
  rightSha256: string | undefined,
): HarnessComparisonDimension {
  if (!hash(leftSha256) || !hash(rightSha256)) {
    return {
      status: "unavailable",
      ...(hash(leftSha256) ? { leftSha256 } : {}),
      ...(hash(rightSha256) ? { rightSha256 } : {}),
    };
  }
  return {
    status: leftSha256 === rightSha256 ? "matched" : "mismatched",
    leftSha256: leftSha256!,
    rightSha256: rightSha256!,
  };
}

function compareBudgets(
  left: RunLimits | undefined,
  right: RunLimits | undefined,
): HarnessComparisonFairness["budget"] {
  const leftSha256 = left ? sha256(canonicalJson(left)) : undefined;
  const rightSha256 = right ? sha256(canonicalJson(right)) : undefined;
  if (!left || !right) {
    return {
      status: "unavailable",
      ...(leftSha256 ? { leftSha256 } : {}),
      ...(rightSha256 ? { rightSha256 } : {}),
    };
  }
  const maxRelativeDelta = Math.max(
    relativeDelta(left.maxTurns, right.maxTurns),
    relativeDelta(left.maxTotalTokens, right.maxTotalTokens),
    relativeDelta(left.maxCostUsd, right.maxCostUsd),
    relativeDelta(left.timeoutMs, right.timeoutMs),
  );
  return {
    status:
      maxRelativeDelta <= HARNESS_BUDGET_RELATIVE_TOLERANCE
        ? "matched"
        : "mismatched",
    leftSha256: leftSha256!,
    rightSha256: rightSha256!,
    maxRelativeDelta,
  };
}

function environmentSha256(run: RunRecord): string | undefined {
  const executionMode =
    run.configuration && "executionMode" in run.configuration
      ? run.configuration.executionMode
      : undefined;
  if (!executionMode || !hash(run.releaseIdentitySha256)) return undefined;
  return sha256(
    canonicalJson({
      threadId: run.threadId,
      executionMode,
      releaseIdentitySha256: run.releaseIdentitySha256,
    }),
  );
}

function runModel(
  run: RunRecord,
): { provider: string; id: string } | undefined {
  return run.configuration?.model;
}

function runLimits(run: RunRecord): RunLimits | undefined {
  return run.limits ?? run.configuration?.runLimits;
}

function optionalDelta(
  left: number | null | undefined,
  right: number | null | undefined,
): number | null {
  return typeof left === "number" && typeof right === "number"
    ? right - left
    : null;
}

function relativeDelta(left: number, right: number): number {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(right - left) / scale;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
