import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installPreparationProbe } from "./harness-preparation-probe.mjs";
import { appendFixedComparisonEvents, copyComparisonSeed, digest } from "./harness-preparation-comparison-fixture.mjs";

const options = JSON.parse(process.argv[2]);
const phases = options.phases ?? ["loop_guard", "invocation_context"];
assert.ok(Array.isArray(phases) && phases.length > 0 && phases.every((phase) => ["loop_guard", "invocation_context"].includes(phase)));
const fixture = JSON.parse(await readFile(options.fixture, "utf8"));
const probe = options.instrumented ? installPreparationProbe() : undefined;
const reference = await import(pathToFileURL(path.join(options.reference, "tool-loop-guard.js")));
const invocation = await import(pathToFileURL(path.join(options.arm === "baseline" ? options.reference : options.runtime, "agent-invocation-context.js")));
const { RunToolLoopGuardCursor } = await import(pathToFileURL(path.join(options.runtime, "run-tool-loop-guard-cursor.js")));
const samples = [];
const deltas = [];
const openStores = [];
let failure;
try {
  for (const seed of phases.includes("loop_guard") ? fixture.seeds : []) {
    const dataRoot = path.join(options.work, `loop-${seed.eventCount}`);
    const store = await copyComparisonSeed(fixture, seed.eventCount, dataRoot); openStores.push(store);
    const cursor = options.arm === "candidate" ? new RunToolLoopGuardCursor(store, fixture.run) : undefined;
    const action = async () => {
      if (cursor) return cursor.refresh(undefined);
      const events = await store.listRunEvents(fixture.run.id);
      return { detection: reference.detectToolCallLoop(events, fixture.run.id, undefined), triggers: reference.projectToolLoopGuardTriggers(events, fixture.run.id), active: reference.latestActiveToolLoopGuard(events, fixture.run.id, undefined) };
    };
    let currentRows = seed.rowCount;
    const append = async (label, inputs) => {
      const receipt = await appendFixedComparisonEvents(dataRoot, fixture, label, inputs);
      const observed = await store.listRunEvents(fixture.run.id, currentRows);
      assert.equal(observed.length, receipt.count, "Existing read worker did not observe committed delta");
      assert.equal(digest(JSON.stringify(observed)), receipt.eventsSha256, "Existing read worker returned a different delta");
      receipt.observedWorkerRows = observed.length; receipt.observedWorkerSha256 = digest(JSON.stringify(observed));
      deltas.push(receipt); currentRows = receipt.totalRows;
      return receipt;
    };
    const dimensions = (stage) => ({ phase: "loop_guard", eventCount: seed.eventCount, stage, inputRows: currentRows });
    const cold = await measured(dimensions("cold"), action); samples.push(cold);
    samples.push(await measured(dimensions("warm_unchanged"), action));
    const noise = Array.from({ length: 100 }, () => ({ type: "model.text.delta", category: "model", visibility: "hidden", payload: { delta: "noise", deltaBytes: 5, chunkCount: 1 } }));
    await append(`noise-${seed.eventCount}`, noise);
    samples.push(await measured(dimensions("warm_noise_only"), action));
    if (cold.output.detection) {
      await append(`trigger-${seed.eventCount}`, [{ type: "model.tool_loop.detected", category: "system", visibility: "debug", payload: cold.output.detection }]);
      samples.push(await measured(dimensions("warm_trigger"), action));
    }
    await append(`pending-${seed.eventCount}`, [{ type: "model.response", category: "model", visibility: "debug", payload: { toolCalls: [{ id: "comparison_late_call", name: "read_file", arguments: { path: "shipping-late.ts" } }] } }, ...noise]);
    samples.push(await measured(dimensions("warm_pending_terminal"), action));
    await append(`late-${seed.eventCount}`, [{ type: "tool.failed", category: "tool", visibility: "debug", payload: { callId: "comparison_late_call", toolName: "read_file", output: "Synthetic late terminal", resultSha256: digest("Synthetic late terminal") } }]);
    samples.push(await measured(dimensions("warm_late_terminal"), action));
    await store.close(); openStores.splice(openStores.indexOf(store), 1);
  }
  for (const workload of phases.includes("invocation_context") ? fixture.workloads : []) {
    const dataRoot = path.join(options.work, `memory-${workload.name}`);
    const store = await copyComparisonSeed(fixture, fixture.seeds.at(-1).eventCount, dataRoot); openStores.push(store);
    const facts = JSON.parse(await readFile(workload.factsFile, "utf8")); assert.equal(digest(JSON.stringify(facts)), workload.factsSha256);
    let eventReads, receipt;
    const contextStore = { workspaceRoot: fixture.workspaceRoot, dataRoot,
      listRuns: (id) => store.listRuns(id),
      listEvents: (id) => { eventReads.full++; return store.listEvents(id); },
      listRunEvents: (id) => store.listRunEvents(id),
      findLatestEvent: (query) => { eventReads.head++; return store.findLatestEvent(query); },
      listEventsRange: async (...args) => { eventReads.range++; const rows = await store.listEventsRange(...args); eventReads.deltaRows += rows.length; return rows; },
      listMemories: () => structuredClone(facts),
      appendEvent: async (event) => { receipt = structuredClone(event); return store.appendEvent(event); },
    };
    const prepare = options.arm === "candidate"
      ? invocation.createAgentInvocationContextPreparer({ store: contextStore, run: fixture.run })
      : (input) => invocation.prepareAgentInvocationContext({ ...input, store: contextStore, run: fixture.run });
    let previousContext;
    for (let iteration = 0; iteration < 3; iteration++) {
      eventReads = { full: 0, head: 0, range: 0, deltaRows: 0 }; receipt = undefined;
      const sample = await measured({ phase: "invocation_context", eventCount: fixture.seeds.at(-1).eventCount, workload: workload.name, factCount: workload.factCount, uniquePaths: workload.uniquePaths, iteration, indexState: iteration === 0 ? "cold" : "warm" }, async () => {
        const context = await prepare({
          context: { messages: [{ role: "user", content: "Inspect shipping thresholds", timestamp: 0 }], systemPrompt: "Synthetic profiling fixture" },
          policy: { memory: "task-aware-v1", workingState: "evidence-v1" },
        });
        return invocation.agentInvocationContextFor(context);
      });
      sample.eventReads = eventReads;
      assert.equal(eventReads.full, options.arm === "baseline" ? 1 : 0, "Unexpected full invocation replay");
      assert.equal(eventReads.head, options.arm === "candidate" ? 1 : 0, "Native cursor path was not exercised");
      if (options.arm === "candidate") {
        assert.equal(eventReads.range, 1);
        if (iteration > 0) assert.equal(eventReads.deltaRows, 0, "Unchanged input returned a typed delta");
      }
      const { index, dependencyValidation, ...semantics } = receipt.payload;
      sample.receipt = receipt; sample.receiptSemantic = { ...receipt, payload: semantics };
      sample.receiptSemanticSha256 = digest(JSON.stringify(sample.receiptSemantic));
      sample.index = index; sample.dependencyValidation = dependencyValidation;
      samples.push(sample);
      assert.equal(receipt.payload.staleFactIds.length, Math.ceil(workload.factCount / 10));
      for (const id of fixture.forbiddenIds) assert.ok(!receipt.payload.factIds.includes(id));
      assert.ok(!JSON.stringify(sample.output).includes("SECRET_"));
      if (previousContext) assert.equal(sample.outputSha256, previousContext, "Warm context changed");
      previousContext = sample.outputSha256;
      if (probe) {
        const referenceReads = options.baselineDependencyReuse
          ? workload.uniquePaths + workload.reusedPaths
          : workload.factCount;
        // The current runtime rechecks every observed path after ranking.
        const expectedReads = options.arm === "baseline" ? referenceReads : 2 * workload.uniquePaths;
        assert.equal(sample.metrics.fileReadCalls, expectedReads, "Observed dependency read count differs from the declared workload");
      }
    }
    await store.close(); openStores.splice(openStores.indexOf(store), 1);
  }
} catch (error) { failure = error; }
finally { for (const store of openStores) { try { await store.close(); } catch (error) { failure ??= error; } } probe?.restore(); }
const result = { arm: options.arm, order: options.order, instrumented: options.instrumented, phases,
  baselineDependencyReuse: options.baselineDependencyReuse === true, success: !failure, samples, deltas,
  ...(failure ? { error: { name: failure.name, message: String(failure), stack: failure.stack } } : {}) };
await mkdir(path.dirname(options.output), { recursive: true }); await writeFile(options.output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
if (failure) { console.error(failure); process.exitCode = 1; }
else console.log(JSON.stringify({ arm: options.arm, order: options.order, instrumented: options.instrumented, samples: samples.length }));

async function measured(dimensions, action) {
  probe?.reset();
  const beforeRss = process.memoryUsage().rss; let peakRss = beforeRss;
  const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
  const cpu = process.cpuUsage(), threadCpu = process.threadCpuUsage(), start = performance.now();
  let output;
  try { output = await action(); } finally { clearInterval(timer); }
  const wallMs = performance.now() - start, threadDelta = process.threadCpuUsage(threadCpu), cpuDelta = process.cpuUsage(cpu);
  const metrics = probe?.snapshot() ?? null;
  const afterRss = process.memoryUsage().rss;
  const result = { ...dimensions, wallMs, processCpuMicros: cpuDelta.user + cpuDelta.system, mainThreadCpuMicros: threadDelta.user + threadDelta.system,
    rssBefore: beforeRss, rssAfter: afterRss, sampledPeakRss: Math.max(peakRss, afterRss), processMaxRssKiB: process.resourceUsage().maxRSS,
    metrics, output, outputSha256: digest(JSON.stringify(output)) };
  if (metrics && dimensions.phase === "loop_guard") {
    assert.equal(metrics.worker.jsonCalls, metrics.worker.eventReturnedRows);
    if (options.arm === "baseline") assert.equal(metrics.worker.eventReturnedRows, dimensions.inputRows);
    else if (dimensions.stage === "warm_unchanged" || dimensions.stage === "warm_noise_only") assert.equal(metrics.worker.eventReturnedRows, 0);
  }
  return result;
}
