import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  PROMPT_REGRESSION_CASES,
  PROMPT_REGRESSION_DIMENSIONS,
  promptRegressionArtifactMatchesSources,
  runPromptRegressionMatrix,
  verifyPromptRegressionMatrix,
} from "./prompt-regression-matrix.mjs";

describe("Prompt regression matrix", () => {
  it("executes one distinct passed case for every required dimension", async () => {
    const calls = [];
    const artifact = await runPromptRegressionMatrix(
      new URL("..", import.meta.url).pathname,
      async (input) => {
        calls.push(input);
        return { status: "passed", testFileCount: 1, testCount: 1 };
      },
    );

    expect(PROMPT_REGRESSION_DIMENSIONS).toEqual([
      "network",
      "coding",
      "browser",
      "long_task",
      "user_interrupt",
      "dangerous_action",
      "partial_block",
      "correction",
    ]);
    expect(calls).toHaveLength(8);
    expect(new Set(calls.map((call) => call.definition.testFile)).size).toBe(8);
    expect(artifact).toEqual(
      expect.objectContaining({
        kind: "napier.prompt-regression-matrix",
        schemaVersion: 1,
        promptContentStored: false,
        dimensions: PROMPT_REGRESSION_DIMENSIONS,
        caseCount: 8,
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(artifact)).not.toContain(
      PROMPT_REGRESSION_CASES[0].testName,
    );
  });

  it("rejects case substitution and source drift", async () => {
    const root = new URL("..", import.meta.url).pathname;
    const artifact = await runPromptRegressionMatrix(root, async () => ({
      status: "passed",
      testFileCount: 1,
      testCount: 1,
    }));
    const tampered = structuredClone(artifact);
    tampered.cases[0].dimension = "coding";
    expect(() => verifyPromptRegressionMatrix(tampered)).toThrow(
      "case is invalid",
    );

    const sourceSha256ByPath = Object.fromEntries(
      await Promise.all(
        PROMPT_REGRESSION_CASES.map(async (item) => [
          item.testFile,
          artifact.cases.find((entry) => entry.testFile === item.testFile)
            .testFileSha256,
        ]),
      ),
    );
    expect(
      promptRegressionArtifactMatchesSources(artifact, sourceSha256ByPath),
    ).toBe(true);
    sourceSha256ByPath[PROMPT_REGRESSION_CASES[0].testFile] = "f".repeat(64);
    expect(
      promptRegressionArtifactMatchesSources(artifact, sourceSha256ByPath),
    ).toBe(false);
  });

  it("verifies the committed deterministic artifact against current sources", async () => {
    const artifact = JSON.parse(
      await readFile(
        new URL(
          "../docs/artifacts/prompt-regression-matrix-0.1.0.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const verified = verifyPromptRegressionMatrix(artifact);
    expect(verified.caseCount).toBe(8);
    const sourceSha256ByPath = Object.fromEntries(
      await Promise.all(
        verified.cases.map(async (item) => {
          const source = await readFile(
            new URL(`../${item.testFile}`, import.meta.url),
          );
          const crypto = await import("node:crypto");
          return [
            item.testFile,
            crypto.createHash("sha256").update(source).digest("hex"),
          ];
        }),
      ),
    );
    expect(
      promptRegressionArtifactMatchesSources(artifact, sourceSha256ByPath),
    ).toBe(true);
  });

  it("rejects a drifted checked-in receipt through the formal entrypoint", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-prompt-regression-"),
    );
    try {
      const artifact = JSON.parse(
        await readFile(
          new URL(
            "../docs/artifacts/prompt-regression-matrix-0.1.0.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      artifact.contentSha256 = "f".repeat(64);
      const receiptPath = path.join(root, "drifted.json");
      await writeFile(receiptPath, JSON.stringify(artifact), "utf8");
      const result = await run([
        "scripts/run-prompt-regression-matrix.mjs",
        "--verify-receipt",
        receiptPath,
      ]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("Prompt regression matrix hash mismatch");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}
