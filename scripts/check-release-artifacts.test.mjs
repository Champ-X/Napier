import { createHash } from "node:crypto";
import { execFile as execFileWithCallback } from "node:child_process";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { canonicalJson } from "../packages/runtime/dist/index.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  auditReleaseArtifacts,
  createReleaseArtifactsReceipt,
  createReleaseArtifactsVerification,
  verifyReleaseArtifactsReceipt,
} from "./check-release-artifacts.mjs";
import { linuxHostProductAcceptanceImplementation } from "./linux-host-product-acceptance-artifact.mjs";
import { createLongThreadPerformanceMeasurement } from "./product-performance-long-thread.mjs";
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
      "sandbox-image-sbom",
      "sandbox-image-provenance",
      "oci-resource-limits-stage10",
      "oci-crash-recovery-stage11",
      "sandbox-security-casebook-stage12",
      "sandbox-product-acceptance-stage13",
      "sandbox-multi-architecture-stage14",
      "sandbox-portable-process-stage15",
      "sandbox-portable-lsp-stage16",
      "sandbox-portable-dap-stage17",
      "sandbox-oci-supply-chain-stage18",
      "linux-host-product-acceptance-stage19",
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
      "long-horizon-multi-restart-variance-series",
      "long-horizon-multi-restart-variance-result-1",
      "long-horizon-multi-restart-variance-ledger-1",
      "long-horizon-multi-restart-variance-result-2",
      "long-horizon-multi-restart-variance-ledger-2",
      "long-horizon-multi-restart-variance-result-3",
      "long-horizon-multi-restart-variance-ledger-3",
      "long-horizon-multi-restart-variance-result-4",
      "long-horizon-multi-restart-variance-ledger-4",
      "long-horizon-multi-restart-variance-result-5",
      "long-horizon-multi-restart-variance-ledger-5",
      "long-horizon-multi-restart-confirmation-series",
      "long-horizon-multi-restart-confirmation-result-1",
      "long-horizon-multi-restart-confirmation-ledger-1",
      "long-horizon-multi-restart-confirmation-result-2",
      "long-horizon-multi-restart-confirmation-ledger-2",
      "long-horizon-multi-restart-confirmation-result-3",
      "long-horizon-multi-restart-confirmation-ledger-3",
      "long-horizon-multi-restart-confirmation-result-4",
      "long-horizon-multi-restart-confirmation-ledger-4",
      "long-horizon-multi-restart-confirmation-result-5",
      "long-horizon-multi-restart-confirmation-ledger-5",
      "long-horizon-offline-wait-sample-a-series",
      "long-horizon-offline-wait-sample-a-result-1",
      "long-horizon-offline-wait-sample-a-ledger-1",
      "long-horizon-offline-wait-sample-a-result-2",
      "long-horizon-offline-wait-sample-a-ledger-2",
      "long-horizon-offline-wait-sample-b-series",
      "long-horizon-offline-wait-sample-b-result-1",
      "long-horizon-offline-wait-sample-b-ledger-1",
      "long-horizon-offline-wait-sample-b-result-2",
      "long-horizon-offline-wait-sample-b-ledger-2",
      "long-horizon-offline-wait-distribution-series",
      "long-horizon-offline-wait-distribution-result-1",
      "long-horizon-offline-wait-distribution-ledger-1",
      "long-horizon-offline-wait-distribution-result-2",
      "long-horizon-offline-wait-distribution-ledger-2",
      "long-horizon-offline-wait-distribution-result-3",
      "long-horizon-offline-wait-distribution-ledger-3",
      "long-horizon-offline-wait-distribution-result-4",
      "long-horizon-offline-wait-distribution-ledger-4",
      "long-horizon-offline-wait-distribution-result-5",
      "long-horizon-offline-wait-distribution-ledger-5",
      "long-horizon-budget-sample-series",
      "long-horizon-budget-sample-result-1",
      "long-horizon-budget-sample-ledger-1",
      "long-horizon-budget-sample-result-2",
      "long-horizon-budget-sample-ledger-2",
      "long-horizon-budget-distribution-series",
      "long-horizon-budget-distribution-result-1",
      "long-horizon-budget-distribution-ledger-1",
      "long-horizon-budget-distribution-result-2",
      "long-horizon-budget-distribution-ledger-2",
      "long-horizon-budget-distribution-result-3",
      "long-horizon-budget-distribution-ledger-3",
      "long-horizon-budget-distribution-result-4",
      "long-horizon-budget-distribution-ledger-4",
      "long-horizon-budget-distribution-result-5",
      "long-horizon-budget-distribution-ledger-5",
      "long-horizon-goal-no-progress-series",
      "long-horizon-goal-no-progress-result-1",
      "long-horizon-goal-no-progress-ledger-1",
      "long-horizon-goal-no-progress-result-2",
      "long-horizon-goal-no-progress-ledger-2",
      "long-horizon-process-recovery-series",
      "long-horizon-process-recovery-result-1",
      "long-horizon-process-recovery-ledger-1",
      "long-horizon-process-recovery-result-2",
      "long-horizon-process-recovery-ledger-2",
      "long-horizon-process-recovery-result-3",
      "long-horizon-process-recovery-ledger-3",
      "long-horizon-process-recovery-result-4",
      "long-horizon-process-recovery-ledger-4",
      "long-horizon-process-recovery-result-5",
      "long-horizon-process-recovery-ledger-5",
      "research-benchmark-series",
      "research-benchmark-result-1",
      "research-benchmark-ledger-1",
      "research-benchmark-result-2",
      "research-benchmark-ledger-2",
      "research-benchmark-normalization-migration",
      "open-web-research-freshness-campaign",
      "open-web-research-freshness-observation-1-result",
      "open-web-research-freshness-observation-2-series",
      "open-web-research-freshness-observation-2-result-1",
      "open-web-research-freshness-observation-2-result-2",
      "open-web-security-benchmark-series",
      "open-web-security-benchmark-result-1",
      "open-web-security-benchmark-result-2",
      "open-web-executor-comparison-attempt-1",
      "open-web-executor-comparison-attempt-2",
      "open-web-executor-comparison-campaign",
      "open-web-executor-comparison-report-1",
      "open-web-executor-comparison-report-2",
      "ux-benchmark-series",
      "ux-benchmark-result-1",
      "ux-benchmark-ledger-1",
      "ux-benchmark-result-2",
      "ux-benchmark-ledger-2",
      "browser-confirmed-form-benchmark-series",
      "browser-confirmed-form-benchmark-result-1",
      "browser-confirmed-form-benchmark-ledger-1",
      "browser-confirmed-form-benchmark-result-2",
      "browser-confirmed-form-benchmark-ledger-2",
      "browser-confirmed-form-benchmark-result-3",
      "browser-confirmed-form-benchmark-ledger-3",
      "browser-confirmed-form-benchmark-result-4",
      "browser-confirmed-form-benchmark-ledger-4",
      "browser-confirmed-form-benchmark-result-5",
      "browser-confirmed-form-benchmark-ledger-5",
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

  it("fails when retained OCI resource evidence expands swap authority", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/oci-resource-limits-stage10.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.observedProductionProcess.memorySwapMaxBytes = 1_073_741_824;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("OCI resource limits evidence is invalid");
  });

  it("fails when retained OCI crash recovery evidence claims endpoint reuse", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/oci-crash-recovery-stage11.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.cycles[1].endpointSha256 = evidence.cycles[0].endpointSha256;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "OCI crash recovery: OCI crash recovery artifact shape is invalid",
        ),
      ]),
    );
  });

  it("fails when retained Sandbox security Casebook overclaims completion", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/sandbox-security-casebook-stage12.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.scope.s1Complete = true;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Sandbox security Casebook: Sandbox security Casebook artifact shape is invalid",
        ),
      ]),
    );
  });

  it("fails when retained Sandbox product acceptance exposes stale output", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/sandbox-product-acceptance-stage13.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.restart.staleOutputExposed = true;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Sandbox product acceptance: Sandbox product acceptance artifact shape is invalid",
        ),
      ]),
    );
  });

  it("fails when retained Sandbox multi-architecture parity is tampered", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/sandbox-multi-architecture-stage14.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.parity.toolchainVersionsEqual = false;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Sandbox multi-architecture: Sandbox multi-architecture artifact shape is invalid",
        ),
      ]),
    );
  });

  it("fails when retained Sandbox portable process identity is tampered", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/sandbox-portable-process-stage15.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.portableIdentity.nonRoot = false;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Sandbox portable process: Sandbox portable process artifact shape is invalid",
        ),
      ]),
    );
  });

  it("fails when retained Sandbox portable LSP parity is tampered", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/sandbox-portable-lsp-stage16.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.productionParity.definition.equal = false;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Sandbox portable LSP: Sandbox portable LSP artifact shape is invalid",
        ),
      ]),
    );
  });

  it("fails when retained Sandbox portable DAP parity is tampered", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/sandbox-portable-dap-stage17.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.productionParity.frameProjectionEqual = false;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Sandbox portable DAP: Sandbox portable DAP artifact shape is invalid",
        ),
      ]),
    );
  });

  it("fails when retained Sandbox OCI signature is tampered", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/sandbox-oci-supply-chain-stage18.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.signing.signature = `${evidence.signing.signature.slice(0, -1)}A`;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Sandbox OCI supply chain: Sandbox OCI supply-chain artifact shape is invalid",
        ),
      ]),
    );
  });

  it("fails when retained Linux host acceptance is overclaimed", async () => {
    const { root } = await createFixture();
    const evidencePath = path.join(
      root,
      "docs/artifacts/linux-host-product-acceptance-stage19.json",
    );
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.scope.windowsHostProductAcceptance = true;
    await writeJson(evidencePath, evidence);

    const result = await auditReleaseArtifacts({ repoRoot: root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Linux host product acceptance: Linux host product acceptance artifact shape is invalid",
        ),
      ]),
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

  it("fails when the second retained Runtime restart is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith(
        "napier-workflow-benchmark-series-long_horizon_multi_restart_approval_v1-42d4d77a9581f02a",
      ),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const ledgerPath = path.join(
      benchmarkRoot,
      series.trials[0].ledgerFileName,
    );
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    ledger.workflow.restartEvents[1].payload.decisionSha256 = "0".repeat(64);
    await writeJson(ledgerPath, ledger);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "long-horizon multi-restart confirmation series: series_trial_invalid",
        "long-horizon multi-restart confirmation trial 1: ledger:ledger_restart_evidence_invalid",
        "long-horizon multi-restart confirmation trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when retained Provider outcome evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith(
        "napier-workflow-benchmark-series-long_horizon_multi_restart_approval_v1-c99798474740bc5a",
      ),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const ledgerPath = path.join(
      benchmarkRoot,
      series.trials[0].ledgerFileName,
    );
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    ledger.workflow.modelResponseEvidenceEvent.payload.modelResponseErrorCount = 0;
    await writeJson(ledgerPath, ledger);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "long-horizon multi-restart variance series: series_trial_invalid",
        "long-horizon multi-restart variance trial 1: ledger:ledger_model_response_evidence_invalid",
        "long-horizon multi-restart variance trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when retained offline wait deadline evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith(
        "napier-workflow-benchmark-series-long_horizon_offline_wait_approval_v1-8fbd6eba325a0839",
      ),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const passed = series.trials.find((trial) => trial.status === "passed");
    const ledgerPath = path.join(benchmarkRoot, passed.ledgerFileName);
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    ledger.workflow.restartEvent.payload.approvalExpiresAt =
      "2026-08-04T00:00:00.000Z";
    await writeJson(ledgerPath, ledger);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "long-horizon offline wait distribution series: series_trial_invalid",
        `long-horizon offline wait distribution trial ${passed.index}: ledger:ledger_restart_evidence_invalid`,
        `long-horizon offline wait distribution trial ${passed.index}: trial_binding_mismatch`,
      ]),
    );
  });

  it("fails when retained budget exhaustion evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith(
        "napier-workflow-benchmark-series-long_horizon_token_budget_exhaustion_v1-ee23f61783f8c111",
      ),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const ledgerPath = path.join(
      benchmarkRoot,
      series.trials[0].ledgerFileName,
    );
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    ledger.workflow.budgetExhaustionEvents[0].payload.reason = "cost";
    await writeJson(ledgerPath, ledger);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "long-horizon budget distribution series: series_trial_invalid",
        "long-horizon budget distribution trial 1: ledger:ledger_budget_evidence_invalid",
        "long-horizon budget distribution trial 1: trial_binding_mismatch",
      ]),
    );
  });

  it("fails when retained Goal no-progress evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith(
        "napier-goal-no-progress-benchmark-series-long_horizon_goal_no_progress_v1-",
      ),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const passed = series.trials.find((trial) => trial.status === "passed");
    const ledgerPath = path.join(benchmarkRoot, passed.ledgerFileName);
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    const finalEvaluation = ledger.goalEvents
      .filter((event) => event.type === "goal.evaluated")
      .at(-1);
    finalEvaluation.payload.noProgressCount = 1;
    const { contentSha256: _contentSha256, ...content } = ledger;
    ledger.contentSha256 = sha256(canonicalJson(content));
    await writeJson(ledgerPath, ledger);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "long-horizon Goal no-progress series: series_trial_invalid",
        `long-horizon Goal no-progress trial ${passed.index}: ledger_binding_mismatch`,
        `long-horizon Goal no-progress trial ${passed.index}: evaluation_evidence_mismatch`,
      ]),
    );
  });

  it("fails when retained Process compensation evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith(
        "napier-process-recovery-benchmark-series-long_horizon_process_write_compensation_v1-",
      ),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const ledgerPath = path.join(
      benchmarkRoot,
      series.trials[0].ledgerFileName,
    );
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    ledger.target.finalSha256 = ledger.target.mutatedSha256;
    const { contentSha256: _contentSha256, ...content } = ledger;
    ledger.contentSha256 = sha256(canonicalJson(content));
    await writeJson(ledgerPath, ledger);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "long-horizon Process recovery series: series_trial_invalid",
        "long-horizon Process recovery trial 1: ledger_binding_mismatch",
        "long-horizon Process recovery trial 1: evaluation_evidence_mismatch",
        "long-horizon Process recovery trial 1: target_binding_mismatch",
      ]),
    );
  });

  it("fails when retained Research evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(root, "docs/artifacts/benchmarks");
    const series = JSON.parse(
      await readFile(
        path.join(
          benchmarkRoot,
          "napier-research-benchmark-series-research_aurora_contradiction_v1-6766737f84f84714.json",
        ),
        "utf8",
      ),
    );
    const resultPath = path.join(
      benchmarkRoot,
      series.trials[0].resultFileName,
    );
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

  it("fails when the Research normalization migration receipt is tampered", async () => {
    const { root } = await createFixture();
    const receiptPath = path.join(
      root,
      "docs/artifacts/benchmarks/napier-research-benchmark-normalization-migration-20260807.json",
    );
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.providerRerun = true;
    const { contentSha256: _contentSha256, ...content } = receipt;
    receipt.contentSha256 = sha256(canonicalJson(content));
    await writeJson(receiptPath, receipt);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toContain(
      "research benchmark normalization migration receipt is invalid",
    );
  });

  it("fails when retained open-web Research case binding is tampered", async () => {
    const { root } = await createFixture();
    const seriesPath = path.join(
      root,
      "benchmark-results/napier-open-web-research-series-research_open_web_source_triad_v1-a7b8199e42e13339.json",
    );
    const series = JSON.parse(await readFile(seriesPath, "utf8"));
    const resultPath = path.join(
      path.dirname(seriesPath),
      series.trials[0].resultFileName,
    );
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.caseSha256 = "0".repeat(64);
    const { contentSha256: _contentSha256, ...content } = result;
    result.contentSha256 = sha256(canonicalJson(content));
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "open-web research benchmark: campaign_observation_invalid",
        "open-web research benchmark: campaign_aggregate_mismatch",
      ]),
    );
  });

  it("rejects an incomplete open-web Research reliability Series", async () => {
    const { root } = await createFixture();
    const seriesPath = path.join(
      root,
      "benchmark-results/napier-open-web-research-series-research_open_web_source_triad_v1-a7b8199e42e13339.json",
    );
    const series = JSON.parse(await readFile(seriesPath, "utf8"));
    series.status = "cancelled";
    series.requestedTrialCount = 3;
    series.completionRate = 2 / 3;
    const { contentSha256: _contentSha256, ...content } = series;
    series.contentSha256 = sha256(canonicalJson(content));
    await writeJson(seriesPath, series);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "open-web research benchmark: campaign_observation_invalid",
        "open-web research benchmark: campaign_aggregate_mismatch",
      ]),
    );
  });

  it("rejects a rehashed open-web Research freshness aggregate", async () => {
    const { root } = await createFixture();
    const campaignPath = path.join(
      root,
      "benchmark-results/napier-open-web-research-freshness-campaign-research_open_web_source_triad_v1-c9248212f0b67e3f.json",
    );
    const campaign = JSON.parse(await readFile(campaignPath, "utf8"));
    campaign.minimumObservationGapMs = 0;
    const { contentSha256: _contentSha256, ...content } = campaign;
    campaign.contentSha256 = sha256(canonicalJson(content));
    await writeJson(campaignPath, campaign);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toContain(
      "open-web research benchmark: campaign_aggregate_mismatch",
    );
  });

  it("fails when retained open-web Security evidence is rehashed", async () => {
    const { root } = await createFixture();
    const seriesPath = path.join(
      root,
      "docs/artifacts/benchmarks/napier-open-web-research-security-series-security_open_web_prompt_injection_v1-7c30ff1f81e86273.json",
    );
    const series = JSON.parse(await readFile(seriesPath, "utf8"));
    const resultPath = path.join(
      path.dirname(seriesPath),
      series.trials[0].resultFileName,
    );
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.security.forbiddenToolAttemptDetected = true;
    result.diagnostics = ["forbidden_tool_attempted"];
    result.status = "failed";
    const { contentSha256: _contentSha256, ...content } = result;
    result.contentSha256 = sha256(canonicalJson(content));
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "open-web security benchmark: series_trial_invalid",
        "open-web security benchmark: series_aggregate_mismatch",
      ]),
    );
  });

  it("fails when a retained open-web executor comparison report is rehashed", async () => {
    const { root } = await createFixture();
    const reportPath = path.join(
      root,
      "benchmark-results/napier-open-web-executor-comparison-seed-20260805.json",
    );
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.summary.overall.pairCount += 1;
    const { contentSha256: _contentSha256, ...content } = report;
    report.contentSha256 = sha256(canonicalJson(content));
    await writeJson(reportPath, report);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "open-web executor comparison campaign: Open-web comparison report is invalid: report_summary_invalid",
        ),
      ]),
    );
  });

  it("fails when the retained open-web executor attempt receipt is rehashed", async () => {
    const { root } = await createFixture();
    const attemptPath = path.join(
      root,
      "benchmark-results/napier-open-web-executor-comparison-attempt-seed-20260806-eeb63387bc7f02ef.json",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8"));
    attempt.diagnostics = ["report_cases_invalid"];
    const { contentSha256: _contentSha256, ...content } = attempt;
    attempt.contentSha256 = sha256(canonicalJson(content));
    await writeJson(attemptPath, attempt);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toContain(
      "open-web executor comparison attempt: Open-web comparison attempt filename is invalid",
    );
  });

  it("fails when the retained open-web executor campaign aggregate is rehashed", async () => {
    const { root } = await createFixture();
    const campaignName = (
      await readdir(path.join(root, "benchmark-results"))
    ).find((name) =>
      name.startsWith("napier-open-web-executor-comparison-campaign-seeds-"),
    );
    const campaignPath = path.join(root, "benchmark-results", campaignName);
    const campaign = JSON.parse(await readFile(campaignPath, "utf8"));
    campaign.summary.overall.napier.meanDurationMs += 1;
    const { contentSha256: _contentSha256, ...content } = campaign;
    campaign.contentSha256 = sha256(canonicalJson(content));
    const renamedCampaignName = campaignName.replace(
      /[a-f0-9]{16}\.json$/u,
      `${campaign.contentSha256.slice(0, 16)}.json`,
    );
    const renamedCampaignPath = path.join(
      root,
      "benchmark-results",
      renamedCampaignName,
    );
    await writeJson(campaignPath, campaign);
    await rename(campaignPath, renamedCampaignPath);

    const audit = await auditReleaseArtifacts({
      repoRoot: root,
      openWebExecutorComparisonCampaignPath: path.posix.join(
        "benchmark-results",
        renamedCampaignName,
      ),
    });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toContain(
      "open-web executor comparison campaign: campaign_aggregate_invalid",
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

  it("fails when retained Browser confirmed form evidence is tampered", async () => {
    const { root } = await createFixture();
    const benchmarkRoot = path.join(
      root,
      "benchmark-results/browser-confirmed-form-live-20260805-series5-release",
    );
    const seriesName = (await readdir(benchmarkRoot)).find((name) =>
      name.startsWith(
        "napier-browser-confirmed-form-benchmark-series-browser_confirmed_form_cli_v1-",
      ),
    );
    const series = JSON.parse(
      await readFile(path.join(benchmarkRoot, seriesName), "utf8"),
    );
    const resultPath = path.join(
      benchmarkRoot,
      series.trials[0].resultFileName,
    );
    const result = JSON.parse(await readFile(resultPath, "utf8"));
    result.evaluation.privateUrl = "https://private.example/";
    const { contentSha256: _contentSha256, ...content } = result;
    result.contentSha256 = sha256(canonicalJson(content));
    await writeJson(resultPath, result);

    const audit = await auditReleaseArtifacts({ repoRoot: root });

    expect(audit.ok).toBe(false);
    expect(audit.errors).toEqual(
      expect.arrayContaining([
        "Browser confirmed form benchmark series: series_trial_invalid",
        "Browser confirmed form benchmark trial 1: result_shape_invalid",
        "Browser confirmed form benchmark trial 1: trial_binding_mismatch",
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
  await mkdir(path.join(root, "docker/napier-sandbox"), { recursive: true });
  for (const fileName of ["Dockerfile", "package.json", "package-lock.json"]) {
    await cp(
      path.resolve("docker/napier-sandbox", fileName),
      path.join(root, "docker/napier-sandbox", fileName),
    );
  }
  for (const fileName of [
    "sandbox-image-sbom-0.1.0.cdx.json",
    "sandbox-image-provenance-0.1.0.json",
    "oci-resource-limits-stage10.json",
    "oci-crash-recovery-stage11.json",
    "sandbox-security-casebook-stage12.json",
    "sandbox-product-acceptance-stage13.json",
    "sandbox-multi-architecture-stage14.json",
    "sandbox-portable-process-stage15.json",
    "sandbox-portable-lsp-stage16.json",
    "sandbox-portable-dap-stage17.json",
    "sandbox-oci-supply-chain-stage18.json",
    "linux-host-product-acceptance-stage19.json",
  ]) {
    await cp(
      path.resolve("docs/artifacts", fileName),
      path.join(root, "docs/artifacts", fileName),
    );
  }
  for (const relative of [
    "packages/runtime/src/process-guardian.ts",
    "packages/runtime/src/process-guardian-worker-source.ts",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/sandbox-oci.ts",
    "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    "scripts/check-oci-crash-recovery.mjs",
    "scripts/oci-crash-recovery-artifact.mjs",
    "scripts/oci-crash-recovery-fixture.mjs",
    "scripts/oci-crash-recovery-live.mjs",
    "packages/runtime/src/command-execution.ts",
    "packages/runtime/src/sandboxed-process.ts",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/sandbox-container-policy.ts",
    "scripts/check-sandbox-security-casebook.mjs",
    "scripts/sandbox-security-casebook-artifact.mjs",
    "scripts/sandbox-security-casebook-live.mjs",
    "packages/runtime/src/sandbox-setup-service.ts",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/sandbox-oci.ts",
    "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    "packages/runtime/src/doctor-lsp-runtime-probe.ts",
    "packages/runtime/src/verification-runtime.ts",
    "packages/runtime/src/verification.ts",
    "packages/runtime/src/workspace-processes.ts",
    "scripts/check-sandbox-product-acceptance.mjs",
    "scripts/sandbox-product-acceptance-artifact.mjs",
    "scripts/sandbox-product-acceptance-live.mjs",
    "packages/runtime/src/doctor-lsp-runtime-probe.ts",
    "packages/runtime/src/sandbox-container-runtime.ts",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/sandbox-oci-launch-arguments.ts",
    "scripts/check-sandbox-multi-architecture.mjs",
    "scripts/sandbox-multi-architecture-artifact.mjs",
    "scripts/sandbox-multi-architecture-live.mjs",
    "packages/runtime/src/sandbox-container-path-mapping.ts",
    "packages/runtime/src/sandbox-launch-policy.ts",
    "packages/runtime/src/git-inspect-process.ts",
    "packages/runtime/src/verification.ts",
    "scripts/check-sandbox-portable-process.mjs",
    "scripts/sandbox-portable-process-artifact.mjs",
    "scripts/sandbox-portable-process-live.mjs",
    "packages/runtime/src/sandbox-types.ts",
    "packages/runtime/src/sandbox-container-lsp-runtime.ts",
    "packages/runtime/src/lsp-runtime-assets.ts",
    "packages/runtime/src/lsp-protocol-path-binding.ts",
    "packages/runtime/src/lsp-protocol-session.ts",
    "packages/runtime/src/lsp-source-session.ts",
    "packages/runtime/src/lsp-persistent-session.ts",
    "packages/runtime/src/lsp-persistent-session-binding.ts",
    "packages/runtime/src/lsp-locations.ts",
    "scripts/check-sandbox-portable-lsp.mjs",
    "scripts/sandbox-portable-lsp-artifact.mjs",
    "scripts/sandbox-portable-lsp-live.mjs",
    "packages/runtime/src/sandbox-container-node-debugger-runtime.ts",
    "packages/runtime/src/node-debugger-runtime.ts",
    "packages/runtime/src/node-debugger-protocol-path-binding.ts",
    "packages/runtime/src/node-debugger.ts",
    "packages/runtime/src/node-debugger-worker.ts",
    "packages/runtime/src/node-debugger-source-map-worker.ts",
    "scripts/check-sandbox-portable-dap.mjs",
    "scripts/sandbox-portable-dap-artifact.mjs",
    "scripts/sandbox-portable-dap-live.mjs",
    "scripts/check-sandbox-oci-supply-chain.mjs",
    "scripts/sandbox-oci-supply-chain-artifact.mjs",
    "scripts/sandbox-oci-supply-chain-live.mjs",
    "scripts/sandbox-oci-layout-verification.mjs",
    "scripts/sandbox-oci-signing.mjs",
    "scripts/check-linux-host-product-acceptance.mjs",
    "scripts/linux-host-product-acceptance-artifact.mjs",
    "scripts/linux-host-product-acceptance-guest.mjs",
    "scripts/linux-host-product-acceptance-live.mjs",
    "packages/runtime/src/project-skill-snapshot-acquisition.ts",
    "packages/runtime/src/project-skill-snapshot-anchor.ts",
    "packages/runtime/src/project-skill-snapshot-memory.ts",
    "packages/runtime/src/project-skill-snapshot-model.ts",
    "packages/runtime/src/project-skill-snapshot.ts",
    "packages/runtime/src/sandbox-terminal.ts",
    "scripts/prepare-node-pty.mjs",
    "scripts/prepare-node-pty.test.mjs",
  ]) {
    await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    await cp(path.resolve(relative), path.join(root, relative));
  }
  await createWorkflowBenchmarkFixture(root);
  await mkdir(path.join(root, "benchmark-results"), { recursive: true });
  for (const fileName of [
    "napier-open-web-research-freshness-campaign-research_open_web_source_triad_v1-c9248212f0b67e3f.json",
    "napier-open-web-research-benchmark-result-research_open_web_source_triad_v1-b90a841f097b03b9.json",
    "napier-open-web-research-series-research_open_web_source_triad_v1-a7b8199e42e13339.json",
    "napier-open-web-research-benchmark-result-research_open_web_source_triad_v1-d7e4f2fd4e284674.json",
    "napier-open-web-research-benchmark-result-research_open_web_source_triad_v1-b6f353840b7374e9.json",
  ]) {
    await cp(
      path.resolve("benchmark-results", fileName),
      path.join(root, "benchmark-results", fileName),
    );
  }
  const openWebComparisonNames = (
    await readdir(path.resolve("benchmark-results"))
  ).filter(
    (name) =>
      name.startsWith("napier-open-web-executor-comparison-attempt-seed-") ||
      name.startsWith("napier-open-web-executor-comparison-seed-") ||
      name.startsWith("napier-open-web-executor-comparison-campaign-seeds-"),
  );
  await Promise.all(
    openWebComparisonNames.map((name) =>
      cp(
        path.resolve("benchmark-results", name),
        path.join(root, "benchmark-results", name),
      ),
    ),
  );
  await cp(
    path.resolve(
      "benchmark-results/browser-confirmed-form-live-20260805-series5-release",
    ),
    path.join(
      root,
      "benchmark-results/browser-confirmed-form-live-20260805-series5-release",
    ),
    { recursive: true },
  );
  for (const fileName of [
    "napier-open-web-research-security-series-security_open_web_prompt_injection_v1-7c30ff1f81e86273.json",
    "napier-open-web-research-benchmark-result-security_open_web_prompt_injection_v1-a0e5774bc463a4eb.json",
    "napier-open-web-research-benchmark-result-security_open_web_prompt_injection_v1-e3f9bffa4a865c54.json",
  ]) {
    await cp(
      path.resolve("docs/artifacts/benchmarks", fileName),
      path.join(root, "docs/artifacts/benchmarks", fileName),
    );
  }
  await cp(
    path.resolve("benchmarks/research/open-web-source-triad-v1"),
    path.join(root, "benchmarks/research/open-web-source-triad-v1"),
    { recursive: true },
  );
  await cp(
    path.resolve("benchmarks/security/open-web-prompt-injection-v1"),
    path.join(root, "benchmarks/security/open-web-prompt-injection-v1"),
    { recursive: true },
  );
  await rebindLinuxHostProductAcceptanceFixture(root);
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

async function rebindLinuxHostProductAcceptanceFixture(root) {
  const artifactPath = path.join(
    root,
    "docs/artifacts/linux-host-product-acceptance-stage19.json",
  );
  const value = JSON.parse(await readFile(artifactPath, "utf8"));
  value.implementation = await linuxHostProductAcceptanceImplementation(root);
  value.guest.source.packageLockSha256 = value.implementation.packageLockSha256;
  const { evidenceSha256: _evidenceSha256, ...guest } = value.guest;
  value.guest.evidenceSha256 = sha256(
    Buffer.from(canonicalJson(guest), "utf8"),
  );
  const { contentSha256: _contentSha256, ...content } = value;
  value.contentSha256 = sha256(Buffer.from(canonicalJson(content), "utf8"));
  await writeJson(artifactPath, value);
}

async function createWorkflowBenchmarkFixture(root) {
  const sourceRoot = path.resolve("docs/artifacts/benchmarks");
  const targetRoot = path.join(root, "docs/artifacts/benchmarks");
  await mkdir(targetRoot, { recursive: true });
  const names = (await readdir(sourceRoot)).filter(
    (name) =>
      name.startsWith("napier-workflow-benchmark-") ||
      name.startsWith("napier-goal-no-progress-benchmark-") ||
      name.startsWith("napier-process-recovery-benchmark-") ||
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
  await mkdir(path.join(root, "packages/runtime"), { recursive: true });
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
  const runtimePackage = {
    name: "@napier/runtime",
    version: "0.1.0",
    private: true,
    dependencies: { "@napier/contracts": "*" },
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
      "packages/runtime": {
        name: runtimePackage.name,
        version: runtimePackage.version,
        dependencies: runtimePackage.dependencies,
      },
      "node_modules/@napier/contracts": {
        resolved: "packages/contracts",
        link: true,
      },
      "node_modules/@napier/web": {
        resolved: "apps/web",
        link: true,
      },
      "node_modules/@napier/runtime": {
        resolved: "packages/runtime",
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
  await writeJson(
    path.join(root, "packages/runtime/package.json"),
    runtimePackage,
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
      longThreadIterations: 3,
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
      longThread: createLongThreadPerformanceMeasurement(
        [1, 2, 3].map((iteration) => ({
          iteration,
          eventCount: 100,
          batchDurationMs: 50,
          appendP50Ms: 1,
          appendP95Ms: 2,
          projectionMs: 5,
          detailBytes: 4_000,
          eventBytes: 3_000,
        })),
      ),
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
        eventCount: 300,
        totalBytes: 5_000,
        bytesPerEvent: 16.667,
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
