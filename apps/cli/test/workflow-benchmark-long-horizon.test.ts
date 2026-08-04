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
