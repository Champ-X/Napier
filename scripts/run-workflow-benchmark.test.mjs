import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import rootPackage from "../package.json" with { type: "json" };

const scriptPath = path.resolve(
  import.meta.dirname,
  "run-workflow-benchmark.mjs",
);

describe("Workflow benchmark CLI", () => {
  it("loads the optional repository environment for live benchmark commands", () => {
    for (const name of ["bench:coding", "bench:research", "bench:workflow"]) {
      expect(rootPackage.scripts[name]).toContain(
        "node --env-file-if-exists=.env scripts/",
      );
    }
  });

  it("accepts bounded trial counts independently from timeout parsing", async () => {
    const accepted = await runScript([
      "--trials",
      "2",
      "--case",
      path.join(import.meta.dirname, "missing-workflow-case"),
    ]);
    expect(accepted.code).not.toBe(0);
    expect(accepted.stderr).not.toContain("--trials must be 2-10");

    const rejected = await runScript(["--trials", "1"]);
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("--trials must be 2-10");
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
