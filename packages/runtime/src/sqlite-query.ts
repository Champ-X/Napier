import { constants as fsConstants } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertSqliteDatabaseCurrent,
  hashSqliteSnapshotFile,
  inspectSqliteDatabase,
  MAX_SQLITE_DATABASE_BYTES,
  type SqliteDatabaseSnapshot,
} from "./sqlite-database-file.js";
import {
  DEFAULT_SQLITE_QUERY_TIMEOUT_MS,
  MAX_SQLITE_QUERY_CELL_CHARS,
  MAX_SQLITE_QUERY_COLUMNS,
  MAX_SQLITE_QUERY_PARAMETERS,
  MAX_SQLITE_QUERY_PARAMETER_CHARS,
  MAX_SQLITE_QUERY_ROWS,
  MAX_SQLITE_QUERY_SQL_CHARS,
  MAX_SQLITE_QUERY_TIMEOUT_MS,
  type SqliteQueryParameter,
  SQLITE_QUERY_WORKER_SHA256,
  SQLITE_QUERY_WORKER_SOURCE,
} from "./sqlite-query-worker.js";

export const MAX_ACTIVE_SQLITE_QUERY_PROCESSES = 4;
export const SQLITE_QUERY_LIMITS_SHA256 = sha256(
  canonicalJson({
    maxActiveProcesses: MAX_ACTIVE_SQLITE_QUERY_PROCESSES,
    maxDatabaseBytes: MAX_SQLITE_DATABASE_BYTES,
    maxSqlChars: MAX_SQLITE_QUERY_SQL_CHARS,
    maxParameters: MAX_SQLITE_QUERY_PARAMETERS,
    maxParameterChars: MAX_SQLITE_QUERY_PARAMETER_CHARS,
    maxRows: MAX_SQLITE_QUERY_ROWS,
    maxTimeoutMs: MAX_SQLITE_QUERY_TIMEOUT_MS,
    databaseMode: "copied_static_snapshot",
    sqliteMode: "read_only_authorizer",
    extensions: "disabled",
    sidecars: "rejected",
    processEnvironment: "private_snapshot_tmpdir_only",
  }),
);

export type SqliteQueryRequest =
  | { action: "schema"; path: string }
  | {
      action: "query";
      path: string;
      databaseSha256: string;
      sql: string;
      params?: SqliteQueryParameter[];
      maxRows?: number;
      timeoutMs?: number;
    };

export type SqliteQueryCell = string | number | null;

export interface SqliteQueryResult {
  action: SqliteQueryRequest["action"];
  database: SqliteDatabaseSnapshot;
  columns: string[];
  rows: SqliteQueryCell[][];
  truncated: boolean;
  durationMs: number;
  workerSha256: string;
  runtimeSha256: string;
  limitsSha256: string;
  resultSha256: string;
}

interface WorkerResult {
  action: SqliteQueryRequest["action"];
  columns: string[];
  rows: SqliteQueryCell[][];
  truncated: boolean;
  durationMs: number;
  runtimeSha256: string;
}

const MAX_WORKER_STDOUT_BYTES = 128 * 1024;
let activeProcesses = 0;

export async function executeSqliteQuery(
  workspaceRoot: string,
  request: SqliteQueryRequest,
  signal?: AbortSignal,
): Promise<SqliteQueryResult> {
  const normalized = normalizeRequest(request);
  assertNotAborted(signal);
  const database = await inspectSqliteDatabase(workspaceRoot, request.path);
  if (
    normalized.action === "query" &&
    normalized.databaseSha256 !== database.fileSha256
  ) {
    throw new Error("SQLite database does not match databaseSha256");
  }
  const runtimeRoot = await mkdtemp(
    path.join(tmpdir(), "napier-sqlite-query-"),
  );
  const snapshotPath = path.join(runtimeRoot, "database.sqlite");
  try {
    await copyFile(database.target, snapshotPath, fsConstants.COPYFILE_EXCL);
    await chmod(snapshotPath, 0o400);
    const copied = await hashSqliteSnapshotFile(snapshotPath);
    if (
      copied.fileSha256 !== database.fileSha256 ||
      copied.fileBytes !== database.fileBytes
    ) {
      throw new Error("SQLite database changed while creating query snapshot");
    }
    assertNotAborted(signal);
    const workerResult = await runSqliteWorker(
      snapshotPath,
      normalized,
      signal,
    );
    if (workerResult.action !== normalized.action) {
      throw new Error("SQLite query worker returned invalid evidence");
    }
    await assertSqliteDatabaseCurrent(database);
    const resultContent = {
      action: workerResult.action,
      databasePathSha256: database.pathSha256,
      databaseSha256: database.fileSha256,
      databaseBytes: database.fileBytes,
      sqlSha256: sha256(normalized.sql),
      parameterCount: normalized.params.length,
      parameterSetSha256: sha256(canonicalJson(normalized.params)),
      maxRows: normalized.maxRows,
      timeoutMs: normalized.timeoutMs,
      columnCount: workerResult.columns.length,
      rowCount: workerResult.rows.length,
      columnsSha256: sha256(canonicalJson(workerResult.columns)),
      rowsSha256: sha256(canonicalJson(workerResult.rows)),
      truncated: workerResult.truncated,
      durationMs: workerResult.durationMs,
      workerSha256: SQLITE_QUERY_WORKER_SHA256,
      runtimeSha256: workerResult.runtimeSha256,
      limitsSha256: SQLITE_QUERY_LIMITS_SHA256,
    };
    return {
      action: workerResult.action,
      database,
      columns: workerResult.columns,
      rows: workerResult.rows,
      truncated: workerResult.truncated,
      durationMs: workerResult.durationMs,
      workerSha256: SQLITE_QUERY_WORKER_SHA256,
      runtimeSha256: workerResult.runtimeSha256,
      limitsSha256: SQLITE_QUERY_LIMITS_SHA256,
      resultSha256: sha256(canonicalJson(resultContent)),
    };
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

function normalizeRequest(request: SqliteQueryRequest): {
  action: SqliteQueryRequest["action"];
  sql: string;
  params: SqliteQueryParameter[];
  maxRows: number;
  timeoutMs: number;
  databaseSha256?: string;
} {
  if (request.action === "schema") {
    return {
      action: "schema",
      sql: "",
      params: [],
      maxRows: MAX_SQLITE_QUERY_ROWS,
      timeoutMs: DEFAULT_SQLITE_QUERY_TIMEOUT_MS,
    };
  }
  const sql = request.sql.trim();
  const params = request.params ?? [];
  const maxRows = request.maxRows ?? 25;
  const timeoutMs = request.timeoutMs ?? DEFAULT_SQLITE_QUERY_TIMEOUT_MS;
  if (
    !/^[a-f0-9]{64}$/u.test(request.databaseSha256) ||
    !sql ||
    sql.length > MAX_SQLITE_QUERY_SQL_CHARS ||
    params.length > MAX_SQLITE_QUERY_PARAMETERS ||
    params.some((value) => !validParameter(value)) ||
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > MAX_SQLITE_QUERY_ROWS ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_SQLITE_QUERY_TIMEOUT_MS
  ) {
    throw new Error("SQLite query request is invalid");
  }
  return {
    action: "query",
    databaseSha256: request.databaseSha256,
    sql,
    params: structuredClone(params),
    maxRows,
    timeoutMs,
  };
}

function validParameter(value: SqliteQueryParameter): boolean {
  return (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" &&
      value.length <= MAX_SQLITE_QUERY_PARAMETER_CHARS &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))
  );
}

async function runSqliteWorker(
  databasePath: string,
  request: ReturnType<typeof normalizeRequest>,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  if (activeProcesses >= MAX_ACTIVE_SQLITE_QUERY_PROCESSES) {
    throw new Error("SQLite query process limit reached");
  }
  assertNotAborted(signal);
  activeProcesses += 1;
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=64", "-e", SQLITE_QUERY_WORKER_SOURCE],
    {
      cwd: path.dirname(databasePath),
      env: { TMPDIR: path.dirname(databasePath) },
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  try {
    const result = waitForWorker(child, request.timeoutMs, signal);
    child.stdin?.on("error", () => undefined);
    child.stdin.end(
      JSON.stringify({
        action: request.action,
        databasePath,
        maxRows: request.maxRows,
        params: request.params,
        sql: request.sql,
      }),
    );
    return await result;
  } finally {
    activeProcesses -= 1;
    await terminateWorker(child);
  }
}

function waitForWorker(
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = Buffer.alloc(0);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      child.removeAllListeners();
      child.stdout?.removeAllListeners();
      callback();
    };
    const onAbort = () =>
      settle(() => reject(new Error("SQLite query was cancelled")));
    const timeout = setTimeout(
      () => settle(() => reject(new Error("SQLite query timed out"))),
      timeoutMs,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.byteLength > MAX_WORKER_STDOUT_BYTES) {
        settle(() =>
          reject(new Error("SQLite query worker returned invalid evidence")),
        );
      }
    });
    child.once("error", () =>
      settle(() => reject(new Error("SQLite query worker failed"))),
    );
    child.once("exit", (code, workerSignal) =>
      settle(() => {
        if (code !== 0 || workerSignal || stdout.byteLength === 0) {
          reject(new Error("SQLite query worker failed"));
          return;
        }
        try {
          resolve(
            parseWorkerResult(
              JSON.parse(stdout.toString("utf8")) as unknown,
              timeoutMs,
            ),
          );
        } catch (error) {
          reject(error);
        }
      }),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function terminateWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 1_000).unref();
  });
}

function parseWorkerResult(value: unknown, timeoutMs: number): WorkerResult {
  if (!record(value) || value["kind"] !== "napier.sqlite-query-worker-result") {
    throw new Error("SQLite query worker returned invalid evidence");
  }
  if (value["status"] === "error") {
    const code = value["errorCode"];
    if (
      !exactRecord(value, ["kind", "schemaVersion", "status", "errorCode"]) ||
      value["schemaVersion"] !== 1 ||
      ![
        "invalid_request",
        "multiple_statements",
        "not_select",
        "operation_denied",
        "query_failed",
        "unsupported_runtime",
      ].includes(String(code))
    ) {
      throw new Error("SQLite query worker returned invalid evidence");
    }
    throw new Error(
      code === "operation_denied"
        ? "SQLite query operation is not read-only"
        : code === "multiple_statements"
          ? "SQLite query must contain one statement"
          : code === "not_select"
            ? "SQLite query must return rows"
            : code === "unsupported_runtime"
              ? "SQLite query requires Node.js 24.12 or newer"
              : code === "invalid_request"
                ? "SQLite query worker rejected the request"
                : "SQLite query failed",
    );
  }
  const result = record(value["result"]) ? value["result"] : undefined;
  const durationMs = integer(value["durationMs"], 0, timeoutMs + 1_000);
  const runtimeSha256 = value["runtimeSha256"];
  const columns =
    result && Array.isArray(result["columns"]) ? result["columns"] : undefined;
  const rows =
    result && Array.isArray(result["rows"]) ? result["rows"] : undefined;
  if (
    !exactRecord(value, [
      "kind",
      "schemaVersion",
      "status",
      "durationMs",
      "runtimeSha256",
      "result",
    ]) ||
    value["schemaVersion"] !== 1 ||
    value["status"] !== "ok" ||
    !result ||
    !exactRecord(result, ["action", "columns", "rows", "truncated"]) ||
    (result["action"] !== "schema" && result["action"] !== "query") ||
    !columns ||
    columns.length > MAX_SQLITE_QUERY_COLUMNS ||
    columns.some(
      (column) => typeof column !== "string" || column.length > 256,
    ) ||
    !rows ||
    rows.length > MAX_SQLITE_QUERY_ROWS ||
    rows.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== columns.length ||
        row.some((cell) => !validCell(cell)),
    ) ||
    typeof result["truncated"] !== "boolean" ||
    durationMs === undefined ||
    !sha256Value(runtimeSha256)
  ) {
    throw new Error("SQLite query worker returned invalid evidence");
  }
  return {
    action: result["action"],
    columns: [...columns] as string[],
    rows: rows.map((row) => [...(row as SqliteQueryCell[])]),
    truncated: result["truncated"],
    durationMs,
    runtimeSha256,
  };
}

function validCell(value: unknown): value is SqliteQueryCell {
  return (
    value === null ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" &&
      value.length <= MAX_SQLITE_QUERY_CELL_CHARS + 3)
  );
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

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactRecord(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function sha256Value(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("SQLite query was cancelled");
}
