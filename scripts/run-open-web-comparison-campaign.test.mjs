import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson } from "../packages/runtime/dist/index.js";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const scriptPath = path.join(
  import.meta.dirname,
  "run-open-web-comparison-campaign.mjs",
);
const retainedReportPath = path.join(
  repoRoot,
  "benchmark-results/napier-open-web-executor-comparison-seed-20260805.json",
);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("open-web comparison campaign CLI", () => {
  it("creates and independently verifies a portable sibling campaign", async () => {
    const outputDir = await portableReports();
    const created = await runScript([
      "--output-dir",
      outputDir,
      "--report",
      path.join(
        outputDir,
        "napier-open-web-executor-comparison-seed-20260805.json",
      ),
      "--report",
      path.join(
        outputDir,
        "napier-open-web-executor-comparison-seed-20260806.json",
      ),
    ]);

    expect(created.code).toBe(0);
    const summary = JSON.parse(created.stdout);
    expect(summary).toEqual(
      expect.objectContaining({
        reportCount: 2,
        seeds: [20260805, 20260806],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const campaignName = (await readdir(outputDir)).find((name) =>
      name.startsWith(
        "napier-open-web-executor-comparison-campaign-seeds-20260805-20260806-",
      ),
    );
    expect(campaignName).toBeTruthy();

    const verified = await runScript([
      "--verify",
      path.join(outputDir, campaignName),
    ]);
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout)).toEqual(
      expect.objectContaining({
        valid: true,
        diagnostics: [],
        reportDiagnostics: [
          { index: 1, seed: 20260805, diagnostics: [] },
          { index: 2, seed: 20260806, diagnostics: [] },
        ],
      }),
    );
  });

  it("rejects non-sibling reports, symlink substitution, and path traversal", async () => {
    const outputDir = await portableReports();
    const outside = retainedReportPath;
    const nonSibling = await runScript([
      "--output-dir",
      outputDir,
      "--report",
      outside,
      "--report",
      path.join(
        outputDir,
        "napier-open-web-executor-comparison-seed-20260806.json",
      ),
    ]);
    expect(nonSibling.code).not.toBe(0);
    expect(nonSibling.stderr).toContain(
      "Every --report artifact must be inside --output-dir",
    );

    const symlinkPath = path.join(
      outputDir,
      "napier-open-web-executor-comparison-seed-20260807.json",
    );
    await symlink(retainedReportPath, symlinkPath);
    const symlinked = await runScript([
      "--output-dir",
      outputDir,
      "--report",
      symlinkPath,
      "--report",
      path.join(
        outputDir,
        "napier-open-web-executor-comparison-seed-20260806.json",
      ),
    ]);
    expect(symlinked.code).not.toBe(0);
    expect(symlinked.stderr).toContain(
      "Open-web comparison artifact file is invalid",
    );

    const maliciousPath = path.join(
      outputDir,
      "napier-open-web-executor-comparison-campaign-seeds-1-2-aaaaaaaaaaaaaaaa.json",
    );
    await writeFile(
      maliciousPath,
      `${JSON.stringify({
        reports: [{ fileName: "../goal.md" }],
      })}\n`,
    );
    const malicious = await runScript(["--verify", maliciousPath]);
    expect(malicious.code).not.toBe(0);
    expect(malicious.stderr).toContain(
      "Open-web comparison campaign shape is invalid",
    );
  });
});

async function portableReports() {
  const outputDir = await mkdtemp(
    path.join(tmpdir(), "napier-open-web-comparison-campaign-"),
  );
  temporaryDirectories.push(outputDir);
  const first = JSON.parse(await readFile(retainedReportPath, "utf8"));
  const second = structuredClone(first);
  second.seed = 20260806;
  second.generatedAt = "2026-08-06T22:21:33.476Z";
  second.suite.seed = 20260806;
  const originalSuite = first.suite;
  const { createOpenWebComparisonSuite, publicOpenWebComparisonSuite } =
    await import("./open-web-comparison-suite.mjs");
  const replacementSuite = createOpenWebComparisonSuite(20260806);
  second.suite = publicOpenWebComparisonSuite(replacementSuite);
  second.cases = second.cases.map((entry, index) => ({
    ...entry,
    caseId: replacementSuite.cases[index].id,
    complexity: replacementSuite.cases[index].complexity,
    taskFamily: replacementSuite.cases[index].taskFamily,
    promptSha256: replacementSuite.cases[index].promptSha256,
    oracleSha256: replacementSuite.cases[index].oracleSha256,
    caseSha256: replacementSuite.cases[index].caseSha256,
  }));
  expect(originalSuite.contentSha256).not.toBe(second.suite.contentSha256);
  second.contentSha256 = hashWithoutSelf(second);
  await Promise.all([
    writeFile(
      path.join(
        outputDir,
        "napier-open-web-executor-comparison-seed-20260805.json",
      ),
      `${JSON.stringify(first, null, 2)}\n`,
    ),
    writeFile(
      path.join(
        outputDir,
        "napier-open-web-executor-comparison-seed-20260806.json",
      ),
      `${JSON.stringify(second, null, 2)}\n`,
    ),
  ]);
  return outputDir;
}

function hashWithoutSelf(value) {
  const { contentSha256: _contentSha256, ...content } = value;
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

function runScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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
