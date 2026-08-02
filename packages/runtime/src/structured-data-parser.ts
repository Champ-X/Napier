import { canonicalJson, sha256 } from "./ed25519.js";

export type WorkspaceDataFormat =
  | "json"
  | "jsonl"
  | "csv"
  | "tsv"
  | "markdown_table";

export interface ParsedStructuredData {
  format: WorkspaceDataFormat;
  columns: string[];
  rows: unknown[][];
}

export const STRUCTURED_DATA_PARSER_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    formats: ["json", "jsonl", "csv", "tsv", "markdown_table"],
    jsonPolicy: "scalar-object-array-or-columns-rows-envelope",
    delimitedPolicy: "quoted-rfc4180-subset-with-unique-headers",
    markdownPolicy: "first-pipe-table-with-escaped-pipes",
    missingCellPolicy: "undefined-before-consumer-normalization",
    columnPolicy: "first-seen-json-or-complete-tabular-width",
  }),
);

export function parseStructuredDataSource(
  source: string,
  relativePath: string,
  requestedFormat: "auto" | WorkspaceDataFormat | undefined,
  errorPrefix = "inspect_data",
): ParsedStructuredData {
  const format = detectDataFormat(source, relativePath, requestedFormat);
  const table =
    format === "csv"
      ? parseDelimitedData(source, errorPrefix, ",", "CSV")
      : format === "tsv"
        ? parseDelimitedData(source, errorPrefix, "\t", "TSV")
        : format === "markdown_table"
          ? parseMarkdownTableData(source, errorPrefix)
          : format === "jsonl"
            ? parseJsonLinesData(source, errorPrefix)
            : parseJsonData(source, errorPrefix);
  return { format, ...table };
}

function detectDataFormat(
  source: string,
  relativePath: string,
  requestedFormat: "auto" | WorkspaceDataFormat | undefined,
): WorkspaceDataFormat {
  if (requestedFormat && requestedFormat !== "auto") return requestedFormat;
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) return "jsonl";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "markdown_table";
  }
  if (lower.endsWith(".tsv") || lower.endsWith(".tab")) return "tsv";
  if (lower.endsWith(".csv")) return "csv";
  const trimmed = source.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (findMarkdownTable(source)) return "markdown_table";
  const firstLine = trimmed.split(/\r?\n/u, 1)[0] ?? "";
  if (firstLine.includes("\t") && !firstLine.includes(",")) return "tsv";
  return "csv";
}

function parseJsonData(
  source: string,
  errorPrefix: string,
): Omit<ParsedStructuredData, "format"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${errorPrefix} JSON parse failed`);
  }
  const envelope = jsonTableEnvelope(parsed);
  if (envelope) return envelope;
  return normalizeRows(Array.isArray(parsed) ? parsed : [parsed]);
}

function parseJsonLinesData(
  source: string,
  errorPrefix: string,
): Omit<ParsedStructuredData, "format"> {
  const rows = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index): unknown => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(
          `${errorPrefix} JSONL parse failed at line ${index + 1}`,
        );
      }
    });
  return normalizeRows(rows);
}

function parseDelimitedData(
  source: string,
  errorPrefix: string,
  delimiter: "," | "\t",
  label: "CSV" | "TSV",
): Omit<ParsedStructuredData, "format"> {
  const parsed = parseDelimitedRows(source, errorPrefix, delimiter, label);
  if (parsed.length === 0) return { columns: [], rows: [] };
  const dataRows = parsed.slice(1);
  const columns = uniqueColumnNames(
    completeColumnValues(
      parsed[0]!,
      maxColumnWidth(parsed[0]!.length, dataRows),
    ),
  );
  return {
    columns,
    rows: dataRows.map((row) =>
      columns.map((_column, index) => row[index] ?? ""),
    ),
  };
}

function parseMarkdownTableData(
  source: string,
  errorPrefix: string,
): Omit<ParsedStructuredData, "format"> {
  const table = findMarkdownTable(source);
  if (!table) {
    throw new Error(`${errorPrefix} Markdown table not found`);
  }
  const columns = uniqueColumnNames(
    completeColumnValues(
      table.headers,
      maxColumnWidth(table.headers.length, table.rows),
    ),
  );
  return {
    columns,
    rows: table.rows.map((row) =>
      columns.map((_column, index) => row[index] ?? ""),
    ),
  };
}

function normalizeRows(rows: unknown[]): Omit<ParsedStructuredData, "format"> {
  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const column of rowColumns(row)) columnSet.add(column);
  }
  const columns = [...columnSet];
  return {
    columns,
    rows: rows.map((row) => projectRawRow(row, columns)),
  };
}

function projectRawRow(row: unknown, columns: string[]): unknown[] {
  if (Array.isArray(row)) {
    return columns.map((column) => {
      const index = arrayColumnIndex(column);
      return index === undefined ? undefined : row[index];
    });
  }
  if (isPlainRecord(row)) {
    return columns.map((column) => row[column]);
  }
  return columns.map((column) => (column === "value" ? row : undefined));
}

function rowColumns(row: unknown): string[] {
  if (Array.isArray(row)) {
    return row.map((_value, index) => arrayColumnName(index));
  }
  if (isPlainRecord(row)) return Object.keys(row);
  return ["value"];
}

function jsonTableEnvelope(
  value: unknown,
): Omit<ParsedStructuredData, "format"> | undefined {
  if (!isPlainRecord(value)) return undefined;
  const columnsValue = value["columns"];
  const rowsValue = Array.isArray(value["rows"])
    ? value["rows"]
    : Array.isArray(value["data"])
      ? value["data"]
      : undefined;
  if (!Array.isArray(columnsValue) || !rowsValue) return undefined;
  const completeColumnsValue = completeColumnValues(
    columnsValue,
    maxColumnWidth(columnsValue.length, rowsValue.filter(Array.isArray)),
  );
  const columns = uniqueColumnNames(completeColumnsValue);
  const sourceColumns = sourceColumnNames(completeColumnsValue);
  if (columns.length === 0) return undefined;
  return {
    columns,
    rows: rowsValue.map((row) => {
      if (Array.isArray(row)) {
        return columns.map((_column, index) => row[index]);
      }
      if (isPlainRecord(row)) {
        return columns.map((_column, index) => row[sourceColumns[index]!]);
      }
      return columns.map((_column, index) => (index === 0 ? row : undefined));
    }),
  };
}

function findMarkdownTable(
  source: string,
): { headers: string[]; rows: string[][] } | undefined {
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = splitMarkdownTableRow(lines[index]!);
    if (header.length === 0) continue;
    const separator = splitMarkdownTableRow(lines[index + 1]!);
    if (!isMarkdownSeparatorRow(separator)) continue;
    const rows: string[][] = [];
    for (const line of lines.slice(index + 2)) {
      if (line.trim().length === 0) break;
      const row = splitMarkdownTableRow(line);
      if (row.length === 0) break;
      rows.push(row);
    }
    return { headers: header, rows };
  }
  return undefined;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return [];
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|")) cells.pop();
  return cells;
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
  return (
    cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()))
  );
}

function parseDelimitedRows(
  source: string,
  errorPrefix: string,
  delimiter: "," | "\t",
  label: "CSV" | "TSV",
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      if (field.length !== 0) {
        throw new Error(`${errorPrefix} ${label} quote is invalid`);
      }
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (char === "\r") continue;
    field += char;
  }
  if (quoted) throw new Error(`${errorPrefix} ${label} quote is unterminated`);
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((candidate) =>
    candidate.some((fieldValue) => fieldValue.length > 0),
  );
}

function uniqueColumnNames(values: unknown[]): string[] {
  const used = new Set<string>();
  return values.map((value, index) => {
    const base =
      typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : arrayColumnName(index);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function completeColumnValues(values: unknown[], width: number): unknown[] {
  return Array.from({ length: width }, (_value, index) => values[index]);
}

function maxColumnWidth(headerWidth: number, rows: unknown[][]): number {
  return rows.reduce((width, row) => Math.max(width, row.length), headerWidth);
}

function sourceColumnNames(values: unknown[]): string[] {
  return values.map((value, index) =>
    typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : arrayColumnName(index),
  );
}

function arrayColumnName(index: number): string {
  return `column_${index + 1}`;
}

function arrayColumnIndex(column: string): number | undefined {
  const match = /^column_([1-9][0-9]*)$/u.exec(column);
  return match ? Number(match[1]) - 1 : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
