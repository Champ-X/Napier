import { sha256 } from "./ed25519.js";

export const MAX_SQLITE_QUERY_SQL_CHARS = 16 * 1024;
export const MAX_SQLITE_QUERY_PARAMETERS = 50;
export const MAX_SQLITE_QUERY_PARAMETER_CHARS = 4_096;
export const MAX_SQLITE_QUERY_ROWS = 100;
export const MAX_SQLITE_QUERY_COLUMNS = 80;
export const MAX_SQLITE_QUERY_CELL_CHARS = 2_048;
export const MAX_SQLITE_QUERY_OUTPUT_BYTES = 64 * 1024;
export const MAX_SQLITE_SCHEMA_OBJECTS = 50;
export const DEFAULT_SQLITE_QUERY_TIMEOUT_MS = 2_000;
export const MAX_SQLITE_QUERY_TIMEOUT_MS = 5_000;

export type SqliteQueryParameter = string | number | boolean | null;

const workerSource = String.raw`
const crypto = require("node:crypto");
const fs = require("node:fs");
const { DatabaseSync, constants } = require("node:sqlite");

const MAX_SQL_CHARS = ${MAX_SQLITE_QUERY_SQL_CHARS};
const MAX_PARAMETERS = ${MAX_SQLITE_QUERY_PARAMETERS};
const MAX_PARAMETER_CHARS = ${MAX_SQLITE_QUERY_PARAMETER_CHARS};
const MAX_ROWS = ${MAX_SQLITE_QUERY_ROWS};
const MAX_COLUMNS = ${MAX_SQLITE_QUERY_COLUMNS};
const MAX_CELL_CHARS = ${MAX_SQLITE_QUERY_CELL_CHARS};
const MAX_OUTPUT_BYTES = ${MAX_SQLITE_QUERY_OUTPUT_BYTES};
const MAX_SCHEMA_OBJECTS = ${MAX_SQLITE_SCHEMA_OBJECTS};
const DANGEROUS_FUNCTIONS = new Set([
  "format",
  "fts3_tokenizer",
  "group_concat",
  "hex",
  "json_group_array",
  "json_group_object",
  "load_extension",
  "printf",
  "randomblob",
  "readfile",
  "replace",
  "writefile",
  "zeroblob",
]);
const ALLOWED_ACTIONS = new Set([
  constants.SQLITE_FUNCTION,
  constants.SQLITE_READ,
  constants.SQLITE_RECURSIVE,
  constants.SQLITE_SELECT,
]);
const RUNTIME_SHA256 = crypto.createHash("sha256").update(JSON.stringify({
  arch: process.arch,
  node: process.versions.node,
  platform: process.platform,
  sqlite: process.versions.sqlite || "",
})).digest("hex");

function exactRecord(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validParameter(value) {
  return value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= MAX_PARAMETER_CHARS &&
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
}

function fail(code) {
  process.stdout.write(JSON.stringify({
    kind: "napier.sqlite-query-worker-result",
    schemaVersion: 1,
    status: "error",
    errorCode: code,
  }));
}

function visible(value, maximum) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function uniqueColumns(columns) {
  const used = new Set();
  return columns.map((column, index) => {
    const base = visible(column.name, 256) || "column_" + String(index + 1);
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = base + "_" + String(suffix++);
    used.add(name);
    return name;
  });
}

function previewCell(value) {
  if (value === null) return { value: null, truncated: false };
  if (typeof value === "bigint") {
    return { value: value.toString(), truncated: false };
  }
  if (typeof value === "number") {
    return {
      value: Number.isFinite(value) ? value : String(value),
      truncated: false,
    };
  }
  if (typeof value === "string") {
    return {
      value:
        value.length > MAX_CELL_CHARS
          ? value.slice(0, MAX_CELL_CHARS) + "..."
          : value,
      truncated: value.length > MAX_CELL_CHARS,
    };
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return {
      value:
        "<blob bytes=" + String(bytes.byteLength) +
        " sha256=" + crypto.createHash("sha256").update(bytes).digest("hex") + ">",
      truncated: false,
    };
  }
  const text = visible(value, MAX_CELL_CHARS);
  return {
    value: text,
    truncated: String(value ?? "").length > text.length,
  };
}

function quoteIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function boundedResult(action, columns, sourceRows, sourceTruncated) {
  const names = uniqueColumns(columns).slice(0, MAX_COLUMNS);
  const rows = [];
  let truncated = sourceTruncated || columns.length > names.length;
  for (const sourceRow of sourceRows) {
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const cells = Array.from(
      { length: names.length },
      (_, index) => previewCell(sourceRow[index]),
    );
    if (cells.some((cell) => cell.truncated)) truncated = true;
    const row = cells.map((cell) => cell.value);
    if (
      Buffer.byteLength(JSON.stringify({ columns: names, rows: [...rows, row] }), "utf8") >
      MAX_OUTPUT_BYTES
    ) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return { action, columns: names, rows, truncated };
}

function schemaResult(database) {
  const statement = database.prepare(
    "SELECT type, name FROM sqlite_schema " +
      "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' " +
      "ORDER BY type, name LIMIT ?",
  );
  const objects = statement.all(MAX_SCHEMA_OBJECTS + 1);
  const rows = [];
  let truncated = objects.length > MAX_SCHEMA_OBJECTS;
  for (const object of objects.slice(0, MAX_SCHEMA_OBJECTS)) {
    const target = database.prepare(
      "SELECT * FROM " + quoteIdentifier(object.name) + " LIMIT 0",
    );
    const columns = target.columns();
    const preview = columns
      .slice(0, MAX_COLUMNS)
      .map((column) => visible(column.name, 128) + ":" + visible(column.type || "untyped", 64))
      .join(", ");
    if (columns.length > MAX_COLUMNS || preview.length > MAX_CELL_CHARS) {
      truncated = true;
    }
    rows.push([
      visible(object.type, 16),
      visible(object.name, 256),
      columns.length,
      preview,
    ]);
  }
  return boundedResult(
    "schema",
    [{ name: "type" }, { name: "name" }, { name: "column_count" }, { name: "columns" }],
    rows,
    truncated,
  );
}

function queryResult(database, request) {
  const statement = database.prepare(request.sql);
  if (
    !request.sql.startsWith(statement.sourceSQL) ||
    request.sql.slice(statement.sourceSQL.length).trim()
  ) {
    throw Object.assign(new Error("multiple statements"), { napierCode: "multiple_statements" });
  }
  const columns = statement.columns();
  if (columns.length === 0) {
    throw Object.assign(new Error("no result columns"), { napierCode: "not_select" });
  }
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  const parameters = request.params.map((value) =>
    typeof value === "boolean" ? (value ? 1 : 0) : value,
  );
  const rows = [];
  let truncated = false;
  for (const row of statement.iterate(...parameters)) {
    if (rows.length >= request.maxRows) {
      truncated = true;
      break;
    }
    rows.push(row);
  }
  return boundedResult("query", columns, rows, truncated);
}

let workerData;
try {
  workerData = JSON.parse(fs.readFileSync(0, "utf8"));
} catch {
  workerData = null;
}

if (
  !exactRecord(workerData, ["action", "databasePath", "maxRows", "params", "sql"]) ||
  (workerData.action !== "schema" && workerData.action !== "query") ||
  typeof workerData.databasePath !== "string" ||
  !workerData.databasePath ||
  !Number.isSafeInteger(workerData.maxRows) ||
  workerData.maxRows < 1 ||
  workerData.maxRows > MAX_ROWS ||
  !Array.isArray(workerData.params) ||
  workerData.params.length > MAX_PARAMETERS ||
  workerData.params.some((value) => !validParameter(value)) ||
  (workerData.action === "query" &&
    (typeof workerData.sql !== "string" ||
      !workerData.sql.trim() ||
      workerData.sql.length > MAX_SQL_CHARS)) ||
  (workerData.action === "schema" && workerData.sql !== "")
) {
  fail("invalid_request");
} else {
  let database;
  let denied = false;
  const startedAt = Date.now();
  try {
    database = new DatabaseSync(workerData.databasePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: false,
      readBigInts: true,
      readOnly: true,
      timeout: 0,
    });
    if (
      typeof database.setAuthorizer !== "function" ||
      typeof database.enableDefensive !== "function"
    ) {
      throw Object.assign(new Error("unsupported runtime"), {
        napierCode: "unsupported_runtime",
      });
    }
    database.enableDefensive(true);
    database.setAuthorizer((actionCode, _arg1, arg2, databaseName) => {
      if (
        !ALLOWED_ACTIONS.has(actionCode) ||
        (databaseName !== null && databaseName !== "main") ||
        (actionCode === constants.SQLITE_FUNCTION &&
          DANGEROUS_FUNCTIONS.has(String(arg2 || "").toLowerCase()))
      ) {
        denied = true;
        return constants.SQLITE_DENY;
      }
      return constants.SQLITE_OK;
    });
    const result =
      workerData.action === "schema"
        ? schemaResult(database)
        : queryResult(database, workerData);
    process.stdout.write(JSON.stringify({
      kind: "napier.sqlite-query-worker-result",
      schemaVersion: 1,
      status: "ok",
      durationMs: Date.now() - startedAt,
      runtimeSha256: RUNTIME_SHA256,
      result,
    }));
  } catch (error) {
    fail(
      denied
        ? "operation_denied"
        : error && error.napierCode
          ? error.napierCode
          : "query_failed",
    );
  } finally {
    if (database) {
      try {
        database.close();
      } catch {}
    }
  }
}
`;

export const SQLITE_QUERY_WORKER_SOURCE = workerSource;
export const SQLITE_QUERY_WORKER_SHA256 = sha256(workerSource);
