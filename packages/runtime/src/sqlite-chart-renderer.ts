import { canonicalJson, sha256 } from "./ed25519.js";
import {
  renderSqliteChartSvg,
  SQLITE_CHART_SVG_POLICY,
  type SqliteChartSvgSeries,
} from "./sqlite-chart-svg.js";
import type { SqliteQueryCell } from "./sqlite-query.js";

export const MAX_SQLITE_CHART_POINTS = 50;
export const MAX_SQLITE_CHART_SERIES = 6;
export const MAX_SQLITE_CHART_TOTAL_POINTS = 200;
export const MAX_SQLITE_CHART_LABEL_CHARS = 80;
export const MAX_SQLITE_CHART_SERIES_LABEL_CHARS = 20;
export const MAX_SQLITE_CHART_TITLE_CHARS = 160;
export const MAX_SQLITE_CHART_SVG_BYTES = 48 * 1024;
export const MIN_SQLITE_CHART_WIDTH = 480;
export const MAX_SQLITE_CHART_WIDTH = 1_600;
export const MIN_SQLITE_CHART_HEIGHT = 320;
export const MAX_SQLITE_CHART_HEIGHT = 1_000;
export const DEFAULT_SQLITE_CHART_WIDTH = 960;
export const DEFAULT_SQLITE_CHART_HEIGHT = 540;

const NUMERIC_TEXT = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;

const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const UNSAFE_TEXT_PRESENT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export type SqliteChartType = "bar" | "line";

interface SqliteChartPresentation {
  type: SqliteChartType;
  xColumn: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  width?: number;
  height?: number;
}

export interface SqliteChartSpec extends SqliteChartPresentation {
  yColumn: string;
}

export interface MultiSeriesSqliteChartSpec extends SqliteChartPresentation {
  yColumns: string[];
}

export type SqliteChartRequestSpec =
  | SqliteChartSpec
  | MultiSeriesSqliteChartSpec;

export interface NormalizedSqliteChartSpec {
  type: SqliteChartType;
  xColumn: string;
  yColumn: string;
  yColumns: string[];
  title: string;
  xLabel: string;
  yLabel: string;
  width: number;
  height: number;
}

export interface SqliteChartPoint {
  label: string;
  value: number;
}

export interface RenderedSqliteChart {
  spec: NormalizedSqliteChartSpec;
  points: SqliteChartPoint[];
  categoryCount: number;
  seriesCount: number;
  svg: string;
  svgSha256: string;
  svgBytes: number;
}

export const SQLITE_CHART_RENDERER_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 2,
    svg: SQLITE_CHART_SVG_POLICY,
  }),
);

export const SQLITE_CHART_LIMITS_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 2,
    maxCategories: MAX_SQLITE_CHART_POINTS,
    maxSeries: MAX_SQLITE_CHART_SERIES,
    maxTotalPoints: MAX_SQLITE_CHART_TOTAL_POINTS,
    maxLabelChars: MAX_SQLITE_CHART_LABEL_CHARS,
    maxSeriesLabelChars: MAX_SQLITE_CHART_SERIES_LABEL_CHARS,
    maxTitleChars: MAX_SQLITE_CHART_TITLE_CHARS,
    maxSvgBytes: MAX_SQLITE_CHART_SVG_BYTES,
    width: [MIN_SQLITE_CHART_WIDTH, MAX_SQLITE_CHART_WIDTH],
    height: [MIN_SQLITE_CHART_HEIGHT, MAX_SQLITE_CHART_HEIGHT],
    chartTypes: ["bar", "line"],
    yValues: "finite-number-or-canonical-numeric-string",
  }),
);

export function normalizeSqliteChartSpec(
  input: SqliteChartRequestSpec,
): NormalizedSqliteChartSpec {
  if (
    !record(input) ||
    !exactKeys(input, [
      "type",
      "xColumn",
      "yColumn",
      "yColumns",
      "title",
      "xLabel",
      "yLabel",
      "width",
      "height",
    ]) ||
    (input.type !== "bar" && input.type !== "line")
  ) {
    throw new Error("SQLite chart specification is invalid");
  }
  const xColumn = boundedText(
    input.xColumn,
    256,
    "SQLite chart X column is invalid",
  );
  const yColumns = normalizeYColumns(input);
  const yColumn = yColumns[0]!;
  if (yColumns.includes(xColumn)) {
    throw new Error("SQLite chart X and Y columns must differ");
  }
  const title = optionalText(
    input.title,
    yColumns.length === 1
      ? `${yColumn} by ${xColumn}`
      : `${yColumns.length} series by ${xColumn}`,
    MAX_SQLITE_CHART_TITLE_CHARS,
  );
  const xLabel = optionalText(
    input.xLabel,
    xColumn,
    MAX_SQLITE_CHART_LABEL_CHARS,
  );
  const yLabel = optionalText(
    input.yLabel,
    yColumns.length === 1 ? yColumn : "Value",
    MAX_SQLITE_CHART_LABEL_CHARS,
  );
  const width = input.width ?? DEFAULT_SQLITE_CHART_WIDTH;
  const height = input.height ?? DEFAULT_SQLITE_CHART_HEIGHT;
  if (
    !Number.isSafeInteger(width) ||
    width < MIN_SQLITE_CHART_WIDTH ||
    width > MAX_SQLITE_CHART_WIDTH ||
    !Number.isSafeInteger(height) ||
    height < MIN_SQLITE_CHART_HEIGHT ||
    height > MAX_SQLITE_CHART_HEIGHT
  ) {
    throw new Error("SQLite chart dimensions are invalid");
  }
  return {
    type: input.type,
    xColumn,
    yColumn,
    yColumns,
    title,
    xLabel,
    yLabel,
    width,
    height,
  };
}

export function renderSqliteChart(
  specInput: SqliteChartRequestSpec,
  columns: string[],
  rows: SqliteQueryCell[][],
): RenderedSqliteChart {
  const spec = normalizeSqliteChartSpec(specInput);
  if (rows.length < 1 || rows.length > MAX_SQLITE_CHART_POINTS) {
    throw new Error("SQLite chart requires 1-50 complete rows");
  }
  if (rows.length * spec.yColumns.length > MAX_SQLITE_CHART_TOTAL_POINTS) {
    throw new Error("SQLite chart exceeds the 200-point series limit");
  }
  const xIndex = uniqueColumnIndex(columns, spec.xColumn);
  const labels = rows.map((row) => chartLabel(row[xIndex]));
  if (new Set(labels).size !== labels.length) {
    throw new Error("SQLite chart X values must be unique");
  }
  const series: SqliteChartSvgSeries[] = spec.yColumns.map((name) => {
    const yIndex = uniqueColumnIndex(columns, name);
    return {
      name,
      points: rows.map((row, index) => ({
        label: labels[index]!,
        value: chartNumber(row[yIndex]),
      })),
    };
  });
  const points = series.flatMap((candidate) => candidate.points);
  const svg = renderSqliteChartSvg(spec, series);
  const svgBytes = Buffer.byteLength(svg, "utf8");
  if (svgBytes > MAX_SQLITE_CHART_SVG_BYTES) {
    throw new Error("SQLite chart SVG exceeds the output limit");
  }
  return {
    spec,
    points,
    categoryCount: rows.length,
    seriesCount: series.length,
    svg,
    svgSha256: sha256(svg),
    svgBytes,
  };
}

function normalizeYColumns(input: SqliteChartRequestSpec): string[] {
  const yColumn = "yColumn" in input ? input.yColumn : undefined;
  const yColumns = "yColumns" in input ? input.yColumns : undefined;
  const hasSingle = yColumn !== undefined;
  const hasMultiple = yColumns !== undefined;
  if (hasSingle === hasMultiple) {
    throw new Error("SQLite chart requires exactly one of yColumn or yColumns");
  }
  const columns = hasSingle
    ? [boundedText(yColumn, 256, "SQLite chart Y column is invalid")]
    : Array.isArray(yColumns)
      ? yColumns.map((column) =>
          boundedText(
            column,
            MAX_SQLITE_CHART_SERIES_LABEL_CHARS,
            "SQLite chart series column is invalid",
          ),
        )
      : [];
  if (
    (!hasSingle &&
      (columns.length < 2 || columns.length > MAX_SQLITE_CHART_SERIES)) ||
    new Set(columns).size !== columns.length
  ) {
    throw new Error("SQLite chart series columns are invalid");
  }
  return columns;
}

function uniqueColumnIndex(columns: string[], target: string): number {
  const indexes = columns.flatMap((column, index) =>
    column === target ? [index] : [],
  );
  if (indexes.length !== 1) {
    throw new Error(`SQLite chart column is missing or ambiguous: ${target}`);
  }
  return indexes[0]!;
}

function chartLabel(value: SqliteQueryCell | undefined): string {
  const normalized = String(value ?? "(null)")
    .replace(UNSAFE_TEXT, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized || normalized.length > MAX_SQLITE_CHART_LABEL_CHARS) {
    throw new Error("SQLite chart X value is invalid or oversized");
  }
  return normalized;
}

function chartNumber(value: SqliteQueryCell | undefined): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          value.length <= 64 &&
          NUMERIC_TEXT.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error("SQLite chart Y values must be finite numbers");
  }
  return parsed;
}

function optionalText(
  value: string | undefined,
  fallback: string,
  maximum: number,
): string {
  return value === undefined
    ? fallback
    : boundedText(value, maximum, "SQLite chart text is invalid");
}

function boundedText(value: unknown, maximum: number, error: string): string {
  if (typeof value !== "string") throw new Error(error);
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    UNSAFE_TEXT_PRESENT.test(normalized)
  ) {
    throw new Error(error);
  }
  return normalized;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key));
}
