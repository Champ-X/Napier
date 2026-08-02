export interface SqliteChartSvgSpec {
  type: "bar" | "line";
  title: string;
  xLabel: string;
  yLabel: string;
  width: number;
  height: number;
}

export interface SqliteChartSvgPoint {
  label: string;
  value: number;
}

export interface SqliteChartSvgSeries {
  name: string;
  points: SqliteChartSvgPoint[];
}

const PALETTE = {
  background: "#f7f4ed",
  axis: "#292722",
  grid: "#d8d2c6",
  series: ["#4e6e5d", "#b26e3b", "#496a9b", "#8a5d91", "#8b7c3f", "#3f8580"],
  text: "#292722",
} as const;
const SINGLE_SERIES_MARGIN = { top: 64, right: 28, bottom: 94, left: 82 };
const MULTI_SERIES_MARGIN = { top: 108, right: 28, bottom: 94, left: 82 };
const LEGEND_COLUMNS = 3;
const Y_TICK_COUNT = 5;

export const SQLITE_CHART_SVG_POLICY = {
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
  singleSeriesMargin: SINGLE_SERIES_MARGIN,
  multiSeriesMargin: MULTI_SERIES_MARGIN,
  palette: PALETTE,
  yTickCount: Y_TICK_COUNT,
  xLabelRotationDegrees: -35,
  numberFormatting: "six-significant-digits",
  textPolicy: "xml-escaped-c0-c1-bidi-safe",
  geometryPolicy: "shared-finite-domain-with-zero-baseline",
  barPolicy: "grouped-by-category",
  linePolicy: "one-polyline-per-series",
  legendPolicy: "maximum-three-columns-two-rows",
} as const;

export function renderSqliteChartSvg(
  spec: SqliteChartSvgSpec,
  series: SqliteChartSvgSeries[],
): string {
  if (series.length < 1 || series.length > PALETTE.series.length) {
    throw new Error("SQLite chart series geometry is invalid");
  }
  const categoryCount = series[0]?.points.length ?? 0;
  if (
    categoryCount < 1 ||
    series.some(
      (candidate) =>
        candidate.points.length !== categoryCount ||
        candidate.points.some(
          (point, index) =>
            point.label !== series[0]?.points[index]?.label ||
            !Number.isFinite(point.value),
        ),
    )
  ) {
    throw new Error("SQLite chart series geometry is inconsistent");
  }
  const margin =
    series.length === 1 ? SINGLE_SERIES_MARGIN : MULTI_SERIES_MARGIN;
  const plotWidth = spec.width - margin.left - margin.right;
  const plotHeight = spec.height - margin.top - margin.bottom;
  const values = series.flatMap((candidate) =>
    candidate.points.map((point) => point.value),
  );
  let minimum = Math.min(0, ...values);
  let maximum = Math.max(0, ...values);
  if (minimum === maximum) maximum = minimum + 1;
  const span = maximum - minimum;
  if (!Number.isFinite(span) || span <= 0) {
    throw new Error("SQLite chart Y range exceeds finite geometry");
  }
  const yPosition = (value: number) =>
    margin.top + ((maximum - value) / span) * plotHeight;
  const baseline = yPosition(0);
  const step = plotWidth / categoryCount;
  const centers = Array.from(
    { length: categoryCount },
    (_value, index) => margin.left + step * (index + 0.5),
  );
  const lines = chartFrame(
    spec,
    series,
    margin,
    plotWidth,
    plotHeight,
    minimum,
    maximum,
    yPosition,
    baseline,
  );
  if (series.length > 1) {
    appendLegend(lines, series, margin, plotWidth);
  }
  if (spec.type === "bar") {
    appendBars(lines, series, centers, step, baseline, yPosition);
  } else {
    appendLines(lines, series, centers, yPosition);
  }
  appendCategoryLabels(lines, series[0]!.points, centers, margin, plotHeight);
  lines.push(
    `  <text x="${decimal(margin.left + plotWidth / 2)}" y="${spec.height - 14}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle">${xml(spec.xLabel)}</text>`,
    `  <text x="18" y="${decimal(margin.top + plotHeight / 2)}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle" transform="rotate(-90 18 ${decimal(margin.top + plotHeight / 2)})">${xml(spec.yLabel)}</text>`,
    "</svg>",
    "",
  );
  return lines.join("\n");
}

function chartFrame(
  spec: SqliteChartSvgSpec,
  series: SqliteChartSvgSeries[],
  margin: typeof SINGLE_SERIES_MARGIN,
  plotWidth: number,
  plotHeight: number,
  minimum: number,
  maximum: number,
  yPosition: (value: number) => number,
  baseline: number,
): string[] {
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" role="img" aria-labelledby="chart-title chart-description">`,
    `  <title id="chart-title">${xml(spec.title)}</title>`,
    `  <desc id="chart-description">${xml(`${spec.type} chart with ${series.length} series and ${series[0]!.points.length} categories; X axis ${spec.xLabel}; Y axis ${spec.yLabel}.`)}</desc>`,
    `  <rect x="0" y="0" width="${spec.width}" height="${spec.height}" fill="${PALETTE.background}"/>`,
    `  <text x="${margin.left}" y="34" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="22" font-weight="600">${xml(spec.title)}</text>`,
  ];
  for (let index = 0; index <= Y_TICK_COUNT; index += 1) {
    const value = minimum + ((maximum - minimum) * index) / Y_TICK_COUNT;
    const y = yPosition(value);
    lines.push(
      `  <line x1="${margin.left}" y1="${decimal(y)}" x2="${decimal(margin.left + plotWidth)}" y2="${decimal(y)}" stroke="${PALETTE.grid}" stroke-width="1"/>`,
      `  <text x="${margin.left - 10}" y="${decimal(y + 4)}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="12" text-anchor="end">${xml(numberLabel(value))}</text>`,
    );
  }
  lines.push(
    `  <line x1="${margin.left}" y1="${decimal(margin.top)}" x2="${margin.left}" y2="${decimal(margin.top + plotHeight)}" stroke="${PALETTE.axis}" stroke-width="1.5"/>`,
    `  <line x1="${margin.left}" y1="${decimal(baseline)}" x2="${decimal(margin.left + plotWidth)}" y2="${decimal(baseline)}" stroke="${PALETTE.axis}" stroke-width="1.5"/>`,
  );
  return lines;
}

function appendLegend(
  lines: string[],
  series: SqliteChartSvgSeries[],
  margin: typeof MULTI_SERIES_MARGIN,
  plotWidth: number,
): void {
  const columnCount = Math.min(LEGEND_COLUMNS, series.length);
  const cellWidth = plotWidth / columnCount;
  series.forEach((candidate, index) => {
    const x = margin.left + cellWidth * (index % LEGEND_COLUMNS);
    const y = 50 + Math.floor(index / LEGEND_COLUMNS) * 20;
    lines.push(
      `  <rect x="${decimal(x)}" y="${y}" width="12" height="12" rx="2" fill="${PALETTE.series[index]}"/>`,
      `  <text x="${decimal(x + 17)}" y="${y + 10}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="10">${xml(candidate.name)}</text>`,
    );
  });
}

function appendBars(
  lines: string[],
  series: SqliteChartSvgSeries[],
  centers: number[],
  step: number,
  baseline: number,
  yPosition: (value: number) => number,
): void {
  const groupWidth = step * 0.72;
  const barWidth = Math.max(1, groupWidth / series.length);
  series.forEach((candidate, seriesIndex) => {
    candidate.points.forEach((point, categoryIndex) => {
      const valueY = yPosition(point.value);
      const x =
        centers[categoryIndex]! - groupWidth / 2 + seriesIndex * barWidth;
      lines.push(
        `  <rect x="${decimal(x)}" y="${decimal(Math.min(valueY, baseline))}" width="${decimal(Math.max(1, barWidth - 1))}" height="${decimal(Math.abs(baseline - valueY))}" fill="${PALETTE.series[seriesIndex]}" rx="2"/>`,
      );
    });
  });
}

function appendLines(
  lines: string[],
  series: SqliteChartSvgSeries[],
  centers: number[],
  yPosition: (value: number) => number,
): void {
  series.forEach((candidate, seriesIndex) => {
    const color = PALETTE.series[seriesIndex];
    const polyline = candidate.points
      .map(
        (point, index) =>
          `${decimal(centers[index]!)},${decimal(yPosition(point.value))}`,
      )
      .join(" ");
    lines.push(
      `  <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
    candidate.points.forEach((point, index) => {
      lines.push(
        `  <circle cx="${decimal(centers[index]!)}" cy="${decimal(yPosition(point.value))}" r="4" fill="${color}"/>`,
      );
    });
  });
}

function appendCategoryLabels(
  lines: string[],
  points: SqliteChartSvgPoint[],
  centers: number[],
  margin: typeof SINGLE_SERIES_MARGIN,
  plotHeight: number,
): void {
  const stride = Math.max(1, Math.ceil(points.length / 12));
  points.forEach((point, index) => {
    if (index % stride !== 0 && index !== points.length - 1) return;
    const x = centers[index]!;
    const y = margin.top + plotHeight + 18;
    lines.push(
      `  <text x="${decimal(x)}" y="${decimal(y)}" fill="${PALETTE.text}" font-family="system-ui, sans-serif" font-size="11" text-anchor="end" transform="rotate(-35 ${decimal(x)} ${decimal(y)})">${xml(point.label)}</text>`,
    );
  });
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
