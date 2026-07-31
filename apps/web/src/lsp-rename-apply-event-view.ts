type ApplyStatus = "applied" | "rolled_back" | "indeterminate";
type Postcondition = "verified" | "drifted" | "indeterminate";
type DiagnosticStatus =
  | "clean"
  | "introduced"
  | "improved"
  | "unchanged"
  | "regressed"
  | "truncated"
  | "unavailable"
  | "drifted";

export interface LspRenameApplyToolEventTraceView {
  lspRenameApplyStatus?: ApplyStatus;
  lspRenameApplyPostcondition?: Postcondition;
  lspRenameApplyFileCount?: number;
  lspRenameApplyEditCount?: number;
  lspRenameApplyCommittedFileCount?: number;
  lspRenameApplyRestoredFileCount?: number;
  lspRenameApplyRecoveryArtifactCount?: number;
  lspRenameApplyRollbackAttempted?: boolean;
  lspRenameApplyRollbackVerified?: boolean;
  lspRenameApplyDurable?: boolean;
  lspRenameApplyCancellationObserved?: boolean;
  lspRenameApplyDiagnosticStatus?: DiagnosticStatus;
  lspRenameApplyDiagnosticFileCount?: number;
  lspRenameApplyDiagnosticOmittedFileCount?: number;
  lspRenameApplyBeforeDiagnosticCount?: number;
  lspRenameApplyAfterDiagnosticCount?: number;
  lspRenameApplySourcePreviewSha256?: string;
  lspRenameApplyPlanSha256?: string;
  lspRenameApplyBeforeFileSetSha256?: string;
  lspRenameApplyExpectedFileSetSha256?: string;
  lspRenameApplyObservedFileSetSha256?: string;
  lspRenameApplyResourceLimitsSha256?: string;
  lspRenameApplyDiagnosticsResultSha256?: string;
  lspRenameApplyResultSha256?: string;
}

export function lspRenameApplyEventEvidence(
  value: unknown,
): LspRenameApplyToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const status = applyStatus(value["status"]);
  const postcondition = postconditionStatus(value["postcondition"]);
  const fileCount = integer(value["fileCount"], 1, 32);
  const editCount = integer(value["editCount"], 1, 256);
  const committed = integer(value["committedFileCount"], 0, 32);
  const restored = integer(value["restoredFileCount"], 0, 32);
  const recoveryArtifacts = integer(value["recoveryArtifactCount"], 0, 32);
  if (
    value["kind"] !== "napier.lsp-rename-apply" ||
    value["schemaVersion"] !== 1 ||
    !status ||
    !postcondition ||
    fileCount === undefined ||
    editCount === undefined ||
    committed === undefined ||
    restored === undefined ||
    recoveryArtifacts === undefined ||
    editCount < fileCount ||
    committed > fileCount ||
    restored > committed ||
    recoveryArtifacts > fileCount ||
    typeof value["rollbackAttempted"] !== "boolean" ||
    typeof value["rollbackVerified"] !== "boolean" ||
    typeof value["durable"] !== "boolean" ||
    typeof value["cancellationObserved"] !== "boolean" ||
    !validStatusBinding(
      value,
      status,
      postcondition,
      fileCount,
      committed,
      restored,
      recoveryArtifacts,
    )
  ) {
    return undefined;
  }
  const hashes = hashFields(value, {
    sourcePreviewResultSha256: "lspRenameApplySourcePreviewSha256",
    planSha256: "lspRenameApplyPlanSha256",
    beforeFileSetSha256: "lspRenameApplyBeforeFileSetSha256",
    expectedFileSetSha256: "lspRenameApplyExpectedFileSetSha256",
    observedFileSetSha256: "lspRenameApplyObservedFileSetSha256",
    resourceLimitsSha256: "lspRenameApplyResourceLimitsSha256",
    resultSha256: "lspRenameApplyResultSha256",
  });
  if (
    !hashes.lspRenameApplySourcePreviewSha256 ||
    !hashes.lspRenameApplyPlanSha256 ||
    !hashes.lspRenameApplyBeforeFileSetSha256 ||
    !hashes.lspRenameApplyExpectedFileSetSha256 ||
    !hashes.lspRenameApplyResourceLimitsSha256 ||
    !hashes.lspRenameApplyResultSha256
  ) {
    return undefined;
  }
  const diagnostics = renameDiagnostics(value["diagnostics"]);
  if (value["diagnostics"] !== undefined && !diagnostics) return undefined;
  return {
    lspRenameApplyStatus: status,
    lspRenameApplyPostcondition: postcondition,
    lspRenameApplyFileCount: fileCount,
    lspRenameApplyEditCount: editCount,
    lspRenameApplyCommittedFileCount: committed,
    lspRenameApplyRestoredFileCount: restored,
    lspRenameApplyRecoveryArtifactCount: recoveryArtifacts,
    lspRenameApplyRollbackAttempted: value["rollbackAttempted"],
    lspRenameApplyRollbackVerified: value["rollbackVerified"],
    lspRenameApplyDurable: value["durable"],
    lspRenameApplyCancellationObserved: value["cancellationObserved"],
    ...hashes,
    ...(diagnostics ? diagnostics : {}),
  };
}

export function lspRenameApplySummaryParts(
  view: LspRenameApplyToolEventTraceView,
): string[] {
  return [
    ...(view.lspRenameApplyStatus
      ? [`rename-apply ${view.lspRenameApplyStatus}`]
      : []),
    ...(view.lspRenameApplyPostcondition
      ? [`rename-postcondition ${view.lspRenameApplyPostcondition}`]
      : []),
    ...(view.lspRenameApplyFileCount !== undefined
      ? [`rename-files ${view.lspRenameApplyFileCount}`]
      : []),
    ...(view.lspRenameApplyEditCount !== undefined
      ? [`rename-edits ${view.lspRenameApplyEditCount}`]
      : []),
    ...(view.lspRenameApplyCommittedFileCount !== undefined
      ? [`rename-committed ${view.lspRenameApplyCommittedFileCount}`]
      : []),
    ...(view.lspRenameApplyRestoredFileCount !== undefined
      ? [`rename-restored ${view.lspRenameApplyRestoredFileCount}`]
      : []),
    ...(view.lspRenameApplyRecoveryArtifactCount !== undefined
      ? [
          `rename-recovery-artifacts ${view.lspRenameApplyRecoveryArtifactCount}`,
        ]
      : []),
    ...(view.lspRenameApplyRollbackVerified
      ? ["rename-rollback-verified"]
      : []),
    ...(view.lspRenameApplyDurable ? ["rename-durable"] : []),
    ...(view.lspRenameApplyCancellationObserved
      ? ["rename-cancellation-observed"]
      : []),
    ...(view.lspRenameApplyDiagnosticStatus
      ? [`rename-diagnostics ${view.lspRenameApplyDiagnosticStatus}`]
      : []),
    ...hashSummary("rename-plan", view.lspRenameApplyPlanSha256),
    ...hashSummary("rename-expected", view.lspRenameApplyExpectedFileSetSha256),
    ...hashSummary("rename-observed", view.lspRenameApplyObservedFileSetSha256),
    ...hashSummary("rename-apply-result", view.lspRenameApplyResultSha256),
  ];
}

function renameDiagnostics(
  value: unknown,
): LspRenameApplyToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const status = diagnosticStatus(value["status"]);
  const fileCount = integer(value["fileCount"], 0, 8);
  const omitted = integer(value["omittedFileCount"], 0, 32);
  const before = integer(value["beforeDiagnosticCount"], 0, 512);
  const beforeErrors = integer(value["beforeErrorCount"], 0, 512);
  const beforeWarnings = integer(value["beforeWarningCount"], 0, 512);
  const after =
    value["afterDiagnosticCount"] === undefined
      ? undefined
      : integer(value["afterDiagnosticCount"], 0, 512);
  const afterErrors =
    value["afterErrorCount"] === undefined
      ? undefined
      : integer(value["afterErrorCount"], 0, 512);
  const afterWarnings =
    value["afterWarningCount"] === undefined
      ? undefined
      : integer(value["afterWarningCount"], 0, 512);
  const beforeSet = hash(value["beforeResultSetSha256"]);
  const afterSet = hash(value["afterResultSetSha256"]);
  const deltaSet = hash(value["deltaSetSha256"]);
  const errorSha256 = hash(value["errorSha256"]);
  const result = hash(value["resultSha256"]);
  if (
    value["kind"] !== "napier.lsp-rename-apply-diagnostics" ||
    value["schemaVersion"] !== 1 ||
    !status ||
    fileCount === undefined ||
    omitted === undefined ||
    before === undefined ||
    beforeErrors === undefined ||
    beforeWarnings === undefined ||
    beforeErrors + beforeWarnings > before ||
    (value["afterDiagnosticCount"] !== undefined && after === undefined) ||
    (value["afterErrorCount"] !== undefined && afterErrors === undefined) ||
    (value["afterWarningCount"] !== undefined && afterWarnings === undefined) ||
    (after !== undefined &&
      (afterErrors === undefined ||
        afterWarnings === undefined ||
        afterErrors + afterWarnings > after)) ||
    !beforeSet ||
    (status === "unavailable"
      ? after !== undefined || !errorSha256
      : after === undefined || !afterSet || !deltaSet) ||
    typeof value["truncated"] !== "boolean" ||
    !result
  ) {
    return undefined;
  }
  return {
    lspRenameApplyDiagnosticStatus: status,
    lspRenameApplyDiagnosticFileCount: fileCount,
    lspRenameApplyDiagnosticOmittedFileCount: omitted,
    lspRenameApplyBeforeDiagnosticCount: before,
    ...(after !== undefined
      ? { lspRenameApplyAfterDiagnosticCount: after }
      : {}),
    lspRenameApplyDiagnosticsResultSha256: result,
  };
}

function validStatusBinding(
  value: Record<string, unknown>,
  status: ApplyStatus,
  postcondition: Postcondition,
  fileCount: number,
  committed: number,
  restored: number,
  recoveryArtifacts: number,
): boolean {
  if (status === "applied") {
    return (
      committed === fileCount &&
      restored === 0 &&
      (recoveryArtifacts === 0 || value["durable"] === false) &&
      value["rollbackAttempted"] === false &&
      value["rollbackVerified"] === false
    );
  }
  if (status === "rolled_back") {
    return (
      postcondition === "verified" &&
      value["rollbackAttempted"] === true &&
      value["rollbackVerified"] === true &&
      restored === committed &&
      (recoveryArtifacts === 0 || value["durable"] === false)
    );
  }
  return (
    postcondition === "indeterminate" &&
    value["rollbackAttempted"] === true &&
    value["rollbackVerified"] === false &&
    restored + recoveryArtifacts >= committed
  );
}

function applyStatus(value: unknown): ApplyStatus | undefined {
  return value === "applied" ||
    value === "rolled_back" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function postconditionStatus(value: unknown): Postcondition | undefined {
  return value === "verified" ||
    value === "drifted" ||
    value === "indeterminate"
    ? value
    : undefined;
}

function diagnosticStatus(value: unknown): DiagnosticStatus | undefined {
  return value === "clean" ||
    value === "introduced" ||
    value === "improved" ||
    value === "unchanged" ||
    value === "regressed" ||
    value === "truncated" ||
    value === "unavailable" ||
    value === "drifted"
    ? value
    : undefined;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
    ? Number(value)
    : undefined;
}

function hashFields(
  value: Record<string, unknown>,
  fields: Record<string, keyof LspRenameApplyToolEventTraceView>,
): LspRenameApplyToolEventTraceView {
  const result: Record<string, string> = {};
  for (const [source, target] of Object.entries(fields)) {
    const digest = hash(value[source]);
    if (digest) result[target] = digest;
  }
  return result as LspRenameApplyToolEventTraceView;
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function hash(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
