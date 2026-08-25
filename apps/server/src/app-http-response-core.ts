import { safeFilenameSegment, setBodyContentSha256Header, setStableContentSha256Header, sha256Json, sha256Text } from "./http-response-evidence.js";
import type { EvaluationSuite, EvaluationSuiteExecution, EvaluationSuiteGateReceipt, ExecutionPlanBlueprintPortfolioCalibration, ExecutionPlanBlueprintRecommendationPolicyBacktest, ExecutionPlanBlueprintRecommendationPolicyOverride, ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview, ExecutionPlanBlueprintRecommendationPolicyOverrideList, ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory, ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle, ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification, ExtensionRecord, HealthResponse, RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult } from "@napier/contracts";
import { compatibilityTelemetrySnapshot } from "@napier/runtime/core";
import type { Context } from "hono";

const HEALTH_RUNTIME_COMPONENTS = ["sqlite", "openssl", "uv", "v8"] as const;

export function isReceiptTrustConflict(error: Error): boolean {
  return ["signing key is unavailable", "trust anchor is revoked", "trust anchor is verify-only", "does not match the trust anchor", "qualification baseline receipt is not trusted", "directory subscription revision changed", "directory subscription refresh is in progress", "directory subscription claim expired", "directory subscription source already exists"].some((message) => error.message.toLowerCase().includes(message));
}

export function isReceiptTrustClientError(error: Error): boolean {
  return ["receipt trust anchor", "receipt signing environment variable", "receipt signing key is not a valid", "trusted receipt"].some((message) => error.message.toLowerCase().includes(message));
}

export function isExtensionPackageConflict(error: Error): boolean {
  return ["signing key is unavailable", "trust anchor is revoked", "trust anchor is verify-only", "does not match the trust anchor", "signed extension package is not trusted", "signed extension package update is not trusted", "changed since the update preview", "changed since the deployment preview", "requires explicit confirmation", "requires explicit override", "already exists"].some((message) => error.message.toLowerCase().includes(message));
}

export function isExtensionPackageClientError(error: Error): boolean {
  return ["extension publisher", "extension package", "signed extension package"].some((message) => error.message.toLowerCase().includes(message));
}

export function isSkillPackageConflict(error: Error): boolean {
  return ["skill package cannot be installed", "skill package replacement requires confirmation", "skill package replacement target is not active", "skill package publisher change requires explicit confirmation", "skill package skill set change requires explicit confirmation"].some((message) => error.message.toLowerCase().includes(message));
}

export function isSkillContentConflict(error: Error): boolean {
  return ["skill content review has changed", "skill content install requires confirmation", "skill content replacement requires confirmation", "skill content write hash mismatch", "skill content target parent is invalid", "skill content target is invalid", "apply_patch create target already exists", "apply_patch replace target does not exist", "apply_patch precondition", "apply_patch target disappeared"].some((message) => error.message.toLowerCase().includes(message));
}

export function isSkillContentClientError(error: Error): boolean {
  return ["skill content review sha-256 is invalid", "skill content must", "skill content frontmatter"].some((message) => error.message.toLowerCase().includes(message));
}

export function isPlanConflict(error: Error): boolean {
  return ["plan revision mismatch", "thread already has an active execution plan"].some((message) => error.message.toLowerCase().includes(message));
}

export function isPlanClientError(error: Error): boolean {
  return ["plan objective", "plan step", "plan steps", "plans require", "plans allow", "plan artifact", "artifact", "cannot start plan step", "cannot complete plan step", "cannot block plan step", "cannot skip plan step", "cannot reopen plan step", "cannot replan", "replanning requires", "duplicate dependency update", "unknown replan strategy"].some((message) => error.message.toLowerCase().includes(message));
}

export function validAgentId(value: unknown): value is string {
  return typeof value === "string" && /^agent_[a-z0-9_]{2,80}$/.test(value);
}

export function setOptionalHeader(context: Context, name: string, value: string | undefined): void {
  if (value !== undefined) context.header(name, value);
}

export function setHealthProjectionHeaders(context: Context, response: HealthResponse): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, response);
  context.header("X-Napier-Service", response.service);
  context.header("X-Napier-Health-Status", response.status);
  context.header("X-Napier-Node-Version", response.runtime.node.version);
  context.header("X-Napier-Node-Platform", response.runtime.node.platform);
  context.header("X-Napier-Node-Arch", response.runtime.node.arch);
  context.header("X-Napier-Runtime-Component-Count", String(HEALTH_RUNTIME_COMPONENTS.length));
  context.header("X-Napier-Runtime-Components-SHA256", sha256Json(response.runtime.components));
  context.header("X-Napier-Runtime-Sqlite-Version", response.runtime.components.sqlite);
  context.header("X-Napier-Runtime-OpenSSL-Version", response.runtime.components.openssl);
  context.header("X-Napier-Runtime-Uv-Version", response.runtime.components.uv);
  context.header("X-Napier-Runtime-V8-Version", response.runtime.components.v8);
  context.header("X-Napier-Ledger-Schema-Version", String(response.ledger.schemaVersion));
  context.header("X-Napier-Ledger-Quick-Check", response.ledger.quickCheck);
  context.header("X-Napier-Ledger-Migration-Count", String(response.ledger.migrations.length));
  context.header(
    "X-Napier-Ledger-Migrations-SHA256",
    sha256Json(
      response.ledger.migrations.map((migration) => ({
        version: migration.version,
        name: migration.name,
        appliedAt: migration.appliedAt,
      })),
    ),
  );
  context.header("X-Napier-Store-Persistence-SHA256", sha256Text(JSON.stringify(response.store.persistence)));
  context.header("X-Napier-Store-Commit-Count", String(response.store.persistence.commitCount));
  context.header("X-Napier-Store-Failed-Commit-Count", String(response.store.persistence.failedCommitCount));
  context.header("X-Napier-Store-Projection-Failure-Count", String(response.store.persistence.projectionFailureCount));
  context.header("X-Napier-Store-State-Bytes-Written", String(response.store.persistence.stateBytesWritten));
  context.header("X-Napier-Store-Event-Bytes-Written", String(response.store.persistence.eventBytesWritten));
  context.header("X-Napier-Store-Projection-Bytes-Written", String(response.store.persistence.projectionBytesWritten));
  context.header("X-Napier-Compatibility-Metrics-SHA256", sha256Json(response.compatibility.metrics));
  const lastPersistence = response.store.persistence.last;
  if (lastPersistence) {
    context.header("X-Napier-Store-Last-Commit-Duration-Ms", String(lastPersistence.ledgerCommitDurationMs));
    context.header("X-Napier-Store-Last-Persist-Duration-Ms", String(lastPersistence.totalDurationMs));
    context.header("X-Napier-Store-Last-State-Bytes", String(lastPersistence.stateBytes));
    context.header("X-Napier-Store-Last-Event-Bytes", String(lastPersistence.eventBytes));
    context.header("X-Napier-Store-Last-Projection-Bytes", String(lastPersistence.stateProjectionBytes + lastPersistence.eventProjectionBytes));
  }
  const latestMigration = response.ledger.migrations.at(-1);
  if (latestMigration) {
    context.header("X-Napier-Ledger-Latest-Migration-Version", String(latestMigration.version));
    context.header("X-Napier-Ledger-Latest-Migration-Name", latestMigration.name);
  }
}

export function createHealthRuntimeProjection() {
  return {
    node: {
      version: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    components: Object.fromEntries(HEALTH_RUNTIME_COMPONENTS.map((component) => [component, process.versions[component] ?? "unavailable"])) as Record<(typeof HEALTH_RUNTIME_COMPONENTS)[number], string>,
  } satisfies HealthResponse["runtime"];
}

export function createHealthCompatibilityProjection(): HealthResponse["compatibility"] {
  return compatibilityTelemetrySnapshot();
}

export function setExecutionPlanBlueprintPortfolioCalibrationHeaders(context: Context, calibration: ExecutionPlanBlueprintPortfolioCalibration): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, calibration.contentSha256);
  context.header("X-Napier-Blueprint-Portfolio-Record-Count", String(calibration.recordCount));
  context.header("X-Napier-Blueprint-Portfolio-Active-Count", String(calibration.activeCount));
  context.header("X-Napier-Blueprint-Portfolio-Archived-Count", String(calibration.archivedCount));
  context.header("X-Napier-Blueprint-Portfolio-Family-Count", String(calibration.familyCount));
  context.header("X-Napier-Blueprint-Portfolio-Source-Qualified-Count", String(calibration.sourceQualifiedCount));
  context.header("X-Napier-Blueprint-Portfolio-Outcome-Qualified-Count", String(calibration.outcomeQualifiedCount));
  context.header("X-Napier-Blueprint-Portfolio-Reviewed-Baseline-Count", String(calibration.reviewedBaselineCount));
  context.header("X-Napier-Blueprint-Portfolio-Missing-Baseline-Count", String(calibration.missingBaselineCount));
  context.header("X-Napier-Blueprint-Portfolio-Policy-Failed-Count", String(calibration.policyFailedCount));
  context.header("X-Napier-Blueprint-Portfolio-Set-SHA256", calibration.portfolioSetSha256);
}

export function setExecutionPlanBlueprintRecommendationPolicyBacktestHeaders(context: Context, backtest: ExecutionPlanBlueprintRecommendationPolicyBacktest): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, backtest.contentSha256);
  context.header("X-Napier-Blueprint-Portfolio-Record-Count", String(backtest.recordCount));
  context.header("X-Napier-Blueprint-Portfolio-Active-Count", String(backtest.activeCount));
  context.header("X-Napier-Blueprint-Recommendation-Policy-Count", String(backtest.policyCount));
  context.header("X-Napier-Blueprint-Recommendation-Policy-Divergent-Selection-Count", String(backtest.divergentSelectionCount));
  context.header("X-Napier-Blueprint-Portfolio-Set-SHA256", backtest.portfolioSetSha256);
  context.header("X-Napier-Blueprint-Recommendation-Policy-Set-SHA256", backtest.policySetSha256);
}

export function setExecutionPlanBlueprintRecommendationPolicyOverrideHeaders(context: Context, override: ExecutionPlanBlueprintRecommendationPolicyOverride): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, override.contentSha256);
  context.header("X-Napier-Blueprint-Family-SHA256", override.familySha256);
  context.header("X-Napier-Blueprint-Recommendation-Policy-Template", override.recommendationPolicy.templateId);
  context.header("X-Napier-Blueprint-Recommendation-Policy-SHA256", override.recommendationPolicySha256);
  context.header("X-Napier-Blueprint-Portfolio-Set-SHA256", override.portfolioSetSha256);
  context.header("X-Napier-Blueprint-Family-Record-Count", String(override.familyRecordCount));
  context.header("X-Napier-Blueprint-Family-Outcome-Qualified-Count", String(override.familyOutcomeQualifiedCount));
  context.header("X-Napier-Blueprint-Family-Completion-Rate-BPS", String(override.familyCompletionRateBps));
}

export function setExecutionPlanBlueprintRecommendationPolicyOverrideListHeaders(context: Context, overrides: ExecutionPlanBlueprintRecommendationPolicyOverrideList): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, overrides.contentSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Count", String(overrides.overrideCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Set-SHA256", overrides.overrideSetSha256);
  context.header("X-Napier-Blueprint-Portfolio-Set-SHA256", overrides.portfolioSetSha256);
}

export function setExecutionPlanBlueprintRecommendationPolicyOverrideDriftReviewHeaders(context: Context, review: ExecutionPlanBlueprintRecommendationPolicyOverrideDriftReview): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, review.contentSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Count", String(review.overrideCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Aligned-Count", String(review.alignedCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retire-Recommended-Count", String(review.retireRecommendedCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Missing-Family-Count", String(review.missingFamilyCount));
  context.header("X-Napier-Blueprint-Portfolio-Set-SHA256", review.portfolioSetSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Set-SHA256", review.overrideSetSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Drift-Review-Set-SHA256", review.reviewSetSha256);
}

export function setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHeaders(context: Context, result: RetireExecutionPlanBlueprintRecommendationPolicyOverrideResult): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, result.contentSha256);
  context.header("X-Napier-Blueprint-Family-SHA256", result.familySha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retired-SHA256", result.retiredOverrideSha256);
  context.header("X-Napier-Blueprint-Recommendation-Policy-Template", result.retiredRecommendationPolicyTemplate);
  context.header("X-Napier-Blueprint-Recommendation-Policy-SHA256", result.retiredRecommendationPolicySha256);
  context.header("X-Napier-Blueprint-Portfolio-Set-SHA256", result.portfolioSetSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Set-SHA256", result.overrideSetSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Drift-Review-Set-SHA256", result.driftReviewSetSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Remaining-Set-SHA256", result.remainingOverrideSetSha256);
}

export function setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryHeaders(context: Context, history: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistory): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, history.contentSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-Count", String(history.retirementCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-Set-SHA256", history.retirementSetSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Current-Set-SHA256", history.currentOverrideSetSha256);
  context.header("X-Napier-Blueprint-Portfolio-Set-SHA256", history.portfolioSetSha256);
  setOptionalHeader(context, "X-Napier-Blueprint-Family-Policy-Override-Latest-Retired-At", history.latestRetiredAt);
}

export function setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerificationHeaders(context: Context, verification: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryVerification): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, verification.contentSha256);
  context.header("X-Napier-Verification-Status", verification.status);
  context.header("X-Napier-Diagnostic-Count", String(verification.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(verification.diagnostics));
  setOptionalHeader(context, "X-Napier-Declared-Content-SHA256", verification.declaredContentSha256);
  setOptionalHeader(context, "X-Napier-Recomputed-Content-SHA256", verification.recomputedContentSha256);
  context.header("X-Napier-Observed-Content-SHA256", verification.observedContentSha256);
  setOptionalHeader(context, "X-Napier-Declared-Blueprint-Portfolio-Set-SHA256", verification.declaredPortfolioSetSha256);
  context.header("X-Napier-Observed-Blueprint-Portfolio-Set-SHA256", verification.observedPortfolioSetSha256);
  setOptionalHeader(context, "X-Napier-Declared-Blueprint-Family-Policy-Override-Current-Set-SHA256", verification.declaredCurrentOverrideSetSha256);
  context.header("X-Napier-Observed-Blueprint-Family-Policy-Override-Current-Set-SHA256", verification.observedCurrentOverrideSetSha256);
  setOptionalHeader(context, "X-Napier-Declared-Blueprint-Family-Policy-Override-Retirement-Set-SHA256", verification.declaredRetirementSetSha256);
  setOptionalHeader(context, "X-Napier-Recomputed-Blueprint-Family-Policy-Override-Retirement-Set-SHA256", verification.recomputedRetirementSetSha256);
  context.header("X-Napier-Observed-Blueprint-Family-Policy-Override-Retirement-Set-SHA256", verification.observedRetirementSetSha256);
  setOptionalHeader(context, "X-Napier-Blueprint-Family-Policy-Override-Retirement-Count", verification.retirementCount?.toString());
  context.header("X-Napier-Observed-Blueprint-Family-Policy-Override-Retirement-Count", String(verification.observedRetirementCount));
  setOptionalHeader(context, "X-Napier-Blueprint-Family-Policy-Override-Latest-Retired-At", verification.latestRetiredAt);
  setOptionalHeader(context, "X-Napier-Observed-Blueprint-Family-Policy-Override-Latest-Retired-At", verification.observedLatestRetiredAt);
}

export function setExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundleHeaders(context: Context, proofBundle: ExecutionPlanBlueprintRecommendationPolicyOverrideRetirementHistoryProofBundle): void {
  context.header("Cache-Control", "no-store");
  setStableContentSha256Header(context, proofBundle.contentSha256);
  context.header("X-Napier-Verification-Status", proofBundle.status);
  context.header("X-Napier-Diagnostic-Count", String(proofBundle.diagnostics.length));
  context.header("X-Napier-Diagnostics-SHA256", sha256Json(proofBundle.diagnostics));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Count", String(proofBundle.historyCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Valid-Count", String(proofBundle.validHistoryCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Invalid-Count", String(proofBundle.invalidHistoryCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Distinct-Count", String(proofBundle.distinctHistoryCount));
  context.header("X-Napier-Blueprint-Portfolio-Set-Distinct-Count", String(proofBundle.distinctPortfolioSetCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Current-Set-Distinct-Count", String(proofBundle.distinctCurrentOverrideSetCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-Set-Distinct-Count", String(proofBundle.distinctRetirementSetCount));
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-History-Set-SHA256", proofBundle.historySetSha256);
  context.header("X-Napier-Blueprint-Portfolio-Set-Bundle-SHA256", proofBundle.portfolioSetBundleSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Current-Set-Bundle-SHA256", proofBundle.currentOverrideSetBundleSha256);
  context.header("X-Napier-Blueprint-Family-Policy-Override-Retirement-Set-Bundle-SHA256", proofBundle.retirementSetBundleSha256);
}

export function setExtensionListHeaders(context: Context, extensions: readonly ExtensionRecord[], agentId: string | undefined): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, extensions);
  if (agentId) {
    context.header("X-Napier-Agent-Id", agentId);
  }
  context.header("X-Napier-Extension-Count", String(extensions.length));
  for (const status of ["pending", "approved", "rejected"] satisfies ExtensionRecord["trustStatus"][]) {
    context.header(`X-Napier-Extension-Trust-${status.replaceAll("_", "-")}-Count`, String(extensions.filter((extension) => extension.trustStatus === status).length));
  }
  context.header("X-Napier-Extension-Enabled-Agent-Count", String(extensions.reduce((total, extension) => total + extension.enabledAgentIds.length, 0)));
  context.header("X-Napier-Extension-Tool-Count", String(extensions.reduce((total, extension) => total + extension.tools.length, 0)));
}

export function setExtensionRecordHeaders(context: Context, extension: ExtensionRecord): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, extension);
  context.header("X-Napier-Extension-Id", extension.id);
  context.header("X-Napier-Extension-Kind", extension.kind);
  context.header("X-Napier-Extension-Trust-Status", extension.trustStatus);
  context.header("X-Napier-Extension-Connection-Status", extension.connection.status);
  context.header("X-Napier-Extension-Revision", String(extension.revision));
  context.header("X-Napier-Extension-Requested-Capability-Count", String(extension.requestedCapabilities.length));
  context.header("X-Napier-Extension-Approved-Capability-Count", String(extension.approvedCapabilities.length));
  context.header("X-Napier-Extension-Enabled-Agent-Count", String(extension.enabledAgentIds.length));
  context.header("X-Napier-Extension-Tool-Count", String(extension.tools.length));
  context.header("X-Napier-Extension-Reviewed-Tool-Count", String(extension.tools.filter((tool) => tool.reviewStatus !== "pending").length));
  if (extension.packageBinding) {
    context.header("X-Napier-Extension-Package-Binding-SHA256", extension.packageBinding.contentSha256);
  }
}

export function setWorkspaceProcessProjectionHeaders(context: Context, projection: unknown): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, projection);
}

export function setEvaluationSuiteListHeaders(context: Context, threadId: string, suites: readonly EvaluationSuite[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, suites);
  context.header("X-Napier-Thread-Id", threadId);
  context.header("X-Napier-Evaluation-Suite-Count", String(suites.length));
  context.header("X-Napier-Evaluation-Suite-Revision-Count", String(suites.reduce((total, suite) => total + suite.revision, 0)));
  context.header("X-Napier-Evaluation-Suite-Candidate-Count", String(suites.reduce((total, suite) => total + suite.candidateRunIds.length, 0)));
}

export function setEvaluationSuiteExecutionListHeaders(context: Context, threadId: string, suiteId: string | undefined, executions: readonly EvaluationSuiteExecution[]): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, executions);
  context.header("X-Napier-Thread-Id", threadId);
  if (suiteId) {
    context.header("X-Napier-Evaluation-Suite-Id", suiteId);
  }
  context.header("X-Napier-Evaluation-Suite-Execution-Count", String(executions.length));
  context.header("X-Napier-Evaluation-Suite-Case-Count", String(executions.reduce((total, execution) => total + execution.results.length, 0)));
  context.header("X-Napier-Evaluation-Suite-Passed-Count", String(executions.reduce((total, execution) => total + execution.passedCount, 0)));
  context.header("X-Napier-Evaluation-Suite-Failed-Count", String(executions.reduce((total, execution) => total + execution.failedCount, 0)));
  context.header("X-Napier-Evaluation-Suite-Inconclusive-Count", String(executions.reduce((total, execution) => total + execution.inconclusiveCount, 0)));
}

export function setEvaluationSuiteGateReceiptHeaders(context: Context, receipt: EvaluationSuiteGateReceipt): void {
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", `attachment; filename="${evaluationSuiteGateReceiptFilename(receipt)}"`);
  setStableContentSha256Header(context, receipt.contentSha256);
  context.header("X-Napier-Thread-Id", receipt.suite.threadId);
  context.header("X-Napier-Evaluation-Suite-Id", receipt.suite.id);
  context.header("X-Napier-Evaluation-Suite-Revision", String(receipt.suite.revision));
  context.header("X-Napier-Evaluation-Gate-State", receipt.state);
  context.header("X-Napier-Evaluation-Count", String(receipt.evaluations.length));
  if (receipt.execution) {
    context.header("X-Napier-Evaluation-Suite-Execution-Id", receipt.execution.id);
    context.header("X-Napier-Evaluation-Suite-Execution-Status", receipt.execution.status);
    context.header("X-Napier-Evaluation-Suite-Execution-SHA256", receipt.execution.contentSha256);
  }
}

export function evaluationSuiteGateReceiptFilename(receipt: EvaluationSuiteGateReceipt): string {
  const safeSuiteId = safeFilenameSegment(receipt.suite.id, "suite");
  return `napier-gate-${safeSuiteId}-r${receipt.suite.revision}-${receipt.contentSha256.slice(0, 12)}.json`;
}
