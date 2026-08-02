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
  sqliteChartCategoryCount?: number;
  sqliteChartSeriesCount?: number;
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

interface SqliteChartReceipt {
  type: "bar" | "line";
  pointCount: number;
  categoryCount?: number;
  seriesCount?: number;
  width: number;
  height: number;
  svgBytes: number;
  chartSpecSha256: string;
  svgSha256: string;
  rendererSha256: string;
  chartLimitsSha256: string;
  queryResultSha256: string;
}

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
  const chartReceipt = sqliteChartReceipt(value, action, rowCount);
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
          sqliteChartType: chartReceipt.type,
          sqliteChartPointCount: chartReceipt.pointCount,
          ...(chartReceipt.categoryCount !== undefined
            ? { sqliteChartCategoryCount: chartReceipt.categoryCount }
            : {}),
          ...(chartReceipt.seriesCount !== undefined
            ? { sqliteChartSeriesCount: chartReceipt.seriesCount }
            : {}),
          sqliteChartWidth: chartReceipt.width,
          sqliteChartHeight: chartReceipt.height,
          sqliteChartSvgBytes: chartReceipt.svgBytes,
          sqliteChartSpecSha256: chartReceipt.chartSpecSha256,
          sqliteChartSvgSha256: chartReceipt.svgSha256,
          sqliteChartRendererSha256: chartReceipt.rendererSha256,
          sqliteChartLimitsSha256: chartReceipt.chartLimitsSha256,
          sqliteChartQueryResultSha256: chartReceipt.queryResultSha256,
        }
      : {}),
  };
}

function sqliteChartReceipt(
  value: Record<string, unknown>,
  action: "schema" | "query" | "chart" | undefined,
  rowCount: number | undefined,
): SqliteChartReceipt | undefined {
  if (
    action !== "chart" ||
    value["kind"] !== "napier.sqlite-chart" ||
    value["truncated"] !== false
  ) {
    return undefined;
  }
  const type =
    value["chartType"] === "bar" || value["chartType"] === "line"
      ? value["chartType"]
      : undefined;
  const pointCount = integer(value["pointCount"], 1, 200);
  const categoryCount = integer(value["categoryCount"], 1, 50);
  const seriesCount = integer(value["seriesCount"], 2, 6);
  const width = integer(value["width"], 480, 1_600);
  const height = integer(value["height"], 320, 1_000);
  const svgBytes = integer(value["svgBytes"], 1, 48 * 1024);
  if (
    !type ||
    pointCount === undefined ||
    width === undefined ||
    height === undefined ||
    svgBytes === undefined ||
    !validChartGeometry(value, rowCount, pointCount, categoryCount, seriesCount)
  ) {
    return undefined;
  }
  const digests = [
    value["chartSpecSha256"],
    value["svgSha256"],
    value["rendererSha256"],
    value["chartLimitsSha256"],
    value["queryResultSha256"],
  ];
  if (!digests.every(sha256)) return undefined;
  return {
    type,
    pointCount,
    ...(categoryCount !== undefined ? { categoryCount } : {}),
    ...(seriesCount !== undefined ? { seriesCount } : {}),
    width,
    height,
    svgBytes,
    chartSpecSha256: digests[0]!,
    svgSha256: digests[1]!,
    rendererSha256: digests[2]!,
    chartLimitsSha256: digests[3]!,
    queryResultSha256: digests[4]!,
  };
}

function validChartGeometry(
  value: Record<string, unknown>,
  rowCount: number | undefined,
  pointCount: number,
  categoryCount: number | undefined,
  seriesCount: number | undefined,
): boolean {
  if (value["schemaVersion"] === 1) {
    return (
      pointCount === rowCount &&
      value["categoryCount"] === undefined &&
      value["seriesCount"] === undefined
    );
  }
  return (
    value["schemaVersion"] === 2 &&
    categoryCount !== undefined &&
    categoryCount === rowCount &&
    seriesCount !== undefined &&
    pointCount === categoryCount * seriesCount
  );
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
    ...(view.sqliteChartCategoryCount !== undefined
      ? [`chart-categories ${view.sqliteChartCategoryCount}`]
      : []),
    ...(view.sqliteChartSeriesCount !== undefined
      ? [`chart-series ${view.sqliteChartSeriesCount}`]
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
