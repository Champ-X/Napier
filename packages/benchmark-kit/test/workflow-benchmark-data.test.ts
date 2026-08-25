import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  canonicalJson,
  createLocalAgentRuntime,
  sha256,
  UnsupportedSandboxAdapter,
  type LocalAgentRuntimeOptions,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { loadWorkflowBenchmarkCase } from "../src/workflow-benchmark-case.js";
import { verifyWorkflowBenchmarkArtifacts } from "../src/workflow-benchmark-contract.js";
import { verifyWorkflowBenchmarkLedgerBundle } from "../src/workflow-benchmark-ledger.js";
import {
  runWorkflowBenchmarkSeries,
  verifyWorkflowBenchmarkSeries,
} from "../src/workflow-benchmark-series.js";
import { setupWorkflowBenchmarkDatabase } from "../src/workflow-benchmark-sqlite-setup.js";
import type { WorkflowBenchmarkDependencies } from "../src/workflow-benchmark.js";
import type { WorkflowBenchmarkLedgerBundle } from "../src/workflow-benchmark-types.js";

const CASE_ROOT = path.resolve(
  import.meta.dirname,
  "../../../benchmarks/data/sqlite-metric-map-reduce-v1",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Data outcome benchmark", () => {
  it("loads a hash-bound SQLite metric and chart case", async () => {
    const loaded = await loadWorkflowBenchmarkCase(CASE_ROOT);
    expect(loaded.benchmarkCase).toEqual(
      expect.objectContaining({
        id: "data_sqlite_metric_map_reduce_v1",
        schemaVersion: 2,
        scenario: "sqlite_metric_map_reduce",
        databasePath: "analytics.sqlite",
        requiredSqliteActions: ["schema", "query", "chart"],
      }),
    );
    expect(loaded.setupSqlSource).toContain("CREATE TABLE orders");
    expect(loaded.expected).toEqual({
      mapItems: [
        { id: "paid_total", length: 90 },
        { id: "refunded_total", length: 12 },
        { id: "paid_region_chart_points", length: 3 },
      ],
      output: 105,
    });
  });

  it("denies setup SQL that attempts to attach an external database", async () => {
    const loaded = await loadWorkflowBenchmarkCase(CASE_ROOT);
    const root = await temporaryRoot("napier-data-setup-");
    const workspaceRoot = path.join(root, "workspace");
    const escapedPath = path.join(root, "escaped.sqlite");
    await mkdir(workspaceRoot);
    await expect(
      setupWorkflowBenchmarkDatabase(workspaceRoot, {
        ...loaded,
        setupSqlSource: [
          `ATTACH DATABASE '${escapedPath}' AS escaped;`,
          "CREATE TABLE escaped.leak (value TEXT);",
        ].join("\n"),
      }),
    ).rejects.toThrow();
    await expect(access(escapedPath)).rejects.toThrow();
  });

  it("runs repeated SQLite trials with receipt-bound private evidence", async () => {
    const outputDir = await temporaryRoot("napier-data-benchmark-");
    const provider = dataBenchmarkProvider(18);
    const artifacts = await runWorkflowBenchmarkSeries(
      {
        caseRoot: CASE_ROOT,
        outputDir,
        model: { provider: "faux-data-benchmark", id: "faux-1" },
        env: {},
        trialCount: 2,
      },
      dataBenchmarkDependencies(provider),
    );

    expect(artifacts.series).toEqual(
      expect.objectContaining({
        status: "completed",
        completedTrialCount: 2,
        passedTrialCount: 2,
        passRate: 1,
      }),
    );
    for (const trial of artifacts.trials) {
      expect(trial.result).toEqual(
        expect.objectContaining({
          status: "passed",
          evaluation: expect.objectContaining({
            schemaVersion: 2,
            outputMatch: true,
            mapOutputMatch: true,
            sqliteSchemaCompletedCount: 3,
            sqliteQueryCompletedCount: 2,
            sqliteChartCompletedCount: 1,
            sqliteProtocolValid: true,
            databaseUnchanged: true,
            diagnostics: [],
          }),
        }),
      );
      expect(trial.bundle.workflow.sqliteActionEvents).toHaveLength(6);
      expect(
        verifyWorkflowBenchmarkArtifacts(trial.result, trial.bundle),
      ).toEqual(expect.objectContaining({ valid: true, diagnostics: [] }));
      const serialized = JSON.stringify(trial.bundle);
      for (const privateValue of [
        "SELECT ",
        "orders",
        "north",
        "south",
        "refunded",
        "<svg",
      ]) {
        expect(serialized).not.toContain(privateValue);
      }
    }

    const trialArtifacts = artifacts.trials.map((trial) => ({
      resultFileName: path.basename(trial.resultPath),
      result: trial.result,
      bundle: trial.bundle,
    }));
    expect(
      verifyWorkflowBenchmarkSeries(artifacts.series, trialArtifacts),
    ).toEqual({
      valid: true,
      diagnostics: [],
      seriesSha256: artifacts.series.contentSha256,
      trialDiagnostics: [],
    });

    const tampered = structuredClone(
      artifacts.trials[0]!.bundle,
    ) as WorkflowBenchmarkLedgerBundle;
    const queryEvent = tampered.workflow.sqliteActionEvents?.find(
      (event) =>
        event.payload &&
        !Array.isArray(event.payload) &&
        typeof event.payload === "object" &&
        event.payload["details"] &&
        !Array.isArray(event.payload["details"]) &&
        typeof event.payload["details"] === "object" &&
        event.payload["details"]["action"] === "query",
    );
    if (
      !queryEvent?.payload ||
      Array.isArray(queryEvent.payload) ||
      typeof queryEvent.payload !== "object" ||
      !queryEvent.payload["details"] ||
      Array.isArray(queryEvent.payload["details"]) ||
      typeof queryEvent.payload["details"] !== "object"
    ) {
      throw new Error("Data benchmark query evidence is unavailable");
    }
    queryEvent.payload["details"]["action"] = "schema";
    queryEvent.payload["resultSha256"] = sha256(
      canonicalJson(queryEvent.payload["details"] as never),
    );
    tampered.contentSha256 = sha256(
      canonicalJson(withoutHash(tampered) as never),
    );
    expect(verifyWorkflowBenchmarkLedgerBundle(tampered)).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostics: ["ledger_sqlite_evidence_invalid"],
      }),
    );
  }, 30_000);
});

function dataBenchmarkProvider(responseCount: number) {
  const provider = fauxProvider({ provider: "faux-data-benchmark" });
  provider.setResponses(
    Array.from({ length: responseCount }, () => dataBenchmarkResponse),
  );
  return provider;
}

function dataBenchmarkResponse(context: { messages: unknown[] }) {
  const messages = JSON.stringify(context.messages);
  const metric = metricFromPrompt(messages);
  if (!messages.includes("SQLite schema complete.")) {
    return toolResponse("sqlite_query", {
      action: "schema",
      path: "analytics.sqlite",
    });
  }
  const databaseSha256 =
    /Database SHA-256: ([a-f0-9]{64})/u.exec(messages)?.[1] ?? "";
  if (!databaseSha256) {
    throw new Error("Data benchmark schema response has no database hash");
  }
  if (
    metric.id === "paid_region_chart_points" &&
    !messages.includes("SQLite chart complete.")
  ) {
    return toolResponse("sqlite_query", {
      action: "chart",
      path: "analytics.sqlite",
      databaseSha256,
      sql: "SELECT region, SUM(amount_cents) AS total FROM orders WHERE status = ? GROUP BY region ORDER BY region",
      params: ["paid"],
      chart: {
        type: "bar",
        xColumn: "region",
        yColumn: "total",
        title: "Paid revenue by region",
      },
    });
  }
  if (
    metric.id !== "paid_region_chart_points" &&
    !messages.includes("SQLite query complete.")
  ) {
    return toolResponse("sqlite_query", {
      action: "query",
      path: "analytics.sqlite",
      databaseSha256,
      sql: "SELECT COALESCE(SUM(amount_cents), 0) AS value FROM orders WHERE status = ?",
      params: [metric.id === "paid_total" ? "paid" : "refunded"],
    });
  }
  return fauxAssistantMessage(JSON.stringify(metric));
}

function metricFromPrompt(messages: string): { id: string; length: number } {
  if (messages.includes("paid_region_chart_points")) {
    return { id: "paid_region_chart_points", length: 3 };
  }
  if (messages.includes("refunded_total")) {
    return { id: "refunded_total", length: 12 };
  }
  if (messages.includes("paid_total")) {
    return { id: "paid_total", length: 90 };
  }
  throw new Error("Data benchmark prompt has no known metric");
}

function toolResponse(name: string, input: Record<string, unknown>) {
  return fauxAssistantMessage(fauxToolCall(name, input), {
    stopReason: "toolUse",
  });
}

function dataBenchmarkDependencies(
  provider: ReturnType<typeof dataBenchmarkProvider>,
): WorkflowBenchmarkDependencies {
  return {
    now: () => new Date("2026-08-02T00:00:00.000Z"),
    async createRuntime(options: LocalAgentRuntimeOptions) {
      const runtime = await createLocalAgentRuntime({
        ...options,
        sandbox: new UnsupportedSandboxAdapter("data-benchmark-test"),
      });
      runtime.models.registerProvider(provider.provider);
      return runtime;
    },
  };
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function withoutHash<T extends { contentSha256: string }>(
  value: T,
): Omit<T, "contentSha256"> {
  const { contentSha256: _contentSha256, ...content } = value;
  return content;
}
