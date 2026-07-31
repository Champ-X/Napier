import { canonicalJson, sha256 } from "./ed25519.js";
import type { SqliteQueryCell } from "./sqlite-query.js";

export const MAX_SQLITE_CHART_POINTS = 50;
export const MAX_SQLITE_CHART_LABEL_CHARS = 80;
export const MAX_SQLITE_CHART_TITLE_CHARS = 160;
export const MAX_SQLITE_CHART_SVG_BYTES = 48 * 1024;
export const MIN_SQLITE_CHART_WIDTH = 480;
export const MAX_SQLITE_CHART_WIDTH = 1_600;
export const MIN_SQLITE_CHART_HEIGHT = 320;
export const MAX_SQLITE_CHART_HEIGHT = 1_000;
export const DEFAULT_SQLITE_CHART_WIDTH = 960;
export const DEFAULT_SQLITE_CHART_HEIGHT = 540;

const PALETTE = {
  background: "#f7f4ed",
  axis: "#292722",
  grid: "#d8d2c6",
  primary: "#4e6e5d",
  text: "#292722",
};
const CHART_MARGIN = { top: 64, right: 28, bottom: 94, left: 82 };
const Y_TICK_COUNT = 5;
const NUMERIC_TEXT = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u;

const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const UNSAFE_TEXT_PRESENT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export type SqliteChartType = "bar" | "line";

export interface SqliteChartSpec {
  type: SqliteChartType;
  xColumn: string;
  yColumn: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  width?: number;
  height?: number;
}

export interface NormalizedSqliteChartSpec {
  type: SqliteChartType;
  xColumn: string;
  yColumn: string;
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
  svg: string;
  svgSha256: string;
  svgBytes: number;
}

export const SQLITE_CHART_RENDERER_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    grammar: [
      "svg",
      "title",
      "desc",
      "rect",
      "line",
      "text",
      "polyline",
      "circle",
    ],
    margin: CHART_MARGIN,
    palette: PALETTE,
    yTickCount: Y_TICK_COUNT,
    xLabelRotationDegrees: -35,
    numberFormatting: "six-significant-digits",
    textPolicy: "xml-escaped-c0-c1-bidi-safe",
    geometryPolicy: "finite-domain-with-zero-baseline",
  }),
);

export const SQLITE_CHART_LIMITS_SHA256 = sha256(
  canonicalJson({
    schemaVersion: 1,
    maxPoints: MAX_SQLITE_CHART_POINTS,
    maxLabelChars: MAX_SQLITE_CHART_LABEL_CHARS,
    maxTitleChars: MAX_SQLITE_CHART_TITLE_CHARS,
    maxSvgBytes: MAX_SQLITE_CHART_SVG_BYTES,
    width: [MIN_SQLITE_CHART_WIDTH, MAX_SQLITE_CHART_WIDTH],
    height: [MIN_SQLITE_CHART_HEIGHT, MAX_SQLITE_CHART_HEIGHT],
    chartTypes: ["bar", "line"],
    yValues: "finite-number-or-canonical-numeric-string",
  }),
);

export function normalizeSqliteChartSpec(
  input: SqliteChartSpec,
): NormalizedSqliteChartSpec {
  if (
    !record(input) ||
    !exactKeys(input, [
      "type",
      "xColumn",
      "yColumn",
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
  const yColumn = boundedText(
    input.yColumn,
    256,
    "SQLite chart Y column is invalid",
  );
  if (xColumn === yColumn) {
    throw new Error("SQLite chart X and Y columns must differ");
  }
  const title = optionalText(
    input.title,
    `${yColumn} by ${xColumn}`,
    MAX_SQLITE_CHART_TITLE_CHARS,
  );
  const xLabel = optionalText(
    input.xLabel,
    xColumn,
    MAX_SQLITE_CHART_LABEL_CHARS,
  );
  const yLabel = optionalText(
    input.yLabel,
    yColumn,
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
    title,
    xLabel,
    yLabel,
    width,
    height,
  };
}

export function renderSqliteChart(
  specInput: SqliteChartSpec,
  columns: string[],
  rows: SqliteQueryCell[][],
): RenderedSqliteChart {
  const spec = normalizeSqliteChartSpec(specInput);
  if (rows.length < 1 || rows.length > MAX_SQLITE_CHART_POINTS) {
    throw new Error("SQLite chart requires 1-50 complete rows");
  }
  const xIndex = uniqueColumnIndex(columns, spec.xColumn);
  const yIndex = uniqueColumnIndex(columns, spec.yColumn);
  const points = rows.map((row) => ({
    label: chartLabel(row[xIndex]),
    value: chartNumber(row[yIndex]),
  }));
  if (new Set(points.map((point) => point.label)).size !== points.length) {
    throw new Error("SQLite chart X values must be unique");
  }
  const svg = renderSvg(spec, points);
  const svgBytes = Buffer.byteLength(svg, "utf8");
  if (svgBytes > MAX_SQLITE_CHART_SVG_BYTES) {
    throw new Error("SQLite chart SVG exceeds the output limit");
  }
  return {
    spec,
    points,
    svg,
    svgSha256: sha256(svg),
    svgBytes,
  };
}

function renderSvg(
  spec: NormalizedSqliteChartSpec,
  points: SqliteChartPoint[],
): string {
  const plotWidth = spec.width - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = spec.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const values = points.map((point) => point.value);
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) maximum = minimum + 1;
  const span = maximum - minimum;
  if (!Number.isFinite(span) || span <= 0) {
    throw new Error("SQLite chart Y range exceeds finite geometry");
  }
  const yPosition = (value: number) =>
    CHART_MARGIN.top + ((maximum - value) / span) * plotHeight;
  const baseline = yPosition(0);
  const step = plotWidth / points.length;
  const centers = points.map(
    (_point, index) => CHART_MARGIN.left + step * (index + 0.5),
  );
  const labelStride = Math.max(1, Math.ceil(points.length / 12));
  const polylinePoints = points
    .map(
      (point, index) =>
        `${decimal(centers[index]!)},${decimal(yPosition(point.value))}`,
    )
    .join(" ");
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" role="img" aria-labelledby="chart-title chart-description">`,
    `  <title id="chart-title">${xml(spec.title)}</title>`,
    `  <desc id="chart-description">${xml(`${spec.type} chart with ${points.length} points; X axis ${spec.xLabel}; Y axis ${spec.yLabel}.`)}</desc>`,
    `  <rect x="0" y="0" width="${spec.width}" height="${spec.height}" fill="${PALETTE.background}"/>`,
    `  <text x="${CHART_MARGIN.left}" y="34" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="22" font-weight="600">${xml(spec.title)}</text>`,
  ];
  for (let index = 0; index <= Y_TICK_COUNT; index += 1) {
    const value = minimum + ((maximum - minimum) * index) / Y_TICK_COUNT;
    const y = yPosition(value);
    lines.push(
      `  <line x1="${CHART_MARGIN.left}" y1="${decimal(y)}" x2="${spec.width - CHART_MARGIN.right}" y2="${decimal(y)}" stroke="${PALETTE.grid}" stroke-width="1"/>`,
      `  <text x="${CHART_MARGIN.left - 10}" y="${decimal(y + 4)}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="12" text-anchor="end">${xml(numberLabel(value))}</text>`,
    );
  }
  lines.push(
    `  <line x1="${CHART_MARGIN.left}" y1="${decimal(CHART_MARGIN.top)}" x2="${CHART_MARGIN.left}" y2="${decimal(CHART_MARGIN.top + plotHeight)}" stroke="${PALETTE.axis}" stroke-width="1.5"/>`,
    `  <line x1="${CHART_MARGIN.left}" y1="${decimal(baseline)}" x2="${spec.width - CHART_MARGIN.right}" y2="${decimal(baseline)}" stroke="${PALETTE.axis}" stroke-width="1.5"/>`,
  );
  if (spec.type === "bar") {
    const barWidth = Math.max(2, step * 0.64);
    points.forEach((point, index) => {
      const valueY = yPosition(point.value);
      lines.push(
        `  <rect x="${decimal(centers[index]! - barWidth / 2)}" y="${decimal(Math.min(valueY, baseline))}" width="${decimal(barWidth)}" height="${decimal(Math.abs(baseline - valueY))}" fill="${PALETTE.primary}" rx="2"/>`,
      );
    });
  } else {
    lines.push(
      `  <polyline points="${polylinePoints}" fill="none" stroke="${PALETTE.primary}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    points.forEach((point, index) => {
      lines.push(
        `  <circle cx="${decimal(centers[index]!)}" cy="${decimal(yPosition(point.value))}" r="4" fill="${PALETTE.primary}"/>`,
      );
    });
  }
  points.forEach((point, index) => {
    if (index % labelStride !== 0 && index !== points.length - 1) return;
    const x = centers[index]!;
    const y = CHART_MARGIN.top + plotHeight + 18;
    lines.push(
      `  <text x="${decimal(x)}" y="${decimal(y)}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="11" text-anchor="end" transform="rotate(-35 ${decimal(x)} ${decimal(y)})">${xml(point.label)}</text>`,
    );
  });
  lines.push(
    `  <text x="${decimal(CHART_MARGIN.left + plotWidth / 2)}" y="${spec.height - 14}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle">${xml(spec.xLabel)}</text>`,
    `  <text x="18" y="${decimal(CHART_MARGIN.top + plotHeight / 2)}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle" transform="rotate(-90 18 ${decimal(CHART_MARGIN.top + plotHeight / 2)})">${xml(spec.yLabel)}</text>`,
    "</svg>",
    "",
  );
  return lines.join("\n");
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

function numberLabel(value: number): string {
  if (Object.is(value, -0)) return "0";
  return Number(value.toPrecision(6)).toString();
}

function decimal(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function xml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
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
