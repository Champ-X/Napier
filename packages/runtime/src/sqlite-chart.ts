import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_SQLITE_CHART_POINTS,
  SQLITE_CHART_LIMITS_SHA256,
  SQLITE_CHART_RENDERER_SHA256,
  normalizeSqliteChartSpec,
  renderSqliteChart,
  type MultiSeriesSqliteChartSpec,
  type NormalizedSqliteChartSpec,
  type SqliteChartRequestSpec,
  type SqliteChartSpec,
} from "./sqlite-chart-renderer.js";
import { executeSqliteQuery, type SqliteQueryResult } from "./sqlite-query.js";
import type { SqliteQueryParameter } from "./sqlite-query-worker.js";

interface SqliteChartRequestBase {
  action: "chart";
  path: string;
  databaseSha256: string;
  sql: string;
  params?: SqliteQueryParameter[];
  maxRows?: number;
  timeoutMs?: number;
}

export interface SqliteChartRequest extends SqliteChartRequestBase {
  chart: SqliteChartSpec;
}

export interface MultiSeriesSqliteChartRequest extends SqliteChartRequestBase {
  chart: MultiSeriesSqliteChartSpec;
}

export interface SqliteChartExecutionRequest extends SqliteChartRequestBase {
  chart: SqliteChartRequestSpec;
}

export interface SqliteChartResult extends Omit<
  SqliteQueryResult,
  "action" | "resultSha256"
> {
  action: "chart";
  chart: NormalizedSqliteChartSpec;
  pointCount: number;
  categoryCount: number;
  seriesCount: number;
  svg: string;
  svgSha256: string;
  svgBytes: number;
  chartSpecSha256: string;
  rendererSha256: string;
  chartLimitsSha256: string;
  queryResultSha256: string;
  resultSha256: string;
}

export async function executeSqliteChart(
  workspaceRoot: string,
  request: SqliteChartExecutionRequest,
  signal?: AbortSignal,
): Promise<SqliteChartResult> {
  const normalized = normalizeChartRequest(request);
  signal?.throwIfAborted();
  const query = await executeSqliteQuery(
    workspaceRoot,
    {
      action: "query",
      path: normalized.path,
      databaseSha256: normalized.databaseSha256,
      sql: normalized.sql,
      params: normalized.params,
      maxRows: normalized.maxRows,
      ...(normalized.timeoutMs !== undefined
        ? { timeoutMs: normalized.timeoutMs }
        : {}),
    },
    signal,
  );
  if (query.truncated) {
    throw new Error("SQLite chart requires a complete query result");
  }
  signal?.throwIfAborted();
  const rendered = renderSqliteChart(
    normalized.chart,
    query.columns,
    query.rows,
  );
  const chartSpecSha256 = sha256(canonicalJson(rendered.spec));
  const resultContent = {
    action: "chart",
    queryResultSha256: query.resultSha256,
    databasePathSha256: query.database.pathSha256,
    databaseSha256: query.database.fileSha256,
    columnCount: query.columns.length,
    rowCount: query.rows.length,
    columnsSha256: sha256(canonicalJson(query.columns)),
    rowsSha256: sha256(canonicalJson(query.rows)),
    chartSpecSha256,
    pointCount: rendered.points.length,
    categoryCount: rendered.categoryCount,
    seriesCount: rendered.seriesCount,
    svgSha256: rendered.svgSha256,
    svgBytes: rendered.svgBytes,
    rendererSha256: SQLITE_CHART_RENDERER_SHA256,
    chartLimitsSha256: SQLITE_CHART_LIMITS_SHA256,
  };
  return {
    action: "chart",
    database: query.database,
    columns: query.columns,
    rows: query.rows,
    truncated: false,
    durationMs: query.durationMs,
    workerSha256: query.workerSha256,
    runtimeSha256: query.runtimeSha256,
    limitsSha256: query.limitsSha256,
    chart: rendered.spec,
    pointCount: rendered.points.length,
    categoryCount: rendered.categoryCount,
    seriesCount: rendered.seriesCount,
    svg: rendered.svg,
    svgSha256: rendered.svgSha256,
    svgBytes: rendered.svgBytes,
    chartSpecSha256,
    rendererSha256: SQLITE_CHART_RENDERER_SHA256,
    chartLimitsSha256: SQLITE_CHART_LIMITS_SHA256,
    queryResultSha256: query.resultSha256,
    resultSha256: sha256(canonicalJson(resultContent)),
  };
}

function normalizeChartRequest(request: SqliteChartExecutionRequest): {
  path: string;
  databaseSha256: string;
  sql: string;
  params: SqliteQueryParameter[];
  maxRows: number;
  timeoutMs: number | undefined;
  chart: SqliteChartRequestSpec;
} {
  if (
    !record(request) ||
    !exactKeys(request, [
      "action",
      "path",
      "databaseSha256",
      "sql",
      "params",
      "maxRows",
      "timeoutMs",
      "chart",
    ]) ||
    request.action !== "chart" ||
    typeof request.path !== "string" ||
    !request.path ||
    request.path.length > 500 ||
    typeof request.databaseSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(request.databaseSha256) ||
    typeof request.sql !== "string" ||
    !request.sql.trim() ||
    !Array.isArray(request.params ?? [])
  ) {
    throw new Error("SQLite chart request is invalid");
  }
  const maxRows = request.maxRows ?? 25;
  if (
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > MAX_SQLITE_CHART_POINTS
  ) {
    throw new Error("SQLite chart maxRows must be between 1 and 50");
  }
  normalizeSqliteChartSpec(request.chart);
  return {
    path: request.path,
    databaseSha256: request.databaseSha256,
    sql: request.sql,
    params: request.params ?? [],
    maxRows,
    timeoutMs: request.timeoutMs,
    chart: structuredClone(request.chart),
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
