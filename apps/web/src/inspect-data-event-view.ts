import {
  isStructuredDataFormat,
  structuredDataFormatLabel,
  type StructuredDataFormat,
} from "./structured-data-format-view";

export interface InspectDataToolEventTraceView {
  dataFormat?: StructuredDataFormat;
  dataRowCount?: number;
  dataColumnCount?: number;
  dataSizeBytes?: number;
  dataTruncated?: boolean;
  dataPathSha256?: string;
  dataFileSha256?: string;
  dataColumnSetSha256?: string;
  dataSampleSha256?: string;
}

export function inspectDataToolEventEvidence(
  toolName: string,
  value: unknown,
): InspectDataToolEventTraceView | undefined {
  return toolName === "inspect_data" ? inspectDataEvidence(value) : undefined;
}

export function inspectDataSummaryParts(
  view: InspectDataToolEventTraceView,
): string[] {
  return [
    ...(view.dataFormat
      ? [`data ${structuredDataFormatLabel(view.dataFormat)}`]
      : []),
    ...(view.dataRowCount !== undefined ? [`rows ${view.dataRowCount}`] : []),
    ...(view.dataColumnCount !== undefined
      ? [`columns ${view.dataColumnCount}`]
      : []),
    ...(view.dataSizeBytes !== undefined ? [`size ${view.dataSizeBytes}`] : []),
    ...(view.dataTruncated ? ["data-truncated"] : []),
    ...hash("data-path", view.dataPathSha256),
    ...hash("data-file", view.dataFileSha256),
    ...hash("column-set", view.dataColumnSetSha256),
    ...hash("sample", view.dataSampleSha256),
  ];
}

function inspectDataEvidence(
  value: unknown,
): InspectDataToolEventTraceView | undefined {
  if (!record(value)) return undefined;
  const format = isStructuredDataFormat(value["format"])
    ? value["format"]
    : undefined;
  const rowCount = integer(value["rowCount"], 0, 1_000_000);
  const columnCount = integer(value["columnCount"], 0, 1_000);
  if (!format || rowCount === undefined || columnCount === undefined) {
    return undefined;
  }
  const sizeBytes = integer(value["sizeBytes"], 0, 2 * 1024 * 1024);
  const pathSha256 = sha256(value["pathSha256"]);
  const fileSha256 = sha256(value["sha256"]);
  const columnSetSha256 = sha256(value["columnSetSha256"]);
  const sampleSha256 = sha256(value["sampleSha256"]);
  return {
    dataFormat: format,
    dataRowCount: rowCount,
    dataColumnCount: columnCount,
    ...(sizeBytes !== undefined ? { dataSizeBytes: sizeBytes } : {}),
    ...(value["truncated"] === true ? { dataTruncated: true } : {}),
    ...(pathSha256 ? { dataPathSha256: pathSha256 } : {}),
    ...(fileSha256 ? { dataFileSha256: fileSha256 } : {}),
    ...(columnSetSha256 ? { dataColumnSetSha256: columnSetSha256 } : {}),
    ...(sampleSha256 ? { dataSampleSha256: sampleSha256 } : {}),
  };
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

function sha256(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function hash(label: string, value: string | undefined): string[] {
  return value ? [`${label} ${value.slice(0, 12)}`] : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
