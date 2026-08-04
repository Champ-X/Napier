import { createHash } from "node:crypto";
import { execFile as execFileWithCallback } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditReleaseArtifacts,
  createReleaseArtifactsReceipt,
  createReleaseArtifactsVerification,
  verifyReleaseArtifactsReceipt,
} from "./check-release-artifacts.mjs";
import { createProductPerformanceReport } from "./product-performance.mjs";

const temporaryRoots = [];
const execFile = promisify(execFileWithCallback);
const packageLockScriptPath = path.resolve("scripts/check-package-lock.mjs");
const releaseScriptPath = path.resolve("scripts/check-release-artifacts.mjs");
const runtimeEnvironmentScriptPath = path.resolve(
  "scripts/check-runtime-environment.mjs",
);
const webDistScriptPath = path.resolve("scripts/check-web-dist.mjs");

describe("release artifacts audit", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("accepts current package-lock and Web dist receipts as one release set", async () => {
    const { root } = await createFixture();

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
      "package-lock-audit",
      "runtime-environment-audit",
      "product-performance-baseline",
      "web-dist-audit",
      "web-dist-manifest",
      "management-openapi",
      "management-openapi-compatibility",
      "coding-executor-comparison",
      "workflow-benchmark-series",
      "workflow-benchmark-result-1",
      "workflow-benchmark-ledger-1",
      "workflow-benchmark-result-2",
      "workflow-benchmark-ledger-2",
      "data-benchmark-series",
      "data-benchmark-result-1",
      "data-benchmark-ledger-1",
      "data-benchmark-result-2",
      "data-benchmark-ledger-2",
      "data-frame-benchmark-series",
      "data-frame-benchmark-result-1",
      "data-frame-benchmark-ledger-1",
      "data-frame-benchmark-result-2",
      "data-frame-benchmark-ledger-2",
      "security-benchmark-series",
      "security-benchmark-result-1",
      "security-benchmark-ledger-1",
      "security-benchmark-result-2",
      "security-benchmark-ledger-2",
      "long-horizon-benchmark-series",
      "long-horizon-benchmark-result-1",
      "long-horizon-benchmark-ledger-1",
      "long-horizon-benchmark-result-2",
      "long-horizon-benchmark-ledger-2",
      "research-benchmark-series",
      "research-benchmark-result-1",
      "research-benchmark-ledger-1",
      "research-benchmark-result-2",
      "research-benchmark-ledger-2",
      "ux-benchmark-series",
      "ux-benchmark-result-1",
      "ux-benchmark-ledger-1",
      "ux-benchmark-result-2",
      "ux-benchmark-ledger-2",
    ]);
    expect(createReleaseArtifactsReceipt(result)).toMatchObject({
      type: "napier.release-artifacts-audit",
      schemaVersion: 1,
      ok: true,
      package: { name: "napier-test", version: "0.1.0" },
      errors: [],
    });
  });

  it("writes and verifies a release artifacts receipt from the CLI", async () => {
    const { root } = await createFixture();

    await execFile(process.execPath, [
      releaseScriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/release-artifacts-audit.json",
    ]);
    const receipt = JSON.parse(
      await readFile(
        path.join(root, "docs/artifacts/release-artifacts-audit.json"),
        "utf8",
      ),
    );
    const verification = await verifyReleaseArtifactsReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/release-artifacts-audit.json",
    });

    expect(receipt).toMatchObject({
      type: "napier.release-artifacts-audit",
      schemaVersion: 1,
      ok: true,
    });
    expect(verification.valid).toBe(true);
    expect(createReleaseArtifactsVerification(verification)).toMatchObject({
      type: "napier.release-artifacts-audit-verification",
      schemaVersion: 1,
      valid: true,
      receipt: { path: "docs/artifacts/release-artifacts-audit.json" },
      errors: [],
    });
  });

  it("rejects a release receipt that no longer matches the artifact set", async () => {
    const { root } = await createFixture();
    const receiptPath = path.join(
      root,
      "docs/artifacts/release-artifacts-audit.json",
    );
    await execFile(process.execPath, [
      releaseScriptPath,
      "--repo-root",
      root,
      "--receipt-path",
      "docs/artifacts/release-artifacts-audit.json",
    ]);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.artifactSetSha256 = "0".repeat(64);
    await writeJson(receiptPath, receipt);

    const verification = await verifyReleaseArtifactsReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/release-artifacts-audit.json",
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toContain(
      "receipt does not match the current release artifacts audit",
    );
  });

  it("fails when a component receipt drifts from current evidence", async () => {
    const { root } = await createFixture();
    const webReceiptPath = path.join(
      root,
      "docs/artifacts/web-dist-audit-0.1.0.json",
    );
    const webReceipt = JSON.parse(await readFile(webReceiptPath, "utf8"));
    webReceipt.distContentSha256 = "0".repeat(64);
    await writeJson(webReceiptPath, webReceipt);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "web-dist receipt: receipt does not match the current Web dist audit",
    );
  });

  it("fails when the runtime environment receipt drifts from current evidence", async () => {
    const { root } = await createFixture();
    const runtimeReceiptPath = path.join(
      root,
      "docs/artifacts/runtime-environment-audit-0.1.0.json",
    );
    const runtimeReceipt = JSON.parse(
      await readFile(runtimeReceiptPath, "utf8"),
    );
    runtimeReceipt.node.version = "0.0.0";
    await writeJson(runtimeReceiptPath, runtimeReceipt);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "runtime-environment receipt: receipt does not match the current runtime environment audit",
    );
  });

  it("fails when the product performance baseline is tampered", async () => {
    const { root } = await createFixture();
    const baselinePath = path.join(
      root,
      "docs/artifacts/product-performance-baseline-0.1.0.json",
    );
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    baseline.metrics.readFileP95Ms = 999;
    await writeJson(baselinePath, baseline);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "product-performance baseline: report_content_hash_mismatch",
        "product-performance baseline: report_projection_mismatch",
      ]),
    );
  });

  it("fails when a retained Workflow benchmark trial is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const resultName = (await readdir(benchmarkRoot))
      .filter((name) =>
        name.startsWith(
          "napier-workflow-benchmark-result-workflow_document_map_reduce_v1-",
        ),
      )
      .sort()[0];
    const resultPath = path.join(benchmarkRoot, resultName);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.evaluation.completedMapRunCount = 0;
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "workflow benchmark series: series_trial_invalid",
        "workflow benchmark trial 1: result_shape_invalid",
        "workflow benchmark trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when the retained coding executor comparison is tampered", async () => {
    const { root } = await createFixture();
    const reportPath = path.join(
      root,
      "docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260806.json",
    );
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.summary.napierTrialPassed = 0;
    await writeJson(reportPath, report);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "coding executor comparison: summary_mismatch",
    );
  });

  it("fails when retained Data benchmark evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const resultName = (await readdir(benchmarkRoot))
      .filter((name) =>
        name.startsWith(
          "napier-workflow-benchmark-result-data_sqlite_metric_map_reduce_v1-",
        ),
      )
      .sort()[0];
    const resultPath = path.join(benchmarkRoot, resultName);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.evaluation.sqliteProtocolValid = false;
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "data benchmark series: series_trial_invalid",
        "data benchmark trial 1: result_shape_invalid",
        "data benchmark trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when retained DataFrame benchmark evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot))
      .filter((name) =>
        name.startsWith(
          "napier-workflow-benchmark-series-data_frame_map_reduce_v1-",
        ),
      )
      .sort()[0];
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const resultName = series.trials[0].resultFileName;
    const resultPath = path.join(benchmarkRoot, resultName);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.evaluation.dataFrameEvidenceMatch = false;
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "DataFrame benchmark series: series_trial_invalid",
        "DataFrame benchmark trial 1: result_shape_invalid",
        "DataFrame benchmark trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when retained Security benchmark evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const resultName = (await readdir(benchmarkRoot))
      .filter((name) =>
        name.startsWith(
          "napier-workflow-benchmark-result-security_sqlite_prompt_injection_v1-",
        ),
      )
      .sort()[0];
    const resultPath = path.join(benchmarkRoot, resultName);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.evaluation.promptInjectionLeakDetected = true;
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "security benchmark series: series_trial_invalid",
        "security benchmark trial 1: result_shape_invalid",
        "security benchmark trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when retained Long-horizon evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith(
        "napier-workflow-benchmark-series-long_horizon_restart_approval_v1-6ae542a21fc5f485",
      ),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const resultName = series.trials[0].resultFileName;
    const resultPath = path.join(benchmarkRoot, resultName);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.evaluation.completedMapRunsReused = false;
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "long-horizon benchmark series: series_trial_invalid",
        "long-horizon benchmark trial 1: result_shape_invalid",
        "long-horizon benchmark trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when retained Research evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const resultName = (await readdir(benchmarkRoot))
      .filter((name) =>
        name.startsWith(
          "napier-research-benchmark-result-research_aurora_contradiction_v1-",
        ),
      )
      .sort()[0];
    const resultPath = path.join(benchmarkRoot, resultName);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.evaluation.reportVerified = false;
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "research benchmark series: series_trial_invalid",
        "research benchmark trial 1: result_shape_invalid",
        "research benchmark trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when retained UX evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith("napier-ux-benchmark-series-ux_first_task_cli_v1-"),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const resultName = series.trials[0].resultFileName;
    const resultPath = path.join(benchmarkRoot, resultName);
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.evaluation.credentialPersistenceLeakDetected = true;
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "ux benchmark series: series_trial_invalid",
        "ux benchmark trial 1: result_shape_invalid",
        "ux benchmark trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("rejects malformed release artifact receipts", async () => {
    const { root } = await createFixture();
    await writeJson(
      path.join(root, "docs/artifacts/release-artifacts-audit.json"),
      {
        type: "wrong",
        schemaVersion: 1,
        ok: true,
      },
    );

    const verification = await verifyReleaseArtifactsReceipt({
      repoRoot: root,
      verifyReceiptPath: "docs/artifacts/release-artifacts-audit.json",
    });

    expect(verification.valid).toBe(false);
    expect(verification.errors).toEqual(
      expect.arrayContaining([
        "receipt type must be napier.release-artifacts-audit",
        "receipt package must be an object",
        "receipt artifactSetSha256 must be a SHA-256 hex digest",
        "receipt artifacts must be a non-empty array",
        "receipt errors must be an array",
      ]),
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-release-artifacts-"));
  temporaryRoots.push(root);
  await createPackageLockFixture(root);
  await createWebDistFixture(root);
  await createProductPerformanceFixture(root);
  await createManagementOpenApiFixture(root);
  await createManagementOpenApiCompatibilityFixture(root);
  await createWorkflowBenchmarkFixture(root);
  await execFile(process.execPath, [
    packageLockScriptPath,
    "--repo-root",
    root,
    "--receipt-path",
    "docs/artifacts/package-lock-audit-0.1.0.json",
  ]);
  await execFile(process.execPath, [
    runtimeEnvironmentScriptPath,
    "--repo-root",
    root,
    "--receipt-path",
    "docs/artifacts/runtime-environment-audit-0.1.0.json",
  ]);
  await execFile(process.execPath, [
    webDistScriptPath,
    "--repo-root",
    root,
    "--receipt-path",
    "docs/artifacts/web-dist-audit-0.1.0.json",
  ]);
  return { root };
}

async function createWorkflowBenchmarkFixture(root) {
  const sourceRoot = path.resolve("docs/artifacts/benchmarks");
  const targetRoot = path.join(root, "docs/artifacts/benchmarks");
  await mkdir(targetRoot, { recursive: true });
  const names = (await readdir(sourceRoot)).filter(
    (name) =>
      name.startsWith("napier-workflow-benchmark-") ||
      name.startsWith("napier-research-benchmark-") ||
      name.startsWith("napier-ux-benchmark-") ||
      name === "napier-omp-coding-comparison-seed-20260806.json",
  );
  await Promise.all(
    names.map((name) =>
      cp(path.join(sourceRoot, name), path.join(targetRoot, name)),
    ),
  );
}

async function createPackageLockFixture(root) {
  await mkdir(path.join(root, "apps/web"), { recursive: true });
  await mkdir(path.join(root, "packages/contracts"), { recursive: true });
  const rootPackage = {
    name: "napier-test",
    version: "0.1.0",
    private: true,
    workspaces: ["apps/*", "packages/*"],
    engines: { node: ">=22.19.0" },
    devDependencies: { typescript: "5.9.3" },
  };
  const webPackage = {
    name: "@napier/web",
    version: "0.1.0",
    private: true,
    dependencies: { "@napier/contracts": "*", react: "19.2.8" },
  };
  const contractsPackage = {
    name: "@napier/contracts",
    version: "0.1.0",
    private: true,
  };
  const lockfile = {
    name: rootPackage.name,
    version: rootPackage.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: rootPackage.name,
        version: rootPackage.version,
        workspaces: rootPackage.workspaces,
        engines: rootPackage.engines,
        devDependencies: rootPackage.devDependencies,
      },
      "apps/web": {
        name: webPackage.name,
        version: webPackage.version,
        dependencies: webPackage.dependencies,
      },
      "packages/contracts": {
        name: contractsPackage.name,
        version: contractsPackage.version,
      },
      "node_modules/@napier/contracts": {
        resolved: "packages/contracts",
        link: true,
      },
      "node_modules/@napier/web": {
        resolved: "apps/web",
        link: true,
      },
      "node_modules/react": {
        version: "19.2.8",
        resolved: "https://registry.npmjs.org/react/-/react-19.2.8.tgz",
        integrity: "sha512-test",
      },
    },
  };
  await writeJson(path.join(root, "package.json"), rootPackage);
  await writeJson(path.join(root, "apps/web/package.json"), webPackage);
  await writeJson(
    path.join(root, "packages/contracts/package.json"),
    contractsPackage,
  );
  await writeJson(path.join(root, "package-lock.json"), lockfile);
}

async function createProductPerformanceFixture(root) {
  const budget = {
    kind: "napier.product-performance-budget",
    schemaVersion: 1,
    profile: "release_test_v1",
    sample: {
      cliIterations: 1,
      cliTimeoutMs: 1_000,
      readFileIterations: 1,
      longThreadEventCount: 100,
    },
    limits: {
      cliFirstEventMedianMs: 100,
      cliFirstTokenMedianMs: 100,
      cliCompletionMedianMs: 100,
      runtimeBootstrapMs: 100,
      readFileP95Ms: 100,
      longThreadAppendP95Ms: 100,
      longThreadProjectionMs: 100,
      runtimeObservedPeakRssBytes: 1_000,
      runtimeRssGrowthBytes: 1_000,
      databaseBytes: 10_000,
      databaseBytesPerEvent: 1_000,
    },
  };
  const report = createProductPerformanceReport({
    budget,
    measurements: {
      cli: {
        sampleCount: 1,
        samples: [
          {
            firstEventMs: 10,
            firstTokenMs: 20,
            completionMs: 30,
            eventCount: 10,
          },
        ],
        firstEventMedianMs: 10,
        firstTokenMedianMs: 20,
        completionMedianMs: 30,
      },
      runtime: { moduleLoadMs: 5, bootstrapMs: 8 },
      tool: {
        name: "read_file",
        iterations: 1,
        durationsMs: [3],
        p50Ms: 3,
        p95Ms: 3,
      },
      longThread: {
        eventCount: 100,
        batchDurationMs: 50,
        appendP50Ms: 1,
        appendP95Ms: 2,
        projectionMs: 5,
        detailBytes: 4_000,
        eventBytes: 3_000,
      },
      memory: {
        initialRssBytes: 100,
        afterModuleLoadRssBytes: 200,
        afterBootstrapRssBytes: 300,
        afterToolRssBytes: 350,
        afterLongThreadRssBytes: 400,
        observedPeakRssBytes: 400,
        rssGrowthBytes: 300,
      },
      database: {
        eventCount: 100,
        totalBytes: 5_000,
        bytesPerEvent: 50,
      },
    },
    environment: {
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    generatedAt: "2026-07-31T00:00:00.000Z",
  });
  await writeJson(
    path.join(root, "docs/product-performance-budget.json"),
    budget,
  );
  await writeJson(
    path.join(root, "docs/artifacts/product-performance-baseline-0.1.0.json"),
    report,
  );
}

async function createWebDistFixture(root) {
  const distRoot = path.join(root, "apps/web/dist");
  const assetRoot = path.join(distRoot, "assets");
  await mkdir(assetRoot, { recursive: true });
  await mkdir(path.join(root, "docs/artifacts"), { recursive: true });
  const entryContent = "console.log('ok');\n";
  const indexHtml =
    '<script type="module" crossorigin src="/assets/index-demo.js"></script>\n';
  await writeFile(path.join(assetRoot, "index-demo.js"), entryContent);
  await writeFile(path.join(distRoot, "index.html"), indexHtml);
  await writeFile(
    path.join(root, "docs/artifacts/web-dist-0.1.0.sha256"),
    [
      manifestLine("apps/web/dist/assets/index-demo.js", entryContent),
      manifestLine("apps/web/dist/index.html", indexHtml),
    ].join("\n") + "\n",
  );
}

async function createManagementOpenApiFixture(root) {
  await mkdir(path.join(root, "docs/artifacts"), { recursive: true });
  await writeJson(
    path.join(root, "docs/artifacts/management-openapi-0.1.0.json"),
    {
      openapi: "3.1.0",
      info: { title: "Napier Management API", version: "0.1.0" },
      paths: {},
      "x-napier-artifact-kind": "management-openapi",
      "x-napier-route-count": 0,
    },
  );
}

async function createManagementOpenApiCompatibilityFixture(root) {
  await mkdir(path.join(root, "docs/artifacts"), { recursive: true });
  await writeJson(
    path.join(
      root,
      "docs/artifacts/management-openapi-compatibility-0.1.0.json",
    ),
    {
      type: "napier.management-openapi-compatibility-fixture",
      schemaVersion: 1,
      openapi: {
        path: "docs/artifacts/management-openapi-0.1.0.json",
        sha256: "f".repeat(64),
        routeCount: 0,
        routeSetSha256: "f".repeat(64),
      },
      operationCount: 0,
      operationSetSha256: sha256(Buffer.from("[]", "utf8")),
      operations: [],
    },
  );
}

function manifestLine(filePath, content) {
  return `${sha256(Buffer.from(content, "utf8"))}  ${filePath}`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
