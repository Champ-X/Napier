import type { WorkflowObjectSchema } from "@napier/contracts";

export function sqliteQueryReceiptSchema(): WorkflowObjectSchema {
  const hash = { type: "string" as const, minLength: 64, maxLength: 64 };
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["napier.sqlite-query"] },
      schemaVersion: { type: "integer", minimum: 1, maximum: 1 },
      action: { type: "string", enum: ["query"] },
      databasePathSha256: hash,
      databaseSha256: hash,
      databaseBytes: { type: "integer", minimum: 16 },
      sqlSha256: hash,
      parameterCount: { type: "integer", minimum: 0, maximum: 50 },
      parameterSetSha256: hash,
      columnCount: { type: "integer", minimum: 0, maximum: 80 },
      rowCount: { type: "integer", minimum: 0, maximum: 100 },
      truncated: { type: "boolean" },
      columnsSha256: hash,
      rowsSha256: hash,
      durationMs: { type: "integer", minimum: 0, maximum: 6_000 },
      workerSha256: hash,
      runtimeSha256: hash,
      limitsSha256: hash,
      resultSha256: hash,
    },
    required: [
      "kind",
      "schemaVersion",
      "action",
      "databasePathSha256",
      "databaseSha256",
      "databaseBytes",
      "sqlSha256",
      "parameterCount",
      "parameterSetSha256",
      "columnCount",
      "rowCount",
      "truncated",
      "columnsSha256",
      "rowsSha256",
      "durationMs",
      "workerSha256",
      "runtimeSha256",
      "limitsSha256",
      "resultSha256",
    ],
    additionalProperties: false,
  };
}

export function sqliteChartReceiptSchema(): WorkflowObjectSchema {
  const base = sqliteQueryReceiptSchema();
  const hash = { type: "string" as const, minLength: 64, maxLength: 64 };
  return {
    ...base,
    properties: {
      ...base.properties,
      kind: { type: "string", enum: ["napier.sqlite-chart"] },
      schemaVersion: { type: "integer", minimum: 2, maximum: 2 },
      action: { type: "string", enum: ["chart"] },
      rowCount: { type: "integer", minimum: 1, maximum: 50 },
      chartType: { type: "string", enum: ["bar", "line"] },
      pointCount: { type: "integer", minimum: 2, maximum: 200 },
      categoryCount: { type: "integer", minimum: 1, maximum: 50 },
      seriesCount: { type: "integer", minimum: 2, maximum: 6 },
      width: { type: "integer", minimum: 480, maximum: 1_600 },
      height: { type: "integer", minimum: 320, maximum: 1_000 },
      chartSpecSha256: hash,
      svgSha256: hash,
      svgBytes: { type: "integer", minimum: 1, maximum: 48 * 1024 },
      rendererSha256: hash,
      chartLimitsSha256: hash,
      queryResultSha256: hash,
    },
    required: [
      ...base.required,
      "chartType",
      "pointCount",
      "categoryCount",
      "seriesCount",
      "width",
      "height",
      "chartSpecSha256",
      "svgSha256",
      "svgBytes",
      "rendererSha256",
      "chartLimitsSha256",
      "queryResultSha256",
    ],
  };
}
