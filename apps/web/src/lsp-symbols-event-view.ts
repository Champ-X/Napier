type LspLanguage =
  | "typescript"
  | "typescriptreact"
  | "javascript"
  | "javascriptreact";

type LspSymbolResponseShape = "empty" | "hierarchical" | "flat";

export interface LspSymbolsToolEventTraceView {
  lspSymbolsStatus?: "found" | "not_found";
  lspSymbolsLanguage?: LspLanguage;
  lspSymbolsComplete?: boolean;
  lspSymbolsTruncated?: boolean;
  lspSymbolsResponseShape?: LspSymbolResponseShape;
  lspSymbolsResponseCount?: number;
  lspSymbolsCount?: number;
  lspSymbolsOmittedCount?: number;
  lspSymbolsMaxDepth?: number;
  lspSymbolsDeprecatedCount?: number;
  lspSymbolsDisplayBytes?: number;
  lspSymbolsDurationMs?: number;
  lspSymbolsProtocolBytes?: number;
  lspSymbolsSourcePathSha256?: string;
  lspSymbolsSourceFileSha256?: string;
  lspSymbolsSetSha256?: string;
  lspSymbolsKindCountsSha256?: string;
  lspSymbolsResultSha256?: string;
}

export function lspSymbolsEventEvidence(
  value: unknown,
): LspSymbolsToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const status = value["status"];
  const language = value["language"];
  const responseShape = value["responseShape"];
  if (
    value["kind"] !== "napier.lsp-symbols" ||
    value["schemaVersion"] !== 1 ||
    (status !== "found" && status !== "not_found") ||
    typeof value["complete"] !== "boolean" ||
    typeof value["truncated"] !== "boolean" ||
    !symbolResponseShape(responseShape) ||
    !lspLanguage(language)
  ) {
    return undefined;
  }
  const responseCount = integerInRange(value["responseSymbolCount"], 0, 1_024);
  const symbolCount = integerInRange(value["symbolCount"], 0, 256);
  const omittedCount = integerInRange(value["omittedSymbolCount"], 0, 1_024);
  const maxDepth = integerInRange(value["maxDepth"], 0, 32);
  const deprecatedCount = integerInRange(
    value["deprecatedSymbolCount"],
    0,
    256,
  );
  const displayBytes = integerInRange(value["displayBytes"], 0, 48 * 1024);
  if (
    responseCount === undefined ||
    symbolCount === undefined ||
    omittedCount === undefined ||
    maxDepth === undefined ||
    deprecatedCount === undefined ||
    displayBytes === undefined ||
    symbolCount + omittedCount > responseCount ||
    deprecatedCount > symbolCount ||
    value["complete"] !==
      (omittedCount === 0 && value["truncated"] === false) ||
    value["truncated"] !== omittedCount > 0 ||
    (status === "found"
      ? symbolCount === 0 || responseShape === "empty" || displayBytes === 0
      : symbolCount !== 0 ||
        responseCount !== 0 ||
        omittedCount !== 0 ||
        maxDepth !== 0 ||
        deprecatedCount !== 0 ||
        displayBytes !== 0 ||
        responseShape !== "empty") ||
    (responseShape === "flat" && maxDepth !== 0)
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
    lspSymbolsStatus: status,
    lspSymbolsLanguage: language,
    lspSymbolsComplete: value["complete"],
    ...(value["truncated"] ? { lspSymbolsTruncated: true } : {}),
    lspSymbolsResponseShape: responseShape,
    lspSymbolsResponseCount: responseCount,
    lspSymbolsCount: symbolCount,
    lspSymbolsOmittedCount: omittedCount,
    lspSymbolsMaxDepth: maxDepth,
    lspSymbolsDeprecatedCount: deprecatedCount,
    lspSymbolsDisplayBytes: displayBytes,
    ...(durationMs !== undefined ? { lspSymbolsDurationMs: durationMs } : {}),
    ...(protocolBytes !== undefined
      ? { lspSymbolsProtocolBytes: protocolBytes }
      : {}),
    ...hashFields(value, {
      sourcePathSha256: "lspSymbolsSourcePathSha256",
      sourceFileSha256: "lspSymbolsSourceFileSha256",
      symbolSetSha256: "lspSymbolsSetSha256",
      kindCountsSha256: "lspSymbolsKindCountsSha256",
      resultSha256: "lspSymbolsResultSha256",
    }),
  };
}

export function lspSymbolsSummaryParts(
  view: LspSymbolsToolEventTraceView,
): string[] {
  return [
    ...(view.lspSymbolsStatus
      ? [`semantic-symbols ${view.lspSymbolsStatus}`]
      : []),
    ...(view.lspSymbolsLanguage
      ? [`symbol-language ${view.lspSymbolsLanguage}`]
      : []),
    ...(view.lspSymbolsResponseShape
      ? [`symbol-shape ${view.lspSymbolsResponseShape}`]
      : []),
    ...(view.lspSymbolsComplete ? ["symbols-complete"] : []),
    ...(view.lspSymbolsTruncated ? ["symbols-truncated"] : []),
    ...numberSummary("symbol-response", view.lspSymbolsResponseCount),
    ...numberSummary("symbols", view.lspSymbolsCount),
    ...numberSummary("symbol-omitted", view.lspSymbolsOmittedCount),
    ...numberSummary("symbol-depth", view.lspSymbolsMaxDepth),
    ...numberSummary("symbol-deprecated", view.lspSymbolsDeprecatedCount),
    ...numberSummary("symbol-display-bytes", view.lspSymbolsDisplayBytes),
    ...numberSummary("symbol-ms", view.lspSymbolsDurationMs),
    ...numberSummary("symbol-protocol", view.lspSymbolsProtocolBytes),
    ...hashSummary("symbol-source-path", view.lspSymbolsSourcePathSha256),
    ...hashSummary("symbol-source-file", view.lspSymbolsSourceFileSha256),
    ...hashSummary("symbol-set", view.lspSymbolsSetSha256),
    ...hashSummary("symbol-kinds", view.lspSymbolsKindCountsSha256),
    ...hashSummary("symbol-result", view.lspSymbolsResultSha256),
  ];
}

function hashFields(
  value: Record<string, unknown>,
  fields: Record<string, keyof LspSymbolsToolEventTraceView>,
): LspSymbolsToolEventTraceView {
  const result: Record<string, string> = {};
  for (const [source, target] of Object.entries(fields)) {
    const digest = sha256(value[source]);
    if (digest) result[target] = digest;
  }
  return result as LspSymbolsToolEventTraceView;
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

function symbolResponseShape(value: unknown): value is LspSymbolResponseShape {
  return value === "empty" || value === "hierarchical" || value === "flat";
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
