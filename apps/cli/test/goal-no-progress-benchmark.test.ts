import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { loadGoalNoProgressBenchmarkCase } from "../src/goal-no-progress-benchmark-case.js";
import { verifyGoalNoProgressBenchmarkArtifacts } from "../src/goal-no-progress-benchmark-contract.js";
import {
  runGoalNoProgressBenchmark,
  type GoalNoProgressBenchmarkDependencies,
} from "../src/goal-no-progress-benchmark.js";
import {
  runGoalNoProgressBenchmarkSeries,
  verifyGoalNoProgressBenchmarkSeries,
} from "../src/goal-no-progress-benchmark-series.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/long-horizon/goal-no-progress-v1",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Goal no-progress outcome benchmark", () => {
  it("loads the hash-bound case", async () => {
    const benchmarkCase = await loadGoalNoProgressBenchmarkCase(CASE_ROOT);
    expect(benchmarkCase).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        id: "long_horizon_goal_no_progress_v1",
        expectedContinuationCount: 2,
        expectedEvaluationCount: 3,
        expectedNoProgressCount: 2,
        expectedPrimaryResponseCount: 3,
        expectedModelResponseCount: 7,
        contentSha256:
          "b41964b9e96f539ad1feb16ac8bf6dd592531d9a90b47f060430a8c6ce711c07",
      }),
    );
  });

  it("blocks repeated evidence, reopens Runtime, and emits CAS artifacts", async () => {
    const outputDir = await temporaryOutput();
    const provider = scriptedProvider();
    const artifacts = await runGoalNoProgressBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-goal-progress", id: "faux-1" },
        env: {},
      },
      dependencies(provider),
    );

    expect(provider.state.callCount).toBe(7);
    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        run: expect.objectContaining({ status: "completed" }),
        evaluation: expect.objectContaining({
          status: "passed",
          goalStatus: "blocked",
          goalBlocker: "goal_not_met_yet",
          continuationCount: 2,
          noProgressCount: 2,
          goalEvaluationCount: 3,
          continuationStartedCount: 2,
          primaryResponseCount: 3,
          repeatedResponseCount: 3,
          modelResponseCount: 7,
          modelResponseErrorCount: 0,
          postBlockContinuationCount: 0,
          goalRecovered: true,
          replayValid: true,
          credentialLeakDetected: false,
          diagnostics: [],
        }),
      }),
    );
    expect(
      artifacts.bundle.goalEvents.filter(
        (event) => event.type === "goal.evaluated",
      ),
    ).toHaveLength(3);
    expect(
      artifacts.bundle.goalEvents.filter(
        (event) => event.type === "goal.continuation.started",
      ),
    ).toHaveLength(2);
    expect(artifacts.bundle.assistantEvents).toHaveLength(3);
    expect(artifacts.bundle.goal).toEqual(
      expect.objectContaining({
        status: "blocked",
        continuationCount: 2,
        noProgressCount: 2,
      }),
    );
    expect(
      verifyGoalNoProgressBenchmarkArtifacts(
        artifacts.result,
        artifacts.bundle,
      ),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));

    const tampered = structuredClone(artifacts.bundle);
    const finalEvaluation = tampered.goalEvents
      .filter((event) => event.type === "goal.evaluated")
      .at(-1)!;
    finalEvaluation.payload["noProgressCount"] = 1;
    const { contentSha256: _contentSha256, ...content } = tampered;
    tampered.contentSha256 = sha256(canonicalJson(content));
    expect(
      verifyGoalNoProgressBenchmarkArtifacts(artifacts.result, tampered),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining([
          "ledger_binding_mismatch",
          "evaluation_evidence_mismatch",
        ]),
      }),
    );
  }, 30_000);

  it("aggregates independent trials and rejects substitution", async () => {
    const outputDir = await temporaryOutput();
    const provider = scriptedProvider(2);
    const artifacts = await runGoalNoProgressBenchmarkSeries(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-goal-progress", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      dependencies(provider),
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        completedTrialCount: 2,
        passedTrialCount: 2,
        failedTrialCount: 0,
        inconclusiveTrialCount: 0,
        successRate: 1,
        passRate: 1,
      }),
    );
    expect(
      verifyGoalNoProgressBenchmarkSeries(artifacts.series, artifacts.trials),
    ).toEqual({
      valid: true,
      diagnostics: [],
      seriesSha256: artifacts.series.contentSha256,
      trialDiagnostics: [],
    });

    const substituted = structuredClone(artifacts.series);
    substituted.trials[0]!.resultSha256 = substituted.trials[1]!.resultSha256;
    expect(
      verifyGoalNoProgressBenchmarkSeries(substituted, artifacts.trials),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining([
          "series_shape_invalid",
          "series_trial_invalid",
        ]),
      }),
    );
  }, 30_000);
});

function scriptedProvider(trialCount = 1) {
  const provider = fauxProvider({
    provider: "faux-goal-progress",
    tokenSize: { min: 10_000, max: 10_000 },
  });
  provider.setResponses(
    Array.from({ length: trialCount }, () => [
      repeatedEvidence(),
      continueEvaluation(),
      repeatedEvidence(),
      continueEvaluation(),
      repeatedEvidence(),
      continueEvaluation(),
      fauxAssistantMessage('{"proposals":[]}'),
    ]).flat(),
  );
  return provider;
}

function dependencies(
  provider: ReturnType<typeof scriptedProvider>,
): GoalNoProgressBenchmarkDependencies {
  return {
    now: () => new Date("2026-08-04T00:00:00.000Z"),
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const runtime = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("goal-progress-benchmark-test"),
      });
      runtime.models.registerProvider(provider.provider);
      return runtime;
    },
  };
}

function repeatedEvidence() {
  return fauxAssistantMessage(
    "Evidence: alpha marker completed. Beta and gamma remain unfinished; autonomous work can continue.",
  );
}

function continueEvaluation() {
  return fauxAssistantMessage(
    JSON.stringify({
      satisfied: false,
      blocker: "goal_not_met_yet",
      reason: "The fixture cannot produce new evidence.",
      evidence:
        "Evidence: alpha marker completed. Beta and gamma remain unfinished; autonomous work can continue.",
    }),
  );
}

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-goal-output-"));
  roots.push(root);
  return root;
}
