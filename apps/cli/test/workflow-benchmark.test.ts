import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import {
  runWorkflowBenchmarkSeries,
  verifyWorkflowBenchmarkSeries,
} from "../src/workflow-benchmark-series.js";
import {
  runWorkflowBenchmark,
  type WorkflowBenchmarkDependencies,
} from "../src/workflow-benchmark.js";
import { verifyWorkflowBenchmarkLedgerBundle } from "../src/workflow-benchmark-ledger.js";
import type {
  WorkflowBenchmarkLedgerBundle,
  WorkflowBenchmarkResult,
} from "../src/workflow-benchmark-types.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/workflow/document-map-reduce-v1",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Workflow outcome benchmark", () => {
  it("loads a hash-bound typed Map Reduce case", async () => {
    const loaded = await loadWorkflowBenchmarkCase(CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual(
      expect.objectContaining({
        id: "workflow_document_map_reduce_v1",
        schemaVersion: 1,
      }),
    );
    expect(loaded.input.documents).toHaveLength(3);
    expect(loaded.expected).toEqual({
      mapItems: [
        { id: "doc_alpha", length: 5 },
        { id: "doc_beta", length: 4 },
        { id: "doc_gamma", length: 6 },
      ],
      output: 15,
    });
  });

  it("scores real Workflow execution and writes offline-verifiable evidence", async () => {
    const outputDir = await temporaryOutput();
    const provider = benchmarkProvider(3);
    const artifacts = await runWorkflowBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-workflow-benchmark", id: "faux-1" },
        env: {},
      },
      benchmarkDependencies(provider),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        run: expect.objectContaining({
          status: "completed",
          runCount: 5,
          completedRunCount: 5,
        }),
        evaluation: expect.objectContaining({
          status: "passed",
          outputMatch: true,
          mapOutputMatch: true,
          completedMapRunCount: 3,
          mapCompletedEventCount: 3,
          reduceCompletedEventCount: 1,
          reduceModelOrToolEventCount: 0,
          replayValid: true,
          credentialLeakDetected: false,
          diagnostics: [],
        }),
      }),
    );
    const storedResult = JSON.parse(
      await readFile(artifacts.resultPath, "utf8"),
    ) as WorkflowBenchmarkResult;
    const storedBundle = JSON.parse(
      await readFile(artifacts.ledgerPath, "utf8"),
    ) as unknown;
    const serializedBundle = JSON.stringify(storedBundle);
    expect(serializedBundle).not.toContain("alpha");
    expect(serializedBundle).not.toContain('"reasoning"');
    expect(serializedBundle).not.toContain('"text"');
    expect(Buffer.byteLength(serializedBundle, "utf8")).toBeLessThan(
      256 * 1024,
    );
    expect(
      verifyWorkflowBenchmarkArtifacts(storedResult, storedBundle),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
      }),
    );

    const tampered = structuredClone(storedResult);
    tampered.evaluation.completedMapRunCount = 2;
    tampered.evaluation.contentSha256 = sha256(
      canonicalJson(withoutHash(tampered.evaluation) as never),
    );
    tampered.contentSha256 = sha256(
      canonicalJson(withoutHash(tampered) as never),
    );
    expect(verifyWorkflowBenchmarkArtifacts(tampered, storedBundle)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["ledger_binding_mismatch"]),
      }),
    );

    const injected = structuredClone(
      storedBundle,
    ) as WorkflowBenchmarkLedgerBundle;
    (injected.runs[0] as unknown as Record<string, unknown>)["raw"] =
      "injected";
    injected.contentSha256 = sha256(
      canonicalJson(withoutHash(injected) as never),
    );
    expect(verifyWorkflowBenchmarkLedgerBundle(injected)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_shape_invalid"],
      }),
    );
  }, 15_000);

  it("aggregates repeated trials and rejects a substituted ledger", async () => {
    const outputDir = await temporaryOutput();
    const provider = benchmarkProvider(6);
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-workflow-benchmark", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      benchmarkDependencies(provider),
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        requestedTrialCount: 2,
        completedTrialCount: 2,
        scoredTrialCount: 2,
        passedTrialCount: 2,
        failedTrialCount: 0,
        inconclusiveTrialCount: 0,
        passRate: 1,
      }),
    );
    const trialArtifacts = artifacts.trials.map((trial) => ({
      resultFileName: path.basename(trial.resultPath),
      result: trial.result,
      bundle: trial.bundle,
    }));
    expect(
      verifyWorkflowBenchmarkSeries(artifacts.series, trialArtifacts),
    ).toEqual({
      valid: true,
      diagnostics: [],
      seriesSha256: artifacts.series.contentSha256,
      trialDiagnostics: [],
    });
    const substituted = structuredClone(trialArtifacts);
    substituted[1]!.bundle = substituted[0]!.bundle;
    expect(
      verifyWorkflowBenchmarkSeries(artifacts.series, substituted),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["series_trial_invalid"],
      }),
    );
    expect(verifyWorkflowBenchmarkSeries({}, [])).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["series_shape_invalid"],
      }),
    );
  }, 20_000);

  it("preserves a verifiable completed prefix after parent cancellation", async () => {
    const outputDir = await temporaryOutput();
    const provider = benchmarkProvider(3);
    const controller = new AbortController();
    let nowCalls = 0;
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-workflow-benchmark", id: "faux-1" },
        env: {},
        trialCount: 3,
        signal: controller.signal,
      },
      benchmarkDependencies(provider, () => {
        nowCalls += 1;
        if (nowCalls === 1) controller.abort();
        return new Date(`2026-08-02T00:00:0${nowCalls}.000Z`);
      }),
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "cancelled",
        requestedTrialCount: 3,
        completedTrialCount: 1,
        passedTrialCount: 1,
        completionRate: 1 / 3,
        passRate: 1,
      }),
    );
    expect(artifacts.trials).toHaveLength(1);
    expect(
      verifyWorkflowBenchmarkSeries(artifacts.series, [
        {
          resultFileName: path.basename(artifacts.trials[0]!.resultPath),
          result: artifacts.trials[0]!.result,
          bundle: artifacts.trials[0]!.bundle,
        },
      ]),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
      }),
    );
  }, 15_000);
});

function benchmarkProvider(responseCount: number) {
  const provider = fauxProvider({ provider: "faux-workflow-benchmark" });
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
    throw new Error("Workflow benchmark prompt has no known document");
  };
  provider.setResponses(Array.from({ length: responseCount }, () => respond));
  return provider;
}

function benchmarkDependencies(
  provider: ReturnType<typeof benchmarkProvider>,
  now: () => Date = () => new Date("2026-08-02T00:00:00.000Z"),
): WorkflowBenchmarkDependencies {
  return {
    now,
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const runtime = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("workflow-benchmark-test"),
      });
      runtime.models.registerProvider(provider.provider);
      return runtime;
    },
  };
}

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-workflow-output-"));
  roots.push(root);
  return root;
}

function withoutHash<T extends { contentSha256: string }>(
  value: T,
): Omit<T, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = value;
  return content;
}
