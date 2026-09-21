import type {
  AutomaticRecoveryPolicy,
  RunLimits,
  SubagentLimits,
} from "@napier/contracts";

export const DEFAULT_SUBAGENT_LIMITS: Readonly<SubagentLimits> = {
  maxConcurrent: 4,
  maxTotal: 8,
  maxTurns: 16,
  timeoutMs: 300_000,
};

export const DEFAULT_RUN_LIMITS: Readonly<RunLimits> = {
  maxTurns: 64,
  maxTotalTokens: 0,
  maxCostUsd: 25,
  timeoutMs: 1_800_000,
};

export const DEFAULT_AUTOMATIC_RECOVERY_POLICY: Readonly<AutomaticRecoveryPolicy> =
  {
    mode: "manual",
    maxAttempts: 2,
    backoffMs: 5_000,
  };

export function normalizeAutomaticRecoveryPolicy(
  input: AutomaticRecoveryPolicy,
): AutomaticRecoveryPolicy {
  if (!input || (input.mode !== "manual" && input.mode !== "safe_read_only")) {
    throw new Error("Automatic recovery mode is invalid");
  }
  return {
    mode: input.mode,
    maxAttempts: boundedInteger(
      input.maxAttempts,
      "Automatic recovery maxAttempts",
      1,
      3,
    ),
    backoffMs: boundedInteger(
      input.backoffMs,
      "Automatic recovery backoffMs",
      1_000,
      3_600_000,
    ),
  };
}

export function normalizeSubagentLimits(input: SubagentLimits): SubagentLimits {
  return {
    maxConcurrent: boundedInteger(input.maxConcurrent, "maxConcurrent", 1, 8),
    maxTotal: boundedInteger(input.maxTotal, "maxTotal", 1, 24),
    maxTurns: boundedInteger(input.maxTurns, "maxTurns", 1, 32),
    timeoutMs: boundedInteger(input.timeoutMs, "timeoutMs", 1_000, 900_000),
  };
}

export function normalizeRunLimits(input: RunLimits): RunLimits {
  return {
    maxTurns: boundedInteger(input.maxTurns, "run maxTurns", 1, 128),
    maxTotalTokens:
      input.maxTotalTokens === 0
        ? 0
        : boundedInteger(
            input.maxTotalTokens,
            "run maxTotalTokens",
            1_000,
            10_000_000,
          ),
    maxCostUsd: boundedNumber(input.maxCostUsd, "run maxCostUsd", 0.01, 1_000),
    timeoutMs: boundedInteger(
      input.timeoutMs,
      "run timeoutMs",
      10_000,
      3_600_000,
    ),
  };
}

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return value;
}

function boundedNumber(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be from ${minimum} to ${maximum}`);
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}
