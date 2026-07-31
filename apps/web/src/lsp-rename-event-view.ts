import {
  lspSessionEventEvidence,
  type LspSessionToolEventTraceView,
} from "./lsp-session-event-view";

type LspLanguage =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact";

export interface LspRenameToolEventTraceView extends LspSessionToolEventTraceView {
  lspRenameStatus?: "found" | "not_found";
  lspRenameLanguage?: LspLanguage;
  lspRenameComplete?: boolean;
  lspRenameFileCount?: number;
  lspRenameEditCount?: number;
  lspRenamePreviewBytes?: number;
  lspRenameDurationMs?: number;
  lspRenameProtocolBytes?: number;
  lspRenameSourcePathSha256?: string;
  lspRenameSourceFileSha256?: string;
  lspRenameNewNameSha256?: string;
  lspRenamePrepareResultSha256?: string;
  lspRenameEditSetSha256?: string;
  lspRenameTargetFileSetSha256?: string;
  lspRenameResultSha256?: string;
}

export function lspRenameEventEvidence(
  value: unknown,
): LspRenameToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const session = lspSessionEventEvidence(value);
  if (!session) return undefined;
  const status = value["status"];
  const language = value["language"];
  if (
    value["kind"] !== "napier.lsp-rename" ||
    value["schemaVersion"] !== 1 ||
    (status !== "found" && status !== "not_found") ||
    value["complete"] !== true ||
    !lspLanguage(language)
  ) {
    return undefined;
  }
  const fileCount = integerInRange(value["fileCount"], 0, 32);
  const editCount = integerInRange(value["editCount"], 0, 256);
  const previewBytes = integerInRange(value["previewBytes"], 0, 32 * 1024);
  const found = status === "found";
  if (
    fileCount === undefined ||
    editCount === undefined ||
    previewBytes === undefined ||
    editCount < fileCount ||
    (found
      ? fileCount === 0 || editCount === 0 || previewBytes === 0
      : fileCount !== 0 || editCount !== 0 || previewBytes !== 0)
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
    lspRenameStatus: status,
    lspRenameLanguage: language,
    lspRenameComplete: true,
    lspRenameFileCount: fileCount,
    lspRenameEditCount: editCount,
    lspRenamePreviewBytes: previewBytes,
    ...(durationMs !== undefined ? { lspRenameDurationMs: durationMs } : {}),
    ...(protocolBytes !== undefined
      ? { lspRenameProtocolBytes: protocolBytes }
      : {}),
    ...hashFields(value, {
      sourcePathSha256: "lspRenameSourcePathSha256",
      sourceFileSha256: "lspRenameSourceFileSha256",
      newNameSha256: "lspRenameNewNameSha256",
      prepareResultSha256: "lspRenamePrepareResultSha256",
      editSetSha256: "lspRenameEditSetSha256",
      targetFileSetSha256: "lspRenameTargetFileSetSha256",
      resultSha256: "lspRenameResultSha256",
    }),
  };
}

export function lspRenameSummaryParts(
  view: LspRenameToolEventTraceView,
): string[] {
  return [
    ...(view.lspRenameStatus ? [`rename ${view.lspRenameStatus}`] : []),
    ...(view.lspRenameLanguage
      ? [`rename-language ${view.lspRenameLanguage}`]
      : []),
    ...(view.lspRenameComplete ? ["rename-complete"] : []),
    ...(view.lspRenameFileCount !== undefined
      ? [`rename-files ${view.lspRenameFileCount}`]
      : []),
    ...(view.lspRenameEditCount !== undefined
      ? [`rename-edits ${view.lspRenameEditCount}`]
      : []),
    ...(view.lspRenamePreviewBytes !== undefined
      ? [`rename-preview-bytes ${view.lspRenamePreviewBytes}`]
      : []),
    ...(view.lspRenameDurationMs !== undefined
      ? [`rename-ms ${view.lspRenameDurationMs}`]
      : []),
    ...(view.lspRenameProtocolBytes !== undefined
      ? [`rename-protocol ${view.lspRenameProtocolBytes}`]
      : []),
    ...hashSummary("rename-source-path", view.lspRenameSourcePathSha256),
    ...hashSummary("rename-source-file", view.lspRenameSourceFileSha256),
    ...hashSummary("rename-name", view.lspRenameNewNameSha256),
    ...hashSummary("rename-prepare", view.lspRenamePrepareResultSha256),
    ...hashSummary("rename-edit-set", view.lspRenameEditSetSha256),
    ...hashSummary("rename-target-files", view.lspRenameTargetFileSetSha256),
    ...hashSummary("rename-result", view.lspRenameResultSha256),
  ];
}

function hashFields(
  value: Record<string, unknown>,
  fields: Record<string, keyof LspRenameToolEventTraceView>,
): LspRenameToolEventTraceView {
  const result: Record<string, string> = {};
  for (const [source, target] of Object.entries(fields)) {
    const digest = sha256(value[source]);
    if (digest) result[target] = digest;
  }
  return result as LspRenameToolEventTraceView;
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
