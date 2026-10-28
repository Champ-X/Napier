import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type {
  HarnessExperimentTrial,
  HarnessExperimentMetric,
} from "@napier/contracts/harness-experiments";
import { canonicalJson, sha256 } from "@napier/runtime/harness-eval-support";
import {
  createHarnessExperiment,
  createModelHarnessExperimentProfile,
  evaluateHarnessExperiment,
  executeHarnessExperiment,
  validateHarnessExperiment,
  validateHarnessExperimentExecution,
  validateHarnessExperimentReleaseEvidence,
} from "../src/harness-experiments.js";

function experiment(
  overrides: Partial<Parameters<typeof createHarnessExperiment>[0]> = {},
) {
  return createHarnessExperiment({
    id: "analysis-regression-v1",
    baselineProfile: createModelHarnessExperimentProfile({
      id: "baseline-v1",
      maxActiveTools: 20,
    }),
    candidateProfile: createModelHarnessExperimentProfile({
      id: "candidate-v1",
      maxActiveTools: 12,
    }),
    cases: Array.from({ length: 30 }, (_, index) => ({
      id: `case-${index}`,
      inputSha256: sha256(`input-${index}`),
      tags: ["coding"],
      taskFamily: `family-${index}`,
    })),
    seeds: [11, 22, 33],
    modelRouteLock: {
      role: "default",
      servingModel: { provider: "fixture", id: "fixed" },
      fallbackSamples: "separate_stratum",
    },
    primaryMetrics: ["task_success"],
    guardrailMetrics: ["intervention_count"],
    decisionRule: { primaryNonInferiorityMargin: 0.02 },
    ...overrides,
  });
}

function matrix(
  definition = experiment(),
  metrics: (
    caseIndex: number,
    arm: "baseline" | "candidate",
    seed: number,
  ) => Partial<Record<HarnessExperimentMetric, number>> = () => ({
    task_success: 1,
  }),
): HarnessExperimentTrial[] {
  return definition.cases.flatMap((item, index) =>
    definition.seeds.flatMap((seed) =>
      (["baseline", "candidate"] as const).map((arm) => ({
        caseId: item.id,
        seed,
        arm,
        runId: `${item.id}-${seed}-${arm}`,
        servingModel: definition.modelRouteLock.servingModel,
        fallbackUsed: false,
        profileSha256: (arm === "baseline"
          ? definition.baselineProfile
          : definition.candidateProfile
        ).contentSha256,
        harnessReceiptSha256: sha256(`${item.id}-${seed}-${arm}`),
        metrics: { intervention_count: 0, ...metrics(index, arm, seed) },
      })),
    ),
  );
}

describe("pre-registered clustered Harness analysis", () => {
  it("never calls the 90/90 -> 89/90 tolerated decline improved", () => {
    const definition = experiment();
    const trials = matrix(definition);
    trials.find((trial) => trial.arm === "candidate")!.metrics.task_success = 0;
    const result = evaluateHarnessExperiment(definition, trials);
    expect(result.verdict).toBe("inconclusive");
    expect(result.primary[0]!.delta).toBeCloseTo(-1 / 90);
    expect(result.primary[0]!.confidenceInterval!.lower).toBeLessThan(-0.02);
    expect(result.primary[0]!.clusterCount).toBe(30);
  });

  it.each([
    [1, 1, "non_inferior"],
    [1, 0.99, "non_inferior"],
    [1, 0.98, "non_inferior"],
    [0, 1, "improved"],
    [1, 0, "regressed"],
  ] as const)(
    "classifies uniform changes %s -> %s as %s",
    (baseline, candidate, verdict) => {
      const definition = experiment();
      const result = evaluateHarnessExperiment(
        definition,
        matrix(definition, (_, arm) => ({
          task_success: arm === "baseline" ? baseline : candidate,
        })),
      );
      expect(result.verdict).toBe(verdict);
    },
  );

  it("applies metric direction and minimum meaningful change in the declared unit", () => {
    const definition = experiment({
      primaryMetrics: ["duration_ms"],
      analysis: {
        metrics: {
          duration_ms: {
            unit: "milliseconds",
            direction: "lower",
            nonInferiorityMargin: 2,
            minimumEffectiveDifference: 10,
          },
        },
      },
    });
    for (const [candidate, verdict] of [
      [95, "non_inferior"],
      [80, "improved"],
      [105, "regressed"],
    ] as const) {
      const result = evaluateHarnessExperiment(
        definition,
        matrix(definition, (_, arm) => ({
          duration_ms: arm === "baseline" ? 100 : candidate,
        })),
      );
      expect(result.verdict).toBe(verdict);
    }
  });

  it("does not claim improvement when its interval crosses the decision boundary", () => {
    const definition = experiment();
    const trials = matrix(definition, (index, arm) => ({
      task_success: arm === "baseline" ? 0.5 : index < 16 ? 1 : 0,
    }));
    const result = evaluateHarnessExperiment(definition, trials);
    expect(result.primary[0]!.delta).toBeGreaterThan(0);
    expect(result.primary[0]!.confidenceInterval!.lower).toBeLessThan(0);
    expect(result.verdict).toBe("inconclusive");
    expect(evaluateHarnessExperiment(definition, trials)).toEqual(result);
  });

  it("repeating seeds does not manufacture independent cases or narrower intervals", () => {
    const definition = experiment();
    const repeated = experiment({
      seeds: Array.from({ length: 30 }, (_, index) => index),
    });
    const observations = (index: number, arm: "baseline" | "candidate") => ({
      task_success: arm === "baseline" ? 0.5 : index < 16 ? 1 : 0,
    });
    const first = evaluateHarnessExperiment(
      definition,
      matrix(definition, observations),
    );
    const second = evaluateHarnessExperiment(
      repeated,
      matrix(repeated, observations),
    );
    expect(second.primary[0]!.pairCount).toBe(900);
    expect(second.primary[0]!.clusterCount).toBe(30);
    expect(second.primary[0]!.confidenceInterval).toEqual(
      first.primary[0]!.confidenceInterval,
    );
  });

  it("uses task families as independent clusters when requested", () => {
    const base = experiment();
    const definition = experiment({
      cases: base.cases.map((item, index) => ({
        ...item,
        taskFamily: `family-${Math.floor(index / 3)}`,
      })),
      analysis: { clusterBy: "task_family" },
    });
    const result = evaluateHarnessExperiment(definition, matrix(definition));
    expect(result.primary[0]!.clusterCount).toBe(10);
    expect(result.primary[0]!.pairCount).toBe(90);
    expect(result.verdict).toBe("non_inferior");
  });

  it("retains missing metric and trial evidence instead of dropping it from the denominator", () => {
    const definition = experiment();
    const trials = matrix(definition);
    delete trials[0]!.metrics.task_success;
    expect(evaluateHarnessExperiment(definition, trials).verdict).toBe(
      "insufficient_evidence",
    );
    const result = evaluateHarnessExperiment(definition, trials.slice(1));
    expect(result.missingPairCount).toBe(1);
    expect(result.verdict).toBe("insufficient_evidence");
    expect(
      result.families!.find(
        (family) =>
          family.taskFamily === definition.cases[0]!.taskFamily &&
          family.arm === "baseline",
      )!.successRate,
    ).toBeNull();
  });

  it("fails closed on fixture observations in a live-model experiment", () => {
    const definition = experiment({ analysis: { evidenceKind: "live_model" } });
    const result = evaluateHarnessExperiment(definition, matrix(definition));
    expect(result.evidenceKindMismatchPairCount).toBe(90);
    expect(result.verdict).toBe("insufficient_evidence");
  });

  it("binds rules before outcomes and rejects task-family leakage across partitions", () => {
    const definition = experiment();
    const tampered = structuredClone(definition);
    tampered.analysis!.metrics.task_success!.nonInferiorityMargin = 1;
    expect(() => validateHarnessExperiment(tampered)).toThrow("hash binding");
    expect(() =>
      experiment({
        cases: definition.cases.map((item, index) => ({
          ...item,
          taskFamily: "same-family",
          partition: index ? "tuning" : "holdout",
        })),
      }),
    ).toThrow("cannot span");
    expect(() =>
      experiment({
        analysis: {
          metrics: {
            task_success: {
              unit: "usd",
              direction: "lower",
              nonInferiorityMargin: 0,
              minimumEffectiveDifference: 0,
            },
          },
        },
      }),
    ).toThrow("metric rule");
  });

  it("reports family cost including failures, tail latency, intervention and false completion", () => {
    const base = experiment();
    const definition = experiment({
      cases: base.cases.map((item) => ({ ...item, taskFamily: "coding" })),
    });
    const trials = matrix(definition, (index) => ({
      task_success: index < 15 ? 1 : 0,
      cost_usd: 2,
      duration_ms: index + 1,
      intervention_count: index < 3 ? 2 : 0,
      false_completion: index < 6 ? 1 : 0,
    }));
    expect(evaluateHarnessExperiment(definition, trials).families![0]).toEqual({
      taskFamily: "coding",
      partition: "regression",
      arm: "baseline",
      expectedTrials: 90,
      observedTrials: 90,
      successRate: 0.5,
      costPerSuccessUsd: 4,
      durationP95Ms: 29,
      interventionRate: 0.1,
      falseCompletionRate: 0.2,
    });
  });

  it("keeps all failed cells and balanced dispatch order without retrying", async () => {
    const definition = experiment();
    const dispatched: string[] = [];
    const result = await executeHarnessExperiment({
      experiment: definition,
      execute: async (request) => {
        dispatched.push(request.arm);
        throw new Error("simulated transport failure");
      },
    });
    expect(result.failures).toHaveLength(180);
    expect(result.evaluation.missingPairCount).toBe(90);
    expect(result.evaluation.verdict).toBe("insufficient_evidence");
    expect(validateHarnessExperimentExecution(result, definition)).toEqual(
      result,
    );
    const missing = structuredClone(result);
    missing.failures!.pop();
    expect(() =>
      validateHarnessExperimentExecution(missing, definition),
    ).toThrow("balanced schedule");
    expect(dispatched.slice(0, 8)).toEqual([
      "baseline",
      "candidate",
      "candidate",
      "baseline",
      "baseline",
      "candidate",
      "candidate",
      "baseline",
    ]);
  });

  it("still verifies the untouched historical receipt without upgrading its evidence scope", async () => {
    const retained = JSON.parse(
      await readFile(
        new URL(
          "../../../docs/artifacts/harness-experiment-release-evidence-0.1.3.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const before = sha256(canonicalJson(retained));
    const verified = validateHarnessExperimentReleaseEvidence(retained);
    expect(sha256(canonicalJson(verified))).toBe(before);
    expect(verified.claimScope).toBeUndefined();
    expect(verified.experiment.modelRouteLock.servingModel.provider).toBe(
      "fixture",
    );
  });

  it("corrects the direction bug when evaluating a legacy definition too", () => {
    const { analysis: _analysis, contentSha256: _hash, ...base } = experiment();
    const cases = base.cases.map(
      ({ taskFamily: _family, partition: _partition, ...item }) => item,
    );
    const content = {
      ...base,
      cases,
      caseSetDigest: sha256(canonicalJson(cases)),
    };
    const definition = {
      ...content,
      contentSha256: sha256(canonicalJson(content)),
    };
    const trials = matrix(definition);
    trials.find((trial) => trial.arm === "candidate")!.metrics.task_success = 0;
    expect(evaluateHarnessExperiment(definition, trials).verdict).toBe(
      "non_inferior",
    );
  });
});
