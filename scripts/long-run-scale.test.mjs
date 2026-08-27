import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  runTraceScaleBenchmark,
  verifyTraceScaleReport,
} from "./benchmark-trace-scale.mjs";
import { verifyStoreScaleReport } from "./benchmark-store-scale.mjs";

const budget = JSON.parse(
  await readFile(
    new URL("../docs/long-run-scale-budget.json", import.meta.url),
    "utf8",
  ),
);
let traceReport;

function measuredTraceReport() {
  traceReport ??= runTraceScaleBenchmark(budget);
  return traceReport;
}

describe("long-run scale evidence", () => {
  it("creates and verifies a production Trace report", () => {
    const report = measuredTraceReport();
    expect(report.status).toBe("passed");
    expect(verifyTraceScaleReport(report, budget)).toEqual([]);
  });

  it("fails closed when Trace evidence or its budget binding changes", () => {
    const report = measuredTraceReport();
    const tampered = structuredClone(report);
    tampered.samples[0].mountedRows = 999;
    expect(verifyTraceScaleReport(tampered, budget)).toContain(
      "report_content_hash_mismatch",
    );
    expect(
      verifyTraceScaleReport(report, { ...budget, profile: "changed" }),
    ).toContain("report_budget_mismatch");
  });

  it("rejects failed, stale, or tampered Store scale evidence", () => {
    const body = {
      kind: "napier.store-scale-benchmark",
      schemaVersion: 2,
      budgetSha256: "stale",
      status: "failed",
      samples: [],
      checks: [],
    };
    const report = { ...body, contentSha256: "tampered" };
    expect(verifyStoreScaleReport(report, budget)).toEqual(
      expect.arrayContaining([
        "report_budget_failed",
        "report_budget_mismatch",
        "report_content_hash_mismatch",
      ]),
    );
  });
});
