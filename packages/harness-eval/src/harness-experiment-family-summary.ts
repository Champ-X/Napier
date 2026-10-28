import type {
  HarnessExperiment,
  HarnessExperimentMetric,
  HarnessExperimentTrial,
  HarnessFamilySummary,
} from "@napier/contracts/harness-experiments";

export function familySummaries(
  experiment: HarnessExperiment,
  trials: readonly HarnessExperimentTrial[],
): HarnessFamilySummary[] {
  const groups = new Map<
    string,
    {
      taskFamily: string;
      partition: HarnessFamilySummary["partition"];
      ids: Set<string>;
    }
  >();
  for (const item of experiment.cases) {
    const taskFamily = item.taskFamily ?? item.id;
    const partition = item.partition ?? "regression";
    const key = `${taskFamily}:${partition}`;
    const group = groups.get(key) ?? {
      taskFamily,
      partition,
      ids: new Set<string>(),
    };
    group.ids.add(item.id);
    groups.set(key, group);
  }
  return [...groups.values()].flatMap(({ taskFamily, partition, ids }) =>
    (["baseline", "candidate"] as const).map((arm) => {
      const observed = trials.filter(
        (trial) => trial.arm === arm && ids.has(trial.caseId),
      );
      const expectedTrials = ids.size * experiment.seeds.length;
      const values = (metric: HarnessExperimentMetric) =>
        observed.flatMap((trial) =>
          trial.metrics[metric] === undefined ? [] : [trial.metrics[metric]!],
        );
      const complete = (metric: HarnessExperimentMetric) => {
        const result = values(metric);
        return result.length === expectedTrials ? result : null;
      };
      const successes = complete("task_success");
      const costs = complete("cost_usd");
      const durations = complete("duration_ms")?.sort((a, b) => a - b);
      const interventions = complete("intervention_count");
      const falseCompletions = complete("false_completion");
      const successCount = successes && sum(successes);
      return {
        taskFamily,
        partition,
        arm,
        expectedTrials,
        observedTrials: observed.length,
        successRate: successes ? sum(successes) / expectedTrials : null,
        // Includes spend on failed tasks; never best-of-retry or success-only cost.
        costPerSuccessUsd:
          costs && successCount ? sum(costs) / successCount : null,
        durationP95Ms:
          durations?.[Math.ceil(durations.length * 0.95) - 1] ?? null,
        interventionRate: interventions
          ? interventions.filter((value) => value > 0).length / expectedTrials
          : null,
        falseCompletionRate: falseCompletions
          ? sum(falseCompletions) / expectedTrials
          : null,
      };
    }),
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
