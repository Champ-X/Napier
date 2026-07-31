import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createProductPerformanceReport,
  validateProductPerformanceBudget,
} from "./product-performance-report.mjs";
export {
  PRODUCT_PERFORMANCE_METRICS,
  createProductPerformanceReport,
  readProductPerformanceBudget,
  validateProductPerformanceBudget,
  verifyProductPerformanceReport,
  verifyProductPerformanceReportFile,
} from "./product-performance-report.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "..");
const MAX_CLI_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_CLI_STDERR_BYTES = 64 * 1024;

export async function runProductPerformanceBenchmark(options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? defaultRepoRoot);
  const budget = validateProductPerformanceBudget(options.budget);
  options.signal?.throwIfAborted();
  const root = await mkdtemp(
    path.join(tmpdir(), "napier-product-performance-"),
  );
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "runtime-state");
  const cliEntrypoint = path.resolve(
    options.cliEntrypoint ?? path.join(repoRoot, "apps/cli/dist/index.js"),
  );
  let services;
  let servicesClosed = false;
  try {
    await mkdir(workspaceRoot);
    const benchmarkText = Array.from(
      { length: 512 },
      (_, index) => `performance sample line ${String(index + 1)}`,
    ).join("\n");
    await writeFile(
      path.join(workspaceRoot, "benchmark.txt"),
      benchmarkText,
      "utf8",
    );

    const cliSamples = [];
    for (let index = 0; index < budget.sample.cliIterations; index += 1) {
      options.signal?.throwIfAborted();
      cliSamples.push(
        await measureBuiltCliProductPath({
          cliEntrypoint,
          workspaceRoot,
          dataRoot: path.join(root, `cli-state-${String(index + 1)}`),
          timeoutMs: budget.sample.cliTimeoutMs,
          signal: options.signal,
        }),
      );
    }

    const memory = {
      initialRssBytes: process.memoryUsage().rss,
    };
    const moduleLoadStartedAt = performance.now();
    const runtimeModule = await import(
      pathToFileURL(path.join(repoRoot, "packages/runtime/dist/index.js")).href
    );
    const moduleLoadMs = round(performance.now() - moduleLoadStartedAt);
    memory.afterModuleLoadRssBytes = process.memoryUsage().rss;

    const bootstrapStartedAt = performance.now();
    services = await runtimeModule.createLocalAgentRuntime({
      workspaceRoot,
      dataRoot,
      env: {},
    });
    const bootstrapMs = round(performance.now() - bootstrapStartedAt);
    memory.afterBootstrapRssBytes = process.memoryUsage().rss;

    const readFileTool = runtimeModule
      .createWorkspaceTools(workspaceRoot)
      .find((tool) => tool.name === "read_file");
    if (!readFileTool) {
      throw new Error("Performance benchmark could not resolve read_file");
    }
    const toolDurations = [];
    const toolSignal = options.signal ?? new AbortController().signal;
    for (let index = 0; index < budget.sample.readFileIterations; index += 1) {
      options.signal?.throwIfAborted();
      const startedAt = performance.now();
      const result = await readFileTool.execute(
        `performance_read_${String(index + 1)}`,
        { path: "benchmark.txt" },
        toolSignal,
      );
      toolDurations.push(round(performance.now() - startedAt));
      if (
        result.details?.sizeBytes !== Buffer.byteLength(benchmarkText, "utf8")
      ) {
        throw new Error("Performance read_file result is not source-bound");
      }
    }
    memory.afterToolRssBytes = process.memoryUsage().rss;

    const agent = services.store.listAgents()[0];
    if (!agent) {
      throw new Error("Performance benchmark requires the seeded Agent");
    }
    const thread = await services.store.createThread({
      title: "Product performance benchmark",
      agentId: agent.id,
    });
    const run = await services.store.createRun({
      threadId: thread.id,
      agentId: agent.id,
    });
    const appendDurations = [];
    const batchStartedAt = performance.now();
    for (
      let index = 0;
      index < budget.sample.longThreadEventCount;
      index += 1
    ) {
      options.signal?.throwIfAborted();
      const appendStartedAt = performance.now();
      await services.store.appendEvent({
        threadId: thread.id,
        runId: run.id,
        type: "performance.benchmark.event",
        category: "lifecycle",
        visibility: "debug",
        payload: {
          sequence: index + 1,
          padding: "x".repeat(128),
        },
      });
      appendDurations.push(round(performance.now() - appendStartedAt));
    }
    const batchDurationMs = round(performance.now() - batchStartedAt);
    await services.store.finishRun(run.id, "completed");
    const projectionStartedAt = performance.now();
    const detail = await services.store.getDetail(thread.id);
    const projectionMs = round(performance.now() - projectionStartedAt);
    if (detail.events.length !== budget.sample.longThreadEventCount) {
      throw new Error("Performance long-Thread projection is incomplete");
    }
    memory.afterLongThreadRssBytes = process.memoryUsage().rss;

    await services.shutdown();
    servicesClosed = true;
    const databaseBytes = await sqlitePersistentBytes(dataRoot);
    const databaseEventCount = detail.events.length;
    const measurements = {
      cli: {
        sampleCount: cliSamples.length,
        samples: cliSamples,
        firstEventMedianMs: percentile(
          cliSamples.map((sample) => sample.firstEventMs),
          0.5,
        ),
        firstTokenMedianMs: percentile(
          cliSamples.map((sample) => sample.firstTokenMs),
          0.5,
        ),
        completionMedianMs: percentile(
          cliSamples.map((sample) => sample.completionMs),
          0.5,
        ),
      },
      runtime: {
        moduleLoadMs,
        bootstrapMs,
      },
      tool: {
        name: "read_file",
        iterations: toolDurations.length,
        durationsMs: toolDurations,
        p50Ms: percentile(toolDurations, 0.5),
        p95Ms: percentile(toolDurations, 0.95),
      },
      longThread: {
        eventCount: detail.events.length,
        batchDurationMs,
        appendP50Ms: percentile(appendDurations, 0.5),
        appendP95Ms: percentile(appendDurations, 0.95),
        projectionMs,
        detailBytes: Buffer.byteLength(JSON.stringify(detail), "utf8"),
        eventBytes: Buffer.byteLength(JSON.stringify(detail.events), "utf8"),
      },
      memory: finalizeMemoryMeasurement(memory),
      database: {
        eventCount: databaseEventCount,
        totalBytes: databaseBytes,
        bytesPerEvent: round(databaseBytes / databaseEventCount),
      },
    };
    return createProductPerformanceReport({
      budget,
      measurements,
      environment: {
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      },
      generatedAt: new Date().toISOString(),
    });
  } finally {
    if (services && !servicesClosed) {
      await services.shutdown().catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
  }
}

export async function measureBuiltCliProductPath(options) {
  options.signal?.throwIfAborted();
  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    [
      options.cliEntrypoint,
      "run",
      "--workspace",
      options.workspaceRoot,
      "--data-root",
      options.dataRoot,
      "--prompt",
      "Measure the built CLI product path.",
      "--jsonl",
    ],
    {
      cwd: options.workspaceRoot,
      env: benchmarkProcessEnvironment(process.env),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let timedOut = false;
  let aborted = false;
  let forceKillTimer;
  const terminate = () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    forceKillTimer ??= setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 500);
    forceKillTimer.unref();
  };
  const abort = () => {
    aborted = true;
    terminate();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, options.timeoutMs);
  timeout.unref();
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  try {
    const [frames, stderr, settled] = await Promise.all([
      collectCliFrames(child.stdout, startedAt),
      collectBoundedText(child.stderr, MAX_CLI_STDERR_BYTES, "CLI stderr"),
      exit,
    ]);
    if (aborted) throw abortError("Product performance CLI sample cancelled");
    if (timedOut) {
      throw new Error("Product performance CLI sample timed out");
    }
    if (settled.code !== 0 || settled.signal !== null) {
      throw new Error("Product performance CLI sample failed");
    }
    if (stderr.length > 0) {
      throw new Error("Product performance CLI sample wrote to stderr");
    }
    if (
      frames.firstEventMs === undefined ||
      frames.firstTokenMs === undefined ||
      frames.completionMs === undefined ||
      !frames.snapshotSeen ||
      frames.doneStatus !== "completed" ||
      frames.firstEventMs > frames.firstTokenMs ||
      frames.firstTokenMs > frames.completionMs
    ) {
      throw new Error("Product performance CLI event stream is incomplete");
    }
    return {
      firstEventMs: frames.firstEventMs,
      firstTokenMs: frames.firstTokenMs,
      completionMs: frames.completionMs,
      eventCount: frames.eventCount,
    };
  } catch (error) {
    terminate();
    await exit.catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
    if (forceKillTimer) clearTimeout(forceKillTimer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function collectCliFrames(stream, startedAt) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let totalBytes = 0;
  let firstEventMs;
  let firstTokenMs;
  let completionMs;
  let snapshotSeen = false;
  let doneStatus;
  let eventCount = 0;
  for await (const line of lines) {
    totalBytes += Buffer.byteLength(line, "utf8") + 1;
    if (totalBytes > MAX_CLI_STDOUT_BYTES) {
      throw new Error("Product performance CLI stdout exceeded its limit");
    }
    if (!line) continue;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      throw new Error("Product performance CLI emitted invalid JSONL");
    }
    const elapsedMs = round(performance.now() - startedAt);
    if (frame?.type === "event") {
      eventCount += 1;
      if (firstEventMs === undefined && frame.event?.type === "run.started") {
        firstEventMs = elapsedMs;
      }
      if (
        firstTokenMs === undefined &&
        frame.event?.type === "model.text.delta"
      ) {
        firstTokenMs = elapsedMs;
      }
    } else if (frame?.type === "snapshot") {
      snapshotSeen = true;
    } else if (frame?.type === "done") {
      completionMs = elapsedMs;
      doneStatus = frame.status;
    }
  }
  return {
    firstEventMs,
    firstTokenMs,
    completionMs,
    snapshotSeen,
    doneStatus,
    eventCount,
  };
}

async function collectBoundedText(stream, maxBytes, label) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      throw new Error(`${label} exceeded its limit`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function finalizeMemoryMeasurement(memory) {
  const observedPeakRssBytes = Math.max(...Object.values(memory));
  return {
    ...memory,
    observedPeakRssBytes,
    rssGrowthBytes: Math.max(0, observedPeakRssBytes - memory.initialRssBytes),
  };
}

async function sqlitePersistentBytes(dataRoot) {
  let totalBytes = 0;
  for (const fileName of ["ledger.sqlite", "ledger.sqlite-wal"]) {
    const filePath = path.join(dataRoot, fileName);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        throw new Error("Performance SQLite evidence is not a regular file");
      }
      totalBytes += info.size;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (totalBytes === 0) {
    throw new Error("Performance SQLite evidence is missing");
  }
  return totalBytes;
}

function percentile(values, quantile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return round(sorted[index]);
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

function benchmarkProcessEnvironment(environment) {
  return Object.fromEntries(
    ["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot"].flatMap((name) => {
      const value = environment[name];
      return value ? [[name, value]] : [];
    }),
  );
}

function abortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
