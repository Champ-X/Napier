import {
  parseStructuredDataSource,
  type WorkspaceDataFormat,
} from "./structured-data-parser.js";

export const MAX_STRUCTURED_DATA_SAMPLE_ROWS = 25;
export const MAX_STRUCTURED_DATA_COLUMNS = 80;
const MAX_STRUCTURED_DATA_CELL_BYTES = 4_096;

export type { WorkspaceDataFormat } from "./structured-data-parser.js";
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
  const parsed = parseStructuredDataSource(
    source,
    relativePath,
    requestedFormat,
    errorPrefix,
  );
  const columns = parsed.columns.slice(0, MAX_STRUCTURED_DATA_COLUMNS);
  const sampleRows = parsed.rows
    .slice(0, maxRows)
    .map((row) =>
      Object.fromEntries(
        columns.map((column, index) => [column, previewCell(row[index])]),
      ),
    );
  return {
    format: parsed.format,
    rowCount: parsed.rows.length,
    columnCount: parsed.columns.length,
    columns,
    sampleRows,
    truncated:
      parsed.rows.length > sampleRows.length ||
      parsed.columns.length > columns.length,
  };
}

function previewCell(value: unknown): WorkspaceDataCell {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") return truncatePreview(value);
  return truncatePreview(JSON.stringify(value));
}

function truncatePreview(value: string | undefined): string {
  const text = value ?? "";
  if (Buffer.byteLength(text) <= MAX_STRUCTURED_DATA_CELL_BYTES) return text;
  return `${Buffer.from(text).subarray(0, MAX_STRUCTURED_DATA_CELL_BYTES).toString("utf8")}...[truncated]`;
}
