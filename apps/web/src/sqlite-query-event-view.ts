export interface SqliteQueryToolEventTraceView {
  sqliteQueryAction?: "schema" | "query";
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
}

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sqliteQueryEventEvidence(
  value: unknown,
): SqliteQueryToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const action =
    value["action"] === "schema" || value["action"] === "query"
      ? value["action"]
      : undefined;
  const databaseBytes = integer(value["databaseBytes"], 16, 64 * 1024 * 1024);
  const parameterCount = integer(value["parameterCount"], 0, 50);
  const columnCount = integer(value["columnCount"], 0, 80);
  const rowCount = integer(value["rowCount"], 0, 100);
  const durationMs = integer(value["durationMs"], 0, 6_000);
  if (
    value["kind"] !== "napier.sqlite-query" ||
    value["schemaVersion"] !== 1 ||
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
    ...(view.sqliteDurationMs !== undefined
      ? [`duration-ms ${view.sqliteDurationMs}`]
      : []),
    ...hash("database-path", view.sqliteDatabasePathSha256),
    ...hash("database", view.sqliteDatabaseSha256),
    ...hash("sql", view.sqliteSqlSha256),
    ...hash("runtime", view.sqliteRuntimeSha256),
    ...hash("sqlite-result", view.sqliteResultSha256),
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
