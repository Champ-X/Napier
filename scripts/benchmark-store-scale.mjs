import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { LocalStore } from "../packages/runtime/dist/index.js";

const DEFAULT_EVENT_COUNTS = [100, 1_000];
const MAX_EVENT_COUNT = 10_000;

const eventCounts = parseEventCounts(
  process.env["NAPIER_BENCH_EVENT_COUNTS"],
);
const outputPath = parseOutputPath(process.argv.slice(2));
const root = await mkdtemp(path.join(tmpdir(), "napier-store-scale-"));
const store = new LocalStore({
  dataRoot: path.join(root, "data"),
  workspaceRoot: path.join(root, "workspace"),
});

try {
  await store.initialize();
  const agent = store.listAgents()[0];
  if (!agent) throw new Error("Scale benchmark requires the seeded Agent");
  const thread = await store.createThread({
    title: "Store scale benchmark",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  const samples = [];
  let appended = 0;

  for (const targetEventCount of eventCounts) {
    const durations = [];
    const batchStartedAt = performance.now();
    while (appended < targetEventCount) {
      const appendStartedAt = performance.now();
      await store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "benchmark.event",
        category: "lifecycle",
        visibility: "debug",
        payload: {
          sequence: appended + 1,
          padding: "x".repeat(128),
        },
      });
      durations.push(performance.now() - appendStartedAt);
      appended += 1;
    }
    const batchDurationMs = performance.now() - batchStartedAt;
    const detailStartedAt = performance.now();
    const detail = await store.getDetail(thread.id);
    const detailDurationMs = performance.now() - detailStartedAt;
    samples.push({
      targetEventCount,
      appendedInBatch: durations.length,
      batchDurationMs: round(batchDurationMs),
      averageAppendMs: round(average(durations)),
      p50AppendMs: round(percentile(durations, 0.5)),
      p95AppendMs: round(percentile(durations, 0.95)),
      detailDurationMs: round(detailDurationMs),
      detailBytes: Buffer.byteLength(JSON.stringify(detail), "utf8"),
      eventBytes: Buffer.byteLength(JSON.stringify(detail.events), "utf8"),
      persistence: store.getPersistenceMetrics().last,
    });
  }

  const first = samples[0];
  const last = samples.at(-1);
  const report = {
    kind: "napier.store-scale-benchmark",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.versions.node,
    eventCounts,
    samples,
    growth:
      first && last
        ? {
            averageAppendRatio: round(
              ratio(last.averageAppendMs, first.averageAppendMs),
            ),
            detailBytesRatio: round(ratio(last.detailBytes, first.detailBytes)),
            eventBytesRatio: round(ratio(last.eventBytes, first.eventBytes)),
          }
        : undefined,
    persistence: store.getPersistenceMetrics(),
  };
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serializedReport, "utf8");
    process.stdout.write(`Store scale benchmark written to ${outputPath}\n`);
  } else {
    process.stdout.write(serializedReport);
  }
} finally {
  store.close();
  await rm(root, { recursive: true, force: true });
}

function parseEventCounts(value) {
  if (!value) return DEFAULT_EVENT_COUNTS;
  const counts = [
    ...new Set(
      value
        .split(",")
        .map((entry) => Number(entry.trim()))
        .filter((entry) => Number.isSafeInteger(entry) && entry > 0),
    ),
  ].sort((left, right) => left - right);
  if (counts.length === 0 || counts.at(-1) > MAX_EVENT_COUNT) {
    throw new Error(
      `NAPIER_BENCH_EVENT_COUNTS must contain ascending positive integers up to ${MAX_EVENT_COUNT}`,
    );
  }
  return counts;
}

function parseOutputPath(args) {
  const outputIndex = args.indexOf("--output");
  if (outputIndex === -1) return undefined;
  const value = args[outputIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--output requires a file path");
  }
  return path.resolve(value);
}

function average(values) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index];
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}
