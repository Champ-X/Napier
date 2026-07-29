export type StructuredDataFormat =
  | "json"
  | "jsonl"
  | "csv"
  | "tsv"
  | "markdown_table";

export function structuredDataFormatLabel(format: string): string {
  return isStructuredDataFormat(format)
    ? STRUCTURED_DATA_FORMAT_LABELS[format]
    : format;
}

export function isStructuredDataFormat(
  value: unknown,
): value is StructuredDataFormat {
  return (
    value === "json" ||
    value === "jsonl" ||
    value === "csv" ||
    value === "tsv" ||
    value === "markdown_table"
  );
}

const STRUCTURED_DATA_FORMAT_LABELS: Record<StructuredDataFormat, string> = {
  json: "JSON",
  jsonl: "JSONL",
  csv: "CSV",
  tsv: "TSV",
  markdown_table: "Markdown table",
};
