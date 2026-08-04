import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import rootPackage from "../package.json" with { type: "json" };

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(
  repoRoot,
  "scripts/run-process-recovery-benchmark.mjs",
);
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Process recovery benchmark command", () => {
  it("requires an explicit trusted-outer boundary and writes a passing Series", async () => {
    expect(rootPackage.scripts["bench:process-recovery"]).not.toContain(
      "--trusted-outer-sandbox",
    );
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-process-benchmark-command-"),
    );
    temporaryRoots.push(outputDir);
    const execution = await runNode([
      scriptPath,
      "--output-dir",
      outputDir,
      "--trials",
      "2",
      "--trusted-outer-sandbox",
    ]);
    expect(execution).toEqual(expect.objectContaining({ code: 0, stderr: "" }));
    const summary = JSON.parse(execution.stdout);
    expect(summary).toEqual(
      expect.objectContaining({
        status: "completed",
        caseId: "long_horizon_process_write_compensation_v1",
        executor: expect.objectContaining({
          sandboxBoundary: "trusted_outer_test",
        }),
        requestedTrialCount: 2,
        completedTrialCount: 2,
        passedTrialCount: 2,
        successRate: 1,
        passRate: 1,
        seriesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const series = JSON.parse(
      await readFile(path.resolve(repoRoot, summary.seriesPath), "utf8"),
    );
    expect(series.trials).toHaveLength(2);
    expect(new Set(series.trials.map((trial) => trial.threadId)).size).toBe(2);
    expect(new Set(series.trials.map((trial) => trial.processId)).size).toBe(2);
  }, 30_000);

  it("rejects unbounded or duplicate options", async () => {
    const rejected = await runNode([scriptPath, "--trials", "1"]);
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("--trials must be 2-20");
    const duplicate = await runNode([
      scriptPath,
      "--trusted-outer-sandbox",
      "--trusted-outer-sandbox",
    ]);
    expect(duplicate.code).not.toBe(0);
    expect(duplicate.stderr).toContain("Duplicate option");
  });
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
