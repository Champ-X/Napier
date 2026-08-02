export interface DataFrameToolEventTraceView {
  dataFrameSourceFormat?: "json" | "jsonl" | "csv" | "tsv" | "markdown_table";
  dataFrameSourceBytes?: number;
  dataFrameSourceRows?: number;
  dataFrameSourceColumns?: number;
  dataFrameOperationCount?: number;
  dataFrameRows?: number;
  dataFrameColumns?: number;
  dataFrameOutputBytes?: number;
  dataFrameSourcePathSha256?: string;
  dataFrameSourceSha256?: string;
  dataFramePlanSha256?: string;
  dataFrameColumnsSha256?: string;
  dataFrameRowsSha256?: string;
  dataFrameOutputSha256?: string;
  dataFrameParserSha256?: string;
  dataFrameEngineSha256?: string;
  dataFrameLimitsSha256?: string;
  dataFrameResultSha256?: string;
}

export function dataFrameToolEventEvidence(
  toolName: string,
  value: unknown,
): DataFrameToolEventTraceView | undefined {
  return toolName === "data_frame" ? dataFrameEventEvidence(value) : undefined;
}

export function dataFrameEventEvidence(
  value: unknown,
): DataFrameToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const sourceFormat = format(value["sourceFormat"]);
  const sourceBytes = integer(value["sourceBytes"], 0, 2 * 1024 * 1024);
  const sourceRows = integer(value["sourceRowCount"], 0, 10_000);
  const sourceColumns = integer(value["sourceColumnCount"], 0, 80);
  const operationCount = integer(value["operationCount"], 1, 12);
  const rows = integer(value["rowCount"], 0, 1_000);
  const columns = integer(value["columnCount"], 0, 80);
  const outputBytes = integer(value["outputBytes"], 1, 256 * 1024);
  const digests = [
    value["sourcePathSha256"],
    value["sourceSha256"],
    value["planSha256"],
    value["columnsSha256"],
    value["rowsSha256"],
    value["outputSha256"],
    value["parserSha256"],
    value["engineSha256"],
    value["limitsSha256"],
    value["resultSha256"],
  ];
  if (
    value["kind"] !== "napier.data-frame" ||
    value["schemaVersion"] !== 1 ||
    value["action"] !== "transform" ||
    !sourceFormat ||
    sourceBytes === undefined ||
    sourceRows === undefined ||
    sourceColumns === undefined ||
    operationCount === undefined ||
    rows === undefined ||
    columns === undefined ||
    outputBytes === undefined ||
    !digests.every(sha256)
  ) {
    return undefined;
  }
  const validatedDigests = digests as string[];
  return {
    dataFrameSourceFormat: sourceFormat,
    dataFrameSourceBytes: sourceBytes,
    dataFrameSourceRows: sourceRows,
    dataFrameSourceColumns: sourceColumns,
    dataFrameOperationCount: operationCount,
    dataFrameRows: rows,
    dataFrameColumns: columns,
    dataFrameOutputBytes: outputBytes,
    dataFrameSourcePathSha256: validatedDigests[0]!,
    dataFrameSourceSha256: validatedDigests[1]!,
    dataFramePlanSha256: validatedDigests[2]!,
    dataFrameColumnsSha256: validatedDigests[3]!,
    dataFrameRowsSha256: validatedDigests[4]!,
    dataFrameOutputSha256: validatedDigests[5]!,
    dataFrameParserSha256: validatedDigests[6]!,
    dataFrameEngineSha256: validatedDigests[7]!,
    dataFrameLimitsSha256: validatedDigests[8]!,
    dataFrameResultSha256: validatedDigests[9]!,
  };
}

export function dataFrameSummaryParts(
  view: DataFrameToolEventTraceView,
): string[] {
  return [
    ...(view.dataFrameSourceFormat
      ? [`data-frame ${view.dataFrameSourceFormat}`]
      : []),
    ...(view.dataFrameSourceRows !== undefined
      ? [`source-rows ${view.dataFrameSourceRows}`]
      : []),
    ...(view.dataFrameSourceColumns !== undefined
      ? [`source-columns ${view.dataFrameSourceColumns}`]
      : []),
    ...(view.dataFrameOperationCount !== undefined
      ? [`operations ${view.dataFrameOperationCount}`]
      : []),
    ...(view.dataFrameRows !== undefined
      ? [`result-rows ${view.dataFrameRows}`]
      : []),
    ...(view.dataFrameColumns !== undefined
      ? [`result-columns ${view.dataFrameColumns}`]
      : []),
    ...(view.dataFrameOutputBytes !== undefined
      ? [`output-bytes ${view.dataFrameOutputBytes}`]
      : []),
    ...hash("source", view.dataFrameSourceSha256),
    ...hash("plan", view.dataFramePlanSha256),
    ...hash("rows", view.dataFrameRowsSha256),
    ...hash("output", view.dataFrameOutputSha256),
    ...hash("engine", view.dataFrameEngineSha256),
  ];
}

function format(
  value: unknown,
): DataFrameToolEventTraceView["dataFrameSourceFormat"] {
  return value === "json" ||
    value === "jsonl" ||
    value === "csv" ||
    value === "tsv" ||
    value === "markdown_table"
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

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
