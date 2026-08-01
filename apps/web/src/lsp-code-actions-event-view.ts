import {
  lspSessionEventEvidence,
  type LspSessionToolEventTraceView,
} from "./lsp-session-event-view";

type LspLanguage =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact";

export interface LspCodeActionsToolEventTraceView extends LspSessionToolEventTraceView {
  lspCodeActionsStatus?: "found" | "not_found";
  lspCodeActionsLanguage?: LspLanguage;
  lspCodeActionsComplete?: boolean;
  lspCodeActionsTruncated?: boolean;
  lspCodeActionsDiagnosticCount?: number;
  lspCodeActionsActionCount?: number;
  lspCodeActionsOmittedActionCount?: number;
  lspCodeActionsPreferredActionCount?: number;
  lspCodeActionsCommandIgnoredCount?: number;
  lspCodeActionsResolveSupported?: boolean;
  lspCodeActionsResolveRequestCount?: number;
  lspCodeActionsResolvedActionCount?: number;
  lspCodeActionsResolveOmittedCount?: number;
  lspCodeActionsCommandPolicy?: "deny_all";
  lspCodeActionsFileCount?: number;
  lspCodeActionsEditCount?: number;
  lspCodeActionsPreviewBytes?: number;
  lspCodeActionsDurationMs?: number;
  lspCodeActionsProtocolBytes?: number;
  lspCodeActionsSourcePathSha256?: string;
  lspCodeActionsSourceFileSha256?: string;
  lspCodeActionsDiagnosticSetSha256?: string;
  lspCodeActionsActionSetSha256?: string;
  lspCodeActionsTargetFileSetSha256?: string;
  lspCodeActionsResultSha256?: string;
}

export function lspCodeActionsEventEvidence(
  value: unknown,
): LspCodeActionsToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const session = lspSessionEventEvidence(value);
  if (!session) return undefined;
  const status = value["status"];
  const language = value["language"];
  if (
    value["kind"] !== "napier.lsp-code-actions" ||
    (value["schemaVersion"] !== 1 && value["schemaVersion"] !== 2) ||
    (status !== "found" && status !== "not_found") ||
    typeof value["complete"] !== "boolean" ||
    typeof value["truncated"] !== "boolean" ||
    !lspLanguage(language)
  ) {
    return undefined;
  }
  const diagnosticCount = integerInRange(value["diagnosticCount"], 0, 64);
  const actionCount = integerInRange(value["actionCount"], 0, 16);
  const omittedActionCount = integerInRange(value["omittedActionCount"], 0, 64);
  const preferredActionCount = integerInRange(
    value["preferredActionCount"],
    0,
    16,
  );
  const commandIgnoredCount = integerInRange(
    value["commandIgnoredCount"],
    0,
    16,
  );
  const fileCount = integerInRange(value["fileCount"], 0, 32);
  const editCount = integerInRange(value["editCount"], 0, 256);
  const previewBytes = integerInRange(value["previewBytes"], 0, 32 * 1024);
  const resolveSupported =
    value["schemaVersion"] === 2 &&
    typeof value["resolveSupported"] === "boolean"
      ? value["resolveSupported"]
      : undefined;
  const resolveRequestCount =
    value["schemaVersion"] === 2
      ? integerInRange(value["resolveRequestCount"], 0, 16)
      : undefined;
  const resolvedActionCount =
    value["schemaVersion"] === 2
      ? integerInRange(value["resolvedActionCount"], 0, 16)
      : undefined;
  const resolveOmittedCount =
    value["schemaVersion"] === 2
      ? integerInRange(value["resolveOmittedCount"], 0, 64)
      : undefined;
  const resolutionBudgetTruncated =
    value["schemaVersion"] === 2 &&
    resolveSupported === true &&
    resolveRequestCount === 16 &&
    resolveOmittedCount !== undefined &&
    resolveOmittedCount > 0;
  if (
    diagnosticCount === undefined ||
    actionCount === undefined ||
    omittedActionCount === undefined ||
    preferredActionCount === undefined ||
    commandIgnoredCount === undefined ||
    fileCount === undefined ||
    editCount === undefined ||
    previewBytes === undefined ||
    actionCount + omittedActionCount > 64 ||
    preferredActionCount > actionCount ||
    commandIgnoredCount > actionCount ||
    editCount < fileCount ||
    (value["schemaVersion"] === 1 &&
      (value["resolveSupported"] !== undefined ||
        value["resolveRequestCount"] !== undefined ||
        value["resolvedActionCount"] !== undefined ||
        value["resolveOmittedCount"] !== undefined ||
        value["commandPolicy"] !== undefined)) ||
    (value["schemaVersion"] === 2 &&
      (resolveSupported === undefined ||
        resolveRequestCount === undefined ||
        resolvedActionCount === undefined ||
        resolveOmittedCount === undefined ||
        value["commandPolicy"] !== "deny_all" ||
        resolvedActionCount > actionCount ||
        resolvedActionCount > resolveRequestCount ||
        resolveOmittedCount > omittedActionCount ||
        resolveRequestCount > resolvedActionCount + resolveOmittedCount ||
        (!resolveSupported &&
          (resolveRequestCount !== 0 || resolvedActionCount !== 0)))) ||
    value["complete"] !==
      (omittedActionCount === 0 && value["truncated"] === false) ||
    (value["truncated"] === true &&
      ((actionCount !== 16 && !resolutionBudgetTruncated) ||
        omittedActionCount === 0)) ||
    (status === "found"
      ? actionCount === 0 || fileCount === 0 || editCount === 0
      : actionCount !== 0 ||
        fileCount !== 0 ||
        editCount !== 0 ||
        previewBytes !== 0)
  ) {
    return undefined;
  }
  const durationMs = integerInRange(value["durationMs"], 0, 30_000);
  const protocolBytes = integerInRange(
    value["protocolBytes"],
    0,
    2 * 1024 * 1024,
  );
  return {
    ...session,
    lspCodeActionsStatus: status,
    lspCodeActionsLanguage: language,
    lspCodeActionsComplete: value["complete"],
    ...(value["truncated"] ? { lspCodeActionsTruncated: true } : {}),
    lspCodeActionsDiagnosticCount: diagnosticCount,
    lspCodeActionsActionCount: actionCount,
    lspCodeActionsOmittedActionCount: omittedActionCount,
    lspCodeActionsPreferredActionCount: preferredActionCount,
    lspCodeActionsCommandIgnoredCount: commandIgnoredCount,
    ...(resolveSupported !== undefined
      ? { lspCodeActionsResolveSupported: resolveSupported }
      : {}),
    ...(resolveRequestCount !== undefined
      ? { lspCodeActionsResolveRequestCount: resolveRequestCount }
      : {}),
    ...(resolvedActionCount !== undefined
      ? { lspCodeActionsResolvedActionCount: resolvedActionCount }
      : {}),
    ...(resolveOmittedCount !== undefined
      ? { lspCodeActionsResolveOmittedCount: resolveOmittedCount }
      : {}),
    ...(value["commandPolicy"] === "deny_all"
      ? { lspCodeActionsCommandPolicy: "deny_all" as const }
      : {}),
    lspCodeActionsFileCount: fileCount,
    lspCodeActionsEditCount: editCount,
    lspCodeActionsPreviewBytes: previewBytes,
    ...(durationMs !== undefined
      ? { lspCodeActionsDurationMs: durationMs }
      : {}),
    ...(protocolBytes !== undefined
      ? { lspCodeActionsProtocolBytes: protocolBytes }
      : {}),
    ...hashFields(value, {
      sourcePathSha256: "lspCodeActionsSourcePathSha256",
      sourceFileSha256: "lspCodeActionsSourceFileSha256",
      diagnosticSetSha256: "lspCodeActionsDiagnosticSetSha256",
      actionSetSha256: "lspCodeActionsActionSetSha256",
      targetFileSetSha256: "lspCodeActionsTargetFileSetSha256",
      resultSha256: "lspCodeActionsResultSha256",
    }),
  };
}

export function lspCodeActionsSummaryParts(
  view: LspCodeActionsToolEventTraceView,
): string[] {
  return [
    ...(view.lspCodeActionsStatus
      ? [`quick-fixes ${view.lspCodeActionsStatus}`]
      : []),
    ...(view.lspCodeActionsLanguage
      ? [`quick-fix-language ${view.lspCodeActionsLanguage}`]
      : []),
    ...(view.lspCodeActionsComplete ? ["quick-fixes-complete"] : []),
    ...(view.lspCodeActionsTruncated ? ["quick-fixes-truncated"] : []),
    ...numberSummary(
      "quick-fix-diagnostics",
      view.lspCodeActionsDiagnosticCount,
    ),
    ...numberSummary("quick-fix-actions", view.lspCodeActionsActionCount),
    ...numberSummary(
      "quick-fix-omitted",
      view.lspCodeActionsOmittedActionCount,
    ),
    ...numberSummary(
      "quick-fix-preferred",
      view.lspCodeActionsPreferredActionCount,
    ),
    ...numberSummary(
      "quick-fix-commands-ignored",
      view.lspCodeActionsCommandIgnoredCount,
    ),
    ...(view.lspCodeActionsResolveSupported
      ? ["quick-fix-resolve-supported"]
      : []),
    ...numberSummary(
      "quick-fix-resolve-requests",
      view.lspCodeActionsResolveRequestCount,
    ),
    ...numberSummary(
      "quick-fix-resolved",
      view.lspCodeActionsResolvedActionCount,
    ),
    ...numberSummary(
      "quick-fix-resolve-omitted",
      view.lspCodeActionsResolveOmittedCount,
    ),
    ...(view.lspCodeActionsCommandPolicy
      ? [`quick-fix-command-policy ${view.lspCodeActionsCommandPolicy}`]
      : []),
    ...numberSummary("quick-fix-files", view.lspCodeActionsFileCount),
    ...numberSummary("quick-fix-edits", view.lspCodeActionsEditCount),
    ...numberSummary(
      "quick-fix-preview-bytes",
      view.lspCodeActionsPreviewBytes,
    ),
    ...numberSummary("quick-fix-ms", view.lspCodeActionsDurationMs),
    ...numberSummary("quick-fix-protocol", view.lspCodeActionsProtocolBytes),
    ...hashSummary(
      "quick-fix-source-path",
      view.lspCodeActionsSourcePathSha256,
    ),
    ...hashSummary(
      "quick-fix-source-file",
      view.lspCodeActionsSourceFileSha256,
    ),
    ...hashSummary(
      "quick-fix-diagnostic-set",
      view.lspCodeActionsDiagnosticSetSha256,
    ),
    ...hashSummary("quick-fix-action-set", view.lspCodeActionsActionSetSha256),
    ...hashSummary(
      "quick-fix-target-files",
      view.lspCodeActionsTargetFileSetSha256,
    ),
    ...hashSummary("quick-fix-result", view.lspCodeActionsResultSha256),
  ];
}

function hashFields(
  value: Record<string, unknown>,
  fields: Record<string, keyof LspCodeActionsToolEventTraceView>,
): LspCodeActionsToolEventTraceView {
  const result: Record<string, string> = {};
  for (const [source, target] of Object.entries(fields)) {
    const digest = sha256(value[source]);
    if (digest) result[target] = digest;
  }
  return result as LspCodeActionsToolEventTraceView;
}

function numberSummary(label: string, value: number | undefined): string[] {
  return value === undefined ? [] : [`${label} ${value}`];
}

function hashSummary(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
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

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
