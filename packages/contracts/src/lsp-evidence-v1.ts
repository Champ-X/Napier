export type LspDiagnosticLanguage = "typescript" | "typescriptreact" | "javascript" | "javascriptreact";

export interface LspSessionEvidenceDetails {
  sessionMode?: "one_shot" | "run_persistent";
  sessionReused?: boolean;
  sessionOperation?: number;
  sessionIdSha256?: string;
  sessionWorkspaceSha256?: string;
  sessionLimitsSha256?: string;
}

export interface LspDiagnosticsDetails extends LspSessionEvidenceDetails {
  kind: "napier.lsp-diagnostics";
  schemaVersion: 1;
  status: "clean" | "diagnostics";
  language: LspDiagnosticLanguage;
  sandbox: string;
  workspaceAccess: "read_only";
  networkAccess: "denied";
  workspaceRootSha256: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  diagnosticCount: number;
  errorCount: number;
  warningCount: number;
  informationCount: number;
  hintCount: number;
  truncated: boolean;
  diagnosticSetSha256: string;
  codeSetSha256: string;
  nodeExecutableSha256: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  timeoutMs: number;
  durationMs: number;
  protocolBytes: number;
  stderrChars: number;
  stderrSha256: string;
  stderrTruncated: boolean;
  resultSha256: string;
}

export interface LspSymbolsDetails extends LspSessionEvidenceDetails {
  kind: "napier.lsp-symbols";
  schemaVersion: 1;
  status: "found" | "not_found";
  complete: boolean;
  truncated: boolean;
  responseShape: "empty" | "hierarchical" | "flat";
  language: LspDiagnosticLanguage;
  sandbox: string;
  workspaceAccess: "read_only";
  networkAccess: "denied";
  workspaceRootSha256: string;
  sourcePathSha256: string;
  sourceFileSha256: string;
  sourceFileBytes: number;
  responseSymbolCount: number;
  symbolCount: number;
  omittedSymbolCount: number;
  maxDepth: number;
  deprecatedSymbolCount: number;
  displayBytes: number;
  symbolSetSha256: string;
  kindCountsSha256: string;
  nodeExecutableSha256: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  timeoutMs: number;
  durationMs: number;
  protocolBytes: number;
  stderrChars: number;
  stderrSha256: string;
  stderrTruncated: boolean;
  resultSha256: string;
}

export interface LspDefinitionDetails extends LspSessionEvidenceDetails {
  kind: "napier.lsp-definition";
  schemaVersion: 1;
  status: "found" | "not_found";
  language: LspDiagnosticLanguage;
  sandbox: string;
  workspaceAccess: "read_only";
  networkAccess: "denied";
  workspaceRootSha256: string;
  sourcePathSha256: string;
  sourceFileSha256: string;
  sourceFileBytes: number;
  positionSha256: string;
  definitionCount: number;
  omittedDefinitionCount: number;
  truncated: boolean;
  definitionSetSha256: string;
  targetFileSetSha256: string;
  nodeExecutableSha256: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  timeoutMs: number;
  durationMs: number;
  protocolBytes: number;
  stderrChars: number;
  stderrSha256: string;
  stderrTruncated: boolean;
  resultSha256: string;
}

export interface LspReferencesDetails extends LspSessionEvidenceDetails {
  kind: "napier.lsp-references";
  schemaVersion: 1;
  status: "found" | "not_found";
  language: LspDiagnosticLanguage;
  sandbox: string;
  workspaceAccess: "read_only";
  networkAccess: "denied";
  workspaceRootSha256: string;
  sourcePathSha256: string;
  sourceFileSha256: string;
  sourceFileBytes: number;
  positionSha256: string;
  includeDeclaration: boolean;
  referenceCount: number;
  omittedReferenceCount: number;
  truncated: boolean;
  referenceSetSha256: string;
  targetFileSetSha256: string;
  nodeExecutableSha256: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  timeoutMs: number;
  durationMs: number;
  protocolBytes: number;
  stderrChars: number;
  stderrSha256: string;
  stderrTruncated: boolean;
  resultSha256: string;
}

export interface LspRenameDetails extends LspSessionEvidenceDetails {
  kind: "napier.lsp-rename";
  schemaVersion: 1;
  status: "found" | "not_found";
  complete: true;
  language: LspDiagnosticLanguage;
  sandbox: string;
  workspaceAccess: "read_only";
  networkAccess: "denied";
  workspaceRootSha256: string;
  sourcePathSha256: string;
  sourceFileSha256: string;
  sourceFileBytes: number;
  positionSha256: string;
  newNameSha256: string;
  prepareResultSha256: string;
  fileCount: number;
  editCount: number;
  previewBytes: number;
  editSetSha256: string;
  targetFileSetSha256: string;
  nodeExecutableSha256: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  timeoutMs: number;
  durationMs: number;
  protocolBytes: number;
  stderrChars: number;
  stderrSha256: string;
  stderrTruncated: boolean;
  resultSha256: string;
}

export interface LspRenameApplyDiagnosticsDetails {
  kind: "napier.lsp-rename-apply-diagnostics";
  schemaVersion: 1;
  status: WorkspacePatchDiagnosticsStatus;
  fileCount: number;
  omittedFileCount: number;
  beforeDiagnosticCount: number;
  afterDiagnosticCount?: number;
  beforeErrorCount: number;
  afterErrorCount?: number;
  beforeWarningCount: number;
  afterWarningCount?: number;
  introducedCount?: number;
  resolvedCount?: number;
  unchangedCount?: number;
  truncated: boolean;
  beforeResultSetSha256: string;
  afterResultSetSha256?: string;
  deltaSetSha256?: string;
  errorSha256?: string;
  durationMs: number;
  resultSha256: string;
}

export interface LspRenameApplyDetails {
  kind: "napier.lsp-rename-apply";
  schemaVersion: 1;
  status: "applied" | "rolled_back" | "indeterminate";
  postcondition: "verified" | "drifted" | "indeterminate";
  sourcePreviewResultSha256: string;
  planSha256: string;
  fileCount: number;
  editCount: number;
  committedFileCount: number;
  restoredFileCount: number;
  recoveryArtifactCount: number;
  rollbackAttempted: boolean;
  rollbackVerified: boolean;
  durable: boolean;
  cancellationObserved: boolean;
  beforeFileSetSha256: string;
  expectedFileSetSha256: string;
  observedFileSetSha256?: string;
  resourceLimitsSha256: string;
  errorSha256?: string;
  diagnostics?: LspRenameApplyDiagnosticsDetails;
  tests?: WriteLinkedTestVerificationDetails;
  resultSha256: string;
}

export interface SubagentWorktreeApplyDetails extends Omit<LspRenameApplyDetails, "kind"> {
  kind: "napier.subagent-worktree-apply";
  taskId: string;
  outcomeSha256: string;
  sourceSnapshotSha256: string;
  sourceFileCount: number;
  sourceBytes: number;
  writeScopeCount: number;
  writeScopeSetSha256: string;
  changedFileSetSha256: string;
  candidateAddedFileCount?: number;
  candidateModifiedFileCount?: number;
  candidateDeletedFileCount?: number;
  candidateRenamedFileCount?: number;
  candidateVerificationAttemptCount?: number;
  candidateVerificationFreshCount?: number;
  candidateVerificationPassedCount?: number;
  candidateVerificationFailedCount?: number;
  candidateVerificationStaleCount?: number;
  candidateVerificationSetSha256?: string;
  candidateCommandAttemptCount?: number;
  candidateCommandFreshCount?: number;
  candidateCommandSucceededCount?: number;
  candidateCommandFailedCount?: number;
  candidateCommandStaleCount?: number;
  candidateCommandSetSha256?: string;
  candidateToolchainSha256?: string;
}

export interface LspCodeActionApplyDiagnosticsDetails extends Omit<LspRenameApplyDiagnosticsDetails, "kind"> {
  kind: "napier.lsp-code-action-apply-diagnostics";
}

export interface LspCodeActionApplyDetails extends Omit<LspRenameApplyDetails, "kind" | "diagnostics"> {
  kind: "napier.lsp-code-action-apply";
  sourceActionSha256: string;
  sourceResolved: boolean;
  sourceCommandIgnored: boolean;
  commandPolicy: "deny_all";
  diagnostics?: LspCodeActionApplyDiagnosticsDetails;
}

export interface LspCodeActionsDetails extends LspSessionEvidenceDetails {
  kind: "napier.lsp-code-actions";
  schemaVersion: 1 | 2;
  status: "found" | "not_found";
  complete: boolean;
  truncated: boolean;
  language: LspDiagnosticLanguage;
  sandbox: string;
  workspaceAccess: "read_only";
  networkAccess: "denied";
  workspaceRootSha256: string;
  sourcePathSha256: string;
  sourceFileSha256: string;
  sourceFileBytes: number;
  positionSha256: string;
  diagnosticCount: number;
  actionCount: number;
  omittedActionCount: number;
  preferredActionCount: number;
  commandIgnoredCount: number;
  resolveSupported?: boolean;
  resolveRequestCount?: number;
  resolvedActionCount?: number;
  resolveOmittedCount?: number;
  commandPolicy?: "deny_all";
  fileCount: number;
  editCount: number;
  previewBytes: number;
  diagnosticSetSha256: string;
  actionSetSha256: string;
  targetFileSetSha256: string;
  nodeExecutableSha256: string;
  languageServerVersion: string;
  languageServerSha256: string;
  typescriptVersion: string;
  typescriptServerSha256: string;
  environmentSha256: string;
  resourceLimitsSha256: string;
  timeoutMs: number;
  durationMs: number;
  protocolBytes: number;
  stderrChars: number;
  stderrSha256: string;
  stderrTruncated: boolean;
  resultSha256: string;
}

export type WorkspacePatchDiagnosticsStatus = "clean" | "introduced" | "improved" | "unchanged" | "regressed" | "truncated" | "unavailable" | "drifted";

export interface WorkspacePatchDiagnosticsDetails {
  kind: "napier.workspace-patch-diagnostics";
  schemaVersion: 1;
  status: WorkspacePatchDiagnosticsStatus;
  language?: LspDiagnosticLanguage;
  beforeDiagnosticCount?: number;
  afterDiagnosticCount?: number;
  beforeErrorCount?: number;
  afterErrorCount?: number;
  beforeWarningCount?: number;
  afterWarningCount?: number;
  beforeInformationCount?: number;
  afterInformationCount?: number;
  beforeHintCount?: number;
  afterHintCount?: number;
  introducedCount?: number;
  resolvedCount?: number;
  unchangedCount?: number;
  truncated?: boolean;
  beforeResultSha256?: string;
  afterResultSha256?: string;
  deltaSetSha256?: string;
  expectedFileSha256: string;
  observedFileSha256?: string;
  errorSha256?: string;
  durationMs: number;
  resultSha256: string;
}

export type WriteLinkedTestVerificationStatus = "passed" | "failed" | "timed_out" | "output_capped" | "no_match" | "selection_incomplete" | "drifted" | "cancelled" | "unavailable";

export interface WriteLinkedTestVerificationDetails {
  kind: "napier.write-linked-test-verification";
  schemaVersion: 1 | 2;
  status: WriteLinkedTestVerificationStatus;
  changedFileCount: number;
  changedSymbolCount: number;
  changedSymbolsTruncated: boolean;
  scannedFileCount: number;
  configurationFileCount?: number;
  workspacePackageCount?: number;
  pathAliasCount?: number;
  workspacePackageEdgeCount?: number;
  pathAliasEdgeCount?: number;
  candidateTestCount: number;
  selectedTestCount: number;
  omittedTestCount: number;
  unresolvedImportCount: number;
  graphTruncated: boolean;
  changedFileSetSha256: string;
  changedSymbolSetSha256: string;
  dependencyGraphSha256: string;
  selectedTestSetSha256: string;
  selectionSnapshotSha256: string;
  observedSnapshotSha256?: string;
  verifierSha256?: string;
  verifierVersion?: string;
  runtimeIdentitySha256?: string;
  durationMs: number;
  exitCode?: number | null;
  stdoutSha256?: string;
  stderrSha256?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  errorSha256?: string;
  resultSha256: string;
}
