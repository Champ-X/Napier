import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createProductPerformanceReport,
  measureBuiltCliProductPath,
  validateProductPerformanceBudget,
  verifyProductPerformanceReport,
  verifyProductPerformanceReportFile,
} from "./product-performance.mjs";
import { createLongThreadPerformanceMeasurement } from "./product-performance-long-thread.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("product performance budget", () => {
  it("builds and verifies one complete passing report", () => {
    const budget = fixtureBudget();
    const report = createProductPerformanceReport({
      budget,
      measurements: fixtureMeasurements(),
      environment: {
        nodeVersion: "24.16.0",
        platform: "darwin",
        arch: "arm64",
      },
      generatedAt: "2026-07-31T00:00:00.000Z",
    });

    expect(report.status).toBe("passed");
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(verifyProductPerformanceReport(report, budget)).toEqual(
      expect.objectContaining({ valid: true, errors: [] }),
    );
  });

  it("fails closed on a budget breach, projection drift, or extra input", () => {
    const budget = fixtureBudget({
      cliFirstEventMedianMs: 5,
    });
    const failed = createProductPerformanceReport({
      budget,
      measurements: fixtureMeasurements(),
      environment: {
        nodeVersion: "24.16.0",
        platform: "darwin",
        arch: "arm64",
      },
      generatedAt: "2026-07-31T00:00:00.000Z",
    });
    expect(failed.status).toBe("failed");
    expect(verifyProductPerformanceReport(failed, budget)).toEqual(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining(["report_budget_failed"]),
      }),
    );

    const tampered = structuredClone(failed);
    tampered.metrics.cliFirstEventMedianMs = 1;
    expect(verifyProductPerformanceReport(tampered, budget)).toEqual(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining([
          "report_content_hash_mismatch",
          "report_projection_mismatch",
        ]),
      }),
    );
    expect(() =>
      validateProductPerformanceBudget({
        ...budget,
        unexpected: true,
      }),
    ).toThrow("unexpected fields");
  });

  it("gates long-Thread performance on the median round without hiding sustained regression", () => {
    const budget = fixtureBudget({
      longThreadAppendP95Ms: 10,
    });
    const oneNoisyRound = fixtureMeasurements({
      appendP95Ms: [2, 75, 3],
    });
    const passing = createProductPerformanceReport({
      budget,
      measurements: oneNoisyRound,
      environment: {
        nodeVersion: "24.16.0",
        platform: "linux",
        arch: "x64",
      },
      generatedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(passing.metrics.longThreadAppendP95Ms).toBe(3);
    expect(passing.status).toBe("passed");

    const sustained = createProductPerformanceReport({
      budget,
      measurements: fixtureMeasurements({
        appendP95Ms: [2, 75, 80],
      }),
      environment: passing.environment,
      generatedAt: "2026-08-11T00:00:00.000Z",
    });
    expect(sustained.metrics.longThreadAppendP95Ms).toBe(75);
    expect(sustained.status).toBe("failed");

    const tampered = structuredClone(passing);
    tampered.measurements.longThread.rounds[1].appendP95Ms = 4;
    expect(verifyProductPerformanceReport(tampered, budget)).toEqual(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining([
          "report_content_hash_mismatch",
          "report_projection_mismatch",
        ]),
      }),
    );
  });

  it("rejects a tampered saved baseline", async () => {
    const root = await temporaryRoot();
    const budgetPath = path.join(root, "budget.json");
    const reportPath = path.join(root, "report.json");
    const budget = fixtureBudget();
    const report = createProductPerformanceReport({
      budget,
      measurements: fixtureMeasurements(),
      environment: {
        nodeVersion: "24.16.0",
        platform: "darwin",
        arch: "arm64",
      },
      generatedAt: "2026-07-31T00:00:00.000Z",
    });
    await writeJson(budgetPath, budget);
    await writeJson(reportPath, report);

    await expect(
      verifyProductPerformanceReportFile({ budgetPath, reportPath }),
    ).resolves.toEqual(expect.objectContaining({ valid: true, errors: [] }));

    report.metrics.readFileP95Ms = 999;
    await writeJson(reportPath, report);
    await expect(
      verifyProductPerformanceReportFile({ budgetPath, reportPath }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining([
          "report_content_hash_mismatch",
          "report_projection_mismatch",
        ]),
      }),
    );
  });

  it("rejects null, oversized, and symlinked baseline input", async () => {
    const root = await temporaryRoot();
    const budgetPath = path.join(root, "budget.json");
    const reportPath = path.join(root, "report.json");
    await writeJson(budgetPath, fixtureBudget());

    await writeJson(reportPath, null);
    await expect(
      verifyProductPerformanceReportFile({ budgetPath, reportPath }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        errors: expect.arrayContaining([
          expect.stringContaining("report_invalid:"),
        ]),
      }),
    );

    await writeFile(reportPath, " ".repeat(1024 * 1024 + 1), "utf8");
    await expect(
      verifyProductPerformanceReportFile({ budgetPath, reportPath }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        errors: ["report:Performance report exceeds 1048576 bytes"],
      }),
    );

    const linkedPath = path.join(root, "linked-report.json");
    await symlink(reportPath, linkedPath);
    await expect(
      verifyProductPerformanceReportFile({
        budgetPath,
        reportPath: linkedPath,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        valid: false,
        errors: ["report:Performance report must be a regular file"],
      }),
    );
  });
});

describe("built CLI performance sampler", () => {
  it("measures ordered JSONL and terminates a timed-out process", async () => {
    const root = await temporaryRoot();
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const entrypoint = path.join(root, "fake-cli.mjs");
    await writeFile(
      entrypoint,
      [
        "const line = (value) => process.stdout.write(`${JSON.stringify(value)}\\n`);",
        "line({ type: 'event', event: { type: 'run.started' } });",
        "setTimeout(() => line({ type: 'event', event: { type: 'model.text.delta' } }), 5);",
        "setTimeout(() => line({ type: 'snapshot' }), 10);",
        "setTimeout(() => line({ type: 'done', status: 'completed' }), 15);",
      ].join("\n"),
      "utf8",
    );

    await expect(
      measureBuiltCliProductPath({
        cliEntrypoint: entrypoint,
        workspaceRoot,
        dataRoot: path.join(root, "data"),
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        firstEventMs: expect.any(Number),
        firstTokenMs: expect.any(Number),
        completionMs: expect.any(Number),
        eventCount: 2,
      }),
    );

    await writeFile(entrypoint, "setInterval(() => {}, 1000);\n", "utf8");
    await expect(
      measureBuiltCliProductPath({
        cliEntrypoint: entrypoint,
        workspaceRoot,
        dataRoot: path.join(root, "timed-out-data"),
        timeoutMs: 50,
      }),
    ).rejects.toThrow("timed out");
  });

  it("honors pre-execution cancellation without spawning", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      measureBuiltCliProductPath({
        cliEntrypoint: "missing",
        workspaceRoot: "missing",
        dataRoot: "missing",
        timeoutMs: 1_000,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

function fixtureBudget(limitOverrides = {}) {
  return {
    kind: "napier.product-performance-budget",
    schemaVersion: 1,
    profile: "test_v1",
    sample: {
      cliIterations: 3,
      cliTimeoutMs: 1_000,
      readFileIterations: 3,
      longThreadIterations: 3,
      longThreadEventCount: 100,
    },
    limits: {
      cliFirstEventMedianMs: 100,
      cliFirstTokenMedianMs: 100,
      cliCompletionMedianMs: 100,
      runtimeBootstrapMs: 100,
      readFileP95Ms: 100,
      longThreadAppendP95Ms: 100,
      longThreadProjectionMs: 100,
      runtimeObservedPeakRssBytes: 1_000,
      runtimeRssGrowthBytes: 1_000,
      databaseBytes: 10_000,
      databaseBytesPerEvent: 1_000,
      ...limitOverrides,
    },
  };
}

function fixtureMeasurements(options = {}) {
  const appendP95Ms = options.appendP95Ms ?? [2, 2, 2];
  return {
    cli: {
      sampleCount: 3,
      samples: [
        {
          firstEventMs: 10,
          firstTokenMs: 20,
          completionMs: 30,
          eventCount: 10,
        },
        {
          firstEventMs: 12,
          firstTokenMs: 22,
          completionMs: 32,
          eventCount: 10,
        },
        {
          firstEventMs: 14,
          firstTokenMs: 24,
          completionMs: 34,
          eventCount: 10,
        },
      ],
      firstEventMedianMs: 12,
      firstTokenMedianMs: 22,
      completionMedianMs: 32,
    },
    runtime: {
      moduleLoadMs: 5,
      bootstrapMs: 8,
    },
    tool: {
      name: "read_file",
      iterations: 3,
      durationsMs: [1, 2, 3],
      p50Ms: 2,
      p95Ms: 3,
    },
    longThread: createLongThreadPerformanceMeasurement(
      appendP95Ms.map((p95Ms, index) => ({
        iteration: index + 1,
        eventCount: 100,
        batchDurationMs: 50 + index,
        appendP50Ms: 1,
        appendP95Ms: p95Ms,
        projectionMs: 5 + index,
        detailBytes: 4_000 + index,
        eventBytes: 3_000 + index,
      })),
    ),
    memory: {
      initialRssBytes: 100,
      afterModuleLoadRssBytes: 200,
      afterBootstrapRssBytes: 300,
      afterToolRssBytes: 350,
      afterLongThreadRssBytes: 400,
      observedPeakRssBytes: 400,
      rssGrowthBytes: 300,
    },
    database: {
      eventCount: 300,
      totalBytes: 5_000,
      bytesPerEvent: 16.667,
    },
  };
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-performance-test-"));
  temporaryRoots.push(root);
  return root;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
