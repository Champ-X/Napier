import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RunEvent } from "@napier/contracts";
import {
  createLocalAgentRuntime,
  LspReferencesRunner,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCodingBenchmark } from "../src/coding-benchmark.js";
import {
  copyCodingBenchmarkFixture,
  loadCodingBenchmarkCase,
} from "../src/coding-benchmark-case.js";
import {
  collectCodingBenchmarkToolMetrics,
  verifyCodingBenchmarkArtifacts,
} from "../src/coding-benchmark-contract.js";
import { runCodingBenchmarkOutcomeTest } from "../src/coding-benchmark-outcome.js";
import {
  createMultifileProvider,
  directSandbox,
  EXPECTED_CHECKOUT,
  EXPECTED_PRICING,
  EXPECTED_QUOTE,
  multifileDependencies,
  MULTIFILE_CASE_ROOT as CASE_ROOT,
} from "./coding-benchmark-multifile-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("CLI multi-file coding outcome benchmark", () => {
  it("distinguishes generic tool inputs while detecting a true repeat", () => {
    const runId = "run_coding_metric";
    const events = ["src/a.js", "src/b.js", "src/a.js"].map(
      (filePath, index) =>
        ({
          id: `event_coding_metric_${String(index + 1)}`,
          threadId: "thread_coding_metric",
          runId,
          seq: index + 1,
          type: "tool.started",
          category: "tool",
          visibility: "user",
          createdAt: `2026-07-30T01:00:0${String(index)}.000Z`,
          payload: {
            callId: `call_${String(index + 1)}`,
            toolName: "read_file",
            status: "started",
            input: { path: filePath },
          },
        }) satisfies RunEvent,
    );

    expect(collectCodingBenchmarkToolMetrics(events, runId)).toEqual({
      started: 3,
      completed: 0,
      failed: 0,
      blocked: 0,
      repeatedCallCount: 1,
      applyPatchCompleted: false,
    });
  });

  it("binds the LSP position to the definition and both call sites", async () => {
    const loaded = await loadCodingBenchmarkCase(CASE_ROOT);
    const result = await new LspReferencesRunner({
      workspaceRoot: loaded.fixtureRoot,
      sandbox: directSandbox(),
    }).run({
      path: "src/pricing.js",
      line: 1,
      character: 17,
      includeDeclaration: true,
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "found",
        referenceCount: 5,
        omittedReferenceCount: 0,
        truncated: false,
      }),
    );
    expect(result.locations.map((location) => location.path)).toEqual([
      "src/pricing.js",
      "src/checkout.js",
      "src/checkout.js",
      "src/quote.js",
      "src/quote.js",
    ]);
  }, 10_000);

  it("executes the canonical solution through the real hidden assertions", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-coding-multifile-outcome-"),
    );
    temporaryRoots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const dataRoot = path.join(root, "state");
    await mkdir(workspaceRoot);
    const loaded = await loadCodingBenchmarkCase(CASE_ROOT);
    await copyCodingBenchmarkFixture(loaded.fixtureRoot, workspaceRoot);
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, "src/pricing.js"),
        EXPECTED_PRICING,
        "utf8",
      ),
      writeFile(
        path.join(workspaceRoot, "src/checkout.js"),
        EXPECTED_CHECKOUT,
        "utf8",
      ),
      writeFile(
        path.join(workspaceRoot, "src/quote.js"),
        EXPECTED_QUOTE,
        "utf8",
      ),
    ]);

    const evidence = await runCodingBenchmarkOutcomeTest({
      workspaceRoot,
      dataRoot,
      env: {},
      testSource: loaded.outcomeTestSource,
      testSha256: loaded.benchmarkCase.outcomeTestSha256,
      runtimeFactory: {
        createRuntime: (options) =>
          createLocalAgentRuntime({
            ...options,
            sandbox: directSandbox(false),
          }),
      },
    });

    expect(evidence).toEqual(
      expect.objectContaining({
        status: "succeeded",
        sandboxId: "direct-coding-multifile-test",
        exitCode: 0,
        passed: true,
      }),
    );
  });

  it("uses real LSP references and migrates every call site", async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-coding-multifile-"),
    );
    temporaryRoots.push(outputDir);
    const provider = createMultifileProvider();

    const artifacts = await runCodingBenchmark(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-coding-multifile", id: "faux-1" },
        env: {},
      },
      multifileDependencies(provider),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        tooling: {
          started: 7,
          completed: 7,
          failed: 0,
          blocked: 0,
          repeatedCallCount: 0,
          applyPatchCompleted: true,
        },
        evaluation: expect.objectContaining({
          status: "passed",
          changedFileCount: 3,
          targetSemanticMatch: true,
          allowedChangeSetMatch: true,
          diagnostics: [],
        }),
      }),
    );
    const [result, bundle] = await Promise.all([
      readJson(artifacts.resultPath),
      readJson(artifacts.ledgerPath),
    ]);
    expect(verifyCodingBenchmarkArtifacts(result, bundle)).toEqual(
      expect.objectContaining({ valid: true, diagnostics: [] }),
    );
    const serialized = JSON.stringify({ result, bundle });
    expect(serialized).not.toContain("src/pricing.js");
    expect(serialized).not.toContain("discountedTotalCents");
  }, 30_000);
});

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}
