import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyPackageLockReceipt } from "./check-package-lock.mjs";
import { verifyRuntimeEnvironmentReceipt } from "./check-runtime-environment.mjs";
import { verifySandboxImageArtifacts } from "./check-sandbox-image-sbom.mjs";
import { verifyOciCrashRecoveryArtifact } from "./check-oci-crash-recovery.mjs";
import { verifySandboxSecurityCasebook } from "./check-sandbox-security-casebook.mjs";
import { verifySandboxProductAcceptance } from "./check-sandbox-product-acceptance.mjs";
import { verifySandboxMultiArchitecture } from "./check-sandbox-multi-architecture.mjs";
import { verifySandboxPortableProcess } from "./check-sandbox-portable-process.mjs";
import { verifySandboxPortableLsp } from "./check-sandbox-portable-lsp.mjs";
import { verifySandboxPortableDap } from "./check-sandbox-portable-dap.mjs";
import { verifySandboxOciSupplyChain } from "./check-sandbox-oci-supply-chain.mjs";
import { verifyLinuxHostProductAcceptance } from "./check-linux-host-product-acceptance.mjs";
import { verifySandboxAcquisition } from "./check-sandbox-acquisition.mjs";
import { verifyProfileUpgrade } from "./check-profile-upgrade.mjs";
import { verifyS1ShellSandboxReadiness } from "./check-s1-shell-sandbox-completion.mjs";
import { verifySandboxRetainedExternalRelease } from "./check-sandbox-retained-external-release.mjs";
import { verifyWebDistReceipt } from "./check-web-dist.mjs";
import { verifyProductPerformanceReportFile } from "./product-performance-report.mjs";
import { verifyCodingExecutorComparison } from "./check-coding-executor-comparison.mjs";
import { parseControlledHarnessEvidence } from "../packages/runtime/dist/controlled-harness-evidence.js";
import { loadOpenWebComparisonAttemptReceipt } from "./open-web-comparison-attempt-artifacts.mjs";
import { loadOpenWebComparisonCampaignArtifacts } from "./open-web-comparison-campaign-artifacts.mjs";
import { verifyOpenWebComparisonCampaign } from "./open-web-comparison-campaign.mjs";
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
  browserConfirmedFormSeriesArtifactReferences,
  verifyBrowserConfirmedFormBenchmarkSeries,
} from "../apps/cli/dist/browser-confirmed-form-benchmark-series.js";
import {
  goalNoProgressSeriesArtifactReferences,
  verifyGoalNoProgressBenchmarkSeries,
} from "../apps/cli/dist/goal-no-progress-benchmark-series.js";
import {
  processRecoverySeriesArtifactReferences,
  verifyProcessRecoveryBenchmarkSeries,
} from "../apps/cli/dist/process-recovery-benchmark-series.js";
import { loadOpenWebResearchBenchmarkCase } from "../apps/cli/dist/open-web-research-benchmark-case.js";
import { loadOpenWebResearchFreshnessCampaignArtifacts } from "../apps/cli/dist/open-web-research-freshness-artifacts.js";
import { verifyOpenWebResearchFreshnessCampaign } from "../apps/cli/dist/open-web-research-freshness-campaign.js";
import { OCI_PROCESS_RESOURCE_POLICY_SHA256 } from "../packages/runtime/dist/sandbox-container-policy.js";
import {
  openWebResearchSecuritySeriesArtifactReferences,
  verifyOpenWebResearchSecuritySeries,
} from "../apps/cli/dist/open-web-research-security-series.js";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultPackageLockReceiptPath =
  "docs/artifacts/package-lock-audit-0.1.0.json";
const defaultRuntimeEnvironmentReceiptPath =
  "docs/artifacts/runtime-environment-audit-0.1.0.json";
const defaultSandboxImageSbomPath =
  "docs/artifacts/sandbox-image-sbom-0.1.0.cdx.json";
const defaultSandboxImageProvenancePath =
  "docs/artifacts/sandbox-image-provenance-0.1.0.json";
const defaultOciResourceLimitsEvidencePath =
  "docs/artifacts/oci-resource-limits-stage10.json";
const defaultOciCrashRecoveryEvidencePath =
  "docs/artifacts/oci-crash-recovery-stage11.json";
const defaultSandboxSecurityCasebookPath =
  "docs/artifacts/sandbox-security-casebook-stage12.json";
const defaultSandboxProductAcceptancePath =
  "docs/artifacts/sandbox-product-acceptance-stage13.json";
const defaultSandboxMultiArchitecturePath =
  "docs/artifacts/sandbox-multi-architecture-stage14.json";
const defaultSandboxPortableProcessPath =
  "docs/artifacts/sandbox-portable-process-stage15.json";
const defaultSandboxPortableLspPath =
  "docs/artifacts/sandbox-portable-lsp-stage16.json";
const defaultSandboxPortableDapPath =
  "docs/artifacts/sandbox-portable-dap-stage17.json";
const defaultSandboxOciSupplyChainPath =
  "docs/artifacts/sandbox-oci-supply-chain-stage18.json";
const defaultLinuxHostProductAcceptancePath =
  "docs/artifacts/linux-host-product-acceptance-stage19.json";
const defaultSandboxAcquisitionPath =
  "docs/artifacts/sandbox-acquisition-stage20.json";
const defaultProfileUpgradePath = "docs/artifacts/profile-upgrade-stage21.json";
const defaultS1ShellSandboxReadinessPath =
  "docs/artifacts/s1-shell-sandbox-readiness-stage22.json";
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
const defaultControlledHarnessEvidencePath =
  "docs/artifacts/controlled-harness-evidence-0.1.1.json";
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
  "docs/artifacts/benchmarks/napier-research-benchmark-series-research_aurora_contradiction_v1-6766737f84f84714.json";
const defaultResearchBenchmarkMigrationReceiptPath =
  "docs/artifacts/benchmarks/napier-research-benchmark-normalization-migration-20260807.json";
const defaultOpenWebResearchFreshnessCampaignPath =
  "benchmark-results/napier-open-web-research-freshness-campaign-research_open_web_source_triad_v1-c9248212f0b67e3f.json";
const defaultOpenWebResearchBenchmarkCaseRoot =
  "benchmarks/research/open-web-source-triad-v1";
const defaultOpenWebSecurityBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-open-web-research-security-series-security_open_web_prompt_injection_v1-7c30ff1f81e86273.json";
const defaultOpenWebSecurityBenchmarkCaseRoot =
  "benchmarks/security/open-web-prompt-injection-v1";
const defaultOpenWebExecutorComparisonCampaignPath =
  "benchmark-results/napier-open-web-executor-comparison-campaign-seeds-20260805-20260813-d108a2049df3c910.json";
const defaultOpenWebExecutorComparisonAttemptPaths = [
  "benchmark-results/napier-open-web-executor-comparison-attempt-seed-20260806-eeb63387bc7f02ef.json",
  "benchmark-results/napier-open-web-executor-comparison-attempt-seed-20260807-62596440116b4a2a.json",
];
const defaultUxBenchmarkSeriesPath =
  "docs/artifacts/benchmarks/napier-ux-benchmark-series-ux_first_task_cli_v1-747782333f3ad3c3.json";
const defaultBrowserConfirmedFormBenchmarkSeriesPath =
  "benchmark-results/browser-confirmed-form-live-20260805-series5-release/napier-browser-confirmed-form-benchmark-series-browser_confirmed_form_cli_v1-3c043842fbec2361.json";

export async function auditReleaseArtifacts(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const errors = [];
  const packageLockReceiptPath =
    options.packageLockReceiptPath ?? defaultPackageLockReceiptPath;
  const runtimeEnvironmentReceiptPath =
    options.runtimeEnvironmentReceiptPath ??
    defaultRuntimeEnvironmentReceiptPath;
  const sandboxImageSbomPath =
    options.sandboxImageSbomPath ?? defaultSandboxImageSbomPath;
  const sandboxImageProvenancePath =
    options.sandboxImageProvenancePath ?? defaultSandboxImageProvenancePath;
  const ociResourceLimitsEvidencePath =
    options.ociResourceLimitsEvidencePath ??
    defaultOciResourceLimitsEvidencePath;
  const ociCrashRecoveryEvidencePath =
    options.ociCrashRecoveryEvidencePath ?? defaultOciCrashRecoveryEvidencePath;
  const sandboxSecurityCasebookPath =
    options.sandboxSecurityCasebookPath ?? defaultSandboxSecurityCasebookPath;
  const sandboxProductAcceptancePath =
    options.sandboxProductAcceptancePath ?? defaultSandboxProductAcceptancePath;
  const sandboxMultiArchitecturePath =
    options.sandboxMultiArchitecturePath ?? defaultSandboxMultiArchitecturePath;
  const sandboxPortableProcessPath =
    options.sandboxPortableProcessPath ?? defaultSandboxPortableProcessPath;
  const sandboxPortableLspPath =
    options.sandboxPortableLspPath ?? defaultSandboxPortableLspPath;
  const sandboxPortableDapPath =
    options.sandboxPortableDapPath ?? defaultSandboxPortableDapPath;
  const sandboxOciSupplyChainPath =
    options.sandboxOciSupplyChainPath ?? defaultSandboxOciSupplyChainPath;
  const linuxHostProductAcceptancePath =
    options.linuxHostProductAcceptancePath ??
    defaultLinuxHostProductAcceptancePath;
  const sandboxAcquisitionPath =
    options.sandboxAcquisitionPath ?? defaultSandboxAcquisitionPath;
  const profileUpgradePath =
    options.profileUpgradePath ?? defaultProfileUpgradePath;
  const s1ShellSandboxReadinessPath =
    options.s1ShellSandboxReadinessPath ?? defaultS1ShellSandboxReadinessPath;
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
  const controlledHarnessEvidencePath =
    options.controlledHarnessEvidencePath ??
    defaultControlledHarnessEvidencePath;
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
  const openWebResearchFreshnessCampaignPath =
    options.openWebResearchFreshnessCampaignPath ??
    defaultOpenWebResearchFreshnessCampaignPath;
  const openWebResearchBenchmarkCaseRoot =
    options.openWebResearchBenchmarkCaseRoot ??
    defaultOpenWebResearchBenchmarkCaseRoot;
  const openWebSecurityBenchmarkSeriesPath =
    options.openWebSecurityBenchmarkSeriesPath ??
    defaultOpenWebSecurityBenchmarkSeriesPath;
  const openWebSecurityBenchmarkCaseRoot =
    options.openWebSecurityBenchmarkCaseRoot ??
    defaultOpenWebSecurityBenchmarkCaseRoot;
  const openWebExecutorComparisonCampaignPath =
    options.openWebExecutorComparisonCampaignPath ??
    defaultOpenWebExecutorComparisonCampaignPath;
  const openWebExecutorComparisonAttemptPaths =
    options.openWebExecutorComparisonAttemptPaths ??
    defaultOpenWebExecutorComparisonAttemptPaths;
  if (
    !Array.isArray(openWebExecutorComparisonAttemptPaths) ||
    openWebExecutorComparisonAttemptPaths.length < 1 ||
    openWebExecutorComparisonAttemptPaths.length > 10 ||
    new Set(openWebExecutorComparisonAttemptPaths).size !==
      openWebExecutorComparisonAttemptPaths.length
  ) {
    throw new Error(
      "openWebExecutorComparisonAttemptPaths must contain 1-10 unique paths",
    );
  }
  const uxBenchmarkSeriesPath =
    options.uxBenchmarkSeriesPath ?? defaultUxBenchmarkSeriesPath;
  const browserConfirmedFormBenchmarkSeriesPath =
    options.browserConfirmedFormBenchmarkSeriesPath ??
    defaultBrowserConfirmedFormBenchmarkSeriesPath;
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
  const researchBenchmarkMigrationEvidence = await readArtifactEvidence(
    repoRoot,
    defaultResearchBenchmarkMigrationReceiptPath,
    errors,
  );
  const researchBenchmarkMigrationReceipt = await readJsonArtifact(
    repoRoot,
    defaultResearchBenchmarkMigrationReceiptPath,
    errors,
  );
  const researchBenchmarkMigrationValid =
    validResearchBenchmarkMigrationReceipt(
      researchBenchmarkMigrationReceipt,
      researchBenchmarkSeriesPath,
    );
  if (!researchBenchmarkMigrationValid) {
    errors.push(
      "research benchmark normalization migration receipt is invalid",
    );
  }
  const openWebResearchBenchmarkArtifacts =
    await verifyOpenWebResearchFreshnessReleaseArtifacts({
      repoRoot,
      campaignPath: openWebResearchFreshnessCampaignPath,
      caseRoot: openWebResearchBenchmarkCaseRoot,
      errors,
    });
  const openWebSecurityBenchmarkArtifacts =
    await verifyOpenWebSecuritySeriesReleaseArtifacts({
      repoRoot,
      seriesPath: openWebSecurityBenchmarkSeriesPath,
      caseRoot: openWebSecurityBenchmarkCaseRoot,
      errors,
    });
  const openWebExecutorComparisonArtifacts =
    await verifyOpenWebComparisonCampaignReleaseArtifacts({
      repoRoot,
      campaignPath: openWebExecutorComparisonCampaignPath,
      errors,
    });
  const openWebExecutorComparisonAttemptArtifacts = await Promise.all(
    openWebExecutorComparisonAttemptPaths.map((attemptPath, index) =>
      verifyOpenWebComparisonAttemptReleaseArtifact({
        repoRoot,
        attemptPath,
        index,
        errors,
      }),
    ),
  );
  const uxBenchmarkArtifacts = await verifyBenchmarkReleaseArtifacts({
    repoRoot,
    seriesPath: uxBenchmarkSeriesPath,
    errors,
    artifactKindPrefix: "ux-benchmark",
    diagnosticLabel: "ux benchmark",
    artifactReferences: uxBenchmarkSeriesArtifactReferences,
    verifySeries: verifyUxBenchmarkSeries,
  });
  const browserConfirmedFormBenchmarkArtifacts =
    await verifyBenchmarkReleaseArtifacts({
      repoRoot,
      seriesPath: browserConfirmedFormBenchmarkSeriesPath,
      errors,
      artifactKindPrefix: "browser-confirmed-form-benchmark",
      diagnosticLabel: "Browser confirmed form benchmark",
      artifactReferences: browserConfirmedFormSeriesArtifactReferences,
      verifySeries: verifyBrowserConfirmedFormBenchmarkSeries,
    });
  const sandboxImageVerification = await verifySandboxImageArtifacts({
    repoRoot,
    sbomPath: sandboxImageSbomPath,
    verifyReceiptPath: sandboxImageProvenancePath,
  });
  const sandboxImageProvenance = await readJsonArtifact(
    repoRoot,
    sandboxImageProvenancePath,
    errors,
  );
  if (!sandboxImageVerification.valid) {
    errors.push(
      ...sandboxImageVerification.errors.map(
        (error) => `Sandbox image SBOM: ${error}`,
      ),
    );
  }
  const ociResourceLimitsEvidence = await readArtifactEvidence(
    repoRoot,
    ociResourceLimitsEvidencePath,
    errors,
  );
  const ociResourceLimits = await readJsonArtifact(
    repoRoot,
    ociResourceLimitsEvidencePath,
    errors,
  );
  const ociResourceLimitsValid = validOciResourceLimitsEvidence(
    ociResourceLimits,
    sandboxImageProvenance,
  );
  if (!ociResourceLimitsValid) {
    errors.push("OCI resource limits evidence is invalid");
  }
  const ociCrashRecoveryVerification = await verifyOciCrashRecoveryArtifact({
    repoRoot,
    artifactPath: ociCrashRecoveryEvidencePath,
  });
  if (!ociCrashRecoveryVerification.valid) {
    errors.push(
      ...ociCrashRecoveryVerification.errors.map(
        (error) => `OCI crash recovery: ${error}`,
      ),
    );
  }
  const sandboxSecurityVerification = await verifySandboxSecurityCasebook({
    repoRoot,
    artifactPath: sandboxSecurityCasebookPath,
  });
  if (!sandboxSecurityVerification.valid) {
    errors.push(
      ...sandboxSecurityVerification.errors.map(
        (error) => `Sandbox security Casebook: ${error}`,
      ),
    );
  }
  const sandboxProductAcceptanceVerification =
    await verifySandboxProductAcceptance({
      repoRoot,
      artifactPath: sandboxProductAcceptancePath,
    });
  if (!sandboxProductAcceptanceVerification.valid) {
    errors.push(
      ...sandboxProductAcceptanceVerification.errors.map(
        (error) => `Sandbox product acceptance: ${error}`,
      ),
    );
  }
  const sandboxMultiArchitectureVerification =
    await verifySandboxMultiArchitecture({
      repoRoot,
      artifactPath: sandboxMultiArchitecturePath,
    });
  if (!sandboxMultiArchitectureVerification.valid) {
    errors.push(
      ...sandboxMultiArchitectureVerification.errors.map(
        (error) => `Sandbox multi-architecture: ${error}`,
      ),
    );
  }
  const sandboxPortableProcessVerification = await verifySandboxPortableProcess(
    {
      repoRoot,
      artifactPath: sandboxPortableProcessPath,
    },
  );
  if (!sandboxPortableProcessVerification.valid) {
    errors.push(
      ...sandboxPortableProcessVerification.errors.map(
        (error) => `Sandbox portable process: ${error}`,
      ),
    );
  }
  const sandboxPortableLspVerification = await verifySandboxPortableLsp({
    repoRoot,
    artifactPath: sandboxPortableLspPath,
  });
  if (!sandboxPortableLspVerification.valid) {
    errors.push(
      ...sandboxPortableLspVerification.errors.map(
        (error) => `Sandbox portable LSP: ${error}`,
      ),
    );
  }
  const sandboxPortableDapVerification = await verifySandboxPortableDap({
    repoRoot,
    artifactPath: sandboxPortableDapPath,
  });
  if (!sandboxPortableDapVerification.valid) {
    errors.push(
      ...sandboxPortableDapVerification.errors.map(
        (error) => `Sandbox portable DAP: ${error}`,
      ),
    );
  }
  const sandboxOciSupplyChainVerification = await verifySandboxOciSupplyChain({
    repoRoot,
    artifactPath: sandboxOciSupplyChainPath,
  });
  if (!sandboxOciSupplyChainVerification.valid) {
    errors.push(
      ...sandboxOciSupplyChainVerification.errors.map(
        (error) => `Sandbox OCI supply chain: ${error}`,
      ),
    );
  }
  const linuxHostProductAcceptanceVerification =
    await verifyLinuxHostProductAcceptance({
      repoRoot,
      artifactPath: linuxHostProductAcceptancePath,
    });
  if (!linuxHostProductAcceptanceVerification.valid) {
    errors.push(
      ...linuxHostProductAcceptanceVerification.errors.map(
        (error) => `Linux host product acceptance: ${error}`,
      ),
    );
  }
  const sandboxAcquisitionVerification = await verifySandboxAcquisition({
    repoRoot,
    artifactPath: sandboxAcquisitionPath,
  });
  if (!sandboxAcquisitionVerification.valid) {
    errors.push(
      ...sandboxAcquisitionVerification.errors.map(
        (error) => `Sandbox acquisition: ${error}`,
      ),
    );
  }
  const profileUpgradeVerification = await verifyProfileUpgrade({
    repoRoot,
    artifactPath: profileUpgradePath,
  });
  if (!profileUpgradeVerification.valid) {
    errors.push(
      ...profileUpgradeVerification.errors.map(
        (error) => `Profile upgrade: ${error}`,
      ),
    );
  }
  const s1ShellSandboxReadinessVerification =
    await verifyS1ShellSandboxReadiness({
      repoRoot,
      artifactPath: s1ShellSandboxReadinessPath,
    });
  if (!s1ShellSandboxReadinessVerification.valid) {
    errors.push(
      ...s1ShellSandboxReadinessVerification.errors.map(
        (error) => `S1 Shell/Sandbox readiness: ${error}`,
      ),
    );
  }
  const retainedSandboxReleaseVerification =
    await verifySandboxRetainedExternalRelease({ repoRoot });
  if (!retainedSandboxReleaseVerification.valid) {
    errors.push(...retainedSandboxReleaseVerification.errors);
  }
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
  const controlledHarnessEvidenceArtifact = await readArtifactEvidence(
    repoRoot,
    controlledHarnessEvidencePath,
    errors,
  );
  const controlledHarnessEvidence = parseControlledHarnessEvidence(
    await readJsonArtifact(repoRoot, controlledHarnessEvidencePath, errors),
  );
  if (!controlledHarnessEvidence) {
    errors.push("controlled harness evidence: artifact_invalid");
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
      kind: "sandbox-image-sbom",
      path: sandboxImageVerification.sbomPath,
      sha256: sandboxImageVerification.sbomSha256,
      valid: sandboxImageVerification.valid,
    },
    {
      kind: "sandbox-image-provenance",
      path: sandboxImageVerification.receiptPath,
      sha256: sandboxImageVerification.receiptSha256,
      valid: sandboxImageVerification.valid,
    },
    {
      kind: "oci-resource-limits-stage10",
      path: ociResourceLimitsEvidence.path,
      sha256: ociResourceLimitsEvidence.sha256,
      valid: ociResourceLimitsEvidence.readable && ociResourceLimitsValid,
    },
    {
      kind: "oci-crash-recovery-stage11",
      path: ociCrashRecoveryVerification.path,
      sha256: ociCrashRecoveryVerification.sha256,
      valid: ociCrashRecoveryVerification.valid,
    },
    {
      kind: "sandbox-security-casebook-stage12",
      path: sandboxSecurityVerification.path,
      sha256: sandboxSecurityVerification.sha256,
      valid: sandboxSecurityVerification.valid,
    },
    {
      kind: "sandbox-product-acceptance-stage13",
      path: sandboxProductAcceptanceVerification.path,
      sha256: sandboxProductAcceptanceVerification.sha256,
      valid: sandboxProductAcceptanceVerification.valid,
    },
    {
      kind: "sandbox-multi-architecture-stage14",
      path: sandboxMultiArchitectureVerification.path,
      sha256: sandboxMultiArchitectureVerification.sha256,
      valid: sandboxMultiArchitectureVerification.valid,
    },
    {
      kind: "sandbox-portable-process-stage15",
      path: sandboxPortableProcessVerification.path,
      sha256: sandboxPortableProcessVerification.sha256,
      valid: sandboxPortableProcessVerification.valid,
    },
    {
      kind: "sandbox-portable-lsp-stage16",
      path: sandboxPortableLspVerification.path,
      sha256: sandboxPortableLspVerification.sha256,
      valid: sandboxPortableLspVerification.valid,
    },
    {
      kind: "sandbox-portable-dap-stage17",
      path: sandboxPortableDapVerification.path,
      sha256: sandboxPortableDapVerification.sha256,
      valid: sandboxPortableDapVerification.valid,
    },
    {
      kind: "sandbox-oci-supply-chain-stage18",
      path: sandboxOciSupplyChainVerification.path,
      sha256: sandboxOciSupplyChainVerification.sha256,
      valid: sandboxOciSupplyChainVerification.valid,
    },
    {
      kind: "linux-host-product-acceptance-stage19",
      path: linuxHostProductAcceptanceVerification.path,
      sha256: linuxHostProductAcceptanceVerification.sha256,
      valid: linuxHostProductAcceptanceVerification.valid,
    },
    {
      kind: "sandbox-acquisition-stage20",
      path: sandboxAcquisitionVerification.path,
      sha256: sandboxAcquisitionVerification.sha256,
      valid: sandboxAcquisitionVerification.valid,
    },
    {
      kind: "profile-upgrade-stage21",
      path: profileUpgradeVerification.path,
      sha256: profileUpgradeVerification.sha256,
      valid: profileUpgradeVerification.valid,
    },
    {
      kind: "s1-shell-sandbox-readiness-stage22",
      path: s1ShellSandboxReadinessVerification.path,
      sha256: s1ShellSandboxReadinessVerification.sha256,
      valid: s1ShellSandboxReadinessVerification.valid,
    },
    ...retainedSandboxReleaseVerification.artifacts,
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
    {
      kind: "controlled-harness-evidence",
      path: controlledHarnessEvidenceArtifact.path,
      sha256: controlledHarnessEvidenceArtifact.sha256,
      valid:
        controlledHarnessEvidenceArtifact.readable &&
        Boolean(controlledHarnessEvidence),
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
    {
      kind: "research-benchmark-normalization-migration",
      path: researchBenchmarkMigrationEvidence.path,
      sha256: researchBenchmarkMigrationEvidence.sha256,
      valid:
        researchBenchmarkMigrationEvidence.readable &&
        researchBenchmarkMigrationValid,
    },
    ...openWebResearchBenchmarkArtifacts,
    ...openWebSecurityBenchmarkArtifacts,
    ...openWebExecutorComparisonAttemptArtifacts,
    ...openWebExecutorComparisonArtifacts,
    ...uxBenchmarkArtifacts,
    ...browserConfirmedFormBenchmarkArtifacts,
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
    if (arg === "--controlled-harness-evidence-path") {
      options.controlledHarnessEvidencePath = readCliValue(args, index, arg);
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
    if (arg === "--open-web-research-freshness-campaign-path") {
      options.openWebResearchFreshnessCampaignPath = readCliValue(
        args,
        index,
        arg,
      );
      index += 1;
      continue;
    }
    if (arg === "--open-web-research-benchmark-case-root") {
      options.openWebResearchBenchmarkCaseRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--open-web-security-benchmark-series-path") {
      options.openWebSecurityBenchmarkSeriesPath = readCliValue(
        args,
        index,
        arg,
      );
      index += 1;
      continue;
    }
    if (arg === "--open-web-security-benchmark-case-root") {
      options.openWebSecurityBenchmarkCaseRoot = readCliValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--open-web-executor-comparison-campaign-path") {
      options.openWebExecutorComparisonCampaignPath = readCliValue(
        args,
        index,
        arg,
      );
      index += 1;
      continue;
    }
    if (arg === "--open-web-executor-comparison-attempt-path") {
      options.openWebExecutorComparisonAttemptPaths ??= [];
      options.openWebExecutorComparisonAttemptPaths.push(
        readCliValue(args, index, arg),
      );
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
    if (arg === "--browser-confirmed-form-series-path") {
      options.browserConfirmedFormBenchmarkSeriesPath = readCliValue(
        args,
        index,
        arg,
      );
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

async function verifyOpenWebResearchFreshnessReleaseArtifacts({
  repoRoot,
  campaignPath,
  caseRoot,
  errors,
}) {
  const campaignEvidence = await readArtifactEvidence(
    repoRoot,
    campaignPath,
    errors,
  );
  const observationArtifacts = [];
  let valid = false;
  try {
    const loadedCampaign = await loadOpenWebResearchFreshnessCampaignArtifacts(
      resolveRepoRelativePath(
        repoRoot,
        campaignPath,
        "openWebResearchFreshnessCampaignPath",
      ),
    );
    const campaign = loadedCampaign.campaign;
    const root = path.posix.dirname(campaignPath);
    for (const [index, observation] of loadedCampaign.observations.entries()) {
      const artifactPath = path.posix.join(root, observation.artifactFileName);
      observationArtifacts.push({
        index: index + 1,
        observation,
        artifactEvidence: await readArtifactEvidence(
          repoRoot,
          artifactPath,
          errors,
        ),
        trialEvidence: await Promise.all(
          observation.trials
            .filter(
              (trial) => trial.resultFileName !== observation.artifactFileName,
            )
            .map((trial) =>
              readArtifactEvidence(
                repoRoot,
                path.posix.join(root, trial.resultFileName),
                errors,
              ),
            ),
        ),
      });
    }
    const loaded = await loadOpenWebResearchBenchmarkCase(
      resolveRepoRelativePath(repoRoot, caseRoot, "openWebResearchCaseRoot"),
    );
    const verification = verifyOpenWebResearchFreshnessCampaign(
      campaign,
      loadedCampaign.observations,
      loaded.benchmarkCase,
      loaded.expected,
    );
    valid =
      verification.valid &&
      campaign?.observationCount >= 2 &&
      campaign?.minimumObservationGapMs >= campaign?.requiredObservationGapMs;
    if (!verification.valid) {
      errors.push(
        ...verification.diagnostics.map(
          (diagnostic) => `open-web research benchmark: ${diagnostic}`,
        ),
      );
      for (const observation of verification.observationDiagnostics) {
        errors.push(
          ...observation.diagnostics.map(
            (diagnostic) =>
              `open-web research benchmark observation ${observation.index}: ${diagnostic}`,
          ),
        );
      }
    }
    if (verification.valid && !valid) {
      errors.push(
        "open-web research benchmark: retained_campaign_not_time_separated",
      );
    }
  } catch (error) {
    errors.push(
      `open-web research benchmark: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const { readable: _campaignReadable, ...campaignArtifact } = campaignEvidence;
  const nestedArtifacts = observationArtifacts.flatMap((observation) => [
    {
      kind: `open-web-research-freshness-observation-${String(
        observation.index,
      )}-${observation.observation.artifact.kind === "napier.open-web-research-series" ? "series" : "result"}`,
      evidence: observation.artifactEvidence,
    },
    ...observation.trialEvidence.map((evidence, index) => ({
      kind: `open-web-research-freshness-observation-${String(
        observation.index,
      )}-result-${String(index + 1)}`,
      evidence,
    })),
  ]);
  return [
    {
      kind: "open-web-research-freshness-campaign",
      ...campaignArtifact,
      valid:
        campaignEvidence.readable &&
        valid &&
        observationArtifacts.length > 0 &&
        nestedArtifacts.every((artifact) => artifact.evidence.readable),
    },
    ...nestedArtifacts.map((artifact) => {
      const { readable: _readable, ...evidence } = artifact.evidence;
      return {
        kind: artifact.kind,
        ...evidence,
        valid: artifact.evidence.readable && valid,
      };
    }),
  ];
}

async function verifyOpenWebSecuritySeriesReleaseArtifacts({
  repoRoot,
  seriesPath,
  caseRoot,
  errors,
}) {
  const seriesEvidence = await readArtifactEvidence(
    repoRoot,
    seriesPath,
    errors,
  );
  const series = await readJsonArtifact(repoRoot, seriesPath, errors);
  const root = path.posix.dirname(seriesPath);
  const artifacts = [];
  let valid = false;
  try {
    for (const reference of openWebResearchSecuritySeriesArtifactReferences(
      series,
    )) {
      const resultPath = path.posix.join(root, reference.resultFileName);
      artifacts.push({
        resultFileName: reference.resultFileName,
        result: await readJsonArtifact(repoRoot, resultPath, errors),
        evidence: await readArtifactEvidence(repoRoot, resultPath, errors),
      });
    }
    const loaded = await loadOpenWebResearchBenchmarkCase(
      resolveRepoRelativePath(repoRoot, caseRoot, "openWebSecurityCaseRoot"),
    );
    const verification = verifyOpenWebResearchSecuritySeries(
      series,
      artifacts.map((artifact) => ({
        resultFileName: artifact.resultFileName,
        result: artifact.result,
      })),
      loaded.benchmarkCase,
      loaded.expected,
    );
    valid =
      verification.valid &&
      series?.status === "completed" &&
      series?.failedTrialCount === 0 &&
      series?.inconclusiveTrialCount === 0;
    if (!verification.valid) {
      errors.push(
        ...verification.diagnostics.map(
          (diagnostic) => `open-web security benchmark: ${diagnostic}`,
        ),
      );
    }
    if (verification.valid && !valid) {
      errors.push("open-web security benchmark: retained_series_not_passing");
    }
  } catch (error) {
    errors.push(
      `open-web security benchmark: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const { readable: _seriesReadable, ...seriesArtifact } = seriesEvidence;
  return [
    {
      kind: "open-web-security-benchmark-series",
      ...seriesArtifact,
      valid:
        seriesEvidence.readable &&
        valid &&
        artifacts.length > 0 &&
        artifacts.every((artifact) => artifact.evidence.readable),
    },
    ...artifacts.map((artifact) => {
      const { readable: _readable, ...evidence } = artifact.evidence;
      return {
        kind: `open-web-security-benchmark-result-${String(
          artifacts.indexOf(artifact) + 1,
        )}`,
        ...evidence,
        valid: artifact.evidence.readable && valid,
      };
    }),
  ];
}

async function verifyOpenWebComparisonCampaignReleaseArtifacts({
  repoRoot,
  campaignPath,
  errors,
}) {
  const campaignEvidence = await readArtifactEvidence(
    repoRoot,
    campaignPath,
    errors,
  );
  const reports = [];
  let valid = false;
  try {
    const loaded = await loadOpenWebComparisonCampaignArtifacts(
      resolveRepoRelativePath(
        repoRoot,
        campaignPath,
        "openWebExecutorComparisonCampaignPath",
      ),
    );
    const verification = verifyOpenWebComparisonCampaign(
      loaded.campaign,
      loaded.reports,
    );
    valid = verification.valid;
    if (!verification.valid) {
      errors.push(
        ...verification.diagnostics.map(
          (diagnostic) =>
            `open-web executor comparison campaign: ${diagnostic}`,
        ),
      );
    }
    for (const artifact of loaded.reports) {
      reports.push({
        fileName: artifact.fileName,
        evidence: await readArtifactEvidence(
          repoRoot,
          path.posix.join(path.posix.dirname(campaignPath), artifact.fileName),
          errors,
        ),
      });
    }
  } catch (error) {
    errors.push(
      `open-web executor comparison campaign: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const { readable: _campaignReadable, ...campaignArtifact } = campaignEvidence;
  return [
    {
      kind: "open-web-executor-comparison-campaign",
      ...campaignArtifact,
      valid:
        campaignEvidence.readable &&
        valid &&
        reports.length >= 2 &&
        reports.every((report) => report.evidence.readable),
    },
    ...reports.map((report, index) => {
      const { readable: _reportReadable, ...reportArtifact } = report.evidence;
      return {
        kind: `open-web-executor-comparison-report-${String(index + 1)}`,
        ...reportArtifact,
        valid: report.evidence.readable && valid,
      };
    }),
  ];
}

async function verifyOpenWebComparisonAttemptReleaseArtifact({
  repoRoot,
  attemptPath,
  index,
  errors,
}) {
  const evidence = await readArtifactEvidence(repoRoot, attemptPath, errors);
  let valid = false;
  try {
    await loadOpenWebComparisonAttemptReceipt(
      resolveRepoRelativePath(
        repoRoot,
        attemptPath,
        "openWebExecutorComparisonAttemptPath",
      ),
    );
    valid = true;
  } catch (error) {
    errors.push(
      `open-web executor comparison attempt: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const { readable: _readable, ...artifact } = evidence;
  return {
    kind: `open-web-executor-comparison-attempt-${String(index + 1)}`,
    ...artifact,
    valid: evidence.readable && valid,
  };
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

function validOciResourceLimitsEvidence(value, provenance) {
  if (!isRecord(value) || !isRecord(provenance)) return false;
  const { contentSha256, ...content } = value;
  const observed = value.observedProductionProcess;
  const failureInjection = value.failureInjection;
  const provenanceImage = provenance.image;
  return (
    value.kind === "napier.oci-resource-limits-stage10" &&
    value.schemaVersion === 1 &&
    isSha256(contentSha256) &&
    sha256(Buffer.from(stableJson(content), "utf8")) === contentSha256 &&
    isRecord(observed) &&
    isRecord(provenanceImage) &&
    typeof provenanceImage.id === "string" &&
    observed.imageIdSha256 === provenanceImage.id.replace(/^sha256:/u, "") &&
    observed.platform ===
      `${String(provenanceImage.os)}/${String(provenanceImage.arch)}` &&
    observed.cgroupVersion === 2 &&
    observed.pidsMax === 256 &&
    observed.memoryMaxBytes === 1_073_741_824 &&
    observed.memorySwapMaxBytes === 0 &&
    observed.cpuQuotaMicros === 200_000 &&
    observed.cpuPeriodMicros === 100_000 &&
    observed.rootReadOnly === true &&
    observed.workspaceReadOnly === true &&
    observed.temporaryFileSystemBytes === 67_108_864 &&
    observed.homeFileSystemBytes === 67_108_864 &&
    observed.temporaryFileSystemRestricted === true &&
    observed.homeFileSystemRestricted === true &&
    observed.capabilitiesDropped === true &&
    observed.noNewPrivileges === true &&
    observed.networkInterfaceCount === 1 &&
    observed.resourcePolicySha256 === OCI_PROCESS_RESOURCE_POLICY_SHA256 &&
    isRecord(failureInjection) &&
    failureInjection.removedMemorySwapLimit === true &&
    failureInjection.observedMemorySwapMaxBytes === 1_073_741_824 &&
    failureInjection.verifierRejectedDrift === true &&
    isRecord(value.retention) &&
    value.retention.credentialValues === false &&
    value.retention.rawDockerOutput === false &&
    value.retention.rawDoctorReport === false &&
    value.retention.rawDaemonEndpoint === false &&
    value.retention.numericHostUserIds === false &&
    value.retention.workspacePaths === false &&
    isRecord(value.scope) &&
    value.scope.sliceComplete === true &&
    value.scope.s1Complete === false
  );
}

function validResearchBenchmarkMigrationReceipt(value, releaseSeriesPath) {
  if (!isRecord(value)) return false;
  const { contentSha256, ...content } = value;
  const series = value.series;
  return (
    value.kind === "napier.research-benchmark-normalization-migration" &&
    value.schemaVersion === 1 &&
    value.providerRerun === false &&
    value.conclusionsChanged === false &&
    isSha256(contentSha256) &&
    sha256(Buffer.from(stableJson(content), "utf8")) === contentSha256 &&
    isRecord(value.sourceProvenance) &&
    value.sourceProvenance.path ===
      "benchmarks/research/aurora-contradiction-v1/sources.json" &&
    isSha256(value.sourceProvenance.sha256) &&
    Array.isArray(series) &&
    series.length === 2 &&
    series.some(
      (entry) =>
        isRecord(entry) &&
        isRecord(entry.normalized) &&
        entry.normalized.file === path.posix.basename(releaseSeriesPath),
    ) &&
    series.every(
      (entry) =>
        isRecord(entry) &&
        isRecord(entry.old) &&
        isRecord(entry.normalized) &&
        typeof entry.old.file === "string" &&
        isSha256(entry.old.contentSha256) &&
        typeof entry.normalized.file === "string" &&
        isSha256(entry.normalized.contentSha256) &&
        Array.isArray(entry.trials) &&
        entry.trials.length === 2 &&
        isRecord(entry.verification) &&
        entry.verification.valid === true &&
        Array.isArray(entry.verification.diagnostics) &&
        entry.verification.diagnostics.length === 0,
    )
  );
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
