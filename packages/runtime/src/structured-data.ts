export const MAX_STRUCTURED_DATA_SAMPLE_ROWS = 25;
export const MAX_STRUCTURED_DATA_COLUMNS = 80;
const MAX_STRUCTURED_DATA_CELL_BYTES = 4_096;

export type WorkspaceDataFormat =
  | "json"
  | "jsonl"
  | "csv"
  | "tsv"
  | "markdown_table";
export type WorkspaceDataCell = string | number | boolean | null;

export interface WorkspaceStructuredDataInspection {
  format: WorkspaceDataFormat;
  rowCount: number;
  columnCount: number;
  columns: string[];
  sampleRows: Array<Record<string, WorkspaceDataCell>>;
  truncated: boolean;
}

export function inspectStructuredData(
  source: string,
  relativePath: string,
  requestedFormat: "auto" | WorkspaceDataFormat | undefined,
  maxRows: number,
  errorPrefix = "inspect_data",
): WorkspaceStructuredDataInspection {
  const format = detectDataFormat(source, relativePath, requestedFormat);
  const inspected =
    format === "csv"
      ? inspectDelimitedData(source, maxRows, errorPrefix, ",", "CSV")
      : format === "tsv"
        ? inspectDelimitedData(source, maxRows, errorPrefix, "\t", "TSV")
        : format === "markdown_table"
          ? inspectMarkdownTableData(source, maxRows, errorPrefix)
          : format === "jsonl"
            ? inspectJsonLinesData(source, maxRows, errorPrefix)
            : inspectJsonData(source, maxRows, errorPrefix);
  return { format, ...inspected };
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

function inspectJsonData(
  source: string,
  maxRows: number,
  errorPrefix: string,
): Omit<WorkspaceStructuredDataInspection, "format"> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${errorPrefix} JSON parse failed`);
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return inspectStructuredRows(rows, maxRows);
}

function inspectJsonLinesData(
  source: string,
  maxRows: number,
  errorPrefix: string,
): Omit<WorkspaceStructuredDataInspection, "format"> {
  const lines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows = lines.map((line, index): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`${errorPrefix} JSONL parse failed at line ${index + 1}`);
    }
  });
  return inspectStructuredRows(rows, maxRows);
}

function inspectDelimitedData(
  source: string,
  maxRows: number,
  errorPrefix: string,
  delimiter: "," | "\t",
  label: "CSV" | "TSV",
): Omit<WorkspaceStructuredDataInspection, "format"> {
  const rows = parseDelimitedRows(source, errorPrefix, delimiter, label);
  if (rows.length === 0) {
    return {
      rowCount: 0,
      columnCount: 0,
      columns: [],
      sampleRows: [],
      truncated: false,
    };
  }
  const headers = rows[0]!.map((value, index) =>
    value.trim().length > 0 ? value.trim() : `column_${index + 1}`,
  );
  const dataRows = rows.slice(1);
  const columns = headers.slice(0, MAX_STRUCTURED_DATA_COLUMNS);
  const sampleRows = dataRows
    .slice(0, maxRows)
    .map((row) =>
      Object.fromEntries(
        columns.map((column, index) => [column, previewCell(row[index] ?? "")]),
      ),
    );
  return {
    rowCount: dataRows.length,
    columnCount: headers.length,
    columns,
    sampleRows,
    truncated:
      dataRows.length > sampleRows.length || headers.length > columns.length,
  };
}

function inspectMarkdownTableData(
  source: string,
  maxRows: number,
  errorPrefix: string,
): Omit<WorkspaceStructuredDataInspection, "format"> {
  const table = findMarkdownTable(source);
  if (!table) {
    throw new Error(`${errorPrefix} Markdown table not found`);
  }
  const headers = table.headers.map((value, index) =>
    value.trim().length > 0 ? value.trim() : `column_${index + 1}`,
  );
  const columns = headers.slice(0, MAX_STRUCTURED_DATA_COLUMNS);
  const sampleRows = table.rows
    .slice(0, maxRows)
    .map((row) =>
      Object.fromEntries(
        columns.map((column, index) => [column, previewCell(row[index] ?? "")]),
      ),
    );
  return {
    rowCount: table.rows.length,
    columnCount: headers.length,
    columns,
    sampleRows,
    truncated:
      table.rows.length > sampleRows.length ||
      headers.length > columns.length,
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
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()))
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
    if (char === "\r") {
      continue;
    }
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

function inspectStructuredRows(
  rows: unknown[],
  maxRows: number,
): Omit<WorkspaceStructuredDataInspection, "format"> {
  const columnSet = new Set<string>();
  for (const row of rows) {
    for (const column of rowColumns(row)) {
      columnSet.add(column);
    }
  }
  const allColumns = [...columnSet];
  const columns = allColumns.slice(0, MAX_STRUCTURED_DATA_COLUMNS);
  const sampleRows = rows
    .slice(0, maxRows)
    .map((row) => projectStructuredRow(row, columns));
  return {
    rowCount: rows.length,
    columnCount: allColumns.length,
    columns,
    sampleRows,
    truncated:
      rows.length > sampleRows.length || allColumns.length > columns.length,
  };
}

function rowColumns(row: unknown): string[] {
  if (Array.isArray(row)) {
    return row.map((_, index) => arrayColumnName(index));
  }
  if (isPlainRecord(row)) return Object.keys(row);
  return ["value"];
}

function projectStructuredRow(
  row: unknown,
  columns: string[],
): Record<string, WorkspaceDataCell> {
  if (Array.isArray(row)) {
    return Object.fromEntries(
      columns.map((column) => {
        const index = arrayColumnIndex(column);
        return [
          column,
          index === undefined ? "" : previewCell(row[index]),
        ];
      }),
    );
  }
  if (!isPlainRecord(row)) {
    return { value: previewCell(row) };
  }
  return Object.fromEntries(
    columns.map((column) => [column, previewCell(row[column])]),
  );
}

function previewCell(value: unknown): WorkspaceDataCell {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return truncatePreview(value);
  }
  return truncatePreview(JSON.stringify(value));
}

function truncatePreview(value: string | undefined): string {
  const text = value ?? "";
  if (Buffer.byteLength(text) <= MAX_STRUCTURED_DATA_CELL_BYTES) return text;
  return `${Buffer.from(text).subarray(0, MAX_STRUCTURED_DATA_CELL_BYTES).toString("utf8")}...[truncated]`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arrayColumnName(index: number): string {
  return `column_${index + 1}`;
}

function arrayColumnIndex(column: string): number | undefined {
  const match = /^column_([1-9][0-9]*)$/u.exec(column);
  if (!match) return undefined;
  return Number(match[1]) - 1;
}
