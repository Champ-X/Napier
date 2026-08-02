import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCodingBenchmark } from "../src/coding-benchmark.js";
import { loadCodingBenchmarkCase } from "../src/coding-benchmark-case.js";
import {
  completedCodingBenchmarkTools,
  validateCodingBenchmarkCase,
  verifyCodingBenchmarkArtifacts,
} from "../src/coding-benchmark-contract.js";
import { validCodingBenchmarkEvaluationShape } from "../src/coding-benchmark-evaluation-shape.js";
import {
  createDebugBenchmarkProvider,
  DEBUG_CASE_ROOT,
  debugBenchmarkDependencies,
} from "./coding-benchmark-debug-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("CLI debugging outcome benchmark", () => {
  it("loads exact case v3 and rejects malformed required tools", async () => {
    const loaded = await loadCodingBenchmarkCase(DEBUG_CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        requiredTools: ["read_file", "node_debugger", "apply_patch"],
        requiredCompletedTools: ["node_debugger"],
      }),
    );
    const manifest = JSON.parse(
      await readFile(path.join(DEBUG_CASE_ROOT, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    for (const requiredCompletedTools of [
      ["node_debugger", "verify_workspace"],
      ["node_debugger", "node_debugger"],
      ["unknown_debugger"],
    ]) {
      const invalid = rehash({
        ...manifest,
        requiredCompletedTools,
      });
      expect(() => validateCodingBenchmarkCase(invalid)).toThrow();
    }
    expect(() =>
      validateCodingBenchmarkCase(
        rehash({ ...manifest, unexpectedField: true }),
      ),
    ).toThrow("exact object");
  });

  it("counts only completed tools from the scored Run", () => {
    const event = (
      runId: string,
      type: string,
      toolName: string,
      seq: number,
    ): RunEvent => ({
      id: `event_debug_tool_${String(seq)}`,
      threadId: "thread_debug_tool",
      runId,
      seq,
      type,
      category: "tool",
      visibility: "user",
      createdAt: `2026-08-01T16:00:0${String(seq)}.000Z`,
      payload: { toolName },
    });
    expect(
      completedCodingBenchmarkTools(
        [
          event("run_scored", "tool.started", "node_debugger", 1),
          event("run_scored", "tool.failed", "node_debugger", 2),
          event("run_scored", "tool.blocked", "node_debugger", 3),
          event("run_other", "tool.completed", "node_debugger", 4),
          event("run_scored", "tool.completed", "unknown_debugger", 5),
          event("run_scored", "tool.completed", "read_file", 6),
          event("run_scored", "tool.completed", "node_debugger", 7),
          event("run_scored", "tool.completed", "node_debugger", 8),
        ],
        "run_scored",
      ),
    ).toEqual(["node_debugger", "read_file"]);
  });

  it("uses real DAP evidence and passes the hidden outcome", async () => {
    const outputDir = await temporaryOutput("napier-coding-debug-");
    const provider = createDebugBenchmarkProvider();
    const artifacts = await runCodingBenchmark(
      {
        caseRoot: DEBUG_CASE_ROOT,
        outputDir,
        model: { provider: "faux-coding-debug", id: "faux-1" },
        env: {},
      },
      debugBenchmarkDependencies(provider),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        tooling: {
          started: 6,
          completed: 6,
          failed: 0,
          blocked: 0,
          repeatedCallCount: 0,
          applyPatchCompleted: true,
          toolOutcomes: [
            {
              toolName: "apply_patch",
              started: 1,
              completed: 1,
              failed: 0,
              blocked: 0,
              repeatedCallCount: 0,
            },
            {
              toolName: "node_debugger",
              started: 4,
              completed: 4,
              failed: 0,
              blocked: 0,
              repeatedCallCount: 0,
            },
            {
              toolName: "read_file",
              started: 1,
              completed: 1,
              failed: 0,
              blocked: 0,
              repeatedCallCount: 0,
            },
          ],
        },
        evaluation: expect.objectContaining({
          schemaVersion: 3,
          status: "passed",
          requiredToolCount: 1,
          completedRequiredToolCount: 1,
          requiredToolSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          completedRequiredToolSetSha256:
            expect.stringMatching(/^[a-f0-9]{64}$/u),
          targetSemanticMatch: true,
          allowedChangeSetMatch: true,
          outcomeTest: expect.objectContaining({
            status: "succeeded",
            passed: true,
          }),
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
    const tamperedToolSet = structuredClone(
      artifacts.result.evaluation,
    ) as Record<string, unknown>;
    tamperedToolSet["completedRequiredToolSetSha256"] = sha256("tampered");
    expect(validCodingBenchmarkEvaluationShape(rehash(tamperedToolSet))).toBe(
      false,
    );
    const serialized = JSON.stringify({ result, bundle });
    expect(serialized).not.toContain("src/loyalty.js");
    expect(serialized).not.toContain("discountCents");
    expect(serialized).not.toContain("The checkout log");
    expect(serialized).not.toContain("gold discount");
    expect(serialized).not.toContain("Target exit code: 0");
  }, 30_000);

  it("fails a correct patch when debugger completion evidence is missing", async () => {
    const outputDir = await temporaryOutput("napier-coding-debug-missing-");
    const provider = createDebugBenchmarkProvider({ skipDebugger: true });
    const artifacts = await runCodingBenchmark(
      {
        caseRoot: DEBUG_CASE_ROOT,
        outputDir,
        model: { provider: "faux-coding-debug-skip", id: "faux-1" },
        env: {},
      },
      debugBenchmarkDependencies(provider),
    );

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "failed",
        evaluation: expect.objectContaining({
          schemaVersion: 3,
          status: "failed",
          requiredToolCount: 1,
          completedRequiredToolCount: 0,
          targetSemanticMatch: true,
          allowedChangeSetMatch: true,
          outcomeTest: expect.objectContaining({
            status: "succeeded",
            passed: true,
          }),
          diagnostics: ["required_tool_missing"],
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
    const tamperedEvaluation = structuredClone(
      artifacts.result.evaluation,
    ) as Record<string, unknown>;
    tamperedEvaluation["completedRequiredToolCount"] = 1;
    expect(
      validCodingBenchmarkEvaluationShape(rehash(tamperedEvaluation)),
    ).toBe(false);
  }, 30_000);
});

async function temporaryOutput(prefix: string): Promise<string> {
  const outputDir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.push(outputDir);
  return outputDir;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function rehash(input: Record<string, unknown>): Record<string, unknown> {
  const { contentSha256: _contentSha256, ...content } = input;
  return {
    ...content,
    contentSha256: sha256(canonicalJson(content)),
  };
}
