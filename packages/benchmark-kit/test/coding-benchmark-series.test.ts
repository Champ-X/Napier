import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  createLocalAgentRuntime,
  sha256,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCodingBenchmarkSeries,
  verifyCodingBenchmarkSeries,
} from "../src/coding-benchmark-series-contract.js";
import { runCodingBenchmarkSeries } from "../src/coding-benchmark-series.js";
import type { CodingBenchmarkDependencies } from "../src/coding-benchmark.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/coding/shipping-boundary-v1",
);
const SOURCE_SHA256 =
  "7599d299a32b68c2995a51f11b0b59927d6fa95cf5906075d122463e1012953e";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("coding benchmark repeated trials", () => {
  it("stops after parent cancellation and preserves a verifiable partial series", async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-coding-series-"),
    );
    temporaryRoots.push(outputDir);
    const provider = fauxProvider({ provider: "faux-coding-series" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "src/shipping.js" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: "src/shipping.js",
          expectedSha256: SOURCE_SHA256,
          edits: [{ oldText: "> 5_000", newText: ">= 5_000" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Fixed the free-shipping boundary."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const controller = new AbortController();
    let nowCalls = 0;
    const dependencies: CodingBenchmarkDependencies = {
      now() {
        nowCalls += 1;
        if (nowCalls === 1) controller.abort();
        return new Date(`2026-07-30T00:00:0${nowCalls}.000Z`);
      },
      async runOutcomeTest(input) {
        return {
          testSha256: input.testSha256,
          status: "succeeded",
          sandboxId: "coding-series-test",
          resultSha256: input.testSha256,
          durationMs: 0,
          exitCode: 0,
          stdoutSha256: sha256(""),
          stderrSha256: sha256(""),
          passed: true,
        };
      },
      async createRuntime(options: LocalAgentRuntimeOptions) {
        const services = await createLocalAgentRuntime({
          ...options,
          sandbox: new UnsupportedSandboxAdapter("coding-series-test"),
        });
        services.models.registerProvider(provider.provider);
        return services;
      },
    };

    const artifacts = await runCodingBenchmarkSeries(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-coding-series", id: "faux-1" },
        env: {},
        trialCount: 3,
        signal: controller.signal,
      },
      dependencies,
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "cancelled",
        requestedTrialCount: 3,
        completedTrialCount: 1,
        passedTrialCount: 1,
        failedTrialCount: 0,
        completionRate: 1 / 3,
        passRate: 1,
      }),
    );
    expect(artifacts.trials).toHaveLength(1);
    expect(path.basename(artifacts.seriesPath)).toMatch(
      /^napier-benchmark-series-coding_shipping_boundary_v1-[a-f0-9]{16}\.json$/u,
    );
    const trial = artifacts.trials[0]!;
    const bundle = JSON.parse(
      await readFile(trial.ledgerPath, "utf8"),
    ) as unknown;
    expect(
      verifyCodingBenchmarkSeries(artifacts.series, [
        {
          resultFileName: path.basename(trial.resultPath),
          result: trial.result,
          bundle,
        },
      ]),
    ).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
        trialDiagnostics: [],
      }),
    );
    expect(() =>
      createCodingBenchmarkSeries({
        generatedAt: "2026-07-30T00:00:03.000Z",
        requestedTrialCount: 2,
        trials: [
          {
            resultFileName: path.basename(trial.resultPath),
            result: trial.result,
          },
          {
            resultFileName: path.basename(trial.resultPath),
            result: trial.result,
          },
        ],
      }),
    ).toThrow("Coding benchmark series trials are inconsistent");
  });
});
