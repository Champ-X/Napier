export interface SqliteQueryToolEventTraceView {
  sqliteQueryAction?: "schema" | "query" | "chart";
  sqliteDatabasePathSha256?: string;
  sqliteDatabaseSha256?: string;
  sqliteDatabaseBytes?: number;
  sqliteSqlSha256?: string;
  sqliteParameterCount?: number;
  sqliteParameterSetSha256?: string;
  sqliteColumnCount?: number;
  sqliteRowCount?: number;
  sqliteResultTruncated?: boolean;
  sqliteColumnsSha256?: string;
  sqliteRowsSha256?: string;
  sqliteDurationMs?: number;
  sqliteWorkerSha256?: string;
  sqliteRuntimeSha256?: string;
  sqliteLimitsSha256?: string;
  sqliteResultSha256?: string;
  sqliteChartType?: "bar" | "line";
  sqliteChartPointCount?: number;
  sqliteChartWidth?: number;
  sqliteChartHeight?: number;
  sqliteChartSvgBytes?: number;
  sqliteChartSpecSha256?: string;
  sqliteChartSvgSha256?: string;
  sqliteChartRendererSha256?: string;
  sqliteChartLimitsSha256?: string;
  sqliteChartQueryResultSha256?: string;
}

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sqliteQueryEventEvidence(
  value: unknown,
): SqliteQueryToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action =
    value["action"] === "schema" ||
    value["action"] === "query" ||
    value["action"] === "chart"
      ? value["action"]
      : undefined;
  const databaseBytes = integer(value["databaseBytes"], 16, 64 * 1024 * 1024);
  const parameterCount = integer(value["parameterCount"], 0, 50);
  const columnCount = integer(value["columnCount"], 0, 80);
  const rowCount = integer(value["rowCount"], 0, 100);
  const durationMs = integer(value["durationMs"], 0, 6_000);
  const chartType =
    value["chartType"] === "bar" || value["chartType"] === "line"
      ? value["chartType"]
      : undefined;
  const chartPointCount = integer(value["pointCount"], 1, 50);
  const chartWidth = integer(value["width"], 480, 1_600);
  const chartHeight = integer(value["height"], 320, 1_000);
  const chartSvgBytes = integer(value["svgBytes"], 1, 48 * 1024);
  const chartReceipt =
    action === "chart" &&
    value["kind"] === "napier.sqlite-chart" &&
    value["schemaVersion"] === 1 &&
    chartType !== undefined &&
    chartPointCount !== undefined &&
    chartPointCount === rowCount &&
    chartWidth !== undefined &&
    chartHeight !== undefined &&
    chartSvgBytes !== undefined &&
    value["truncated"] === false &&
    sha256(value["chartSpecSha256"]) &&
    sha256(value["svgSha256"]) &&
    sha256(value["rendererSha256"]) &&
    sha256(value["chartLimitsSha256"]) &&
    sha256(value["queryResultSha256"]);
  const queryReceipt =
    action !== "chart" &&
    value["kind"] === "napier.sqlite-query" &&
    value["schemaVersion"] === 1;
  if (
    (!queryReceipt && !chartReceipt) ||
    !action ||
    !sha256(value["databasePathSha256"]) ||
    !sha256(value["databaseSha256"]) ||
    databaseBytes === undefined ||
    !sha256(value["sqlSha256"]) ||
    parameterCount === undefined ||
    !sha256(value["parameterSetSha256"]) ||
    columnCount === undefined ||
    rowCount === undefined ||
    typeof value["truncated"] !== "boolean" ||
    !sha256(value["columnsSha256"]) ||
    !sha256(value["rowsSha256"]) ||
    durationMs === undefined ||
    !sha256(value["workerSha256"]) ||
    !sha256(value["runtimeSha256"]) ||
    !sha256(value["limitsSha256"]) ||
    !sha256(value["resultSha256"]) ||
    (action === "schema" &&
      (value["sqlSha256"] !== EMPTY_SHA256 || parameterCount !== 0))
  ) {
    return undefined;
  }
  return {
    sqliteQueryAction: action,
    sqliteDatabasePathSha256: value["databasePathSha256"],
    sqliteDatabaseSha256: value["databaseSha256"],
    sqliteDatabaseBytes: databaseBytes,
    sqliteSqlSha256: value["sqlSha256"],
    sqliteParameterCount: parameterCount,
    sqliteParameterSetSha256: value["parameterSetSha256"],
    sqliteColumnCount: columnCount,
    sqliteRowCount: rowCount,
    sqliteResultTruncated: value["truncated"],
    sqliteColumnsSha256: value["columnsSha256"],
    sqliteRowsSha256: value["rowsSha256"],
    sqliteDurationMs: durationMs,
    sqliteWorkerSha256: value["workerSha256"],
    sqliteRuntimeSha256: value["runtimeSha256"],
    sqliteLimitsSha256: value["limitsSha256"],
    sqliteResultSha256: value["resultSha256"],
    ...(chartReceipt
      ? {
          sqliteChartType: chartType,
          sqliteChartPointCount: chartPointCount,
          sqliteChartWidth: chartWidth,
          sqliteChartHeight: chartHeight,
          sqliteChartSvgBytes: chartSvgBytes,
          sqliteChartSpecSha256: value["chartSpecSha256"] as string,
          sqliteChartSvgSha256: value["svgSha256"] as string,
          sqliteChartRendererSha256: value["rendererSha256"] as string,
          sqliteChartLimitsSha256: value["chartLimitsSha256"] as string,
          sqliteChartQueryResultSha256: value["queryResultSha256"] as string,
        }
      : {}),
  };
}

export function sqliteQuerySummaryParts(
  view: SqliteQueryToolEventTraceView,
): string[] {
  return [
    ...(view.sqliteQueryAction ? [`sqlite ${view.sqliteQueryAction}`] : []),
    ...(view.sqliteDatabaseBytes !== undefined
      ? [`database-bytes ${view.sqliteDatabaseBytes}`]
      : []),
    ...(view.sqliteParameterCount !== undefined
      ? [`parameters ${view.sqliteParameterCount}`]
      : []),
    ...(view.sqliteColumnCount !== undefined
      ? [`columns ${view.sqliteColumnCount}`]
      : []),
    ...(view.sqliteRowCount !== undefined
      ? [`rows ${view.sqliteRowCount}`]
      : []),
    ...(view.sqliteResultTruncated ? ["result-truncated"] : []),
    ...(view.sqliteChartType ? [`chart ${view.sqliteChartType}`] : []),
    ...(view.sqliteChartPointCount !== undefined
      ? [`chart-points ${view.sqliteChartPointCount}`]
      : []),
    ...(view.sqliteChartWidth !== undefined &&
    view.sqliteChartHeight !== undefined
      ? [`chart-size ${view.sqliteChartWidth}x${view.sqliteChartHeight}`]
      : []),
    ...(view.sqliteChartSvgBytes !== undefined
      ? [`svg-bytes ${view.sqliteChartSvgBytes}`]
      : []),
    ...(view.sqliteDurationMs !== undefined
      ? [`duration-ms ${view.sqliteDurationMs}`]
      : []),
    ...hash("database-path", view.sqliteDatabasePathSha256),
    ...hash("database", view.sqliteDatabaseSha256),
    ...hash("sql", view.sqliteSqlSha256),
    ...hash("runtime", view.sqliteRuntimeSha256),
    ...hash("sqlite-result", view.sqliteResultSha256),
    ...hash("chart-spec", view.sqliteChartSpecSha256),
    ...hash("svg", view.sqliteChartSvgSha256),
    ...hash("chart-renderer", view.sqliteChartRendererSha256),
  ];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
