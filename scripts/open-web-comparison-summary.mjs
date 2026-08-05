const TRACKS = ["default", "controlled"];

export function openWebComparisonSummary(cases) {
  const byTrack = {};
  for (const track of TRACKS) {
    const pairs = cases.flatMap((entry) =>
      entry.tracks
        .filter((candidate) => candidate.track === track)
        .flatMap((candidate) => candidate.trials),
    );
    byTrack[track] = summarizePairs(pairs);
  }
  return {
    byTrack,
    overall: summarizePairs(
      cases.flatMap((entry) =>
        entry.tracks.flatMap((candidate) => candidate.trials),
      ),
    ),
  };
}

function summarizePairs(pairs) {
  const decisivePairs = pairs.filter(
    (pair) => decisive(pair.napier) && decisive(pair.omp),
  );
  return {
    pairCount: pairs.length,
    decisivePairCount: decisivePairs.length,
    excludedPairCount: pairs.length - decisivePairs.length,
    napier: summarizeExecutor(pairs.map((pair) => pair.napier)),
    omp: summarizeExecutor(pairs.map((pair) => pair.omp)),
    paired: {
      bothPassed: decisivePairs.filter(
        (pair) => pair.napier.outcomePassed && pair.omp.outcomePassed,
      ).length,
      napierOnlyPassed: decisivePairs.filter(
        (pair) => pair.napier.outcomePassed && !pair.omp.outcomePassed,
      ).length,
      ompOnlyPassed: decisivePairs.filter(
        (pair) => !pair.napier.outcomePassed && pair.omp.outcomePassed,
      ).length,
      neitherPassed: decisivePairs.filter(
        (pair) => !pair.napier.outcomePassed && !pair.omp.outcomePassed,
      ).length,
    },
  };
}

function decisive(outcome) {
  return outcome.status === "passed" || outcome.status === "failed";
}

function summarizeExecutor(outcomes) {
  return {
    passed: outcomes.filter((entry) => entry.status === "passed").length,
    failed: outcomes.filter((entry) => entry.status === "failed").length,
    inconclusive: outcomes.filter((entry) => entry.status === "inconclusive")
      .length,
    infrastructureFailure: outcomes.filter(
      (entry) => entry.status === "infrastructure_failure",
    ).length,
    meanDurationMs: mean(outcomes.map((entry) => entry.durationMs)),
    meanCostUsd: mean(
      outcomes.map((entry) => entry.usage.costUsd),
      12,
    ),
    totalToolFailed: outcomes.reduce(
      (total, entry) => total + entry.toolFailed,
      0,
    ),
    totalManualInterventions: outcomes.reduce(
      (total, entry) => total + entry.manualInterventionCount,
      0,
    ),
  };
}

function mean(values, digits = 3) {
  if (values.length === 0) return 0;
  return Number(
    (values.reduce((total, value) => total + value, 0) / values.length).toFixed(
      digits,
    ),
  );
}
