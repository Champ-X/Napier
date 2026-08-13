export interface WorkspaceReadToolEventTraceView {
  searchMatchCount?: number;
  searchTruncated?: boolean;
  searchMatchSetSha256?: string;
  symbolIndexFileCount?: number;
  symbolIndexSkippedFileCount?: number;
  symbolIndexSymbolCount?: number;
  symbolIndexTotalLines?: number;
  symbolIndexSizeBytes?: number;
  symbolIndexTruncated?: boolean;
  symbolIndexPathSha256?: string;
  symbolIndexLanguageCountsSha256?: string;
  symbolIndexFileSetSha256?: string;
  symbolIndexSymbolSetSha256?: string;
  codeLanguage?: "typescript" | "javascript" | "python" | "go" | "unknown";
  codeSymbolCount?: number;
  codeTotalLines?: number;
  codeSizeBytes?: number;
  codeTruncated?: boolean;
  codePathSha256?: string;
  codeFileSha256?: string;
  codeSymbolSetSha256?: string;
  symbolSourceKind?:
    | "class"
    | "function"
    | "interface"
    | "type"
    | "enum"
    | "variable"
    | "struct"
    | "method";
  symbolSourceStartLine?: number;
  symbolSourceEndLine?: number;
  symbolSourceLine?: number;
  symbolSourceObservedLineCount?: number;
  symbolSourceSizeBytes?: number;
  symbolSourceTruncated?: boolean;
  symbolSourcePathSha256?: string;
  symbolSourceFileSha256?: string;
  symbolSourceNameSha256?: string;
  symbolSourceLineSha256?: string;
  symbolSourceSignatureSha256?: string;
  symbolSourceRangeSha256?: string;
  symbolSourceLineAnchorSetSha256?: string;
  listCount?: number;
  listTruncated?: boolean;
  listPathSha256?: string;
  listEntrySetSha256?: string;
  readStartLine?: number;
  readEndLine?: number;
  readTotalLines?: number;
  readPathSha256?: string;
  readFileSha256?: string;
  readSizeBytes?: number;
  readTruncated?: boolean;
  readLineAnchorsTruncated?: boolean;
  readLineAnchorSetSha256?: string;
}

export function workspaceReadEventEvidence(
  toolName: string,
  value: unknown,
): WorkspaceReadToolEventTraceView | undefined {
  if (toolName === "search_files") return searchFilesEvidence(value);
  if (toolName === "list_symbols") return listSymbolsEvidence(value);
  if (toolName === "inspect_code") return inspectCodeEvidence(value);
  if (toolName === "read_symbol") return readSymbolEvidence(value);
  if (toolName === "list_files") return listFilesEvidence(value);
  return toolName === "read_file" ? readFileEvidence(value) : undefined;
}

export function workspaceReadSummaryParts(
  view: WorkspaceReadToolEventTraceView,
): string[] {
  return [
    ...searchSummary(view),
    ...symbolIndexSummary(view),
    ...codeSummary(view),
    ...symbolSourceSummary(view),
    ...fileSummary(view),
  ];
}

function searchSummary(view: WorkspaceReadToolEventTraceView): string[] {
  return [
    ...(view.searchMatchCount !== undefined
      ? [`matches ${view.searchMatchCount}`]
      : []),
    ...(view.searchTruncated ? ["truncated"] : []),
    ...hash("match-set", view.searchMatchSetSha256),
  ];
}

function symbolIndexSummary(view: WorkspaceReadToolEventTraceView): string[] {
  return [
    ...(view.symbolIndexFileCount !== undefined
      ? [`indexed-files ${view.symbolIndexFileCount}`]
      : []),
    ...(view.symbolIndexSkippedFileCount !== undefined
      ? [`skipped-files ${view.symbolIndexSkippedFileCount}`]
      : []),
    ...(view.symbolIndexSymbolCount !== undefined
      ? [`indexed-symbols ${view.symbolIndexSymbolCount}`]
      : []),
    ...(view.symbolIndexTotalLines !== undefined
      ? [`indexed-lines ${view.symbolIndexTotalLines}`]
      : []),
    ...(view.symbolIndexSizeBytes !== undefined
      ? [`indexed-size ${view.symbolIndexSizeBytes}`]
      : []),
    ...(view.symbolIndexTruncated ? ["symbol-index-truncated"] : []),
    ...hash("symbol-root", view.symbolIndexPathSha256),
    ...hash("language-counts", view.symbolIndexLanguageCountsSha256),
    ...hash("symbol-files", view.symbolIndexFileSetSha256),
    ...hash("symbol-set", view.symbolIndexSymbolSetSha256),
  ];
}

function codeSummary(view: WorkspaceReadToolEventTraceView): string[] {
  return [
    ...(view.codeLanguage ? [`code ${view.codeLanguage}`] : []),
    ...(view.codeSymbolCount !== undefined
      ? [`symbols ${view.codeSymbolCount}`]
      : []),
    ...(view.codeTotalLines !== undefined
      ? [`lines ${view.codeTotalLines}`]
      : []),
    ...(view.codeSizeBytes !== undefined ? [`size ${view.codeSizeBytes}`] : []),
    ...(view.codeTruncated ? ["code-truncated"] : []),
    ...hash("code-path", view.codePathSha256),
    ...hash("code-file", view.codeFileSha256),
    ...hash("symbol-set", view.codeSymbolSetSha256),
  ];
}

function symbolSourceSummary(view: WorkspaceReadToolEventTraceView): string[] {
  return [
    ...(view.symbolSourceKind ? [`symbol ${view.symbolSourceKind}`] : []),
    ...(view.symbolSourceStartLine !== undefined &&
    view.symbolSourceEndLine !== undefined
      ? [
          `symbol-range ${view.symbolSourceStartLine}-${view.symbolSourceEndLine}`,
        ]
      : []),
    ...(view.symbolSourceLine !== undefined
      ? [`symbol-line ${view.symbolSourceLine}`]
      : []),
    ...(view.symbolSourceObservedLineCount !== undefined
      ? [`symbol-lines ${view.symbolSourceObservedLineCount}`]
      : []),
    ...(view.symbolSourceSizeBytes !== undefined
      ? [`symbol-size ${view.symbolSourceSizeBytes}`]
      : []),
    ...(view.symbolSourceTruncated ? ["symbol-truncated"] : []),
    ...hash("symbol-path", view.symbolSourcePathSha256),
    ...hash("symbol-file", view.symbolSourceFileSha256),
    ...hash("symbol-name", view.symbolSourceNameSha256),
    ...hash("symbol-line-hash", view.symbolSourceLineSha256),
    ...hash("signature", view.symbolSourceSignatureSha256),
    ...hash("symbol-source", view.symbolSourceRangeSha256),
    ...hash("symbol-anchors", view.symbolSourceLineAnchorSetSha256),
  ];
}

function fileSummary(view: WorkspaceReadToolEventTraceView): string[] {
  return [
    ...(view.listCount !== undefined ? [`entries ${view.listCount}`] : []),
    ...(view.listTruncated ? ["entries-truncated"] : []),
    ...hash("list-path", view.listPathSha256),
    ...hash("entry-set", view.listEntrySetSha256),
    ...(view.readStartLine !== undefined && view.readEndLine !== undefined
      ? [`range ${view.readStartLine}-${view.readEndLine}`]
      : []),
    ...(view.readTotalLines !== undefined
      ? [`lines ${view.readTotalLines}`]
      : []),
    ...(view.readSizeBytes !== undefined ? [`size ${view.readSizeBytes}`] : []),
    ...(view.readTruncated ? ["read-truncated"] : []),
    ...(view.readLineAnchorsTruncated ? ["anchors-truncated"] : []),
    ...hash("read-path", view.readPathSha256),
    ...hash("file", view.readFileSha256),
    ...hash("anchor-set", view.readLineAnchorSetSha256),
  ];
}

function searchFilesEvidence(
  value: unknown,
): WorkspaceReadToolEventTraceView | undefined {
  const record = asRecord(value);
  const count = integer(record?.["count"], 0, 80);
  if (!record || count === undefined) return undefined;
  return {
    searchMatchCount: count,
    ...(record["truncated"] === true ? { searchTruncated: true } : {}),
    ...digestField(record, "matchSetSha256", "searchMatchSetSha256"),
  };
}

function listSymbolsEvidence(
  value: unknown,
): WorkspaceReadToolEventTraceView | undefined {
  const record = asRecord(value);
  const fileCount = integer(record?.["fileCount"], 0, 120);
  const skipped = integer(record?.["skippedFileCount"], 0, 120);
  const symbolCount = integer(record?.["symbolCount"], 0, 240);
  if (
    !record ||
    fileCount === undefined ||
    skipped === undefined ||
    symbolCount === undefined
  ) {
    return undefined;
  }
  return {
    symbolIndexFileCount: fileCount,
    symbolIndexSkippedFileCount: skipped,
    symbolIndexSymbolCount: symbolCount,
    ...integerField(record, "totalLines", "symbolIndexTotalLines", 10_000_000),
    ...integerField(
      record,
      "sizeBytes",
      "symbolIndexSizeBytes",
      256 * 1024 * 1024,
    ),
    ...(record["truncated"] === true ? { symbolIndexTruncated: true } : {}),
    ...digestField(record, "pathSha256", "symbolIndexPathSha256"),
    ...digestField(
      record,
      "languageCountsSha256",
      "symbolIndexLanguageCountsSha256",
    ),
    ...digestField(record, "fileSetSha256", "symbolIndexFileSetSha256"),
    ...digestField(record, "symbolSetSha256", "symbolIndexSymbolSetSha256"),
  };
}

function inspectCodeEvidence(
  value: unknown,
): WorkspaceReadToolEventTraceView | undefined {
  const record = asRecord(value);
  const language = codeLanguage(record?.["language"]);
  const symbolCount = integer(record?.["symbolCount"], 0, 120);
  const totalLines = integer(record?.["totalLines"], 0, 1_000_000);
  if (
    !record ||
    !language ||
    symbolCount === undefined ||
    totalLines === undefined
  ) {
    return undefined;
  }
  return {
    codeLanguage: language,
    codeSymbolCount: symbolCount,
    codeTotalLines: totalLines,
    ...integerField(record, "sizeBytes", "codeSizeBytes", 2 * 1024 * 1024),
    ...(record["truncated"] === true ? { codeTruncated: true } : {}),
    ...digestField(record, "pathSha256", "codePathSha256"),
    ...digestField(record, "sha256", "codeFileSha256"),
    ...digestField(record, "symbolSetSha256", "codeSymbolSetSha256"),
  };
}

function readSymbolEvidence(
  value: unknown,
): WorkspaceReadToolEventTraceView | undefined {
  const record = asRecord(value);
  const kind = symbolKind(record?.["symbolKind"]);
  const startLine = integer(record?.["startLine"], 1, 1_000_000);
  const endLine = integer(record?.["endLine"], 1, 1_000_000);
  const symbolLine = integer(record?.["symbolLine"], 1, 1_000_000);
  if (
    !record ||
    !kind ||
    startLine === undefined ||
    endLine === undefined ||
    symbolLine === undefined
  ) {
    return undefined;
  }
  return {
    symbolSourceKind: kind,
    symbolSourceStartLine: startLine,
    symbolSourceEndLine: endLine,
    symbolSourceLine: symbolLine,
    ...integerField(
      record,
      "observedLineCount",
      "symbolSourceObservedLineCount",
      220,
      1,
    ),
    ...integerField(
      record,
      "sizeBytes",
      "symbolSourceSizeBytes",
      2 * 1024 * 1024,
    ),
    ...(record["truncated"] === true ? { symbolSourceTruncated: true } : {}),
    ...digestField(record, "pathSha256", "symbolSourcePathSha256"),
    ...digestField(record, "sha256", "symbolSourceFileSha256"),
    ...digestField(record, "symbolNameSha256", "symbolSourceNameSha256"),
    ...digestField(record, "lineSha256", "symbolSourceLineSha256"),
    ...digestField(record, "signatureSha256", "symbolSourceSignatureSha256"),
    ...digestField(record, "rangeSha256", "symbolSourceRangeSha256"),
    ...digestField(
      record,
      "lineAnchorSetSha256",
      "symbolSourceLineAnchorSetSha256",
    ),
  };
}

function listFilesEvidence(
  value: unknown,
): WorkspaceReadToolEventTraceView | undefined {
  const record = asRecord(value);
  const count = integer(record?.["count"], 0, 300);
  if (!record || count === undefined) return undefined;
  return {
    listCount: count,
    ...(record["truncated"] === true ? { listTruncated: true } : {}),
    ...digestField(record, "pathSha256", "listPathSha256"),
    ...digestField(record, "entrySetSha256", "listEntrySetSha256"),
  };
}

function readFileEvidence(
  value: unknown,
): WorkspaceReadToolEventTraceView | undefined {
  const record = asRecord(value);
  const startLine = integer(record?.["startLine"], 1, 1_000_000);
  const endLine = integer(record?.["endLine"], 1, 1_000_000);
  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    return undefined;
  }
  const totalLines = integer(record?.["totalLines"], 1, 1_000_000);
  if (
    !record ||
    (!sha256(record["sha256"]) &&
      !sha256(record["pathSha256"]) &&
      startLine === undefined)
  ) {
    return undefined;
  }
  return {
    ...(startLine !== undefined ? { readStartLine: startLine } : {}),
    ...(endLine !== undefined ? { readEndLine: endLine } : {}),
    ...(totalLines !== undefined ? { readTotalLines: totalLines } : {}),
    ...integerField(record, "sizeBytes", "readSizeBytes", 2 * 1024 * 1024),
    ...(record["truncated"] === true ? { readTruncated: true } : {}),
    ...(record["lineAnchorsTruncated"] === true
      ? { readLineAnchorsTruncated: true }
      : {}),
    ...digestField(record, "pathSha256", "readPathSha256"),
    ...digestField(record, "sha256", "readFileSha256"),
    ...digestField(record, "lineAnchorSetSha256", "readLineAnchorSetSha256"),
  };
}

function integerField(
  record: Record<string, unknown>,
  source: string,
  target: keyof WorkspaceReadToolEventTraceView,
  maximum: number,
  minimum = 0,
): WorkspaceReadToolEventTraceView {
  const value = integer(record[source], minimum, maximum);
  return value === undefined ? {} : { [target]: value };
}

function digestField(
  record: Record<string, unknown>,
  source: string,
  target: keyof WorkspaceReadToolEventTraceView,
): WorkspaceReadToolEventTraceView {
  const value = sha256(record[source]);
  return value ? { [target]: value } : {};
}

function symbolKind(
  value: unknown,
): WorkspaceReadToolEventTraceView["symbolSourceKind"] {
  return value === "class" ||
    value === "function" ||
    value === "interface" ||
    value === "type" ||
    value === "enum" ||
    value === "variable" ||
    value === "struct" ||
    value === "method"
    ? value
    : undefined;
}

function codeLanguage(
  value: unknown,
): WorkspaceReadToolEventTraceView["codeLanguage"] {
  return value === "typescript" ||
    value === "javascript" ||
    value === "python" ||
    value === "go" ||
    value === "unknown"
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

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
