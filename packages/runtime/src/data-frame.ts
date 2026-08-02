import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  DATA_FRAME_ENGINE_SHA256,
  executeDataFrameOperations,
  MAX_DATA_FRAME_AGGREGATIONS,
  MAX_DATA_FRAME_CELL_BYTES,
  MAX_DATA_FRAME_COLUMNS,
  MAX_DATA_FRAME_GROUP_COLUMNS,
  MAX_DATA_FRAME_OPERATIONS,
  MAX_DATA_FRAME_RESULT_ROWS,
  MAX_DATA_FRAME_SORT_COLUMNS,
  MAX_DATA_FRAME_SOURCE_ROWS,
  type DataFrameCell,
  type DataFrameOperation,
} from "./data-frame-engine.js";
import { isPathInsideWorkspace } from "./policy.js";
import {
  parseStructuredDataSource,
  STRUCTURED_DATA_PARSER_SHA256,
  type WorkspaceDataFormat,
} from "./structured-data-parser.js";
import { isProtectedWorkspacePathSegment } from "./workspace-file-scope.js";

export const MAX_DATA_FRAME_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_DATA_FRAME_OUTPUT_BYTES = 256 * 1024;

export interface DataFrameRequest {
  action: "transform";
  path: string;
  sourceSha256: string;
  format?: "auto" | WorkspaceDataFormat;
  operations: DataFrameOperation[];
}

export interface DataFrameSourceReceipt {
  path: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  format: WorkspaceDataFormat;
  rowCount: number;
  columnCount: number;
}

export interface DataFrameResult {
  kind: "napier.data-frame-result";
  schemaVersion: 1;
  action: "transform";
  source: DataFrameSourceReceipt;
  operationCount: number;
  planSha256: string;
  columns: string[];
  rows: DataFrameCell[][];
  rowCount: number;
  columnCount: number;
  columnsSha256: string;
  rowsSha256: string;
  output: string;
  outputSha256: string;
  outputBytes: number;
  parserSha256: string;
  engineSha256: string;
  limitsSha256: string;
  resultSha256: string;
}

export const DATA_FRAME_LIMITS_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    parserSha256: STRUCTURED_DATA_PARSER_SHA256,
    engineSha256: DATA_FRAME_ENGINE_SHA256,
    sourceBytes: MAX_DATA_FRAME_SOURCE_BYTES,
    sourceRows: MAX_DATA_FRAME_SOURCE_ROWS,
    resultRows: MAX_DATA_FRAME_RESULT_ROWS,
    columns: MAX_DATA_FRAME_COLUMNS,
    operations: MAX_DATA_FRAME_OPERATIONS,
    cellBytes: MAX_DATA_FRAME_CELL_BYTES,
    groupColumns: MAX_DATA_FRAME_GROUP_COLUMNS,
    aggregations: MAX_DATA_FRAME_AGGREGATIONS,
    sortColumns: MAX_DATA_FRAME_SORT_COLUMNS,
    sourceFormats: ["json", "jsonl", "csv", "tsv", "markdown_table"],
    outputFormat: "table-json",
    outputBytes: MAX_DATA_FRAME_OUTPUT_BYTES,
    semantics:
      "explicit-casts-stable-sort-null-last-typed-filter-bounded-group",
  }),
);

export async function executeDataFrame(
  workspaceRoot: string,
  request: DataFrameRequest,
  signal?: AbortSignal,
): Promise<DataFrameResult> {
  const normalized = normalizeRequest(request);
  signal?.throwIfAborted();
  const source = await readDataFrameSource(
    workspaceRoot,
    normalized.path,
    normalized.sourceSha256,
  );
  const parsed = parseStructuredDataSource(
    source.text,
    source.relativePath,
    normalized.format,
    "DataFrame",
  );
  signal?.throwIfAborted();
  const transformed = executeDataFrameOperations(
    parsed.columns,
    parsed.rows,
    normalized.operations,
  );
  const output = `${JSON.stringify(
    {
      columns: transformed.columns,
      rows: transformed.rows,
      rowCount: transformed.rows.length,
    },
    null,
    2,
  )}\n`;
  const outputBytes = Buffer.byteLength(output, "utf8");
  if (outputBytes > MAX_DATA_FRAME_OUTPUT_BYTES) {
    throw new Error("DataFrame output exceeds 256 KiB; reduce columns or rows");
  }
  signal?.throwIfAborted();
  await assertDataFrameSourceCurrent(source);
  const planSha256 = sha256(
    canonicalJson({
      format: normalized.format,
      operations: normalized.operations,
    }),
  );
  const columnsSha256 = sha256(canonicalJson(transformed.columns));
  const rowsSha256 = sha256(canonicalJson(transformed.rows));
  const outputSha256 = sha256(output);
  const content = {
    kind: "napier.data-frame-result",
    schemaVersion: 1,
    action: "transform",
    sourcePathSha256: source.pathSha256,
    sourceSha256: source.fileSha256,
    sourceBytes: source.fileBytes,
    sourceFormat: parsed.format,
    sourceRowCount: parsed.rows.length,
    sourceColumnCount: parsed.columns.length,
    operationCount: normalized.operations.length,
    planSha256,
    rowCount: transformed.rows.length,
    columnCount: transformed.columns.length,
    columnsSha256,
    rowsSha256,
    outputSha256,
    outputBytes,
    parserSha256: STRUCTURED_DATA_PARSER_SHA256,
    engineSha256: DATA_FRAME_ENGINE_SHA256,
    limitsSha256: DATA_FRAME_LIMITS_SHA256,
  };
  return {
    kind: "napier.data-frame-result",
    schemaVersion: 1,
    action: "transform",
    source: {
      path: source.relativePath,
      pathSha256: source.pathSha256,
      fileSha256: source.fileSha256,
      fileBytes: source.fileBytes,
      format: parsed.format,
      rowCount: parsed.rows.length,
      columnCount: parsed.columns.length,
    },
    operationCount: normalized.operations.length,
    planSha256,
    columns: transformed.columns,
    rows: transformed.rows,
    rowCount: transformed.rows.length,
    columnCount: transformed.columns.length,
    columnsSha256,
    rowsSha256,
    output,
    outputSha256,
    outputBytes,
    parserSha256: STRUCTURED_DATA_PARSER_SHA256,
    engineSha256: DATA_FRAME_ENGINE_SHA256,
    limitsSha256: DATA_FRAME_LIMITS_SHA256,
    resultSha256: sha256(canonicalJson(content)),
  };
}

interface ReadDataFrameSource {
  target: string;
  relativePath: string;
  pathSha256: string;
  fileSha256: string;
  fileBytes: number;
  text: string;
}

async function readDataFrameSource(
  workspaceRoot: string,
  candidate: string,
  expectedSha256: string,
): Promise<ReadDataFrameSource> {
  if (
    !candidate ||
    candidate.length > 500 ||
    path.isAbsolute(candidate) ||
    /[\u0000-\u001f\u007f]/u.test(candidate)
  ) {
    throw new Error("DataFrame source path is invalid");
  }
  const protectedSegment = candidate
    .split(/[\\/]/u)
    .find(isProtectedWorkspacePathSegment);
  if (protectedSegment) {
    throw new Error(
      `DataFrame cannot read protected path segment: ${protectedSegment}`,
    );
  }
  let root: string;
  try {
    root = await realpath(path.resolve(workspaceRoot));
  } catch {
    throw new Error("DataFrame workspace root is unavailable");
  }
  const requested = path.resolve(root, candidate);
  if (!isPathInsideWorkspace(requested, root)) {
    throw new Error("DataFrame source path escapes the workspace");
  }
  let requestedInfo;
  try {
    requestedInfo = await lstat(requested);
  } catch {
    throw new Error("DataFrame source is unavailable");
  }
  if (requestedInfo.isSymbolicLink()) {
    throw new Error("DataFrame source cannot be a symbolic link");
  }
  let target: string;
  try {
    target = await realpath(requested);
  } catch {
    throw new Error("DataFrame source is unavailable");
  }
  if (!isPathInsideWorkspace(target, root)) {
    throw new Error("DataFrame source resolves outside the workspace");
  }
  const buffer = await readRegularDataFrameFile(target);
  const fileSha256 = sha256(buffer);
  if (fileSha256 !== expectedSha256) {
    throw new Error("DataFrame source does not match sourceSha256");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("DataFrame source must be valid UTF-8");
  }
  const relativePath = path.relative(root, target);
  return {
    target,
    relativePath,
    pathSha256: sha256(relativePath),
    fileSha256,
    fileBytes: buffer.byteLength,
    text,
  };
}

async function assertDataFrameSourceCurrent(
  source: ReadDataFrameSource,
): Promise<void> {
  let rebound: string;
  try {
    rebound = await realpath(source.target);
  } catch {
    throw new Error("DataFrame source changed during transformation");
  }
  if (rebound !== source.target) {
    throw new Error("DataFrame source changed during transformation");
  }
  let current: Buffer;
  try {
    current = await readRegularDataFrameFile(source.target);
  } catch {
    throw new Error("DataFrame source changed during transformation");
  }
  if (
    current.byteLength !== source.fileBytes ||
    sha256(current) !== source.fileSha256
  ) {
    throw new Error("DataFrame source changed during transformation");
  }
}

async function readRegularDataFrameFile(target: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    throw new Error("DataFrame source could not be opened safely");
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("DataFrame source must be a file");
    if (info.size > MAX_DATA_FRAME_SOURCE_BYTES) {
      throw new Error("DataFrame source exceeds 2 MiB");
    }
    const buffer = await handle.readFile();
    if (buffer.byteLength > MAX_DATA_FRAME_SOURCE_BYTES) {
      throw new Error("DataFrame source exceeds 2 MiB");
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

function normalizeRequest(request: DataFrameRequest): {
  path: string;
  sourceSha256: string;
  format: "auto" | WorkspaceDataFormat;
  operations: DataFrameOperation[];
} {
  const formats = ["auto", "json", "jsonl", "csv", "tsv", "markdown_table"];
  if (
    !record(request) ||
    !exactKeys(request, [
      "action",
      "path",
      "sourceSha256",
      "format",
      "operations",
    ]) ||
    request.action !== "transform" ||
    typeof request.path !== "string" ||
    typeof request.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(request.sourceSha256) ||
    !formats.includes(request.format ?? "auto") ||
    !Array.isArray(request.operations)
  ) {
    throw new Error("DataFrame request is invalid");
  }
  return {
    path: request.path,
    sourceSha256: request.sourceSha256,
    format: request.format ?? "auto",
    operations: structuredClone(request.operations),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
