import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildTraceRunSemanticCollection } from "../apps/web/src/trace-semantic-rows.ts";
import { sampleTraceTrajectorySegments } from "../apps/web/src/trace-trajectory-layout.ts";
import {
  createTraceTrajectoryModel,
  traceTrajectoryIsKeyEvent,
  traceTrajectoryMatches,
} from "../apps/web/src/trace-trajectory-model.ts";
import {
  createTraceVirtualLayout,
  createTraceVirtualWindow,
  TRACE_VIRTUAL_VIEWPORT_PX,
} from "../apps/web/src/trace-virtual-window.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const budgetPath = path.join(repoRoot, "docs/long-run-scale-budget.json");

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runCli();
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const budget = JSON.parse(await readFile(budgetPath, "utf8"));
  if (options.verifyPath) {
    const report = JSON.parse(await readFile(options.verifyPath, "utf8"));
    const errors = verifyTraceScaleReport(report, budget);
    process.stdout.write(
      errors.length === 0
        ? `Trace scale baseline verified: ${report.contentSha256.slice(0, 16)}\n`
        : `Trace scale baseline invalid: ${errors.join(", ")}\n`,
    );
    if (errors.length > 0) process.exitCode = 1;
    return;
  }
  const report = runTraceScaleBenchmark(budget);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.outputPath)
    await writeFile(options.outputPath, serialized, "utf8");
  process.stdout.write(
    `Trace scale ${report.status}: ${report.samples.map((sample) => `${formatCount(sample.eventCount)} ${sample.projectionMs.toFixed(1)}ms/${String(sample.mountedRows)} rows`).join("; ")}\n`,
  );
  if (report.status !== "passed") {
    for (const check of report.checks.filter(
      (candidate) => !candidate.passed,
    )) {
      process.stderr.write(
        `Trace scale budget exceeded: ${check.metric} ${String(check.observed)} > ${String(check.limit)} ${check.unit}\n`,
      );
    }
    process.exitCode = 1;
  }
}

export function runTraceScaleBenchmark(budget) {
  validateBudget(budget);
  const initialRssBytes = process.memoryUsage().rss;
  const samples = budget.eventCounts.map((eventCount) =>
    measureSample(eventCount),
  );
  const maximumRssBytes = Math.max(
    initialRssBytes,
    ...samples.map((sample) => sample.rssBytes),
  );
  const checks = samples.flatMap((sample) => {
    const key = String(sample.eventCount);
    return [
      check(
        `trace.${key}.projectionMs`,
        sample.projectionMs,
        budget.trace.projectionMs[key],
        "ms",
      ),
      check(
        `trace.${key}.searchMs`,
        sample.searchMs,
        budget.trace.searchMs[key],
        "ms",
      ),
      check(
        `trace.${key}.filterMs`,
        sample.filterMs,
        budget.trace.filterMs[key],
        "ms",
      ),
      check(
        `trace.${key}.inspectorLookupMs`,
        sample.inspectorLookupMs,
        budget.trace.inspectorLookupMs[key],
        "ms",
      ),
      check(
        `trace.${key}.semanticRowsMs`,
        sample.semanticRowsMs,
        budget.trace.semanticRowsMs[key],
        "ms",
      ),
      check(
        `trace.${key}.virtualLayoutMs`,
        sample.virtualLayoutMs,
        budget.trace.virtualLayoutMs[key],
        "ms",
      ),
      check(
        `trace.${key}.mountedRows`,
        sample.mountedRows,
        budget.trace.maximumMountedRows,
        "rows",
      ),
      check(
        `trace.${key}.overviewSegments`,
        sample.overviewSegments,
        budget.trace.maximumOverviewSegments,
        "segments",
      ),
    ];
  });
  checks.push(
    check(
      "trace.rssGrowthBytes",
      Math.max(0, maximumRssBytes - initialRssBytes),
      budget.trace.maximumRssGrowthBytes,
      "bytes",
    ),
  );
  const reportWithoutHash = {
    kind: "napier.trace-scale-benchmark",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
    budgetSha256: sha256(budget),
    status: checks.every((candidate) => candidate.passed) ? "passed" : "failed",
    samples,
    memory: {
      initialRssBytes,
      maximumRssBytes,
      rssGrowthBytes: Math.max(0, maximumRssBytes - initialRssBytes),
    },
    checks,
  };
  return { ...reportWithoutHash, contentSha256: sha256(reportWithoutHash) };
}

function measureSample(eventCount) {
  globalThis.gc?.();
  const generatedAt = performance.now();
  const events = createEvents(eventCount);
  const run = createRun(eventCount);
  const generationMs = round(performance.now() - generatedAt);
  const projectionStartedAt = performance.now();
  const model = createTraceTrajectoryModel(events, [run]);
  const projectionMs = round(performance.now() - projectionStartedAt);
  assert(model.eventCount === eventCount, "Trace projection dropped events");
  assert(model.index.byId.size === eventCount, "Trace ID index is incomplete");
  assert(
    model.index.bySeq.get(eventCount)?.event.seq === eventCount,
    "Trace sequence index is incomplete",
  );

  const searchStartedAt = performance.now();
  const searchMatches = model.events.filter((event) =>
    traceTrajectoryMatches(event, "read_file"),
  );
  const searchMs = round(performance.now() - searchStartedAt);
  assert(searchMatches.length > 0, "Trace search did not find the tail call");
  const filterStartedAt = performance.now();
  const filtered = model.events.filter(
    (event) => event.lane === "tools" && traceTrajectoryIsKeyEvent(event),
  );
  const filterMs = round(performance.now() - filterStartedAt);
  assert(filtered.length > 0, "Trace lane/key filter is empty");
  const inspectorStartedAt = performance.now();
  let inspectedSequence = 0;
  for (let index = 0; index < 10_000; index += 1) {
    inspectedSequence +=
      model.index.byId.get(
        `event_scale_${String(eventCount - (index % 100)).padStart(6, "0")}`,
      )?.event.seq ?? 0;
  }
  const inspectorLookupMs = round(performance.now() - inspectorStartedAt);
  assert(inspectedSequence > 0, "Trace Inspector index lookup failed");

  const semanticStartedAt = performance.now();
  const collection = buildTraceRunSemanticCollection(
    model.runs[0]?.turns ?? [],
  );
  const semanticRowsMs = round(performance.now() - semanticStartedAt);
  assert(collection.totalRowCount > 0, "Trace semantic projection is empty");

  const virtualStartedAt = performance.now();
  const layout = createTraceVirtualLayout(collection);
  const window = createTraceVirtualWindow(
    layout,
    Math.max(0, layout.totalHeight - TRACE_VIRTUAL_VIEWPORT_PX),
    TRACE_VIRTUAL_VIEWPORT_PX,
  );
  const virtualLayoutMs = round(performance.now() - virtualStartedAt);
  const laneSegments = model.segments.filter(
    (segment) => segment.lane === "tools",
  );
  const overviewSegments = sampleTraceTrajectorySegments(
    laneSegments,
    laneSegments.at(-1)?.eventId,
  ).length;
  assert(window.items.at(-1)?.kind === "row", "Trace tail row is unreachable");
  return {
    eventCount,
    generationMs,
    projectionMs,
    searchMs,
    searchMatches: searchMatches.length,
    filterMs,
    filteredEventCount: filtered.length,
    inspectorLookupMs,
    semanticRowsMs,
    semanticRowCount: collection.totalRowCount,
    virtualLayoutMs,
    virtualHeightPx: layout.totalHeight,
    mountedRows: window.mountedRowCount,
    overviewSegments,
    indexedRuns: model.index.byRun.size,
    indexedTypes: model.index.byType.size,
    rssBytes: process.memoryUsage().rss,
  };
}

function createEvents(eventCount) {
  const base = Date.UTC(2026, 7, 27);
  return Array.from({ length: eventCount }, (_, offset) => {
    const seq = offset + 1;
    const cycle = offset % 8;
    const callOrdinal = Math.floor(offset / 8);
    const type = [
      "turn.started",
      "message.user",
      "context.model_envelope",
      "tool.started",
      "tool.completed",
      "model.response",
      "message.assistant",
      "context.prepared",
    ][cycle];
    return {
      id: `event_scale_${String(seq).padStart(6, "0")}`,
      threadId: "thread_trace_scale",
      runId: "run_trace_scale",
      seq,
      type,
      category: eventCategory(type),
      visibility:
        type === "message.user" || type === "message.assistant"
          ? "user"
          : "debug",
      createdAt: new Date(base + offset * 10).toISOString(),
      payload: eventPayload(type, callOrdinal),
    };
  });
}

function eventCategory(type) {
  if (type.startsWith("tool.")) return "tool";
  if (type.startsWith("message.")) return "message";
  if (type.startsWith("context.") || type === "model.response") return "model";
  return "lifecycle";
}

function eventPayload(type, ordinal) {
  if (type === "message.user") return { role: "user", text: "private input" };
  if (type === "message.assistant")
    return { role: "assistant", text: "bounded output" };
  if (type.startsWith("tool."))
    return { callId: `call_${String(ordinal)}`, toolName: "read_file" };
  if (type === "context.model_envelope") return { turnIndex: ordinal };
  if (type === "model.response")
    return { modelContextEnvelopeTurnIndex: ordinal };
  return { sequence: ordinal };
}

function createRun(eventCount) {
  return {
    id: "run_trace_scale",
    threadId: "thread_trace_scale",
    agentId: "agent_trace_scale",
    status: "completed",
    startedAt: new Date(Date.UTC(2026, 7, 27)).toISOString(),
    finishedAt: new Date(Date.UTC(2026, 7, 27) + eventCount * 10).toISOString(),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}

export function verifyTraceScaleReport(report, budget) {
  const errors = [];
  if (
    report?.kind !== "napier.trace-scale-benchmark" ||
    report?.schemaVersion !== 1
  )
    errors.push("report_shape_invalid");
  if (report?.status !== "passed") errors.push("report_budget_failed");
  if (report?.budgetSha256 !== sha256(budget))
    errors.push("report_budget_mismatch");
  if (report?.contentSha256 !== sha256WithoutContentHash(report))
    errors.push("report_content_hash_mismatch");
  return errors;
}

function validateBudget(budget) {
  assert(
    budget?.kind === "napier.long-run-scale-budget" &&
      budget?.schemaVersion === 1,
    "Long-run scale budget is invalid",
  );
  assert(
    Array.isArray(budget.eventCounts) &&
      budget.eventCounts.join(",") === "10000,100000",
    "Long-run scale event counts must be 10k and 100k",
  );
}

function check(metric, observed, limit, unit) {
  assert(typeof limit === "number", `Missing scale budget: ${metric}`);
  return { metric, observed, limit, unit, passed: observed <= limit };
}

function parseArguments(args) {
  const outputIndex = args.indexOf("--output");
  const verifyIndex = args.indexOf("--verify");
  if (outputIndex !== -1 && verifyIndex !== -1)
    throw new Error("--output and --verify are mutually exclusive");
  return {
    outputPath:
      outputIndex === -1
        ? undefined
        : path.resolve(requiredValue(args, outputIndex, "--output")),
    verifyPath:
      verifyIndex === -1
        ? undefined
        : path.resolve(requiredValue(args, verifyIndex, "--verify")),
  };
}

function requiredValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a path`);
  return value;
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256WithoutContentHash(report) {
  if (!report || typeof report !== "object") return "";
  const { contentSha256: _contentSha256, ...body } = report;
  return sha256(body);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(value);
}
