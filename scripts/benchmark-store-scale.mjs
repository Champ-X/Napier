import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const DEFAULT_EVENT_COUNTS = [10_000, 100_000];
const MAX_EVENT_COUNT = 100_000;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budgetPath = path.join(repoRoot, "docs/long-run-scale-budget.json");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}

async function runCli() {
  const budget = JSON.parse(await readFile(budgetPath, "utf8"));
  const options = parseArguments(process.argv.slice(2));
  if (options.verifyPath) {
    const report = JSON.parse(await readFile(options.verifyPath, "utf8"));
    const errors = verifyStoreScaleReport(report, budget);
    process.stdout.write(
      errors.length === 0
        ? `Store scale baseline verified: ${report.contentSha256.slice(0, 16)}\n`
        : `Store scale baseline invalid: ${errors.join(", ")}\n`,
    );
    if (errors.length > 0) process.exitCode = 1;
    return;
  }
  const report = await runStoreScaleBenchmark({
    budget,
    eventCounts: parseEventCounts(process.env["NAPIER_BENCH_EVENT_COUNTS"]),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, serialized, "utf8");
  }
  process.stdout.write(
    `Store scale ${report.status}: ${report.samples.map((sample) => `${formatCount(sample.targetEventCount)} ${sample.batchDurationMs.toFixed(1)}ms/${sample.detailDurationMs.toFixed(1)}ms`).join("; ")}\n`,
  );
  if (report.status !== "passed") {
    for (const check of report.checks.filter((candidate) => !candidate.passed)) {
      process.stderr.write(
        `Store scale budget exceeded: ${check.metric} ${String(check.observed)} > ${String(check.limit)} ${check.unit}\n`,
      );
    }
    process.exitCode = 1;
  }
}

export async function runStoreScaleBenchmark({ budget, eventCounts }) {
  validateBudget(budget, eventCounts);
  const { LocalStore } = await import("../packages/runtime/dist/index.js");
  const root = await mkdtemp(path.join(tmpdir(), "napier-store-scale-"));
  const dataRoot = path.join(root, "data");
  const store = new LocalStore({
    dataRoot,
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
    const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
    const initialRssBytes = process.memoryUsage().rss;
    let maximumRssBytes = initialRssBytes;
    const samples = [];
    let appended = 0;
    let lastSeq = 0;

    for (const targetEventCount of eventCounts) {
      const durations = [];
      const batchStartedAt = performance.now();
      while (appended < targetEventCount) {
        const appendStartedAt = performance.now();
        const event = await store.appendEvent({
          threadId: thread.id,
          runId: run.id,
          type: "context.prepared",
          category: "model",
          visibility: "debug",
          payload: { sequence: appended + 1, padding: "x".repeat(128) },
        });
        durations.push(performance.now() - appendStartedAt);
        appended += 1;
        lastSeq = event.seq;
      }
      const batchDurationMs = performance.now() - batchStartedAt;
      const incrementalStartedAt = performance.now();
      const incremental = await store.listEvents(thread.id, lastSeq - 100);
      const incrementalQueryMs = performance.now() - incrementalStartedAt;
      const typedStartedAt = performance.now();
      const typed = await store.listRunEvents(run.id, 0, ["context.prepared"]);
      const typedQueryMs = performance.now() - typedStartedAt;
      const detailStartedAt = performance.now();
      const detail = await store.getDetail(thread.id);
      const detailDurationMs = performance.now() - detailStartedAt;
      if (incremental.length !== 100 || typed.length !== targetEventCount) {
        throw new Error("Store scale indexed query is incomplete");
      }
      if (detail.events.filter((event) => event.type === "context.prepared").length !== targetEventCount) {
        throw new Error("Store scale Thread projection is incomplete");
      }
      const databaseBytes = await sqlitePersistentBytes(dataRoot);
      maximumRssBytes = Math.max(maximumRssBytes, process.memoryUsage().rss);
      samples.push({
        targetEventCount,
        appendedInBatch: durations.length,
        batchDurationMs: round(batchDurationMs),
        averageAppendMs: round(average(durations)),
        p50AppendMs: round(percentile(durations, 0.5)),
        p95AppendMs: round(percentile(durations, 0.95)),
        incrementalQueryMs: round(incrementalQueryMs),
        incrementalEventCount: incremental.length,
        typedQueryMs: round(typedQueryMs),
        typedEventCount: typed.length,
        detailDurationMs: round(detailDurationMs),
        detailEventCount: detail.events.length,
        detailBytes: Buffer.byteLength(JSON.stringify(detail), "utf8"),
        eventBytes: Buffer.byteLength(JSON.stringify(detail.events), "utf8"),
        databaseBytes,
        databaseBytesPerEvent: round(databaseBytes / targetEventCount),
        rssBytes: process.memoryUsage().rss,
      });
    }
    const concurrent = await measureConcurrentRuns(store, agent.id);
    maximumRssBytes = Math.max(maximumRssBytes, process.memoryUsage().rss);
    const checks = samples.flatMap((sample) => sampleChecks(sample, budget.store));
    checks.push(
      check("store.concurrent.batchDurationMs", concurrent.batchDurationMs, budget.concurrentRuns.batchDurationMs, "ms"),
      check("store.concurrent.projectionMs", concurrent.projectionMs, budget.concurrentRuns.projectionMs, "ms"),
    );
    checks.push(
      check(
        "store.rssGrowthBytes",
        Math.max(0, maximumRssBytes - initialRssBytes),
        budget.store.maximumRssGrowthBytes,
        "bytes",
      ),
    );
    const reportWithoutHash = {
      kind: "napier.store-scale-benchmark",
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      environment: { nodeVersion: process.versions.node, platform: process.platform, arch: process.arch },
      budgetSha256: sha256(budget),
      eventCounts,
      status: checks.every((candidate) => candidate.passed) ? "passed" : "failed",
      samples,
      concurrent,
      memory: {
        initialRssBytes,
        maximumRssBytes,
        rssGrowthBytes: Math.max(0, maximumRssBytes - initialRssBytes),
      },
      checks,
      persistence: store.getPersistenceMetrics(),
    };
    return { ...reportWithoutHash, contentSha256: sha256(reportWithoutHash) };
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function measureConcurrentRuns(store, agentId) {
  const threadCount = 4;
  const totalEventCount = 10_000;
  const eventCountPerThread = totalEventCount / threadCount;
  const contexts = [];
  for (let index = 0; index < threadCount; index += 1) {
    const thread = await store.createThread({
      title: `Concurrent scale ${String(index + 1)}`,
      agentId,
    });
    const run = await store.createRun({ threadId: thread.id, agentId });
    contexts.push({ thread, run });
  }
  const batchStartedAt = performance.now();
  await Promise.all(
    contexts.map(async ({ thread, run }) => {
      for (let index = 0; index < eventCountPerThread; index += 1) {
        await store.appendEvent({
          threadId: thread.id,
          runId: run.id,
          type: "context.prepared",
          category: "model",
          visibility: "debug",
          payload: { concurrentSequence: index + 1 },
        });
      }
    }),
  );
  const batchDurationMs = round(performance.now() - batchStartedAt);
  const projectionStartedAt = performance.now();
  const details = await Promise.all(
    contexts.map(({ thread }) => store.getDetail(thread.id)),
  );
  const projectionMs = round(performance.now() - projectionStartedAt);
  if (details.some((detail) => detail.events.length !== eventCountPerThread)) {
    throw new Error("Concurrent Run scale projection is incomplete");
  }
  return { threadCount, totalEventCount, eventCountPerThread, batchDurationMs, projectionMs };
}

function sampleChecks(sample, limits) {
  const key = String(sample.targetEventCount);
  return [
    check(`store.${key}.batchDurationMs`, sample.batchDurationMs, limits.batchDurationMs[key], "ms"),
    check(`store.${key}.appendP95Ms`, sample.p95AppendMs, limits.appendP95Ms[key], "ms"),
    check(`store.${key}.detailMs`, sample.detailDurationMs, limits.detailMs[key], "ms"),
    check(`store.${key}.incrementalQueryMs`, sample.incrementalQueryMs, limits.incrementalQueryMs[key], "ms"),
    check(`store.${key}.typedQueryMs`, sample.typedQueryMs, limits.typedQueryMs[key], "ms"),
    check(`store.${key}.databaseBytesPerEvent`, sample.databaseBytesPerEvent, limits.maximumDatabaseBytesPerEvent, "bytes/event"),
  ];
}

export function verifyStoreScaleReport(report, currentBudget) {
  const errors = [];
  if (report?.kind !== "napier.store-scale-benchmark" || report?.schemaVersion !== 2) errors.push("report_shape_invalid");
  if (report?.status !== "passed") errors.push("report_budget_failed");
  if (report?.budgetSha256 !== sha256(currentBudget)) errors.push("report_budget_mismatch");
  if (report?.contentSha256 !== sha256WithoutContentHash(report)) errors.push("report_content_hash_mismatch");
  return errors;
}

function validateBudget(currentBudget, eventCounts) {
  if (currentBudget?.kind !== "napier.long-run-scale-budget" || currentBudget?.schemaVersion !== 1) {
    throw new Error("Long-run scale budget is invalid");
  }
  if (eventCounts.some((count) => !currentBudget.eventCounts.includes(count))) {
    throw new Error("Store scale event count is not budgeted");
  }
  if (
    currentBudget.concurrentRuns?.threadCount !== 4 ||
    currentBudget.concurrentRuns?.totalEventCount !== 10_000
  ) {
    throw new Error("Concurrent Run scale budget is invalid");
  }
}

function parseEventCounts(value) {
  if (!value) return DEFAULT_EVENT_COUNTS;
  const counts = [...new Set(value.split(",").map((entry) => Number(entry.trim())).filter((entry) => Number.isSafeInteger(entry) && entry > 0))].sort((left, right) => left - right);
  if (counts.length === 0 || counts.at(-1) > MAX_EVENT_COUNT) {
    throw new Error(`NAPIER_BENCH_EVENT_COUNTS must contain ascending positive integers up to ${String(MAX_EVENT_COUNT)}`);
  }
  return counts;
}

function parseArguments(args) {
  const outputIndex = args.indexOf("--output");
  const verifyIndex = args.indexOf("--verify");
  if (outputIndex !== -1 && verifyIndex !== -1) throw new Error("--output and --verify are mutually exclusive");
  return {
    outputPath: outputIndex === -1 ? undefined : path.resolve(requiredValue(args, outputIndex, "--output")),
    verifyPath: verifyIndex === -1 ? undefined : path.resolve(requiredValue(args, verifyIndex, "--verify")),
  };
}

async function sqlitePersistentBytes(dataRoot) {
  let totalBytes = 0;
  for (const fileName of ["ledger.sqlite", "ledger.sqlite-wal"]) {
    try {
      totalBytes += (await stat(path.join(dataRoot, fileName))).size;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (totalBytes === 0) throw new Error("Store scale SQLite evidence is missing");
  return totalBytes;
}

function check(metric, observed, limit, unit) {
  if (typeof limit !== "number") throw new Error(`Missing scale budget: ${metric}`);
  return { metric, observed, limit, unit, passed: observed <= limit };
}
function requiredValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return value;
}
function sha256(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function sha256WithoutContentHash(report) { const { contentSha256: _contentSha256, ...body } = report; return sha256(body); }
function average(values) { return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length; }
function percentile(values, quantile) { if (values.length === 0) return 0; const sorted = [...values].sort((left, right) => left - right); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))]; }
function round(value) { return Math.round(value * 1_000) / 1_000; }
function formatCount(value) { return new Intl.NumberFormat("en-US").format(value); }
