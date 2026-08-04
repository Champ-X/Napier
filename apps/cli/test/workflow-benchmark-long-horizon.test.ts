import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { loadWorkflowBenchmarkCase } from "../src/workflow-benchmark-case.js";
import { verifyWorkflowBenchmarkArtifacts } from "../src/workflow-benchmark-contract.js";
import { verifyWorkflowBenchmarkLedgerBundle } from "../src/workflow-benchmark-ledger.js";
import {
  runWorkflowBenchmarkSeries,
  verifyWorkflowBenchmarkSeries,
} from "../src/workflow-benchmark-series.js";
import type { WorkflowBenchmarkDependencies } from "../src/workflow-benchmark.js";
import type { WorkflowBenchmarkLedgerBundle } from "../src/workflow-benchmark-types.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/long-horizon/restart-approval-map-reduce-v1",
);
const MULTI_RESTART_CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/long-horizon/multi-restart-approval-map-reduce-v1",
);
const OFFLINE_WAIT_CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/long-horizon/offline-wait-approval-map-reduce-v1",
);
const BUDGET_EXHAUSTION_CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/long-horizon/token-budget-exhaustion-map-reduce-v1",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Long-horizon outcome benchmark", () => {
  it("loads a hash-bound Runtime restart and Approval case", async () => {
    const loaded = await loadWorkflowBenchmarkCase(CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual({
      kind: "napier.workflow-benchmark-case",
      schemaVersion: 4,
      id: "long_horizon_restart_approval_v1",
      title: "Runtime restart and Approval recovery",
      objective:
        "Complete model-backed Map work, persist a pending Approval, close and reopen the Runtime, recover the decision, reuse every completed Map Run, and finish through model-free Reduce.",
      inputPath: "input.json",
      expectedPath: "expected.json",
      timeoutMs: 120000,
      inputSha256:
        "0942edc17cec9611112875030c680e9251e43d2fa81f3648ae509cd7f3ca9aa0",
      expectedSha256:
        "470bb14f4b11e4cd8903a651dbcf8ecc8b8402240700f990a22a541977157e29",
      scenario: "workflow_restart_approval_resume",
      requiredRestartCount: 1,
      approvalCustomText: "Resume after the verified Runtime restart.",
      contentSha256:
        "cd0c8079ce4461a40b7f34225502975b075a131f07791dfa64f276382fb9124c",
    });
  });

  it("loads a hash-bound repeated Runtime restart case", async () => {
    const loaded = await loadWorkflowBenchmarkCase(MULTI_RESTART_CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual({
      kind: "napier.workflow-benchmark-case",
      schemaVersion: 6,
      id: "long_horizon_multi_restart_approval_v1",
      title: "Repeated Runtime restart and Approval answer recovery",
      objective:
        "Complete model-backed Map work, recover a pending Approval after one Runtime restart, persist its answer, close and reopen the Runtime again, recover the answer, reuse every completed Map Run, and finish through model-free Reduce.",
      inputPath: "input.json",
      expectedPath: "expected.json",
      timeoutMs: 120000,
      inputSha256:
        "0942edc17cec9611112875030c680e9251e43d2fa81f3648ae509cd7f3ca9aa0",
      expectedSha256:
        "470bb14f4b11e4cd8903a651dbcf8ecc8b8402240700f990a22a541977157e29",
      scenario: "workflow_multi_restart_approval_resume",
      requiredRestartCount: 2,
      approvalCustomText: "Resume after both verified Runtime restarts.",
      contentSha256:
        "71b5885b79b36b423959f6c9e0da27ab8cd3b53827167fe33858127e67424d2e",
    });
  });

  it("loads a hash-bound offline wall-clock wait case", async () => {
    const loaded = await loadWorkflowBenchmarkCase(OFFLINE_WAIT_CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual({
      kind: "napier.workflow-benchmark-case",
      schemaVersion: 7,
      id: "long_horizon_offline_wait_approval_v1",
      title: "Offline wall-clock wait and Approval recovery",
      objective:
        "Complete model-backed Map work, close the Runtime for a bounded wall-clock interval, reopen before the original Approval deadline, recover the same decision, reuse every completed Map Run, and finish through model-free Reduce.",
      inputPath: "input.json",
      expectedPath: "expected.json",
      timeoutMs: 120000,
      inputSha256:
        "0942edc17cec9611112875030c680e9251e43d2fa81f3648ae509cd7f3ca9aa0",
      expectedSha256:
        "470bb14f4b11e4cd8903a651dbcf8ecc8b8402240700f990a22a541977157e29",
      scenario: "workflow_offline_wait_approval_resume",
      requiredRestartCount: 1,
      requiredOfflineWaitMs: 1000,
      approvalCustomText: "Resume after the verified offline wall-clock wait.",
      contentSha256:
        "c7dd56229d4e433308f13f9ad552ac2ce880c6e86c60baf9a6075291b4ce429d",
    });
  });

  it("loads a hash-bound token budget exhaustion case", async () => {
    const loaded = await loadWorkflowBenchmarkCase(BUDGET_EXHAUSTION_CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual({
      kind: "napier.workflow-benchmark-case",
      schemaVersion: 8,
      id: "long_horizon_token_budget_exhaustion_v1",
      title: "Map token budget exhaustion containment",
      objective:
        "Exhaust the first model-backed Map child at a frozen 1,000-token limit, retain its budget receipt, prevent later tool completion, stop the remaining Map items and Reduce, and verify the expected blocked Workflow offline.",
      inputPath: "input.json",
      expectedPath: "expected.json",
      timeoutMs: 120000,
      inputSha256:
        "0942edc17cec9611112875030c680e9251e43d2fa81f3648ae509cd7f3ca9aa0",
      expectedSha256:
        "470bb14f4b11e4cd8903a651dbcf8ecc8b8402240700f990a22a541977157e29",
      scenario: "workflow_map_token_budget_exhaustion",
      runTokenLimit: 1000,
      requiredBudgetReason: "tokens",
      requiredBudgetExhaustedRunCount: 1,
      contentSha256:
        "939ca57c1ba353fd5f35b628c8f615343cc623ac189d8113a3723878b77307c5",
    });
  });

  it("reopens Runtime, recovers Approval, and reuses completed Map Runs", async () => {
    const outputDir = await temporaryOutput();
    const provider = longHorizonProvider(6);
    const dependencies = longHorizonDependencies(provider);
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-long-horizon", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      dependencies,
    );

    expect(dependencies.runtimeCreateCount()).toBe(4);
    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        completedTrialCount: 2,
        passedTrialCount: 2,
        usageSampleCount: 2,
        successRate: 1,
        passRate: 1,
      }),
    );
    for (const trial of artifacts.trials) {
      expect(trial.result).toEqual(
        expect.objectContaining({
          status: "passed",
          run: expect.objectContaining({
            status: "completed",
          }),
          evaluation: expect.objectContaining({
            schemaVersion: 4,
            outputMatch: true,
            mapOutputMatch: true,
            completedNodeResultCount: 3,
            runtimeRestartCount: 1,
            approvalRecovered: true,
            completedMapRunsReused: true,
            postRestartModelResponseCount: 0,
            replayValid: true,
            diagnostics: [],
          }),
        }),
      );
      expect(trial.bundle.workflow.preRestartMapRunIds).toHaveLength(3);
      expect(trial.bundle.workflow.restartEvent).toEqual(
        expect.objectContaining({
          type: "benchmark.workflow.runtime.restarted",
          payload: expect.objectContaining({
            preRestartMapRunIds: trial.bundle.workflow.preRestartMapRunIds,
          }),
        }),
      );
      expect(
        verifyWorkflowBenchmarkArtifacts(trial.result, trial.bundle),
      ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
      expect(JSON.stringify(trial.bundle)).not.toContain("alpha");
    }

    expect(
      verifyWorkflowBenchmarkSeries(
        artifacts.series,
        artifacts.trials.map((trial) => ({
          resultFileName: path.basename(trial.resultPath),
          result: trial.result,
          bundle: trial.bundle,
        })),
      ),
    ).toEqual({
      valid: true,
      diagnostics: [],
      seriesSha256: artifacts.series.contentSha256,
      trialDiagnostics: [],
    });

    const tampered = structuredClone(
      artifacts.trials[0]!.bundle,
    ) as WorkflowBenchmarkLedgerBundle;
    const restartEvent = tampered.workflow.restartEvent!;
    if (!restartEvent.payload || typeof restartEvent.payload !== "object") {
      throw new Error("Long-horizon restart evidence is unavailable");
    }
    restartEvent.payload["preRestartReplaySha256"] = sha256(
      "substituted pre-restart replay",
    );
    tampered.contentSha256 = sha256(
      canonicalJson(withoutHash(tampered) as never),
    );
    expect(verifyWorkflowBenchmarkLedgerBundle(tampered)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_restart_evidence_invalid"],
      }),
    );
  }, 30_000);

  it("recovers the persisted Approval answer after a second Runtime restart", async () => {
    const outputDir = await temporaryOutput();
    const dependencies = longHorizonDependencies(longHorizonProvider(6));
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: MULTI_RESTART_CASE_ROOT,
        outputDir,
        model: { provider: "faux-long-horizon", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      dependencies,
    );

    expect(dependencies.runtimeCreateCount()).toBe(6);
    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        passedTrialCount: 2,
        usageSampleCount: 2,
        successRate: 1,
        passRate: 1,
      }),
    );
    for (const trial of artifacts.trials) {
      expect(trial.result.evaluation).toEqual(
        expect.objectContaining({
          schemaVersion: 6,
          runtimeRestartCount: 2,
          approvalRecovered: true,
          completedMapRunsReused: true,
          postRestartModelResponseCount: 0,
          replayValid: true,
          diagnostics: [],
        }),
      );
      expect(trial.bundle.workflow.restartEvents).toHaveLength(2);
      expect(trial.bundle.workflow.restartEvents?.[0]).toEqual(
        trial.bundle.workflow.restartEvent,
      );
      expect(
        trial.bundle.workflow.restartEvents?.map((event) => event.seq),
      ).toEqual(
        [...(trial.bundle.workflow.restartEvents ?? [])]
          .map((event) => event.seq)
          .sort((left, right) => left - right),
      );
      expect(
        verifyWorkflowBenchmarkArtifacts(trial.result, trial.bundle),
      ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    }

    const tampered = structuredClone(
      artifacts.trials[0]!.bundle,
    ) as WorkflowBenchmarkLedgerBundle;
    const secondRestart = tampered.workflow.restartEvents?.[1];
    if (
      !secondRestart?.payload ||
      typeof secondRestart.payload !== "object" ||
      Array.isArray(secondRestart.payload)
    ) {
      throw new Error("Second restart evidence is unavailable");
    }
    secondRestart.payload["decisionSha256"] = sha256(
      "substituted answered decision",
    );
    tampered.contentSha256 = sha256(
      canonicalJson(withoutHash(tampered) as never),
    );
    expect(verifyWorkflowBenchmarkLedgerBundle(tampered)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_restart_evidence_invalid"],
      }),
    );
  }, 30_000);

  it("preserves Approval deadline across a real offline wait", async () => {
    const outputDir = await temporaryOutput();
    const dependencies = longHorizonDependencies(longHorizonProvider(6));
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: OFFLINE_WAIT_CASE_ROOT,
        outputDir,
        model: { provider: "faux-long-horizon", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      dependencies,
    );

    expect(dependencies.runtimeCreateCount()).toBe(4);
    expect(artifacts.series).toEqual(
      expect.objectContaining({
        completedTrialCount: 2,
        passedTrialCount: 2,
        usageSampleCount: 2,
        successRate: 1,
        passRate: 1,
      }),
    );
    for (const trial of artifacts.trials) {
      expect(trial.result.evaluation).toEqual(
        expect.objectContaining({
          schemaVersion: 7,
          runtimeRestartCount: 1,
          approvalRecovered: true,
          completedMapRunsReused: true,
          postRestartModelResponseCount: 0,
          offlineWaitElapsedMs: expect.any(Number),
          offlineWaitSatisfied: true,
          approvalDeadlinePreserved: true,
          modelResponseCount: 3,
          diagnostics: [],
        }),
      );
      expect(
        trial.result.evaluation.offlineWaitElapsedMs,
      ).toBeGreaterThanOrEqual(1000);
      expect(trial.bundle.workflow.restartEvent?.payload).toEqual(
        expect.objectContaining({
          schemaVersion: 2,
          requiredOfflineWaitMs: 1000,
          approvalTimeoutMs: 120000,
        }),
      );
      expect(
        verifyWorkflowBenchmarkArtifacts(trial.result, trial.bundle),
      ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    }

    const shortWait = tamperedRestartBundle(artifacts.trials[0]!.bundle);
    shortWait.workflow.restartEvent!.payload["requiredOfflineWaitMs"] = 30_000;
    shortWait.contentSha256 = sha256(
      canonicalJson(withoutHash(shortWait) as never),
    );
    expect(verifyWorkflowBenchmarkLedgerBundle(shortWait)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_restart_evidence_invalid"],
      }),
    );

    const changedDeadline = tamperedRestartBundle(artifacts.trials[0]!.bundle);
    changedDeadline.workflow.restartEvent!.payload["approvalExpiresAt"] =
      "2026-08-02T00:00:01.000Z";
    changedDeadline.contentSha256 = sha256(
      canonicalJson(withoutHash(changedDeadline) as never),
    );
    expect(verifyWorkflowBenchmarkLedgerBundle(changedDeadline)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_restart_evidence_invalid"],
      }),
    );
  }, 30_000);

  it("contains Map token budget exhaustion before later side effects", async () => {
    const outputDir = await temporaryOutput();
    const provider = budgetExhaustionProvider(2);
    const dependencies = longHorizonDependencies(provider);
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: BUDGET_EXHAUSTION_CASE_ROOT,
        outputDir,
        model: { provider: "faux-long-horizon", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      dependencies,
    );

    expect(provider.state.callCount).toBe(2);
    expect(artifacts.series).toEqual(
      expect.objectContaining({
        completedTrialCount: 2,
        passedTrialCount: 2,
        successRate: 1,
        passRate: 1,
      }),
    );
    for (const trial of artifacts.trials) {
      expect(trial.result).toEqual(
        expect.objectContaining({
          status: "passed",
          run: expect.objectContaining({ status: "blocked" }),
          evaluation: expect.objectContaining({
            schemaVersion: 8,
            expectedBudgetReason: "tokens",
            expectedBudgetTokenLimit: 1000,
            expectedBudgetExhaustedRunCount: 1,
            budgetExhaustedRunCount: 1,
            budgetReasonMatch: true,
            budgetLimitMatch: true,
            postBudgetToolCompletedCount: 0,
            reduceCompletedEventCount: 0,
            modelResponseCount: 1,
            modelResponseErrorCount: 0,
            diagnostics: [],
          }),
        }),
      );
      expect(trial.bundle.workflow.budgetExhaustionEvents).toHaveLength(1);
      expect(trial.bundle.workflow).not.toHaveProperty("reduceRunId");
      expect(
        verifyWorkflowBenchmarkArtifacts(trial.result, trial.bundle),
      ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    }

    const tampered = structuredClone(
      artifacts.trials[0]!.bundle,
    ) as WorkflowBenchmarkLedgerBundle;
    tampered.workflow.budgetExhaustionEvents![0]!.payload["reason"] = "cost";
    tampered.contentSha256 = sha256(
      canonicalJson(withoutHash(tampered) as never),
    );
    expect(verifyWorkflowBenchmarkLedgerBundle(tampered)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_budget_evidence_invalid"],
      }),
    );
  }, 30_000);

  it("keeps budget-case Provider errors inconclusive", async () => {
    const outputDir = await temporaryOutput();
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: BUDGET_EXHAUSTION_CASE_ROOT,
        outputDir,
        model: { provider: "faux-long-horizon", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      longHorizonDependencies(errorLongHorizonProvider()),
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        scoredTrialCount: 0,
        failedTrialCount: 0,
        inconclusiveTrialCount: 2,
        successRate: 0,
        passRate: null,
      }),
    );
    for (const trial of artifacts.trials) {
      expect(trial.result.evaluation).toEqual(
        expect.objectContaining({
          schemaVersion: 8,
          expectedBudgetExhaustedRunCount: 1,
          budgetExhaustedRunCount: expect.any(Number),
          postBudgetToolCompletedCount: 0,
          modelResponseCount: 1,
          modelResponseErrorCount: 1,
        }),
      );
      expect(
        trial.result.evaluation.budgetExhaustedRunCount,
      ).toBeGreaterThanOrEqual(0);
      expect(
        trial.result.evaluation.budgetExhaustedRunCount,
      ).toBeLessThanOrEqual(1);
      expect(trial.bundle.workflow.budgetExhaustionEvents?.length ?? 0).toBe(
        trial.result.evaluation.budgetExhaustedRunCount,
      );
      expect(
        verifyWorkflowBenchmarkArtifacts(trial.result, trial.bundle),
      ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    }
  }, 30_000);

  it("retains pre-gate Workflow failures as verifiable failed trials", async () => {
    const outputDir = await temporaryOutput();
    const dependencies = longHorizonDependencies(blockedLongHorizonProvider());
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: MULTI_RESTART_CASE_ROOT,
        outputDir,
        model: { provider: "faux-long-horizon", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      dependencies,
    );

    expect(dependencies.runtimeCreateCount()).toBe(2);
    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        scoredTrialCount: 2,
        passedTrialCount: 0,
        failedTrialCount: 2,
        usageSampleCount: 2,
        successRate: 0,
        passRate: 0,
      }),
    );
    for (const trial of artifacts.trials) {
      expect(trial.result).toEqual(
        expect.objectContaining({
          status: "failed",
          run: expect.objectContaining({ status: "blocked" }),
          evaluation: expect.objectContaining({
            workflowStatus: "blocked",
            runtimeRestartCount: 0,
            approvalRecovered: false,
            completedMapRunsReused: false,
            postRestartModelResponseCount: 0,
            modelResponseCount: 3,
            modelResponseErrorCount: 0,
            modelResponseUsageSampleCount: 3,
            diagnostics: expect.arrayContaining([
              "workflow_not_completed",
              "runtime_restart_mismatch",
              "approval_recovery_mismatch",
              "map_reuse_mismatch",
            ]),
          }),
        }),
      );
      expect(trial.bundle.terminalEvent.type).toBe("workflow.blocked");
      expect(trial.bundle.workflow).not.toHaveProperty("outputSha256");
      expect(trial.bundle.workflow).not.toHaveProperty("reduceRunId");
      expect(trial.bundle.workflow).not.toHaveProperty("restartEvent");
      expect(trial.bundle.workflow.modelResponseEvidenceEvent?.type).toBe(
        "benchmark.workflow.model-responses.observed",
      );
      expect(trial.result.evaluation.diagnostics).not.toContain(
        "post_restart_model_called",
      );
      expect(
        verifyWorkflowBenchmarkArtifacts(trial.result, trial.bundle),
      ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    }
  }, 30_000);

  it("classifies pre-gate Provider response errors as inconclusive", async () => {
    const outputDir = await temporaryOutput();
    const dependencies = longHorizonDependencies(errorLongHorizonProvider());
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: MULTI_RESTART_CASE_ROOT,
        outputDir,
        model: { provider: "faux-long-horizon", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      dependencies,
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        completedTrialCount: 2,
        scoredTrialCount: 0,
        failedTrialCount: 0,
        inconclusiveTrialCount: 2,
        usageSampleCount: 2,
        successRate: 0,
        passRate: null,
      }),
    );
    for (const trial of artifacts.trials) {
      expect(trial.result).toEqual(
        expect.objectContaining({
          status: "inconclusive",
          evaluation: expect.objectContaining({
            workflowStatus: "blocked",
            modelResponseCount: 3,
            modelResponseErrorCount: 3,
            modelResponseUsageSampleCount: 3,
          }),
        }),
      );
      expect(
        verifyWorkflowBenchmarkArtifacts(trial.result, trial.bundle),
      ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    }
  }, 30_000);
});

function longHorizonProvider(responseCount: number) {
  const provider = fauxProvider({ provider: "faux-long-horizon" });
  const respond = (context: { messages: unknown[] }) => {
    const prompt = JSON.stringify(context.messages);
    for (const document of [
      { id: "doc_alpha", length: 5 },
      { id: "doc_beta", length: 4 },
      { id: "doc_gamma", length: 6 },
    ]) {
      if (prompt.includes(document.id)) {
        return fauxAssistantMessage(JSON.stringify(document));
      }
    }
    throw new Error("Long-horizon prompt has no known document");
  };
  provider.setResponses(Array.from({ length: responseCount }, () => respond));
  return provider;
}

function blockedLongHorizonProvider() {
  const provider = fauxProvider({ provider: "faux-long-horizon" });
  provider.setResponses(
    Array.from({ length: 6 }, () => fauxAssistantMessage("not typed JSON")),
  );
  return provider;
}

function errorLongHorizonProvider() {
  const provider = fauxProvider({ provider: "faux-long-horizon" });
  provider.setResponses(
    Array.from({ length: 6 }, () =>
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "private provider failure",
      }),
    ),
  );
  return provider;
}

function budgetExhaustionProvider(responseCount: number) {
  const provider = fauxProvider({
    provider: "faux-long-horizon",
    tokensPerSecond: 1_000_000,
    tokenSize: { min: 10_000, max: 10_000 },
  });
  provider.setResponses(
    Array.from({ length: responseCount }, () => () => ({
      ...fauxAssistantMessage(
        [
          fauxThinking("budget calibration ".repeat(1_000)),
          fauxToolCall("list_files", { path: "." }),
        ],
        { stopReason: "toolUse" },
      ),
    })),
  );
  return provider;
}

function longHorizonDependencies(
  provider: ReturnType<typeof longHorizonProvider>,
): WorkflowBenchmarkDependencies & { runtimeCreateCount(): number } {
  let runtimeCreateCount = 0;
  return {
    now: () => new Date("2026-08-02T00:00:00.000Z"),
    runtimeCreateCount: () => runtimeCreateCount,
    async createRuntime(options: LocalAgentRuntimeOptions) {
      runtimeCreateCount += 1;
      const runtime = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("long-horizon-benchmark-test"),
      });
      runtime.models.registerProvider(provider.provider);
      return runtime;
    },
  };
}

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-long-horizon-output-"),
  );
  roots.push(root);
  return root;
}

function withoutHash<T extends { contentSha256: string }>(
  value: T,
): Omit<T, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = value;
  return content;
}

function tamperedRestartBundle(
  bundle: WorkflowBenchmarkLedgerBundle,
): WorkflowBenchmarkLedgerBundle {
  const tampered = structuredClone(bundle);
  if (
    !tampered.workflow.restartEvent?.payload ||
    typeof tampered.workflow.restartEvent.payload !== "object" ||
    Array.isArray(tampered.workflow.restartEvent.payload)
  ) {
    throw new Error("Offline wait restart evidence is unavailable");
  }
  return tampered;
}
