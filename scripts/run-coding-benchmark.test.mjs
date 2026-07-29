import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
