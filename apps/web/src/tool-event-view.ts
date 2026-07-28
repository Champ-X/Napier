import type { RunEvent } from "@napier/contracts";

export interface ToolEventTraceView {
  toolName: string;
  status: string;
  effect?: "read" | "write";
  inputSha256?: string;
  loopGuardTriggerSha256?: string;
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
  dataFormat?: "json" | "jsonl" | "csv";
  dataRowCount?: number;
  dataColumnCount?: number;
  dataSizeBytes?: number;
  dataTruncated?: boolean;
  dataPathSha256?: string;
  dataFileSha256?: string;
  dataColumnSetSha256?: string;
  dataSampleSha256?: string;
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
  verificationKind?: "typecheck" | "test" | "format";
  verificationStatus?: "passed" | "failed" | "timed_out" | "output_capped";
  verificationExitCode?: number;
  verificationScopeSha256?: string;
  verificationCwdPathSha256?: string;
  verificationTargetPathSha256?: string;
  verificationTargetSnapshotSha256?: string;
  verificationTargetSnapshotTruncated?: boolean;
  verificationVerifierSha256?: string;
  verificationWorkspaceSnapshotSha256?: string;
  verificationWorkspaceSnapshotFileCount?: number;
  verificationWorkspaceSnapshotBytes?: number;
  verificationWorkspaceSnapshotTruncated?: boolean;
  verificationStdoutSha256?: string;
  verificationStderrSha256?: string;
  verificationStdoutTruncated?: boolean;
  verificationStderrTruncated?: boolean;
  patchOperation?: "create" | "replace" | "hashline_replace";
  patchPathSha256?: string;
  patchBeforeSha256?: string;
  patchAfterSha256?: string;
  patchBeforeBytes?: number;
  patchAfterBytes?: number;
  patchEditCount?: number;
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

const TOOL_EVENT_PATTERN = /^tool\.(started|completed|failed|blocked)$/u;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,160}$/u;
const STATUS = /^[A-Za-z0-9_.:-]{1,64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TOOL_RECEIPT_SUMMARY = "tool receipt";

export function toolEventTraceView(
  event: RunEvent,
): ToolEventTraceView | undefined {
  if (
    !TOOL_EVENT_PATTERN.test(event.type) ||
    !event.payload ||
    Array.isArray(event.payload) ||
    typeof event.payload !== "object"
  ) {
    return undefined;
  }
  const toolName = safeToolName(event.payload["toolName"]);
  const status = safeStatus(event.payload["status"]) ?? statusFromEvent(event);
  if (!toolName || !status) return undefined;
  const effect = safeEffect(event.payload["effect"]);
  const inputSha256 = sha256(event.payload["inputSha256"]);
  const loopGuardTriggerSha256 = sha256(
    event.payload["loopGuardTriggerSha256"],
  );
  const searchEvidence =
    toolName === "search_files"
      ? searchFilesEvidence(event.payload["details"])
      : undefined;
  const symbolIndexEvidence =
    toolName === "list_symbols"
      ? listSymbolsEvidence(event.payload["details"])
      : undefined;
  const dataEvidence =
    toolName === "inspect_data"
      ? inspectDataEvidence(event.payload["details"])
      : undefined;
  const codeEvidence =
    toolName === "inspect_code"
      ? inspectCodeEvidence(event.payload["details"])
      : undefined;
  const symbolSourceEvidence =
    toolName === "read_symbol"
      ? readSymbolEvidence(event.payload["details"])
      : undefined;
  const verificationEvidence =
    toolName === "verify_workspace"
      ? verificationEvidenceView(event.payload["details"])
      : undefined;
  const patchEvidence =
    toolName === "apply_patch"
      ? applyPatchEvidence(event.payload["details"])
      : undefined;
  const listEvidence =
    toolName === "list_files"
      ? listFilesEvidence(event.payload["details"])
      : undefined;
  const readEvidence =
    toolName === "read_file"
      ? readFileEvidence(event.payload["details"])
      : undefined;
  return {
    toolName,
    status,
    ...(effect ? { effect } : {}),
    ...(inputSha256 ? { inputSha256 } : {}),
    ...(loopGuardTriggerSha256 ? { loopGuardTriggerSha256 } : {}),
    ...(searchEvidence ? searchEvidence : {}),
    ...(symbolIndexEvidence ? symbolIndexEvidence : {}),
    ...(dataEvidence ? dataEvidence : {}),
    ...(codeEvidence ? codeEvidence : {}),
    ...(symbolSourceEvidence ? symbolSourceEvidence : {}),
    ...(verificationEvidence ? verificationEvidence : {}),
    ...(patchEvidence ? patchEvidence : {}),
    ...(listEvidence ? listEvidence : {}),
    ...(readEvidence ? readEvidence : {}),
  };
}

export function toolEventTraceSummary(event: RunEvent): string | undefined {
  if (!TOOL_EVENT_PATTERN.test(event.type)) return undefined;
  const view = toolEventTraceView(event);
  if (!view) return TOOL_RECEIPT_SUMMARY;
  return [
    `tool / ${view.toolName}`,
    view.status,
    ...(view.effect ? [`effect ${view.effect}`] : []),
    ...(view.inputSha256 ? [`input ${view.inputSha256.slice(0, 12)}`] : []),
    ...(view.loopGuardTriggerSha256
      ? [`loop ${view.loopGuardTriggerSha256.slice(0, 12)}`]
      : []),
    ...(view.searchMatchCount !== undefined
      ? [`matches ${view.searchMatchCount}`]
      : []),
    ...(view.searchTruncated ? ["truncated"] : []),
    ...(view.searchMatchSetSha256
      ? [`match-set ${view.searchMatchSetSha256.slice(0, 12)}`]
      : []),
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
    ...(view.symbolIndexPathSha256
      ? [`symbol-root ${view.symbolIndexPathSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolIndexLanguageCountsSha256
      ? [`language-counts ${view.symbolIndexLanguageCountsSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolIndexFileSetSha256
      ? [`symbol-files ${view.symbolIndexFileSetSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolIndexSymbolSetSha256
      ? [`symbol-set ${view.symbolIndexSymbolSetSha256.slice(0, 12)}`]
      : []),
    ...(view.dataFormat ? [`data ${view.dataFormat}`] : []),
    ...(view.dataRowCount !== undefined ? [`rows ${view.dataRowCount}`] : []),
    ...(view.dataColumnCount !== undefined
      ? [`columns ${view.dataColumnCount}`]
      : []),
    ...(view.dataSizeBytes !== undefined ? [`size ${view.dataSizeBytes}`] : []),
    ...(view.dataTruncated ? ["data-truncated"] : []),
    ...(view.dataPathSha256
      ? [`data-path ${view.dataPathSha256.slice(0, 12)}`]
      : []),
    ...(view.dataFileSha256
      ? [`data-file ${view.dataFileSha256.slice(0, 12)}`]
      : []),
    ...(view.dataColumnSetSha256
      ? [`column-set ${view.dataColumnSetSha256.slice(0, 12)}`]
      : []),
    ...(view.dataSampleSha256
      ? [`sample ${view.dataSampleSha256.slice(0, 12)}`]
      : []),
    ...(view.codeLanguage ? [`code ${view.codeLanguage}`] : []),
    ...(view.codeSymbolCount !== undefined
      ? [`symbols ${view.codeSymbolCount}`]
      : []),
    ...(view.codeTotalLines !== undefined
      ? [`lines ${view.codeTotalLines}`]
      : []),
    ...(view.codeSizeBytes !== undefined ? [`size ${view.codeSizeBytes}`] : []),
    ...(view.codeTruncated ? ["code-truncated"] : []),
    ...(view.codePathSha256
      ? [`code-path ${view.codePathSha256.slice(0, 12)}`]
      : []),
    ...(view.codeFileSha256
      ? [`code-file ${view.codeFileSha256.slice(0, 12)}`]
      : []),
    ...(view.codeSymbolSetSha256
      ? [`symbol-set ${view.codeSymbolSetSha256.slice(0, 12)}`]
      : []),
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
    ...(view.symbolSourcePathSha256
      ? [`symbol-path ${view.symbolSourcePathSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolSourceFileSha256
      ? [`symbol-file ${view.symbolSourceFileSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolSourceNameSha256
      ? [`symbol-name ${view.symbolSourceNameSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolSourceLineSha256
      ? [`symbol-line-hash ${view.symbolSourceLineSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolSourceSignatureSha256
      ? [`signature ${view.symbolSourceSignatureSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolSourceRangeSha256
      ? [`symbol-source ${view.symbolSourceRangeSha256.slice(0, 12)}`]
      : []),
    ...(view.symbolSourceLineAnchorSetSha256
      ? [`symbol-anchors ${view.symbolSourceLineAnchorSetSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationKind && view.verificationStatus
      ? [`verification ${view.verificationKind} ${view.verificationStatus}`]
      : []),
    ...(view.verificationExitCode !== undefined
      ? [`exit ${view.verificationExitCode}`]
      : []),
    ...(view.verificationScopeSha256
      ? [`scope ${view.verificationScopeSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationCwdPathSha256
      ? [`cwd ${view.verificationCwdPathSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationTargetPathSha256
      ? [`target ${view.verificationTargetPathSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationTargetSnapshotSha256
      ? [
          `target-snapshot ${view.verificationTargetSnapshotSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.verificationTargetSnapshotTruncated
      ? ["target-snapshot-truncated"]
      : []),
    ...(view.verificationVerifierSha256
      ? [`verifier ${view.verificationVerifierSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationWorkspaceSnapshotFileCount !== undefined
      ? [`snapshot-files ${view.verificationWorkspaceSnapshotFileCount}`]
      : []),
    ...(view.verificationWorkspaceSnapshotBytes !== undefined
      ? [`snapshot-bytes ${view.verificationWorkspaceSnapshotBytes}`]
      : []),
    ...(view.verificationWorkspaceSnapshotTruncated
      ? ["snapshot-truncated"]
      : []),
    ...(view.verificationWorkspaceSnapshotSha256
      ? [
          `workspace-snapshot ${view.verificationWorkspaceSnapshotSha256.slice(0, 12)}`,
        ]
      : []),
    ...(view.verificationStdoutSha256
      ? [`stdout ${view.verificationStdoutSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationStderrSha256
      ? [`stderr ${view.verificationStderrSha256.slice(0, 12)}`]
      : []),
    ...(view.verificationStdoutTruncated ? ["stdout-truncated"] : []),
    ...(view.verificationStderrTruncated ? ["stderr-truncated"] : []),
    ...(view.patchOperation ? [`patch ${view.patchOperation}`] : []),
    ...(view.patchEditCount !== undefined
      ? [`edits ${view.patchEditCount}`]
      : []),
    ...(view.patchBeforeBytes !== undefined &&
    view.patchAfterBytes !== undefined
      ? [`bytes ${view.patchBeforeBytes}->${view.patchAfterBytes}`]
      : []),
    ...(view.patchPathSha256
      ? [`path ${view.patchPathSha256.slice(0, 12)}`]
      : []),
    ...(view.patchBeforeSha256
      ? [`before ${view.patchBeforeSha256.slice(0, 12)}`]
      : view.patchOperation === "create"
        ? ["before absent"]
        : []),
    ...(view.patchAfterSha256
      ? [`after ${view.patchAfterSha256.slice(0, 12)}`]
      : []),
    ...(view.listCount !== undefined ? [`entries ${view.listCount}`] : []),
    ...(view.listTruncated ? ["entries-truncated"] : []),
    ...(view.listPathSha256
      ? [`list-path ${view.listPathSha256.slice(0, 12)}`]
      : []),
    ...(view.listEntrySetSha256
      ? [`entry-set ${view.listEntrySetSha256.slice(0, 12)}`]
      : []),
    ...(view.readStartLine !== undefined && view.readEndLine !== undefined
      ? [`range ${view.readStartLine}-${view.readEndLine}`]
      : []),
    ...(view.readTotalLines !== undefined
      ? [`lines ${view.readTotalLines}`]
      : []),
    ...(view.readSizeBytes !== undefined ? [`size ${view.readSizeBytes}`] : []),
    ...(view.readTruncated ? ["read-truncated"] : []),
    ...(view.readLineAnchorsTruncated ? ["anchors-truncated"] : []),
    ...(view.readPathSha256
      ? [`read-path ${view.readPathSha256.slice(0, 12)}`]
      : []),
    ...(view.readFileSha256
      ? [`file ${view.readFileSha256.slice(0, 12)}`]
      : []),
    ...(view.readLineAnchorSetSha256
      ? [`anchor-set ${view.readLineAnchorSetSha256.slice(0, 12)}`]
      : []),
  ].join(" / ");
}

function statusFromEvent(event: RunEvent): string | undefined {
  if (event.type === "tool.started") return "started";
  if (event.type === "tool.completed") return "completed";
  if (event.type === "tool.failed") return "failed";
  if (event.type === "tool.blocked") return "blocked";
  return undefined;
}

function safeToolName(value: unknown): string | undefined {
  return typeof value === "string" && TOOL_NAME.test(value) ? value : undefined;
}

function safeStatus(value: unknown): string | undefined {
  return typeof value === "string" && STATUS.test(value) ? value : undefined;
}

function safeEffect(value: unknown): "read" | "write" | undefined {
  return value === "read" || value === "write" ? value : undefined;
}

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && SHA256.test(value) ? value : undefined;
}

function searchFilesEvidence(value: unknown):
  | {
      searchMatchCount: number;
      searchTruncated?: boolean;
      searchMatchSetSha256?: string;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const count = record["count"];
  if (
    typeof count !== "number" ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > 80
  ) {
    return undefined;
  }
  const truncated = record["truncated"] === true;
  const matchSetSha256 = sha256(record["matchSetSha256"]);
  return {
    searchMatchCount: count,
    ...(truncated ? { searchTruncated: true } : {}),
    ...(matchSetSha256 ? { searchMatchSetSha256: matchSetSha256 } : {}),
  };
}

function inspectDataEvidence(value: unknown):
  | {
      dataFormat: "json" | "jsonl" | "csv";
      dataRowCount: number;
      dataColumnCount: number;
      dataSizeBytes?: number;
      dataTruncated?: boolean;
      dataPathSha256?: string;
      dataFileSha256?: string;
      dataColumnSetSha256?: string;
      dataSampleSha256?: string;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const format = dataFormat(record["format"]);
  const rowCount = integerInRange(record["rowCount"], 0, 1_000_000);
  const columnCount = integerInRange(record["columnCount"], 0, 1_000);
  if (!format || rowCount === undefined || columnCount === undefined) {
    return undefined;
  }
  const sizeBytes = integerInRange(record["sizeBytes"], 0, 2 * 1024 * 1024);
  const pathSha256 = sha256(record["pathSha256"]);
  const fileSha256 = sha256(record["sha256"]);
  const columnSetSha256 = sha256(record["columnSetSha256"]);
  const sampleSha256 = sha256(record["sampleSha256"]);
  return {
    dataFormat: format,
    dataRowCount: rowCount,
    dataColumnCount: columnCount,
    ...(sizeBytes !== undefined ? { dataSizeBytes: sizeBytes } : {}),
    ...(record["truncated"] === true ? { dataTruncated: true } : {}),
    ...(pathSha256 ? { dataPathSha256: pathSha256 } : {}),
    ...(fileSha256 ? { dataFileSha256: fileSha256 } : {}),
    ...(columnSetSha256 ? { dataColumnSetSha256: columnSetSha256 } : {}),
    ...(sampleSha256 ? { dataSampleSha256: sampleSha256 } : {}),
  };
}

function listSymbolsEvidence(value: unknown):
  | {
      symbolIndexFileCount: number;
      symbolIndexSkippedFileCount: number;
      symbolIndexSymbolCount: number;
      symbolIndexTotalLines?: number;
      symbolIndexSizeBytes?: number;
      symbolIndexTruncated?: boolean;
      symbolIndexPathSha256?: string;
      symbolIndexLanguageCountsSha256?: string;
      symbolIndexFileSetSha256?: string;
      symbolIndexSymbolSetSha256?: string;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const fileCount = integerInRange(record["fileCount"], 0, 120);
  const skippedFileCount = integerInRange(record["skippedFileCount"], 0, 120);
  const symbolCount = integerInRange(record["symbolCount"], 0, 240);
  if (
    fileCount === undefined ||
    skippedFileCount === undefined ||
    symbolCount === undefined
  ) {
    return undefined;
  }
  const totalLines = integerInRange(record["totalLines"], 0, 10_000_000);
  const sizeBytes = integerInRange(record["sizeBytes"], 0, 256 * 1024 * 1024);
  const pathSha256 = sha256(record["pathSha256"]);
  const languageCountsSha256 = sha256(record["languageCountsSha256"]);
  const fileSetSha256 = sha256(record["fileSetSha256"]);
  const symbolSetSha256 = sha256(record["symbolSetSha256"]);
  return {
    symbolIndexFileCount: fileCount,
    symbolIndexSkippedFileCount: skippedFileCount,
    symbolIndexSymbolCount: symbolCount,
    ...(totalLines !== undefined ? { symbolIndexTotalLines: totalLines } : {}),
    ...(sizeBytes !== undefined ? { symbolIndexSizeBytes: sizeBytes } : {}),
    ...(record["truncated"] === true ? { symbolIndexTruncated: true } : {}),
    ...(pathSha256 ? { symbolIndexPathSha256: pathSha256 } : {}),
    ...(languageCountsSha256
      ? { symbolIndexLanguageCountsSha256: languageCountsSha256 }
      : {}),
    ...(fileSetSha256 ? { symbolIndexFileSetSha256: fileSetSha256 } : {}),
    ...(symbolSetSha256 ? { symbolIndexSymbolSetSha256: symbolSetSha256 } : {}),
  };
}

function dataFormat(value: unknown): "json" | "jsonl" | "csv" | undefined {
  return value === "json" || value === "jsonl" || value === "csv"
    ? value
    : undefined;
}

function inspectCodeEvidence(value: unknown):
  | {
      codeLanguage: "typescript" | "javascript" | "python" | "go" | "unknown";
      codeSymbolCount: number;
      codeTotalLines: number;
      codeSizeBytes?: number;
      codeTruncated?: boolean;
      codePathSha256?: string;
      codeFileSha256?: string;
      codeSymbolSetSha256?: string;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const language = codeLanguage(record["language"]);
  const symbolCount = integerInRange(record["symbolCount"], 0, 120);
  const totalLines = integerInRange(record["totalLines"], 0, 1_000_000);
  if (!language || symbolCount === undefined || totalLines === undefined) {
    return undefined;
  }
  const sizeBytes = integerInRange(record["sizeBytes"], 0, 2 * 1024 * 1024);
  const pathSha256 = sha256(record["pathSha256"]);
  const fileSha256 = sha256(record["sha256"]);
  const symbolSetSha256 = sha256(record["symbolSetSha256"]);
  return {
    codeLanguage: language,
    codeSymbolCount: symbolCount,
    codeTotalLines: totalLines,
    ...(sizeBytes !== undefined ? { codeSizeBytes: sizeBytes } : {}),
    ...(record["truncated"] === true ? { codeTruncated: true } : {}),
    ...(pathSha256 ? { codePathSha256: pathSha256 } : {}),
    ...(fileSha256 ? { codeFileSha256: fileSha256 } : {}),
    ...(symbolSetSha256 ? { codeSymbolSetSha256: symbolSetSha256 } : {}),
  };
}

function readSymbolEvidence(value: unknown):
  | {
      symbolSourceKind:
        | "class"
        | "function"
        | "interface"
        | "type"
        | "enum"
        | "variable"
        | "struct"
        | "method";
      symbolSourceStartLine: number;
      symbolSourceEndLine: number;
      symbolSourceLine: number;
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
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = symbolKind(record["symbolKind"]);
  const startLine = integerInRange(record["startLine"], 1, 1_000_000);
  const endLine = integerInRange(record["endLine"], 1, 1_000_000);
  const symbolLine = integerInRange(record["symbolLine"], 1, 1_000_000);
  if (
    !kind ||
    startLine === undefined ||
    endLine === undefined ||
    symbolLine === undefined
  ) {
    return undefined;
  }
  const observedLineCount = integerInRange(record["observedLineCount"], 1, 220);
  const sizeBytes = integerInRange(record["sizeBytes"], 0, 2 * 1024 * 1024);
  const pathSha256 = sha256(record["pathSha256"]);
  const fileSha256 = sha256(record["sha256"]);
  const nameSha256 = sha256(record["symbolNameSha256"]);
  const lineSha256 = sha256(record["lineSha256"]);
  const signatureSha256 = sha256(record["signatureSha256"]);
  const rangeSha256 = sha256(record["rangeSha256"]);
  const lineAnchorSetSha256 = sha256(record["lineAnchorSetSha256"]);
  return {
    symbolSourceKind: kind,
    symbolSourceStartLine: startLine,
    symbolSourceEndLine: endLine,
    symbolSourceLine: symbolLine,
    ...(observedLineCount !== undefined
      ? { symbolSourceObservedLineCount: observedLineCount }
      : {}),
    ...(sizeBytes !== undefined ? { symbolSourceSizeBytes: sizeBytes } : {}),
    ...(record["truncated"] === true ? { symbolSourceTruncated: true } : {}),
    ...(pathSha256 ? { symbolSourcePathSha256: pathSha256 } : {}),
    ...(fileSha256 ? { symbolSourceFileSha256: fileSha256 } : {}),
    ...(nameSha256 ? { symbolSourceNameSha256: nameSha256 } : {}),
    ...(lineSha256 ? { symbolSourceLineSha256: lineSha256 } : {}),
    ...(signatureSha256
      ? { symbolSourceSignatureSha256: signatureSha256 }
      : {}),
    ...(rangeSha256 ? { symbolSourceRangeSha256: rangeSha256 } : {}),
    ...(lineAnchorSetSha256
      ? { symbolSourceLineAnchorSetSha256: lineAnchorSetSha256 }
      : {}),
  };
}

function symbolKind(
  value: unknown,
):
  | "class"
  | "function"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "struct"
  | "method"
  | undefined {
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
): "typescript" | "javascript" | "python" | "go" | "unknown" | undefined {
  return value === "typescript" ||
    value === "javascript" ||
    value === "python" ||
    value === "go" ||
    value === "unknown"
    ? value
    : undefined;
}

function verificationEvidenceView(value: unknown):
  | {
      verificationKind: "typecheck" | "test" | "format";
      verificationStatus: "passed" | "failed" | "timed_out" | "output_capped";
      verificationExitCode?: number;
      verificationScopeSha256?: string;
      verificationCwdPathSha256?: string;
      verificationTargetPathSha256?: string;
      verificationTargetSnapshotSha256?: string;
      verificationTargetSnapshotTruncated?: boolean;
      verificationVerifierSha256?: string;
      verificationWorkspaceSnapshotSha256?: string;
      verificationWorkspaceSnapshotFileCount?: number;
      verificationWorkspaceSnapshotBytes?: number;
      verificationWorkspaceSnapshotTruncated?: boolean;
      verificationStdoutSha256?: string;
      verificationStderrSha256?: string;
      verificationStdoutTruncated?: boolean;
      verificationStderrTruncated?: boolean;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = verificationKind(record["kind"]);
  const status = verificationStatus(record["status"]);
  if (!kind || !status) return undefined;
  const exitCode = integerInRange(record["exitCode"], -1, 255);
  const workspaceSnapshotFileCount = integerInRange(
    record["workspaceSnapshotFileCount"],
    0,
    2_001,
  );
  const workspaceSnapshotBytes = integerInRange(
    record["workspaceSnapshotBytes"],
    0,
    16 * 1024 * 1024,
  );
  const scopeSha256 = sha256(record["scopeSha256"]);
  const cwdPathSha256 = sha256(record["cwdPathSha256"]);
  const targetPathSha256 = sha256(record["targetPathSha256"]);
  const targetSnapshotSha256 = sha256(record["targetSnapshotSha256"]);
  const verifierSha256 = sha256(record["verifierSha256"]);
  const workspaceSnapshotSha256 = sha256(record["workspaceSnapshotSha256"]);
  const stdoutSha256 = sha256(record["stdoutSha256"]);
  const stderrSha256 = sha256(record["stderrSha256"]);
  return {
    verificationKind: kind,
    verificationStatus: status,
    ...(exitCode !== undefined ? { verificationExitCode: exitCode } : {}),
    ...(scopeSha256 ? { verificationScopeSha256: scopeSha256 } : {}),
    ...(cwdPathSha256 ? { verificationCwdPathSha256: cwdPathSha256 } : {}),
    ...(targetPathSha256
      ? { verificationTargetPathSha256: targetPathSha256 }
      : {}),
    ...(targetSnapshotSha256
      ? { verificationTargetSnapshotSha256: targetSnapshotSha256 }
      : {}),
    ...(record["targetSnapshotTruncated"] === true
      ? { verificationTargetSnapshotTruncated: true }
      : {}),
    ...(verifierSha256 ? { verificationVerifierSha256: verifierSha256 } : {}),
    ...(workspaceSnapshotSha256
      ? { verificationWorkspaceSnapshotSha256: workspaceSnapshotSha256 }
      : {}),
    ...(workspaceSnapshotFileCount !== undefined
      ? { verificationWorkspaceSnapshotFileCount: workspaceSnapshotFileCount }
      : {}),
    ...(workspaceSnapshotBytes !== undefined
      ? { verificationWorkspaceSnapshotBytes: workspaceSnapshotBytes }
      : {}),
    ...(record["workspaceSnapshotTruncated"] === true
      ? { verificationWorkspaceSnapshotTruncated: true }
      : {}),
    ...(stdoutSha256 ? { verificationStdoutSha256: stdoutSha256 } : {}),
    ...(stderrSha256 ? { verificationStderrSha256: stderrSha256 } : {}),
    ...(record["stdoutTruncated"] === true
      ? { verificationStdoutTruncated: true }
      : {}),
    ...(record["stderrTruncated"] === true
      ? { verificationStderrTruncated: true }
      : {}),
  };
}

function verificationKind(
  value: unknown,
): "typecheck" | "test" | "format" | undefined {
  return value === "typecheck" || value === "test" || value === "format"
    ? value
    : undefined;
}

function verificationStatus(
  value: unknown,
): "passed" | "failed" | "timed_out" | "output_capped" | undefined {
  return value === "passed" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "output_capped"
    ? value
    : undefined;
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function applyPatchEvidence(value: unknown):
  | {
      patchOperation: "create" | "replace" | "hashline_replace";
      patchPathSha256?: string;
      patchBeforeSha256?: string;
      patchAfterSha256?: string;
      patchBeforeBytes?: number;
      patchAfterBytes?: number;
      patchEditCount?: number;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const operation = patchOperation(record["operation"]);
  if (!operation) return undefined;
  const pathSha256 = sha256(record["pathSha256"]);
  const beforeSha256 = sha256(record["beforeSha256"]);
  const afterSha256 = sha256(record["afterSha256"]);
  const beforeBytes = integerInRange(record["beforeBytes"], 0, 262_144);
  const afterBytes = integerInRange(record["afterBytes"], 0, 262_144);
  const editCount = integerInRange(record["editCount"], 0, 32);
  return {
    patchOperation: operation,
    ...(pathSha256 ? { patchPathSha256: pathSha256 } : {}),
    ...(beforeSha256 ? { patchBeforeSha256: beforeSha256 } : {}),
    ...(afterSha256 ? { patchAfterSha256: afterSha256 } : {}),
    ...(beforeBytes !== undefined ? { patchBeforeBytes: beforeBytes } : {}),
    ...(afterBytes !== undefined ? { patchAfterBytes: afterBytes } : {}),
    ...(editCount !== undefined ? { patchEditCount: editCount } : {}),
  };
}

function patchOperation(
  value: unknown,
): "create" | "replace" | "hashline_replace" | undefined {
  return value === "create" ||
    value === "replace" ||
    value === "hashline_replace"
    ? value
    : undefined;
}

function listFilesEvidence(value: unknown):
  | {
      listCount: number;
      listTruncated?: boolean;
      listPathSha256?: string;
      listEntrySetSha256?: string;
    }
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const count = integerInRange(record["count"], 0, 300);
  if (count === undefined) return undefined;
  const pathSha256 = sha256(record["pathSha256"]);
  const entrySetSha256 = sha256(record["entrySetSha256"]);
  return {
    listCount: count,
    ...(record["truncated"] === true ? { listTruncated: true } : {}),
    ...(pathSha256 ? { listPathSha256: pathSha256 } : {}),
    ...(entrySetSha256 ? { listEntrySetSha256: entrySetSha256 } : {}),
  };
}

function readFileEvidence(value: unknown):
  | {
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
  | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const startLine = integerInRange(record["startLine"], 1, 1_000_000);
  const endLine = integerInRange(record["endLine"], 1, 1_000_000);
  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    return undefined;
  }
  const totalLines = integerInRange(record["totalLines"], 1, 1_000_000);
  const pathSha256 = sha256(record["pathSha256"]);
  const fileSha256 = sha256(record["sha256"]);
  const lineAnchorSetSha256 = sha256(record["lineAnchorSetSha256"]);
  const sizeBytes = integerInRange(record["sizeBytes"], 0, 2_097_152);
  if (!fileSha256 && !pathSha256 && startLine === undefined) {
    return undefined;
  }
  return {
    ...(startLine !== undefined ? { readStartLine: startLine } : {}),
    ...(endLine !== undefined ? { readEndLine: endLine } : {}),
    ...(totalLines !== undefined ? { readTotalLines: totalLines } : {}),
    ...(pathSha256 ? { readPathSha256: pathSha256 } : {}),
    ...(fileSha256 ? { readFileSha256: fileSha256 } : {}),
    ...(sizeBytes !== undefined ? { readSizeBytes: sizeBytes } : {}),
    ...(record["truncated"] === true ? { readTruncated: true } : {}),
    ...(record["lineAnchorsTruncated"] === true
      ? { readLineAnchorsTruncated: true }
      : {}),
    ...(lineAnchorSetSha256
      ? { readLineAnchorSetSha256: lineAnchorSetSha256 }
      : {}),
  };
}
