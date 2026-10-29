import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installPreparationProbe } from "./harness-preparation-probe.mjs";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const smoke = args[0] === "--smoke";
if (smoke) args.shift();
assert.equal(args.length, 1, "Usage: node scripts/profile-harness-preparation.mjs [--smoke] <new-receipt.json>");
const output = path.resolve(args[0]);
await access(output).then(() => { throw new Error("Refusing to overwrite evidence"); }, (error) => { if (error.code !== "ENOENT") throw error; });
const eventCounts = smoke ? [100] : [10_000, 100_000];
const factCounts = smoke ? [50] : [1_000, 10_000];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const before = await bindings();
const probe = installPreparationProbe();
const { LocalStore } = await import("../packages/runtime/dist/store.js");
const { detectToolCallLoop, latestActiveToolLoopGuard, projectToolLoopGuardTriggers } = await import("../packages/runtime/dist/tool-loop-guard.js");
const { prepareAgentInvocationContext, agentInvocationContextFor } = await import("../packages/runtime/dist/agent-invocation-context.js");
const { createMemoryFact, reviewMemoryFact } = await import("../packages/runtime/dist/memory.js");
const temporary = await mkdtemp(path.join(tmpdir(), "napier-harness-profile-"));
const workspaceRoot = path.join(temporary, "workspace");
await mkdir(workspaceRoot);
const store = new LocalStore({ workspaceRoot, dataRoot: path.join(temporary, "data") });
const samples = [];
let failure;
try {
  await store.initialize();
  const agent = store.listAgents()[0];
  const thread = await store.createThread({ title: "Synthetic preparation scale", agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const append = (event) => store.appendEvent({ threadId: thread.id, runId: run.id, ...event });
  await append({ type: "message.user", category: "message", visibility: "user", payload: { role: "user", text: "Inspect shipping thresholds." } });
  let appended = 0;
  for (const count of eventCounts) {
    while (appended < count) {
      const position = appended % 100;
      const callId = `profile_${Math.floor(appended / 100)}`;
      await append(position === 0 ? {
        type: "model.response", category: "model", visibility: "debug",
        payload: { toolCalls: [{ id: callId, name: "read_file", arguments: { path: "shipping.ts" } }] },
      } : position === 1 ? {
        type: "tool.completed", category: "tool", visibility: "debug",
        payload: { callId, toolName: "read_file", output: "Synthetic stable shipping evidence", resultSha256: hash("Synthetic stable shipping evidence") },
      } : {
        type: "model.text.delta", category: "model", visibility: "hidden",
        payload: { delta: "x".repeat(128), deltaBytes: 128, chunkCount: 1 },
      });
      appended++;
      if (appended % 10_000 === 0) console.log(JSON.stringify({ seededEvents: appended }));
    }
    for (let iteration = 0; iteration < 3; iteration++) {
      let eventLength = 0;
      const sample = await measured("run_loop_guard_full_replay", { eventCount: count, iteration }, async () => {
        const events = await store.listRunEvents(run.id);
        eventLength = events.length;
        return {
          detected: detectToolCallLoop(events, run.id, undefined),
          knownTriggers: projectToolLoopGuardTriggers(events, run.id),
          active: latestActiveToolLoopGuard(events, run.id, undefined),
        };
      });
      assert.ok(sample.metrics.worker.eventReturnedRows >= count, "Read-worker probe did not observe the production query");
      assert.equal(sample.metrics.worker.eventReturnedRows, eventLength);
      assert.equal(sample.metrics.worker.jsonCalls, eventLength);
      samples.push(sample);
    }
  }
  const dependencies = [];
  for (let index = 0; index < 32; index++) {
    const name = `shipping-${index}.ts`, content = `// synthetic shipping module ${index}\n${"x".repeat(1024)}\n`;
    await writeFile(path.join(workspaceRoot, name), content);
    dependencies.push({ path: name, sha256: hash(content) });
  }
  const facts = Array.from({ length: factCounts.at(-1) }, (_, index) => {
    const dependency = { ...dependencies[index % dependencies.length] };
    if (index % 10 === 0) dependency.sha256 = "0".repeat(64);
    return reviewMemoryFact(createMemoryFact({ content: `Shipping module ${index} uses integer cents and threshold ${index + 5000}.`, category: "context" }, { type: "manual", fileDependencies: [dependency] }), { action: "approve" });
  });
  const forbidden = [
    { ...reviewMemoryFact(createMemoryFact({ content: "SECRET_FOREIGN shipping" }, { type: "manual" }), { action: "approve" }), scope: "agent", agentId: "foreign" },
    createMemoryFact({ content: "SECRET_PROPOSED shipping" }, { type: "manual" }),
    { ...reviewMemoryFact(createMemoryFact({ content: "SECRET_EXPIRED shipping" }, { type: "manual" }), { action: "approve" }), reviewDueAt: "2000-01-01T00:00:00Z" },
  ];
  for (const count of factCounts) {
    const selected = facts.slice(0, count);
    const memoryStore = {
      workspaceRoot, dataRoot: path.join(temporary, `memory-${count}`),
      listRuns: (id) => store.listRuns(id), listEvents: (id) => store.listEvents(id),
      listRunEvents: (id) => store.listRunEvents(id),
      listMemories: () => structuredClone([...selected, ...forbidden]),
      appendEvent: (input) => store.appendEvent(input),
    };
    let previousOutput;
    for (let iteration = 0; iteration < 3; iteration++) {
      let receipt;
      const sample = await measured("invocation_working_state_and_memory", { eventCount: eventCounts.at(-1), factCount: count, iteration, indexState: iteration === 0 ? "cold" : "warm" }, async () => {
        const context = await prepareAgentInvocationContext({
          context: { messages: [{ role: "user", content: "Inspect shipping thresholds", timestamp: 0 }], systemPrompt: "Synthetic profiling fixture" },
          run, store: { ...memoryStore, appendEvent: async (input) => { receipt = input.payload; return memoryStore.appendEvent(input); } },
          policy: { memory: "task-aware-v1", workingState: "evidence-v1" },
        });
        return agentInvocationContextFor(context);
      });
      sample.memory = { index: receipt.index, selected: receipt.factIds.length, stale: receipt.staleFactIds.length, excludedUnauthorized: forbidden.length };
      assert.equal(receipt.staleFactIds.length, Math.ceil(count / 10));
      for (const fact of forbidden) assert.ok(!receipt.factIds.includes(fact.id));
      assert.ok(sample.metrics.fileReadCalls >= count, "File dependency reads were not observed");
      if (previousOutput) assert.equal(sample.outputSha256, previousOutput, "Warm preparation changed the context");
      previousOutput = sample.outputSha256;
      samples.push(sample);
    }
  }
} catch (error) { failure = error; }
finally {
  try { await store.close(); } catch (error) { failure ??= error; }
  probe.restore();
}
const after = await bindings();
try { assert.deepEqual(after, before, "Profiled source/build/scripts changed during capture"); } catch (error) { failure ??= error; }
const result = {
  kind: "napier.harness-preparation-profile", schemaVersion: 1, capturedAt: new Date().toISOString(),
  success: !failure, smoke, eventCounts, factCounts, iterations: 3,
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  externalModelRequests: 0, modelInvocations: 0, temporaryFixture: temporary, samples,
  bindings: before, bindingsUnchanged: JSON.stringify(before) === JSON.stringify(after),
  scope: "Synthetic events/facts through production LocalStore read worker, full loop-guard replay, and prepareAgentInvocationContext; no provider dispatch or model quality experiment",
  limits: [
    "Timing includes benchmark observers. SQL counts are returned rows, not SQLite internal rows scanned.",
    "JSON decoding CPU is sampled every 32 calls per query on its executing thread; sample CPU includes timer/counter overhead and is not an exact aggregate CPU attribution.",
    "RSS is sampled at phase boundaries and at 20ms intervals; process high-water RSS includes fixture preparation and earlier phases.",
    "Memory facts are reviewed synthetic records supplied through the production preparation input; repository fact-loading cost is replaced by structuredClone.",
    "Invocation timing covers working-state/memory preparation, not every operation before a provider invocation. Loop-guard replay is measured separately.",
    "Selected hot-path source files and all consumed Runtime/Contracts JS build files are bound. Concurrent unrelated source work is outside that source subset.",
    "No baseline/candidate quality improvement, untouched holdout, operating-system cache flush or complete G07 claim.",
  ],
  ...(failure ? { error: { message: String(failure), stack: failure.stack } } : {}),
};
if (!failure) { await rm(temporary, { recursive: true, force: true }); result.temporaryFixtureRemoved = true; }
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, success: !failure, samples: samples.length, error: failure ? String(failure) : null }));
if (failure) process.exitCode = 1;

async function measured(phase, dimensions, action) {
  probe.reset();
  const beforeRss = process.memoryUsage().rss;
  let peakRss = beforeRss;
  const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 20);
  const cpu = process.cpuUsage(), threadCpu = process.threadCpuUsage(), start = performance.now();
  let value;
  try { value = await action(); } finally { clearInterval(timer); }
  const wallMs = performance.now() - start, threadDelta = process.threadCpuUsage(threadCpu), cpuDelta = process.cpuUsage(cpu);
  const metrics = probe.snapshot();
  const afterRss = process.memoryUsage().rss;
  const sample = { phase, ...dimensions, wallMs, processCpuMicros: cpuDelta.user + cpuDelta.system,
    mainThreadCpuMicros: threadDelta.user + threadDelta.system, rssBefore: beforeRss, rssAfter: afterRss,
    sampledPeakRss: Math.max(peakRss, afterRss), processMaxRssKiB: process.resourceUsage().maxRSS,
    metrics, outputSha256: hash(JSON.stringify(value)) };
  console.log(JSON.stringify({ phase, ...dimensions, wallMs, readRows: metrics.worker.eventReturnedRows, fileReads: metrics.fileReadCalls }));
  return sample;
}
async function bindings() {
  const sourceFiles = ["task-memory-context", "task-memory-index", "task-memory-selection", "task-memory-grouping", "tool-loop-guard", "tool-loop-guard-receipts", "agent-invocation-context", "agent-memory-context", "agent-working-state-context", "sqlite-ledger-query", "sqlite-ledger-read-worker"].map(name => `packages/runtime/src/${name}.ts`);
  const files = await Promise.all([...sourceFiles, "scripts/profile-harness-preparation.mjs", "scripts/harness-preparation-probe.mjs", "package-lock.json"].map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
  const trees = [];
  for (const directory of ["packages/runtime/dist", "packages/contracts/dist"]) {
    const entries = (await readdir(path.join(root, directory), { recursive: true, withFileTypes: true })).filter(e => e.isFile() && e.name.endsWith(".js")).map(e => path.relative(root, path.join(e.parentPath, e.name))).sort();
    const digests = await Promise.all(entries.map(async file => ({ path: file, sha256: hash(await readFile(path.join(root, file))) })));
    trees.push({ directory, suffix: ".js", files: digests.length, sha256: hash(JSON.stringify(digests)) });
  }
  return { files, trees };
}
