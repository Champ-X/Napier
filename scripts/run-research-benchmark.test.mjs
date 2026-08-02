import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const scriptPath = path.resolve(
  import.meta.dirname,
  "run-research-benchmark.mjs",
);

describe("Research benchmark CLI", () => {
  it("accepts bounded trial counts and rejects single-trial Series", async () => {
    const accepted = await runScript([
      "--trials",
      "2",
      "--case",
      path.join(import.meta.dirname, "missing-research-case"),
    ]);
    expect(accepted.code).not.toBe(0);
    expect(accepted.stderr).not.toContain("--trials must be 2-10");

    const rejected = await runScript(["--trials", "1"]);
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("--trials must be 2-10");
  });

  it("keeps verification modes isolated from execution options", async () => {
    const missingLedger = await runScript(["--verify-result", "result.json"]);
    expect(missingLedger.code).not.toBe(0);
    expect(missingLedger.stderr).toContain(
      "--verify-result and --ledger must be used together",
    );

    const mixed = await runScript([
      "--verify-series",
      "series.json",
      "--model",
      "deepseek/deepseek-v4-flash",
    ]);
    expect(mixed.code).not.toBe(0);
    expect(mixed.stderr).toContain(
      "--verify-series cannot be combined with other options",
    );
  });
});

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: path.resolve(import.meta.dirname, ".."),
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
