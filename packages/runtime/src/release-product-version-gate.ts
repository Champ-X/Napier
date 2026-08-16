import type {
  ReleaseProductTrial,
  ReleaseProductVersionGate,
} from "@napier/contracts/release-product-trial";

export function projectReleaseProductVersion(
  productVersion: string,
  trials: ReleaseProductTrial[],
  caseCount: number,
  criticalCaseIds: string[],
  minimumSuccessRate: number,
  requireReleaseIdentity: boolean,
  expectedReleaseIdentitySha256?: string,
): ReleaseProductVersionGate {
  const latestByCase = new Map<string, ReleaseProductTrial>();
  for (const trial of trials) latestByCase.set(trial.templateCaseId, trial);
  const effectiveTrials = [...latestByCase.values()];
  const releaseIdentities = new Set(
    effectiveTrials.flatMap((trial) =>
      trial.releaseIdentitySha256 ? [trial.releaseIdentitySha256] : [],
    ),
  );
  const releaseIdentitySha256 =
    releaseIdentities.size === 1 ? [...releaseIdentities][0] : undefined;
  const releaseIdentityValid =
    !requireReleaseIdentity ||
    (releaseIdentities.size === 1 &&
      effectiveTrials.every(
        (trial) => trial.releaseIdentitySha256 === releaseIdentitySha256,
      ) &&
      (!expectedReleaseIdentitySha256 ||
        releaseIdentitySha256 === expectedReleaseIdentitySha256));
  const failedCriticalCaseIds = criticalCaseIds.filter(
    (caseId) => latestByCase.get(caseId)?.status !== "passed",
  );
  const passedCount = effectiveTrials.filter(
    (trial) => trial.status === "passed",
  ).length;
  const failedCount = effectiveTrials.filter(
    (trial) => trial.status === "failed",
  ).length;
  const inconclusiveCount = effectiveTrials.length - passedCount - failedCount;
  const successRate = effectiveTrials.length
    ? Number((passedCount / effectiveTrials.length).toFixed(4))
    : 0;
  const coveredCaseCount = latestByCase.size;
  const status =
    coveredCaseCount < caseCount
      ? "incomplete"
      : successRate < minimumSuccessRate ||
          failedCriticalCaseIds.length > 0 ||
          !releaseIdentityValid
        ? "failed"
        : "passed";
  return {
    productVersion,
    caseCount,
    coveredCaseCount,
    trialCount: effectiveTrials.length,
    passedCount,
    failedCount,
    inconclusiveCount,
    successRate,
    minimumSuccessRate,
    meanUxScore: meanUxScore(effectiveTrials),
    configurationInterventions: sumMetric(
      effectiveTrials,
      "configurationInterventions",
    ),
    humanInterventions: sumMetric(effectiveTrials, "humanInterventions"),
    recoveryEvents: sumMetric(effectiveTrials, "recoveryEvents"),
    criticalCaseIds,
    failedCriticalCaseIds,
    ...(releaseIdentitySha256 ? { releaseIdentitySha256 } : {}),
    status,
    firstRecordedAt: trials[0]!.recordedAt,
    lastRecordedAt: trials.at(-1)!.recordedAt,
  };
}

function meanUxScore(trials: ReleaseProductTrial[]): number {
  return trials.length
    ? Number(
        (
          trials.reduce((sum, trial) => sum + trial.uxScore, 0) / trials.length
        ).toFixed(2),
      )
    : 0;
}

function sumMetric(
  trials: ReleaseProductTrial[],
  metric:
    | "configurationInterventions"
    | "humanInterventions"
    | "recoveryEvents",
): number {
  return trials.reduce((sum, trial) => sum + trial[metric], 0);
}
