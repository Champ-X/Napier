import type { RunLimits } from "@napier/contracts";

export interface RunConvergenceSnapshot {
  turnIndex: number;
  elapsedMs: number;
  progressed: boolean;
  productProgressed: boolean;
  acceptanceProgressed: boolean;
  supportProgressed: boolean;
  regressed: boolean;
  stagnantTurnCount: number;
  stagnantElapsedMs: number;
  acquisitionOnlyTurnCount: number;
  acquisitionStagnantTurnCount: number;
  supportCount: number;
  acquisitionAttemptCount: number;
  acquisitionAttemptCountSinceProgress: number;
  acquisitionAdvanceCountSinceProgress: number;
  productCount: number;
  acceptanceCount: number;
  failureFingerprintCount: number;
  failureDomainCount: number;
  failureDomainCountSinceProgress: number;
  unclassifiedActivityCountSinceProgress: number;
  contentSha256: string;
}

export interface RunAcquisitionPhase {
  attempts: number;
  advances: number;
  failureDomains: number;
}

export type RunConvergenceReason =
  | "support_phase"
  | "marginal_yield"
  | "failure_pressure"
  | "elapsed";

export interface RunConvergencePolicy {
  zeroYieldMinimumAttempts: number;
  lowYieldMinimumAttempts: number;
  lowYieldMaximumRatio: number;
  failureDomainPressure: number;
  limitPressureRatio: number;
  noProgressTurnThreshold: number;
  noProgressElapsedMs: number;
  resourceCircuitFailures: number;
  failureDomainCircuitFailures: number;
  unclassifiedActivityLeaseTurns: number;
}

export const DEFAULT_RUN_CONVERGENCE_POLICY: Readonly<RunConvergencePolicy> =
  Object.freeze({
    zeroYieldMinimumAttempts: 2,
    lowYieldMinimumAttempts: 5,
    lowYieldMaximumRatio: 0.5,
    failureDomainPressure: 3,
    // Time alone never closes acquisition. It only breaks a tie after recent
    // marginal yield has stopped and the Run is under material limit pressure.
    limitPressureRatio: 0.65,
    noProgressTurnThreshold: 6,
    noProgressElapsedMs: 180_000,
    resourceCircuitFailures: 2,
    failureDomainCircuitFailures: 3,
    unclassifiedActivityLeaseTurns: 2,
  });

export function projectRunAcquisitionPhase(
  vector: RunConvergenceSnapshot,
  baseline: {
    acquisitionAttemptCountSinceProgress: number;
    acquisitionAdvanceCountSinceProgress: number;
    failureDomainCount: number;
  },
): RunAcquisitionPhase {
  return {
    attempts: Math.max(
      0,
      vector.acquisitionAttemptCountSinceProgress -
        baseline.acquisitionAttemptCountSinceProgress,
    ),
    advances: Math.max(
      0,
      vector.acquisitionAdvanceCountSinceProgress -
        baseline.acquisitionAdvanceCountSinceProgress,
    ),
    failureDomains: Math.max(
      0,
      vector.failureDomainCountSinceProgress - baseline.failureDomainCount,
    ),
  };
}

export function evaluateRunConvergence(
  vector: RunConvergenceSnapshot,
  phase: RunAcquisitionPhase,
  limits: RunLimits,
  policy: Readonly<RunConvergencePolicy> = DEFAULT_RUN_CONVERGENCE_POLICY,
): RunConvergenceReason | undefined {
  if (vector.productProgressed || vector.acceptanceProgressed) return undefined;
  const marginalYield =
    phase.attempts > 0 ? phase.advances / phase.attempts : 1;
  if (
    phase.attempts >= policy.zeroYieldMinimumAttempts &&
    phase.advances === 0 &&
    vector.acquisitionStagnantTurnCount >= 1
  ) {
    return "marginal_yield";
  }
  if (
    phase.failureDomains >= policy.failureDomainPressure &&
    phase.attempts >= policy.zeroYieldMinimumAttempts
  ) {
    return "failure_pressure";
  }
  if (
    phase.attempts >= policy.lowYieldMinimumAttempts &&
    marginalYield <= policy.lowYieldMaximumRatio
  ) {
    return "support_phase";
  }
  const limitPressure = Math.max(
    vector.turnIndex / limits.maxTurns,
    vector.elapsedMs / limits.timeoutMs,
  );
  if (
    phase.attempts >= policy.zeroYieldMinimumAttempts + 1 &&
    vector.acquisitionStagnantTurnCount >= 1 &&
    marginalYield < 1 &&
    limitPressure >= policy.limitPressureRatio
  ) {
    return "elapsed";
  }
  return undefined;
}

export function hasRunNoProgressPressure(
  vector: RunConvergenceSnapshot,
  phase: RunAcquisitionPhase,
  policy: Readonly<RunConvergencePolicy> = DEFAULT_RUN_CONVERGENCE_POLICY,
): boolean {
  const acquisitionIsNotAdvancing =
    phase.attempts === 0 || vector.acquisitionStagnantTurnCount >= 2;
  return (
    acquisitionIsNotAdvancing &&
    (vector.stagnantTurnCount >= policy.noProgressTurnThreshold ||
      vector.stagnantElapsedMs >= policy.noProgressElapsedMs)
  );
}

export function noProgressReason(
  vector: RunConvergenceSnapshot,
  policy: Readonly<RunConvergencePolicy> = DEFAULT_RUN_CONVERGENCE_POLICY,
): "turns" | "elapsed" {
  return vector.stagnantTurnCount >= policy.noProgressTurnThreshold
    ? "turns"
    : "elapsed";
}

export function runNoProgressMessage(vector: RunConvergenceSnapshot): string {
  return [
    "Internal convergence redirect: the Run has made no measurable product or acceptance progress.",
    `Bound vector ${vector.contentSha256}; turn ${String(vector.turnIndex)}; stagnant turns ${String(vector.stagnantTurnCount)}; stagnant ms ${String(vector.stagnantElapsedMs)}.`,
    "Perform one smallest safe operation that advances the product or its verification, or produce the best concrete partial result now.",
    "If this turn still makes no measurable progress, deterministic finalization will stop the Run.",
  ].join("\n");
}
