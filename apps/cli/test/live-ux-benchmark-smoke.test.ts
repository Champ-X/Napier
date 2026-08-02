import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyUxBenchmarkArtifacts } from "../src/ux-benchmark-contract.js";
import { runUxBenchmark } from "../src/ux-benchmark.js";

const describeLive =
  process.env["NAPIER_LIVE_UX_BENCHMARK"] === "1" ? describe : describe.skip;
const roots: string[] = [];
const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/ux/first-task-cli-v1",
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describeLive("live DeepSeek first-task UX outcome benchmark", () => {
  it("completes one clean-state command without persisting the credential", async () => {
    const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "Set DEEPSEEK_API_KEY before running the live UX benchmark",
      );
    }
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-live-ux-benchmark-"),
    );
    roots.push(outputDir);
    const artifacts = await runUxBenchmark({
      caseRoot: CASE_ROOT,
      outputDir,
      model: {
        provider: "deepseek",
        id: process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash",
      },
      env: { DEEPSEEK_API_KEY: apiKey },
      credentialEnv: "DEEPSEEK_API_KEY",
    });

    expect(artifacts.result).toEqual(
      expect.objectContaining({
        status: "passed",
        evaluation: expect.objectContaining({
          cliExitCode: 0,
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
    expect(JSON.stringify(artifacts)).not.toContain(apiKey);
  }, 180_000);
});
