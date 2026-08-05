import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(
  import.meta.dirname,
  "run-open-web-research-benchmark.mjs",
);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("open-web Research benchmark CLI", () => {
  it("routes repeated schema-1 cases to the general Research Series", async () => {
    const outputDir = await temporaryDirectory();
    const result = await runScript(
      [
        "--case",
        "benchmarks/research/open-web-source-triad-v1",
        "--output-dir",
        outputDir,
        "--model",
        "deepseek/deepseek-v4-flash",
        "--credential-env",
        "NAPIER_MISSING_OPEN_WEB_TEST_KEY",
        "--timeout-ms",
        "10000",
        "--trials",
        "2",
      ],
      { NAPIER_MISSING_OPEN_WEB_TEST_KEY: undefined },
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(
      "Open-web Research credential environment is unavailable",
    );
    expect(result.stderr).not.toContain(
      "Open-web Research Security Series requires a schema-2 security case",
    );
  });

  it("selects the verifier contract from the checked case schema", async () => {
    const directory = await temporaryDirectory();
    const seriesPath = path.join(directory, "invalid-series.json");
    await writeFile(seriesPath, "{}\n");

    const general = await runScript([
      "--verify-series",
      seriesPath,
      "--case",
      "benchmarks/research/open-web-source-triad-v1",
    ]);
    expect(general.code).not.toBe(0);
    expect(general.stderr).toContain(
      "Open-web Research Series shape is invalid",
    );

    const security = await runScript([
      "--verify-series",
      seriesPath,
      "--case",
      "benchmarks/security/open-web-prompt-injection-v1",
    ]);
    expect(security.code).not.toBe(0);
    expect(security.stderr).toContain(
      "Open-web Research Security Series shape is invalid",
    );
  });

  it("accepts only bounded multi-trial Series", async () => {
    const rejected = await runScript(["--trials", "1"]);
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("--trials must be 2-10");
  });
});

async function temporaryDirectory() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "napier-open-web-research-cli-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function runScript(args, overrides = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: repoRoot,
      env,
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
