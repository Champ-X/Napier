import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyPackageLockReceipt } from "./check-package-lock.mjs";
import { verifyRuntimeEnvironmentReceipt } from "./check-runtime-environment.mjs";
import { verifyWebDistReceipt } from "./check-web-dist.mjs";
import { verifyProductPerformanceReportFile } from "./product-performance-report.mjs";
import { verifyCodingExecutorComparison } from "./check-coding-executor-comparison.mjs";
import {
  verifyWorkflowBenchmarkSeries,
  workflowBenchmarkSeriesArtifactReferences,
} from "../apps/cli/dist/workflow-benchmark-series.js";
import {
  researchBenchmarkSeriesArtifactReferences,
  verifyResearchBenchmarkSeries,
} from "../apps/cli/dist/research-benchmark-series.js";
import {
  uxBenchmarkSeriesArtifactReferences,
  verifyUxBenchmarkSeries,
} from "../apps/cli/dist/ux-benchmark-series.js";
import {
  goalNoProgressSeriesArtifactReferences,
  verifyGoalNoProgressBenchmarkSeries,
} from "../apps/cli/dist/goal-no-progress-benchmark-series.js";
import {
  processRecoverySeriesArtifactReferences,
  verifyProcessRecoveryBenchmarkSeries,
} from "../apps/cli/dist/process-recovery-benchmark-series.js";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultPackageLockReceiptPath =
  "docs/artifacts/package-lock-audit-0.1.0.json";
const defaultRuntimeEnvironmentReceiptPath =
  "docs/artifacts/runtime-environment-audit-0.1.0.json";
const defaultProductPerformanceBudgetPath =
  "docs/product-performance-budget.json";
const defaultProductPerformanceBaselinePath =
  "docs/artifacts/product-performance-baseline-0.1.0.json";
const defaultWebDistReceiptPath = "docs/artifacts/web-dist-audit-0.1.0.json";
const defaultWebDistManifestPath = "docs/artifacts/web-dist-0.1.0.sha256";
const defaultManagementOpenApiPath =
  "docs/artifacts/management-openapi-0.1.0.json";
const defaultManagementOpenApiCompatibilityPath =
  "docs/artifacts/management-openapi-compatibility-0.1.0.json";
const defaultCodingExecutorComparisonPath =
  "docs/artifacts/benchmarks/napier-omp-coding-comparison-seed-20260806.json";
const defaultWorkflowBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-workflow_document_map_reduce_v1-b8bead9bcd08f431.json";
const defaultDataBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-data_sqlite_metric_map_reduce_v1-48f028b75bb535cc.json";
const defaultDataFrameBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-data_frame_map_reduce_v1-c03e1665999f8b6c.json";
const defaultSecurityBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-security_sqlite_prompt_injection_v1-feaceb9d2fee8ab8.json";
const defaultLongHorizonBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_restart_approval_v1-6ae542a21fc5f485.json";
const defaultMultiRestartBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_multi_restart_approval_v1-c99798474740bc5a.json";
const defaultMultiRestartConfirmationBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_multi_restart_approval_v1-42d4d77a9581f02a.json";
const defaultOfflineWaitSampleABenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_offline_wait_approval_v1-29e6600a075de2d2.json";
const defaultOfflineWaitSampleBBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_offline_wait_approval_v1-f9763a9fb75404b4.json";
const defaultOfflineWaitDistributionBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_offline_wait_approval_v1-8fbd6eba325a0839.json";
const defaultBudgetSampleBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_token_budget_exhaustion_v1-3661f272968004ae.json";
const defaultBudgetDistributionBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-workflow-benchmark-series-long_horizon_token_budget_exhaustion_v1-ee23f61783f8c111.json";
const defaultGoalNoProgressBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-goal-no-progress-benchmark-series-long_horizon_goal_no_progress_v1-87aeab3e1c06e1a1.json";
const defaultProcessRecoveryBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-process-recovery-benchmark-series-long_horizon_process_write_compensation_v1-79f2082920791734.json";
const defaultResearchBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-research-benchmark-series-research_aurora_contradiction_v1-f7a821ff7a0b0723.json";
const defaultUxBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-ux-benchmark-series-ux_first_task_cli_v1-747782333f3ad3c3.json";

export async function auditReleaseArtifacts(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const errors = [];
  const packageLockReceiptPath =
    options.packageLockReceiptPath ?? defaultPackageLockReceiptPath;
  const runtimeEnvironmentReceiptPath =
    options.runtimeEnvironmentReceiptPath ??
    defaultRuntimeEnvironmentReceiptPath;
  const productPerformanceBudgetPath =
    options.productPerformanceBudgetPath ?? defaultProductPerformanceBudgetPath;
  const productPerformanceBaselinePath =
    options.productPerformanceBaselinePath ??
    defaultProductPerformanceBaselinePath;
  const webDistReceiptPath =
    options.webDistReceiptPath ?? defaultWebDistReceiptPath;
  const webDistManifestPath =
    options.webDistManifestPath ?? defaultWebDistManifestPath;
  const managementOpenApiPath =
    options.managementOpenApiPath ?? defaultManagementOpenApiPath;
  const managementOpenApiCompatibilityPath =
    options.managementOpenApiCompatibilityPath ??
    defaultManagementOpenApiCompatibilityPath;
  const codingExecutorComparisonPath =
    options.codingExecutorComparisonPath ?? defaultCodingExecutorComparisonPath;
  const workflowBenchmarkSeriesPath =
    options.workflowBenchmarkSeriesPath ?? defaultWorkflowBenchmarkSeriesPath;
  const dataBenchmarkSeriesPath =
    options.dataBenchmarkSeriesPath ?? defaultDataBenchmarkSeriesPath;
  const dataFrameBenchmarkSeriesPath =
    options.dataFrameBenchmarkSeriesPath ?? defaultDataFrameBenchmarkSeriesPath;
  const securityBenchmarkSeriesPath =
    options.securityBenchmarkSeriesPath ?? defaultSecurityBenchmarkSeriesPath;
  const longHorizonBenchmarkSeriesPath =
    options.longHorizonBenchmarkSeriesPath ??
    defaultLongHorizonBenchmarkSeriesPath;
  const multiRestartBenchmarkSeriesPath =
    options.multiRestartBenchmarkSeriesPath ??
    defaultMultiRestartBenchmarkSeriesPath;
  const multiRestartConfirmationBenchmarkSeriesPath =
    options.multiRestartConfirmationBenchmarkSeriesPath ??
    defaultMultiRestartConfirmationBenchmarkSeriesPath;
  const offlineWaitSampleABenchmarkSeriesPath =
    options.offlineWaitSampleABenchmarkSeriesPath ??
    defaultOfflineWaitSampleABenchmarkSeriesPath;
  const offlineWaitSampleBBenchmarkSeriesPath =
    options.offlineWaitSampleBBenchmarkSeriesPath ??
    defaultOfflineWaitSampleBBenchmarkSeriesPath;
  const offlineWaitDistributionBenchmarkSeriesPath =
    options.offlineWaitDistributionBenchmarkSeriesPath ??
    defaultOfflineWaitDistributionBenchmarkSeriesPath;
  const budgetSampleBenchmarkSeriesPath =
    options.budgetSampleBenchmarkSeriesPath ??
    defaultBudgetSampleBenchmarkSeriesPath;
  const budgetDistributionBenchmarkSeriesPath =
    options.budgetDistributionBenchmarkSeriesPath ??
    defaultBudgetDistributionBenchmarkSeriesPath;
  const goalNoProgressBenchmarkSeriesPath =
    options.goalNoProgressBenchmarkSeriesPath ??
    defaultGoalNoProgressBenchmarkSeriesPath;
  const processRecoveryBenchmarkSeriesPath =
    options.processRecoveryBenchmarkSeriesPath ??
    defaultProcessRecoveryBenchmarkSeriesPath;
  const researchBenchmarkSeriesPath =
    options.researchBenchmarkSeriesPath ?? defaultResearchBenchmarkSeriesPath;
  const uxBenchmarkSeriesPath =
    options.uxBenchmarkSeriesPath ?? defaultUxBenchmarkSeriesPath;
  const rootPackage = parseJson(
    await readTextFile(
      path.join(repoRoot, "package.json"),
      "package.json",
      errors,
    ),
    "package.json",
    errors,
  );

  const [
    packageLockVerification,
    runtimeEnvironmentVerification,
    productPerformanceVerification,
    webDistVerification,
    webDistManifest,
    managementOpenApi,
    managementOpenApiCompatibility,
  ] = await Promise.all([
    verifyPackageLockReceipt({
      repoRoot,
      verifyReceiptPath: packageLockReceiptPath,
    }),
    verifyRuntimeEnvironmentReceipt({
      repoRoot,
      verifyReceiptPath: runtimeEnvironmentReceiptPath,
    }),
    verifyProductPerformanceReportFile({
      budgetPath: resolveRepoRelativePath(
        repoRoot,
        productPerformanceBudgetPath,
        "productPerformanceBudgetPath",
      ),
      reportPath: resolveRepoRelativePath(
        repoRoot,
        productPerformanceBaselinePath,
        "productPerformanceBaselinePath",
      ),
    }),
    verifyWebDistReceipt({
      repoRoot,
      verifyReceiptPath: webDistReceiptPath,
    }),
    readArtifactEvidence(repoRoot, webDistManifestPath, errors),
    readArtifactEvidence(repoRoot, managementOpenApiPath, errors),
    readArtifactEvidence(repoRoot, managementOpenApiCompatibilityPath, errors),
  ]);

  if (!packageLockVerification.valid) {
    errors.push(
      ...packageLockVerification.errors.map(
        (error) => `package-lock receipt: ${error}`,
      ),
    );
  }
  if (!runtimeEnvironmentVerification.valid) {
    errors.push(
      ...runtimeEnvironmentVerification.errors.map(
        (error) => `runtime-environment receipt: ${error}`,
      ),
    );
  }
  if (!productPerformanceVerification.valid) {
    errors.push(
      ...productPerformanceVerification.errors.map(
        (error) => `product-performance baseline: ${error}`,
      ),
    );
  }
  if (!webDistVerification.valid) {
    errors.push(
      ...webDistVerification.errors.map(
        (error) => `web-dist receipt: ${error}`,
      ),
    );
  }
  const workflowBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: workflowBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "workflow-benchmark",
    diagnosticLabel: "workflow benchmark",
    artifactReferences: workflowBenchmarkSeriesArtifactReferences,
    verifySeries: verifyWorkflowBenchmarkSeries,
  });
  const dataBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: dataBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "data-benchmark",
    diagnosticLabel: "data benchmark",
    artifactReferences: workflowBenchmarkSeriesArtifactReferences,
    verifySeries: verifyWorkflowBenchmarkSeries,
  });
  const dataFrameBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: dataFrameBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "data-frame-benchmark",
    diagnosticLabel: "DataFrame benchmark",
    artifactReferences: workflowBenchmarkSeriesArtifactReferences,
    verifySeries: verifyWorkflowBenchmarkSeries,
  });
  const securityBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: securityBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "security-benchmark",
    diagnosticLabel: "security benchmark",
    artifactReferences: workflowBenchmarkSeriesArtifactReferences,
    verifySeries: verifyWorkflowBenchmarkSeries,
  });
  const longHorizonBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: longHorizonBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "long-horizon-benchmark",
    diagnosticLabel: "long-horizon benchmark",
    artifactReferences: workflowBenchmarkSeriesArtifactReferences,
    verifySeries: verifyWorkflowBenchmarkSeries,
  });
  const multiRestartBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: multiRestartBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "long-horizon-multi-restart-variance",
    diagnosticLabel: "long-horizon multi-restart variance",
    artifactReferences: workflowBenchmarkSeriesArtifactReferences,
    verifySeries: verifyWorkflowBenchmarkSeries,
  });
  const multiRestartConfirmationBenchmarkArtifacts =
    await verifyBenchmarkReleaseArtifacts({
      repoRoot,
      seriesPath: multiRestartConfirmationBenchmarkSeriesPath,
      errors,
      artifactKindPrefix: "long-horizon-multi-restart-confirmation",
      diagnosticLabel: "long-horizon multi-restart confirmation",
      artifactReferences: workflowBenchmarkSeriesArtifactReferences,
      verifySeries: verifyWorkflowBenchmarkSeries,
    });
  const offlineWaitSampleABenchmarkArtifacts =
    await verifyBenchmarkReleaseArtifacts({
      repoRoot,
      seriesPath: offlineWaitSampleABenchmarkSeriesPath,
      errors,
      artifactKindPrefix: "long-horizon-offline-wait-sample-a",
      diagnosticLabel: "long-horizon offline wait sample A",
      artifactReferences: workflowBenchmarkSeriesArtifactReferences,
      verifySeries: verifyWorkflowBenchmarkSeries,
    });
  const offlineWaitSampleBBenchmarkArtifacts =
    await verifyBenchmarkReleaseArtifacts({
      repoRoot,
      seriesPath: offlineWaitSampleBBenchmarkSeriesPath,
      errors,
      artifactKindPrefix: "long-horizon-offline-wait-sample-b",
      diagnosticLabel: "long-horizon offline wait sample B",
      artifactReferences: workflowBenchmarkSeriesArtifactReferences,
      verifySeries: verifyWorkflowBenchmarkSeries,
    });
  const offlineWaitDistributionBenchmarkArtifacts =
    await verifyBenchmarkReleaseArtifacts({
      repoRoot,
      seriesPath: offlineWaitDistributionBenchmarkSeriesPath,
      errors,
      artifactKindPrefix: "long-horizon-offline-wait-distribution",
      diagnosticLabel: "long-horizon offline wait distribution",
      artifactReferences: workflowBenchmarkSeriesArtifactReferences,
      verifySeries: verifyWorkflowBenchmarkSeries,
    });
  const budgetSampleBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: budgetSampleBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "long-horizon-budget-sample",
    diagnosticLabel: "long-horizon budget sample",
    artifactReferences: workflowBenchmarkSeriesArtifactReferences,
    verifySeries: verifyWorkflowBenchmarkSeries,
  });
  const budgetDistributionBenchmarkArtifacts =
    await verifyBenchmarkReleaseArtifacts({
      repoRoot,
      seriesPath: budgetDistributionBenchmarkSeriesPath,
      errors,
      artifactKindPrefix: "long-horizon-budget-distribution",
      diagnosticLabel: "long-horizon budget distribution",
      artifactReferences: workflowBenchmarkSeriesArtifactReferences,
      verifySeries: verifyWorkflowBenchmarkSeries,
    });
  const goalNoProgressBenchmarkArtifacts =
    await verifyBenchmarkReleaseArtifacts({
      repoRoot,
      seriesPath: goalNoProgressBenchmarkSeriesPath,
      errors,
      artifactKindPrefix: "long-horizon-goal-no-progress",
      diagnosticLabel: "long-horizon Goal no-progress",
      artifactReferences: goalNoProgressSeriesArtifactReferences,
      verifySeries: verifyGoalNoProgressBenchmarkSeries,
    });
  const processRecoveryBenchmarkArtifacts =
    await verifyBenchmarkReleaseArtifacts({
      repoRoot,
      seriesPath: processRecoveryBenchmarkSeriesPath,
      errors,
      artifactKindPrefix: "long-horizon-process-recovery",
      diagnosticLabel: "long-horizon Process recovery",
      artifactReferences: processRecoverySeriesArtifactReferences,
      verifySeries: verifyProcessRecoveryBenchmarkSeries,
    });
  const researchBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: researchBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "research-benchmark",
    diagnosticLabel: "research benchmark",
    artifactReferences: researchBenchmarkSeriesArtifactReferences,
    verifySeries: verifyResearchBenchmarkSeries,
  });
  const uxBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: uxBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "ux-benchmark",
    diagnosticLabel: "ux benchmark",
    artifactReferences: uxBenchmarkSeriesArtifactReferences,
    verifySeries: verifyUxBenchmarkSeries,
  });
  const codingExecutorComparisonEvidence = await readArtifactEvidence(
    repoRoot,
    codingExecutorComparisonPath,
    errors,
  );
  const codingExecutorComparison = await readJsonArtifact(
    repoRoot,
    codingExecutorComparisonPath,
    errors,
  );
  const codingExecutorComparisonVerification =
    await verifyCodingExecutorComparison(codingExecutorComparison);
  if (!codingExecutorComparisonVerification.valid) {
    errors.push(
      ...codingExecutorComparisonVerification.errors.map(
        (error) => `coding executor comparison: ${error}`,
      ),
    );
  }

  const artifacts = [
    {
      kind: "package-lock-audit",
      path: packageLockVerification.receiptPath,
      sha256: packageLockVerification.receiptSha256,
      valid: packageLockVerification.valid,
    },
    {
      kind: "runtime-environment-audit",
      path: runtimeEnvironmentVerification.receiptPath,
      sha256: runtimeEnvironmentVerification.receiptSha256,
      valid: runtimeEnvironmentVerification.valid,
    },
    {
      kind: "product-performance-baseline",
      path: productPerformanceBaselinePath,
      sha256: productPerformanceVerification.reportSha256,
      valid: productPerformanceVerification.valid,
    },
    {
      kind: "web-dist-audit",
      path: webDistVerification.receiptPath,
      sha256: webDistVerification.receiptSha256,
      valid: webDistVerification.valid,
    },
    {
      kind: "web-dist-manifest",
      path: webDistManifest.path,
      sha256: webDistManifest.sha256,
      valid: webDistManifest.readable,
    },
    {
      kind: "management-openapi",
      path: managementOpenApi.path,
      sha256: managementOpenApi.sha256,
      valid: managementOpenApi.readable,
    },
    {
      kind: "management-openapi-compatibility",
      path: managementOpenApiCompatibility.path,
      sha256: managementOpenApiCompatibility.sha256,
      valid: managementOpenApiCompatibility.readable,
    },
    {
      kind: "coding-executor-comparison",
      path: codingExecutorComparisonEvidence.path,
      sha256: codingExecutorComparisonEvidence.sha256,
      valid:
        codingExecutorComparisonEvidence.readable &&
        codingExecutorComparisonVerification.valid,
    },
    ...workflowBenchmarkArtifacts,
    ...dataBenchmarkArtifacts,
    ...dataFrameBenchmarkArtifacts,
    ...securityBenchmarkArtifacts,
    ...longHorizonBenchmarkArtifacts,
    ...multiRestartBenchmarkArtifacts,
    ...multiRestartConfirmationBenchmarkArtifacts,
    ...offlineWaitSampleABenchmarkArtifacts,
    ...offlineWaitSampleBBenchmarkArtifacts,
    ...offlineWaitDistributionBenchmarkArtifacts,
    ...budgetSampleBenchmarkArtifacts,
    ...budgetDistributionBenchmarkArtifacts,
    ...goalNoProgressBenchmarkArtifacts,
    ...processRecoveryBenchmarkArtifacts,
    ...researchBenchmarkArtifacts,
    ...uxBenchmarkArtifacts,
  ];
  const artifactSetSha256 = sha256(
    Buffer.from(formatArtifactSetManifest(artifacts), "utf8"),
  );

  return {
    ok: errors.length === 0,
    errors,
    packageName: isRecord(rootPackage) ? rootPackage.name : undefined,
    packageVersion: isRecord(rootPackage) ? rootPackage.version : undefined,
    artifacts,
    artifactSetSha256,
  };
}

export function createReleaseArtifactsReceipt(result) {
  return {
    type: "napier.release-artifacts-audit",
    schemaVersion: 1,
    ok: result.ok,
    package: {
      name: result.packageName ?? null,
      version: result.packageVersion ?? null,
    },
    artifactSetSha256: result.artifactSetSha256,
    artifacts: result.artifacts,
    errors: result.errors,
  };
}

export async function verifyReleaseArtifactsReceipt(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  if (!options.verifyReceiptPath) {
    throw new Error("verifyReceiptPath is required");
  }
  const absoluteReceiptPath = resolveRepoRelativePath(
    repoRoot,
    options.verifyReceiptPath,
    "verifyReceiptPath",
  );
  const errors = [];
  const receiptText = await readTextFile(
    absoluteReceiptPath,
    toRepoRelativePath(repoRoot, absoluteReceiptPath),
    errors,
  );
  const observedReceipt = parseJson(
    receiptText,
    "release artifacts audit receipt",
    errors,
  );
  const currentAudit = await auditReleaseArtifacts(options);
  const expectedReceipt = createReleaseArtifactsReceipt(currentAudit);
  const receiptSha256 = sha256(Buffer.from(receiptText, "utf8"));

  if (!currentAudit.ok) {
    errors.push(
      ...currentAudit.errors.map((error) => `current audit failed: ${error}`),
    );
  }
  if (observedReceipt) {
    validateReleaseArtifactsReceiptShape(observedReceipt, errors);
    if (stableJson(observedReceipt) !== stableJson(expectedReceipt)) {
      errors.push("receipt does not match the current release artifacts audit");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    receiptPath: toRepoRelativePath(repoRoot, absoluteReceiptPath),
    receiptSha256,
    expectedReceipt,
    observedReceipt,
  };
}

export function createReleaseArtifactsVerification(verification) {
  return {
    type: "napier.release-artifacts-audit-verification",
    schemaVersion: 1,
    valid: verification.valid,
    receipt: {
      path: verification.receiptPath,
      sha256: verification.receiptSha256,
    },
    expected: verification.expectedReceipt,
    observed: verification.observedReceipt,
    errors: verification.errors,
  };
}

export function formatReleaseArtifactsAuditResult(result) {
  return [
    "Release artifacts audit passed:",
    `${result.artifacts.length} artifacts`,
    `set ${result.artifactSetSha256.slice(0, 16)}`,
  ].join(" ");
}

async function runCli() {
  const cliOptions = parseCliOptions(process.argv.slice(2));
  if (cliOptions.verifyReceiptPath) {
    const verification = await verifyReleaseArtifactsReceipt(cliOptions);
    if (cliOptions.json) {
      console.log(
        JSON.stringify(
          createReleaseArtifactsVerification(verification),
          null,
          2,
        ),
      );
    }
    if (!verification.valid) {
      if (!cliOptions.json) {
        console.error("Release artifacts receipt verification failed:");
        for (const error of verification.errors) console.error(`- ${error}`);
      }
      process.exitCode = 1;
      return;
    }
    if (!cliOptions.json) {
      console.log(
        `Release artifacts receipt verified: ${verification.receiptPath} ${verification.receiptSha256.slice(0, 16)}`,
      );
    }
    return;
  }

  const result = await auditReleaseArtifacts(cliOptions);
  const receipt = createReleaseArtifactsReceipt(result);
  if (cliOptions.receiptPath) {
    await settleReceiptFile({
      receipt,
      receiptPath: cliOptions.receiptPath,
      repoRoot: cliOptions.repoRoot ?? defaultRepoRoot,
    });
  }
  if (cliOptions.json) {
    console.log(JSON.stringify(receipt, null, 2));
  }
  if (!result.ok) {
    if (!cliOptions.json) {
      console.error("Release artifacts audit failed:");
      for (const error of result.errors) console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  if (!cliOptions.json) {
    const receiptSuffix = cliOptions.receiptPath
      ? ` receipt ${toRepoRelativePath(
          path.resolve(cliOptions.repoRoot ?? defaultRepoRoot),
          path.resolve(
            cliOptions.repoRoot ?? defaultRepoRoot,
            cliOptions.receiptPath,
          ),
        )}`
      : "";
    console.log(`${formatReleaseArtifactsAuditResult(result)}${receiptSuffix}`);
  }
}

function parseCliOptions(args) {
  const options = { json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--repo-root") {
      options.repoRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--receipt-path") {
      options.receiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--verify-receipt-path") {
      options.verifyReceiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--package-lock-receipt-path") {
      options.packageLockReceiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--runtime-environment-receipt-path") {
      options.runtimeEnvironmentReceiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--web-dist-receipt-path") {
      options.webDistReceiptPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--web-dist-manifest-path") {
      options.webDistManifestPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--management-openapi-path") {
      options.managementOpenApiPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--management-openapi-compatibility-path") {
      options.managementOpenApiCompatibilityPath = readCliValue(
        args,
        index,
        arg,
      );
      index += 1;
      continue;
    }
    if (arg === "--coding-executor-comparison-path") {
      options.codingExecutorComparisonPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--workflow-benchmark-series-path") {
      options.workflowBenchmarkSeriesPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--data-benchmark-series-path") {
      options.dataBenchmarkSeriesPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--data-frame-benchmark-series-path") {
      options.dataFrameBenchmarkSeriesPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--security-benchmark-series-path") {
      options.securityBenchmarkSeriesPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--long-horizon-benchmark-series-path") {
      options.longHorizonBenchmarkSeriesPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--multi-restart-benchmark-series-path") {
      options.multiRestartBenchmarkSeriesPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--multi-restart-confirmation-series-path") {
      options.multiRestartConfirmationBenchmarkSeriesPath = readCliValue(
        args,
        index,
        arg,
      );
      index += 1;
      continue;
    }
    if (arg === "--research-benchmark-series-path") {
      options.researchBenchmarkSeriesPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--process-recovery-benchmark-series-path") {
      options.processRecoveryBenchmarkSeriesPath = readCliValue(
        args,
        index,
        arg,
      );
      index += 1;
      continue;
    }
    if (arg === "--ux-benchmark-series-path") {
      options.uxBenchmarkSeriesPath = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function verifyBenchmarkReleaseArtifacts({
  repoRoot,
  seriesPath,
  errors,
  artifactKindPrefix,
  diagnosticLabel,
  artifactReferences,
  verifySeries,
}) {
  const seriesEvidence = await readArtifactEvidence(
    repoRoot,
    seriesPath,
    errors,
  );
  const series = parseJson(
    await readTextFile(
      resolveRepoRelativePath(repoRoot, seriesPath, "benchmarkSeriesPath"),
      seriesPath,
      errors,
    ),
    `${diagnosticLabel} Series`,
    errors,
  );
  let references = [];
  try {
    references = artifactReferences(series);
  } catch (error) {
    errors.push(
      `${diagnosticLabel} series: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const artifactRoot = path.posix.dirname(seriesPath);
  const verificationArtifacts = [];
  const releaseArtifacts = [
    {
      kind: `${artifactKindPrefix}-series`,
      ...seriesEvidence,
      valid: seriesEvidence.readable,
    },
  ];
  for (const reference of references) {
    const resultPath = path.posix.join(artifactRoot, reference.resultFileName);
    const ledgerPath = path.posix.join(artifactRoot, reference.ledgerFileName);
    const [resultEvidence, ledgerEvidence, result, bundle] = await Promise.all([
      readArtifactEvidence(repoRoot, resultPath, errors),
      readArtifactEvidence(repoRoot, ledgerPath, errors),
      readJsonArtifact(repoRoot, resultPath, errors),
      readJsonArtifact(repoRoot, ledgerPath, errors),
    ]);
    verificationArtifacts.push({
      resultFileName: reference.resultFileName,
      result,
      bundle,
    });
    releaseArtifacts.push(
      {
        kind: `${artifactKindPrefix}-result-${reference.index}`,
        ...resultEvidence,
        valid: resultEvidence.readable,
      },
      {
        kind: `${artifactKindPrefix}-ledger-${reference.index}`,
        ...ledgerEvidence,
        valid: ledgerEvidence.readable,
      },
    );
  }
  const verification = verifySeries(series, verificationArtifacts);
  if (!verification.valid) {
    errors.push(
      ...verification.diagnostics.map(
        (diagnostic) => `${diagnosticLabel} series: ${diagnostic}`,
      ),
    );
    for (const trial of verification.trialDiagnostics) {
      errors.push(
        ...trial.diagnostics.map(
          (diagnostic) =>
            `${diagnosticLabel} trial ${trial.index}: ${diagnostic}`,
        ),
      );
    }
  }
  return releaseArtifacts.map(({ readable: _readable, ...artifact }) => ({
    ...artifact,
    valid: artifact.valid && verification.valid,
  }));
}

async function readJsonArtifact(repoRoot, artifactPath, errors) {
  const absolutePath = resolveRepoRelativePath(
    repoRoot,
    artifactPath,
    "benchmarkArtifactPath",
  );
  return parseJson(
    await readTextFile(absolutePath, artifactPath, errors),
    artifactPath,
    errors,
  );
}

async function readArtifactEvidence(repoRoot, artifactPath, errors) {
  const absolutePath = resolveRepoRelativePath(
    repoRoot,
    artifactPath,
    "artifactPath",
  );
  try {
    const content = await readFile(absolutePath);
    return {
      path: toRepoRelativePath(repoRoot, absolutePath),
      sha256: sha256(content),
      readable: true,
    };
  } catch {
    const relativePath = toRepoRelativePath(repoRoot, absolutePath);
    errors.push(`${relativePath} cannot be read`);
    return {
      path: relativePath,
      sha256: sha256(Buffer.alloc(0)),
      readable: false,
    };
  }
}

async function settleReceiptFile({ receipt, receiptPath, repoRoot }) {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const absoluteReceiptPath = resolveRepoRelativePath(
    absoluteRepoRoot,
    receiptPath,
    "--receipt-path",
  );
  if (!receipt.ok) {
    await rm(absoluteReceiptPath, { force: true });
    return;
  }
  await mkdir(path.dirname(absoluteReceiptPath), { recursive: true });
  await writeFile(absoluteReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}

function validateReleaseArtifactsReceiptShape(receipt, errors) {
  if (!isRecord(receipt)) {
    errors.push("receipt must be a JSON object");
    return;
  }
  if (receipt.type !== "napier.release-artifacts-audit") {
    errors.push("receipt type must be napier.release-artifacts-audit");
  }
  if (receipt.schemaVersion !== 1) {
    errors.push("receipt schemaVersion must be 1");
  }
  if (receipt.ok !== true) {
    errors.push("receipt must represent a passing audit");
  }
  if (!isRecord(receipt.package)) {
    errors.push("receipt package must be an object");
  } else {
    if (typeof receipt.package.name !== "string") {
      errors.push("receipt package.name must be a string");
    }
    if (typeof receipt.package.version !== "string") {
      errors.push("receipt package.version must be a string");
    }
  }
  if (!isSha256(receipt.artifactSetSha256)) {
    errors.push("receipt artifactSetSha256 must be a SHA-256 hex digest");
  }
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) {
    errors.push("receipt artifacts must be a non-empty array");
  } else {
    for (const [index, artifact] of receipt.artifacts.entries()) {
      if (!isRecord(artifact)) {
        errors.push(`receipt artifacts[${index}] must be an object`);
        continue;
      }
      if (typeof artifact.kind !== "string") {
        errors.push(`receipt artifacts[${index}].kind must be a string`);
      }
      if (typeof artifact.path !== "string") {
        errors.push(`receipt artifacts[${index}].path must be a string`);
      }
      if (!isSha256(artifact.sha256)) {
        errors.push(
          `receipt artifacts[${index}].sha256 must be a SHA-256 hex digest`,
        );
      }
      if (typeof artifact.valid !== "boolean") {
        errors.push(`receipt artifacts[${index}].valid must be boolean`);
      }
    }
  }
  if (!Array.isArray(receipt.errors)) {
    errors.push("receipt errors must be an array");
  } else if (receipt.errors.some((error) => typeof error !== "string")) {
    errors.push("receipt errors must contain only strings");
  }
}

function formatArtifactSetManifest(artifacts) {
  return artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.kind}  ${artifact.path}`)
    .sort()
    .join("\n")
    .concat(artifacts.length > 0 ? "\n" : "");
}

async function readTextFile(filePath, label, errors) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    errors.push(`${label} cannot be read`);
    return "";
  }
}

function parseJson(text, label, errors) {
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`${label} is not valid JSON`);
    return undefined;
  }
}

function resolveRepoRelativePath(repoRoot, filePath, optionName) {
  if (path.isAbsolute(filePath)) {
    throw new Error(`${optionName} must be a repo-relative path`);
  }
  const absolutePath = path.resolve(repoRoot, filePath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${optionName} must stay inside the repo root`);
  }
  return absolutePath;
}

function readCliValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map((item) => sortJson(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortJson(nestedValue)]),
  );
}

function toRepoRelativePath(repoRoot, absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
