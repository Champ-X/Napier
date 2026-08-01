import {
  lspCodeActionsEventEvidence,
  lspCodeActionsSummaryParts,
  type LspCodeActionsToolEventTraceView,
} from "./lsp-code-actions-event-view";
import {
  lspRenameEventEvidence,
  lspRenameSummaryParts,
  type LspRenameToolEventTraceView,
} from "./lsp-rename-event-view";
import {
  lspCodeActionApplyEventEvidence,
  lspRenameApplyEventEvidence,
  lspRenameApplySummaryParts,
  type LspRenameApplyToolEventTraceView,
} from "./lsp-rename-apply-event-view";
import {
  lspSessionEventEvidence,
  lspSessionSummaryParts,
  type LspSessionToolEventTraceView,
} from "./lsp-session-event-view";
import {
  lspSymbolsEventEvidence,
  lspSymbolsSummaryParts,
  type LspSymbolsToolEventTraceView,
} from "./lsp-symbols-event-view";

type LspLanguage =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact";

export interface LspToolEventTraceView
  extends
    LspRenameToolEventTraceView,
    LspRenameApplyToolEventTraceView,
    LspCodeActionsToolEventTraceView,
    LspSymbolsToolEventTraceView,
    LspSessionToolEventTraceView {
  lspStatus?: "clean" | "diagnostics";
  lspLanguage?: LspLanguage;
  lspDiagnosticCount?: number;
  lspErrorCount?: number;
  lspWarningCount?: number;
  lspTruncated?: boolean;
  lspDurationMs?: number;
  lspProtocolBytes?: number;
  lspPathSha256?: string;
  lspFileSha256?: string;
  lspDiagnosticSetSha256?: string;
  lspCodeSetSha256?: string;
  lspResultSha256?: string;
  lspDefinitionStatus?: "found" | "not_found";
  lspDefinitionLanguage?: LspLanguage;
  lspDefinitionCount?: number;
  lspDefinitionOmittedCount?: number;
  lspDefinitionTruncated?: boolean;
  lspDefinitionDurationMs?: number;
  lspDefinitionProtocolBytes?: number;
  lspDefinitionSourcePathSha256?: string;
  lspDefinitionSourceFileSha256?: string;
  lspDefinitionSetSha256?: string;
  lspDefinitionTargetFileSetSha256?: string;
  lspDefinitionResultSha256?: string;
  lspReferencesStatus?: "found" | "not_found";
  lspReferencesLanguage?: LspLanguage;
  lspReferencesIncludeDeclaration?: boolean;
  lspReferencesCount?: number;
  lspReferencesOmittedCount?: number;
  lspReferencesTruncated?: boolean;
  lspReferencesDurationMs?: number;
  lspReferencesProtocolBytes?: number;
  lspReferencesSourcePathSha256?: string;
  lspReferencesSourceFileSha256?: string;
  lspReferencesSetSha256?: string;
  lspReferencesTargetFileSetSha256?: string;
  lspReferencesResultSha256?: string;
}

export function lspToolEventEvidence(
  toolName: string,
  value: unknown,
): LspToolEventTraceView | undefined {
  if (toolName === "lsp_diagnostics") return diagnosticsEvidence(value);
  if (toolName === "lsp_symbols") return lspSymbolsEventEvidence(value);
  if (toolName === "lsp_definition") return definitionEvidence(value);
  if (toolName === "lsp_references") return referencesEvidence(value);
  if (toolName === "lsp_rename") return lspRenameEventEvidence(value);
  if (toolName === "lsp_rename_apply")
    return lspRenameApplyEventEvidence(value);
  if (toolName === "lsp_code_action_apply")
    return lspCodeActionApplyEventEvidence(value);
  if (toolName === "lsp_code_actions")
    return lspCodeActionsEventEvidence(value);
  return undefined;
}

export function lspToolEventSummaryParts(
  view: LspToolEventTraceView,
): string[] {
  return [
    ...lspSessionSummaryParts(view),
    ...(view.lspStatus ? [`lsp ${view.lspStatus}`] : []),
    ...(view.lspLanguage ? [`language ${view.lspLanguage}`] : []),
    ...(view.lspDiagnosticCount !== undefined
      ? [`diagnostics ${view.lspDiagnosticCount}`]
      : []),
    ...(view.lspErrorCount !== undefined
      ? [`errors ${view.lspErrorCount}`]
      : []),
    ...(view.lspWarningCount !== undefined
      ? [`warnings ${view.lspWarningCount}`]
      : []),
    ...(view.lspDurationMs !== undefined
      ? [`duration-ms ${view.lspDurationMs}`]
      : []),
    ...(view.lspProtocolBytes !== undefined
      ? [`protocol-bytes ${view.lspProtocolBytes}`]
      : []),
    ...(view.lspTruncated ? ["lsp-truncated"] : []),
    ...(view.lspPathSha256
      ? [`lsp-path ${view.lspPathSha256.slice(0, 12)}`]
      : []),
    ...(view.lspFileSha256
      ? [`lsp-file ${view.lspFileSha256.slice(0, 12)}`]
      : []),
    ...(view.lspDiagnosticSetSha256
      ? [`diagnostic-set ${view.lspDiagnosticSetSha256.slice(0, 12)}`]
      : []),
    ...(view.lspCodeSetSha256
      ? [`code-set ${view.lspCodeSetSha256.slice(0, 12)}`]
      : []),
    ...(view.lspResultSha256
      ? [`lsp-result ${view.lspResultSha256.slice(0, 12)}`]
      : []),
    ...lspSymbolsSummaryParts(view),
    ...(view.lspDefinitionStatus
      ? [`definition ${view.lspDefinitionStatus}`]
      : []),
    ...(view.lspDefinitionLanguage
      ? [`definition-language ${view.lspDefinitionLanguage}`]
      : []),
    ...(view.lspDefinitionCount !== undefined
      ? [`definitions ${view.lspDefinitionCount}`]
      : []),
    ...(view.lspDefinitionOmittedCount !== undefined
      ? [`definition-omitted ${view.lspDefinitionOmittedCount}`]
      : []),
    ...(view.lspDefinitionDurationMs !== undefined
      ? [`definition-ms ${view.lspDefinitionDurationMs}`]
      : []),
    ...(view.lspDefinitionProtocolBytes !== undefined
      ? [`definition-protocol ${view.lspDefinitionProtocolBytes}`]
      : []),
    ...(view.lspDefinitionTruncated ? ["definition-truncated"] : []),
    ...(view.lspDefinitionSourcePathSha256
      ? [
          `definition-source-path ${view.lspDefinitionSourcePathSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.lspDefinitionSourceFileSha256
      ? [
          `definition-source-file ${view.lspDefinitionSourceFileSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.lspDefinitionSetSha256
      ? [`definition-set ${view.lspDefinitionSetSha256.slice(0, 12)}`]
      : []),
    ...(view.lspDefinitionTargetFileSetSha256
      ? [
          `definition-files ${view.lspDefinitionTargetFileSetSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.lspDefinitionResultSha256
      ? [`definition-result ${view.lspDefinitionResultSha256.slice(0, 12)}`]
      : []),
    ...(view.lspReferencesStatus
      ? [`references ${view.lspReferencesStatus}`]
      : []),
    ...(view.lspReferencesLanguage
      ? [`reference-language ${view.lspReferencesLanguage}`]
      : []),
    ...(view.lspReferencesIncludeDeclaration !== undefined
      ? [
          view.lspReferencesIncludeDeclaration
            ? "reference-declarations included"
            : "reference-declarations excluded",
        ]
      : []),
    ...(view.lspReferencesCount !== undefined
      ? [`reference-count ${view.lspReferencesCount}`]
      : []),
    ...(view.lspReferencesOmittedCount !== undefined
      ? [`reference-omitted ${view.lspReferencesOmittedCount}`]
      : []),
    ...(view.lspReferencesDurationMs !== undefined
      ? [`reference-ms ${view.lspReferencesDurationMs}`]
      : []),
    ...(view.lspReferencesProtocolBytes !== undefined
      ? [`reference-protocol ${view.lspReferencesProtocolBytes}`]
      : []),
    ...(view.lspReferencesTruncated ? ["reference-truncated"] : []),
    ...(view.lspReferencesSourcePathSha256
      ? [
          `reference-source-path ${view.lspReferencesSourcePathSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.lspReferencesSourceFileSha256
      ? [
          `reference-source-file ${view.lspReferencesSourceFileSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.lspReferencesSetSha256
      ? [`reference-set ${view.lspReferencesSetSha256.slice(0, 12)}`]
      : []),
    ...(view.lspReferencesTargetFileSetSha256
      ? [
          `reference-files ${view.lspReferencesTargetFileSetSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.lspReferencesResultSha256
      ? [`reference-result ${view.lspReferencesResultSha256.slice(0, 12)}`]
      : []),
    ...lspRenameSummaryParts(view),
    ...lspRenameApplySummaryParts(view),
    ...lspCodeActionsSummaryParts(view),
  ];
}

function diagnosticsEvidence(
  value: unknown,
): LspToolEventTraceView | undefined {
  const record = evidenceRecord(value, "napier.lsp-diagnostics", [
    "clean",
    "diagnostics",
  ]);
  if (!record) return undefined;
  const session = lspSessionEventEvidence(record);
  if (!session) return undefined;
  const diagnosticCount = integerInRange(record["diagnosticCount"], 0, 64);
  const errorCount = integerInRange(record["errorCount"], 0, 64);
  const warningCount = integerInRange(record["warningCount"], 0, 64);
  if (
    diagnosticCount === undefined ||
    errorCount === undefined ||
    warningCount === undefined ||
    errorCount + warningCount > diagnosticCount
  ) {
    return undefined;
  }
  const bounded = commonEvidence(record);
  return {
    ...session,
    lspStatus: record["status"] as "clean" | "diagnostics",
    lspLanguage: record["language"] as LspLanguage,
    lspDiagnosticCount: diagnosticCount,
    lspErrorCount: errorCount,
    lspWarningCount: warningCount,
    ...(record["truncated"] === true ? { lspTruncated: true } : {}),
    ...(bounded.durationMs !== undefined
      ? { lspDurationMs: bounded.durationMs }
      : {}),
    ...(bounded.protocolBytes !== undefined
      ? { lspProtocolBytes: bounded.protocolBytes }
      : {}),
    ...hashFields(record, {
      pathSha256: "lspPathSha256",
      fileSha256: "lspFileSha256",
      diagnosticSetSha256: "lspDiagnosticSetSha256",
      codeSetSha256: "lspCodeSetSha256",
      resultSha256: "lspResultSha256",
    }),
  };
}

function definitionEvidence(value: unknown): LspToolEventTraceView | undefined {
  const record = evidenceRecord(value, "napier.lsp-definition", [
    "found",
    "not_found",
  ]);
  if (!record) return undefined;
  const session = lspSessionEventEvidence(record);
  if (!session) return undefined;
  const count = integerInRange(record["definitionCount"], 0, 32);
  const omitted = integerInRange(record["omittedDefinitionCount"], 0, 100_000);
  if (count === undefined || omitted === undefined) return undefined;
  const bounded = commonEvidence(record);
  return {
    ...session,
    lspDefinitionStatus: record["status"] as "found" | "not_found",
    lspDefinitionLanguage: record["language"] as LspLanguage,
    lspDefinitionCount: count,
    lspDefinitionOmittedCount: omitted,
    ...(record["truncated"] === true ? { lspDefinitionTruncated: true } : {}),
    ...(bounded.durationMs !== undefined
      ? { lspDefinitionDurationMs: bounded.durationMs }
      : {}),
    ...(bounded.protocolBytes !== undefined
      ? { lspDefinitionProtocolBytes: bounded.protocolBytes }
      : {}),
    ...hashFields(record, {
      sourcePathSha256: "lspDefinitionSourcePathSha256",
      sourceFileSha256: "lspDefinitionSourceFileSha256",
      definitionSetSha256: "lspDefinitionSetSha256",
      targetFileSetSha256: "lspDefinitionTargetFileSetSha256",
      resultSha256: "lspDefinitionResultSha256",
    }),
  };
}

function referencesEvidence(value: unknown): LspToolEventTraceView | undefined {
  const record = evidenceRecord(value, "napier.lsp-references", [
    "found",
    "not_found",
  ]);
  if (!record || typeof record["includeDeclaration"] !== "boolean") {
    return undefined;
  }
  const session = lspSessionEventEvidence(record);
  if (!session) return undefined;
  const count = integerInRange(record["referenceCount"], 0, 64);
  const omitted = integerInRange(record["omittedReferenceCount"], 0, 100_000);
  if (count === undefined || omitted === undefined) return undefined;
  const bounded = commonEvidence(record);
  return {
    ...session,
    lspReferencesStatus: record["status"] as "found" | "not_found",
    lspReferencesLanguage: record["language"] as LspLanguage,
    lspReferencesIncludeDeclaration: record["includeDeclaration"],
    lspReferencesCount: count,
    lspReferencesOmittedCount: omitted,
    ...(record["truncated"] === true ? { lspReferencesTruncated: true } : {}),
    ...(bounded.durationMs !== undefined
      ? { lspReferencesDurationMs: bounded.durationMs }
      : {}),
    ...(bounded.protocolBytes !== undefined
      ? { lspReferencesProtocolBytes: bounded.protocolBytes }
      : {}),
    ...hashFields(record, {
      sourcePathSha256: "lspReferencesSourcePathSha256",
      sourceFileSha256: "lspReferencesSourceFileSha256",
      referenceSetSha256: "lspReferencesSetSha256",
      targetFileSetSha256: "lspReferencesTargetFileSetSha256",
      resultSha256: "lspReferencesResultSha256",
    }),
  };
}

function evidenceRecord(
  value: unknown,
  kind: string,
  statuses: string[],
): Record<string, unknown> | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record["kind"] !== kind ||
    record["schemaVersion"] !== 1 ||
    !statuses.includes(String(record["status"])) ||
    !lspLanguage(record["language"])
  ) {
    return undefined;
  }
  return record;
}

function commonEvidence(record: Record<string, unknown>): {
  durationMs?: number;
  protocolBytes?: number;
} {
  const durationMs = integerInRange(record["durationMs"], 0, 30_000);
  const protocolBytes = integerInRange(
    record["protocolBytes"],
    0,
    2 * 1024 * 1024,
  );
  return {
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(protocolBytes !== undefined ? { protocolBytes } : {}),
  };
}

function hashFields(
  record: Record<string, unknown>,
  fields: Record<string, keyof LspToolEventTraceView>,
): LspToolEventTraceView {
  const result: Record<string, string> = {};
  for (const [source, target] of Object.entries(fields)) {
    const value = sha256(record[source]);
    if (value) result[target] = value;
  }
  return result as LspToolEventTraceView;
}

function lspLanguage(value: unknown): value is LspLanguage {
  return (
    value === "typescript" ||
    value === "typescriptreact" ||
    value === "javascript" ||
    value === "javascriptreact"
  );
}

function integerInRange(
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

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}
