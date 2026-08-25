import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

import { loadUxBenchmarkCase } from "../src/ux-benchmark-case.js";
import { executeUxBenchmarkCliInProcess } from "../src/ux-benchmark-cli-execution.js";
import { verifyUxBenchmarkArtifacts } from "../src/ux-benchmark-contract.js";
import {
  runUxBenchmark,
  type UxBenchmarkDependencies,
} from "../src/ux-benchmark.js";
import {
  runUxBenchmarkSeries,
  verifyUxBenchmarkSeries,
} from "../src/ux-benchmark-series.js";
import type {
  UxBenchmarkLedgerBundle,
  UxBenchmarkResult,
} from "../src/ux-benchmark-types.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/ux/first-task-cli-v1",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("First-task UX outcome benchmark", () => {
  it("loads the fixed hash-bound one-command case", async () => {
    const loaded = await loadUxBenchmarkCase(CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual(
      expect.objectContaining({
        id: "ux_first_task_cli_v1",
        maxFirstEventMs: 30_000,
        maxDurationMs: 120_000,
        contentSha256:
          "5bac88cc43de82b7c2909d130da71a053648300d128015b0a2cff1302de3dedc",
      }),
    );
    expect(loaded.expected).toEqual({
      assistantText: "NAPIER_UX_FIRST_TASK_OK",
      manualCommandCount: 1,
      credentialReferenceCount: 1,
      threadCountAfter: 2,
    });
  });

  it("runs the real CLI path and writes privacy-bounded verifiable evidence", async () => {
    const outputDir = await temporaryOutput();
    const provider = uxProvider("NAPIER_UX_FIRST_TASK_OK");
    const credential = "PRIVATE_UX_BENCHMARK_KEY";
    const artifacts = await runUxBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-ux-benchmark", id: "faux-1" },
        env: { UX_BENCHMARK_KEY: credential },
        credentialEnv: "UX_BENCHMARK_KEY",
      },
      uxDependencies(provider),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        run: expect.objectContaining({ status: "completed" }),
        evaluation: expect.objectContaining({
          outputMatch: true,
          manualCommandCount: 1,
          credentialReferenceCount: 1,
          credentialProviderMatch: true,
          credentialLocatorMatch: true,
          credentialAvailable: true,
          threadCountAfter: 2,
          replayValid: true,
          credentialLeakDetected: false,
          credentialPersistenceLeakDetected: false,
          diagnostics: [],
        }),
      }),
    );
    expect(
      verifyUxBenchmarkArtifacts(artifacts.result, artifacts.bundle),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
    const serialized = JSON.stringify({
      result: artifacts.result,
      bundle: artifacts.bundle,
    });
    for (const raw of [
      credential,
      "UX_BENCHMARK_KEY",
      "NAPIER_UX_FIRST_TASK_OK",
      "Reply with exactly",
    ]) {
      expect(serialized).not.toContain(raw);
    }

    const substituted = structuredClone(artifacts.result) as UxBenchmarkResult;
    substituted.model.id = "substituted";
    substituted.contentSha256 = sha256(
      canonicalJson(withoutHash(substituted) as never),
    );
    expect(verifyUxBenchmarkArtifacts(substituted, artifacts.bundle)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["ledger_binding_mismatch"]),
      }),
    );

    const tampered = structuredClone(
      artifacts.bundle,
    ) as UxBenchmarkLedgerBundle;
    tampered.credentialReferenceCount = 2;
    tampered.contentSha256 = sha256(
      canonicalJson(withoutHash(tampered) as never),
    );
    expect(verifyUxBenchmarkArtifacts(artifacts.result, tampered)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining(["ledger_binding_mismatch"]),
      }),
    );
  }, 30_000);

  it("records a failed verdict when assistant output exposes the credential", async () => {
    const outputDir = await temporaryOutput();
    const credential = "PRIVATE_UX_EXPOSURE_KEY";
    const artifacts = await runUxBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-ux-benchmark", id: "faux-1" },
        env: { UX_EXPOSURE_KEY: credential },
        credentialEnv: "UX_EXPOSURE_KEY",
      },
      uxDependencies(uxProvider(credential)),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "failed",
        evaluation: expect.objectContaining({
          outputMatch: false,
          credentialLeakDetected: true,
          credentialPersistenceLeakDetected: true,
          diagnostics: [
            "output_mismatch",
            "credential_leaked",
            "credential_persisted",
          ],
        }),
      }),
    );
    expect(
      verifyUxBenchmarkArtifacts(artifacts.result, artifacts.bundle),
    ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
  }, 30_000);

  it("detects a credential persisted in the temporary workspace", async () => {
    const outputDir = await temporaryOutput();
    const credential = "PRIVATE_UX_WORKSPACE_KEY";
    const dependencies = uxDependencies(uxProvider("NAPIER_UX_FIRST_TASK_OK"));
    const executeCli = dependencies.executeCli;
    dependencies.executeCli = async (request) => {
      const workspaceIndex = request.args.indexOf("--workspace");
      const workspaceRoot = request.args[workspaceIndex + 1]!;
      await writeFile(path.join(workspaceRoot, "credential.txt"), credential);
      return executeCli(request);
    };
    const artifacts = await runUxBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-ux-benchmark", id: "faux-1" },
        env: { UX_WORKSPACE_KEY: credential },
        credentialEnv: "UX_WORKSPACE_KEY",
      },
      dependencies,
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "failed",
        evaluation: expect.objectContaining({
          outputMatch: true,
          credentialLeakDetected: false,
          credentialPersistenceLeakDetected: true,
          diagnostics: ["credential_persisted"],
        }),
      }),
    );
  }, 30_000);

  it("aggregates independent trials and rejects ledger substitution", async () => {
    const outputDir = await temporaryOutput();
    const provider = uxProvider("NAPIER_UX_FIRST_TASK_OK", 2);
    const artifacts = await runUxBenchmarkSeries(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-ux-benchmark", id: "faux-1" },
        env: { UX_SERIES_KEY: "PRIVATE_UX_SERIES_KEY" },
        credentialEnv: "UX_SERIES_KEY",
        trialCount: 2,
      },
      uxDependencies(provider),
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        completedTrialCount: 2,
        passedTrialCount: 2,
        passRate: 1,
      }),
    );
    const verificationInputs = artifacts.trials.map((trial) => ({
      resultFileName: path.basename(trial.resultPath),
      result: trial.result,
      bundle: trial.bundle,
    }));
    expect(
      verifyUxBenchmarkSeries(artifacts.series, verificationInputs),
    ).toEqual({
      valid: true,
      diagnostics: [],
      seriesSha256: artifacts.series.contentSha256,
      trialDiagnostics: [
        { index: 1, diagnostics: [] },
        { index: 2, diagnostics: [] },
      ],
    });
    verificationInputs[0]!.bundle = artifacts.trials[1]!.bundle;
    expect(
      verifyUxBenchmarkSeries(artifacts.series, verificationInputs),
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["series_trial_invalid", "series_aggregate_mismatch"],
      }),
    );
  }, 30_000);
});

function uxProvider(output: string, trialCount = 1) {
  const provider = fauxProvider({ provider: "faux-ux-benchmark" });
  provider.setResponses(
    Array.from({ length: trialCount }).flatMap(() => [
      fauxAssistantMessage(output),
      fauxAssistantMessage('{"facts":[]}'),
    ]),
  );
  return provider;
}

function uxDependencies(
  provider: ReturnType<typeof uxProvider>,
): UxBenchmarkDependencies {
  const createRuntime = async (options: LocalAgentRuntimeOptions) => {
    const runtime = await createLocalAgentRuntime({
      ...options,
      sandbox: new UnsupportedSandboxAdapter("ux-benchmark-test"),
    });
    runtime.models.registerProvider(provider.provider);
    return runtime;
  };
  return {
    createRuntime,
    executeCli: (request) =>
      executeUxBenchmarkCliInProcess(request, createRuntime),
    now: () => new Date("2026-08-02T00:00:00.000Z"),
  };
}

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-ux-output-"));
  roots.push(root);
  return root;
}

function withoutHash<T extends { contentSha256: string }>(
  value: T,
): Omit<T, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = value;
  return content;
}
