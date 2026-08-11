import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256 } from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptPath = path.join(repoRoot, "scripts/run-coding-benchmark.mjs");
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("coding benchmark command", () => {
  it("writes and verifies a deterministically failed demo baseline", async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-benchmark-command-"),
    );
    temporaryRoots.push(outputDir);

    const execution = await runNode([scriptPath, "--output-dir", outputDir]);

    expect(execution.code).toBe(1);
    expect(execution.stderr).toBe("");
    const summary = JSON.parse(execution.stdout);
    expect(summary).toEqual(
      expect.objectContaining({
        status: "failed",
        caseId: "coding_shipping_boundary_v1",
        model: { provider: "napier", id: "demo" },
        tooling: expect.objectContaining({
          toolOutcomes: expect.any(Array),
        }),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const resultPath = path.resolve(repoRoot, summary.resultPath);
    const ledgerPath = path.resolve(repoRoot, summary.ledgerPath);
    expect(JSON.parse(await readFile(resultPath, "utf8"))).toEqual(
      expect.objectContaining({ status: "failed" }),
    );

    const verification = await runNode([
      scriptPath,
      "--verify-result",
      resultPath,
      "--ledger",
      ledgerPath,
    ]);

    expect(verification).toEqual(
      expect.objectContaining({ code: 0, stderr: "" }),
    );
    expect(JSON.parse(verification.stdout)).toEqual(
      expect.objectContaining({ valid: true, diagnostics: [] }),
    );

    const legacyVerification = await runNode([
      scriptPath,
      "--verify-result",
      path.join(
        repoRoot,
        "docs/artifacts/benchmarks/napier-benchmark-result-coding_shipping_boundary_v1-ad31aff64f35d15a.json",
      ),
      "--ledger",
      path.join(
        repoRoot,
        "docs/artifacts/benchmarks/napier-benchmark-ledger-coding_shipping_boundary_v1-c52d3c3d04232076.json",
      ),
    ]);
    expect(legacyVerification).toEqual(
      expect.objectContaining({ code: 0, stderr: "" }),
    );
    expect(JSON.parse(legacyVerification.stdout)).toEqual(
      expect.objectContaining({ valid: true, diagnostics: [] }),
    );

    const oversizedResult = path.join(outputDir, "oversized-result.json");
    await writeFile(oversizedResult, " ".repeat(256 * 1024 + 1), "utf8");
    const rejected = await runNode([
      scriptPath,
      "--verify-result",
      oversizedResult,
      "--ledger",
      ledgerPath,
    ]);
    expect(rejected).toEqual(
      expect.objectContaining({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining(
          "Coding benchmark artifact exceeds its size limit",
        ),
      }),
    );
  }, 30_000);

  it("runs and verifies an independently bound repeated-trial series", async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-benchmark-series-command-"),
    );
    temporaryRoots.push(outputDir);

    const rejectedSingleTrial = await runNode([scriptPath, "--trials", "1"]);
    expect(rejectedSingleTrial).toEqual(
      expect.objectContaining({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("--trials must be 2-10"),
      }),
    );

    const execution = await runNode([
      scriptPath,
      "--output-dir",
      outputDir,
      "--trials",
      "2",
    ]);

    expect(execution).toEqual(expect.objectContaining({ code: 1, stderr: "" }));
    const summary = JSON.parse(execution.stdout);
    expect(summary).toEqual(
      expect.objectContaining({
        status: "completed",
        caseId: "coding_shipping_boundary_v1",
        model: { provider: "napier", id: "demo" },
        requestedTrialCount: 2,
        completedTrialCount: 2,
        passedTrialCount: 0,
        passRate: 0,
        seriesSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const seriesPath = path.resolve(repoRoot, summary.seriesPath);
    const series = JSON.parse(await readFile(seriesPath, "utf8"));
    expect(series.trials).toHaveLength(2);
    expect(new Set(series.trials.map((trial) => trial.runId)).size).toBe(2);

    const verification = await runNode([
      scriptPath,
      "--verify-series",
      seriesPath,
    ]);
    expect(verification).toEqual(
      expect.objectContaining({ code: 0, stderr: "" }),
    );
    expect(JSON.parse(verification.stdout)).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
        trialDiagnostics: [],
      }),
    );

    const tamperedPath = path.join(outputDir, "tampered-series.json");
    const tampered = structuredClone(series);
    tampered.passedTrialCount = 1;
    await writeFile(tamperedPath, `${JSON.stringify(tampered)}\n`, "utf8");
    const rejectedTamper = await runNode([
      scriptPath,
      "--verify-series",
      tamperedPath,
    ]);
    expect(rejectedTamper.code).toBe(1);
    expect(JSON.parse(rejectedTamper.stdout)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: expect.arrayContaining([
          "series_hash_mismatch",
          "series_aggregate_mismatch",
        ]),
      }),
    );

    const unsafePath = path.join(outputDir, "unsafe-series.json");
    const unsafe = structuredClone(series);
    unsafe.trials[0].resultFileName = "..";
    const { contentSha256: _contentSha256, ...unsafeContent } = unsafe;
    unsafe.contentSha256 = sha256(canonicalJson(unsafeContent));
    await writeFile(unsafePath, `${JSON.stringify(unsafe)}\n`, "utf8");
    const rejectedPath = await runNode([
      scriptPath,
      "--verify-series",
      unsafePath,
    ]);
    expect(rejectedPath).toEqual(
      expect.objectContaining({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining(
          "Coding benchmark series artifact is invalid",
        ),
      }),
    );

    const linkedResult = path.join(outputDir, series.trials[0].resultFileName);
    const movedResult = path.join(outputDir, "moved-result.json");
    await rename(linkedResult, movedResult);
    await symlink(movedResult, linkedResult);
    const rejectedSymlink = await runNode([
      scriptPath,
      "--verify-series",
      seriesPath,
    ]);
    expect(rejectedSymlink).toEqual(
      expect.objectContaining({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining(
          "Coding benchmark artifact must be a regular file",
        ),
      }),
    );
  }, 20_000);

  it("runs and verifies the multi-file case through --case", async () => {
    const outputDir = await mkdtemp(
      path.join(tmpdir(), "napier-benchmark-multifile-command-"),
    );
    temporaryRoots.push(outputDir);
    const caseRoot = path.join(
      repoRoot,
      "benchmarks/coding/pricing-options-migration-v1",
    );

    const execution = await runNode([
      scriptPath,
      "--case",
      caseRoot,
      "--output-dir",
      outputDir,
    ]);

    expect(execution).toEqual(expect.objectContaining({ code: 1, stderr: "" }));
    const summary = JSON.parse(execution.stdout);
    expect(summary).toEqual(
      expect.objectContaining({
        status: "failed",
        caseId: "coding_pricing_options_migration_v1",
        model: { provider: "napier", id: "demo" },
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const verification = await runNode([
      scriptPath,
      "--verify-result",
      path.resolve(repoRoot, summary.resultPath),
      "--ledger",
      path.resolve(repoRoot, summary.ledgerPath),
    ]);
    expect(verification).toEqual(
      expect.objectContaining({ code: 0, stderr: "" }),
    );
    expect(JSON.parse(verification.stdout)).toEqual(
      expect.objectContaining({ valid: true, diagnostics: [] }),
    );
  }, 15_000);
});

function runNode(args) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", async (code) => {
      resolve({
        code,
        stdout: await stdout,
        stderr: await stderr,
      });
    });
  });
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      text += chunk;
    });
    stream.once("end", () => resolve(text));
    stream.once("error", reject);
  });
}
