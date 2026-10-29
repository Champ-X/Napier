import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value);
export async function createComparisonFixture(directory, smoke) {
  const [{ LocalStore }, { SqliteLedger }, { applyThreadSummaryEvent, replayThreadSummaryTails }, { resolveRegisteredEventInput }, memory] = await Promise.all([
    import("../packages/runtime/dist/store.js"), import("../packages/runtime/dist/sqlite-ledger.js"),
    import("../packages/runtime/dist/store-thread-summary-projection.js"), import("../packages/runtime/dist/run-event-registry.js"),
    import("../packages/runtime/dist/memory.js"),
  ]);
  const started = performance.now();
  const workspaceRoot = path.join(directory, "workspace"); await mkdir(workspaceRoot, { recursive: true });
  const templateRoot = path.join(directory, "template");
  const template = new LocalStore({ workspaceRoot, dataRoot: templateRoot });
  await template.initialize();
  const agent = template.listAgents()[0];
  const thread = await template.createThread({ title: "Fixed preparation comparison corpus", agentId: agent.id });
  const { run } = await template.createLeasedRun({ threadId: thread.id, agentId: agent.id }, { ownerId: `benchmark:${process.pid}:preparation`, ttlMs: 600_000 });
  await template.appendEvent({ threadId: thread.id, runId: run.id, type: "message.user", category: "message", visibility: "user", payload: { role: "user", text: "Inspect shipping thresholds." } });
  const originalEvents = (await Promise.all(template.listThreads().map((item) => template.listEvents(item.id)))).flat();
  await template.close();
  const originalLedger = new SqliteLedger(path.join(templateRoot, "ledger.sqlite")); originalLedger.initialize();
  const snapshot = originalLedger.readSnapshot(); originalLedger.close();
  assert.ok(snapshot);
  const state = JSON.parse(snapshot.stateJson);
  replayThreadSummaryTails({ threads: state.threads, expectedEventCount: snapshot.revision - snapshot.snapshotRevision,
    listEvents: (threadId, afterSeq) => originalEvents.filter((event) => event.threadId === threadId && event.seq > afterSeq).sort((a, b) => a.seq - b.seq) });
  const originalThread = state.threads.find((item) => item.id === thread.id);
  const firstSeq = originalThread.eventCount;
  const epoch = Date.parse(originalThread.updatedAt);
  // Three repeated calls are needed to exercise the trigger stage in smoke too.
  const scales = smoke ? [300] : [10_000, 100_000];
  const seeds = [];
  for (const eventCount of scales) {
    const events = [...originalEvents];
    const projected = structuredClone(state);
    const target = projected.threads.find((item) => item.id === thread.id);
    for (let offset = 0; offset < eventCount; offset++) {
      const position = offset % 100, callId = `profile_${Math.floor(offset / 100)}`;
      const input = position === 0 ? {
        type: "model.response", category: "model", visibility: "debug",
        payload: { toolCalls: [{ id: callId, name: "read_file", arguments: { path: "shipping.ts" } }] },
      } : position === 1 ? {
        type: "tool.completed", category: "tool", visibility: "debug",
        payload: { callId, toolName: "read_file", output: "Synthetic stable shipping evidence", resultSha256: digest("Synthetic stable shipping evidence") },
      } : {
        type: "model.text.delta", category: "model", visibility: "hidden", payload: { delta: "x".repeat(128), deltaBytes: 128, chunkCount: 1 },
      };
      const checked = resolveRegisteredEventInput({ threadId: thread.id, runId: run.id, ...input });
      const event = { id: `event_${digest(`fixed-event:${offset}`).slice(0, 24)}`, threadId: thread.id, runId: run.id,
        seq: firstSeq + offset + 1, type: checked.type, category: checked.category, visibility: checked.visibility,
        createdAt: new Date(epoch + offset + 1).toISOString(), payload: checked.payload, schemaVersion: checked.schemaVersion };
      applyThreadSummaryEvent(target, event); events.push(event);
    }
    const seedRoot = path.join(directory, `seed-${eventCount}`); await mkdir(seedRoot);
    const ledger = new SqliteLedger(path.join(seedRoot, "ledger.sqlite")); ledger.initialize();
    ledger.bootstrap(json(projected), events); ledger.close();
    const reopened = new LocalStore({ workspaceRoot, dataRoot: seedRoot }); await reopened.initialize();
    const actual = await reopened.listRunEvents(run.id);
    const expected = events.filter((event) => event.runId === run.id).sort((a, b) => a.seq - b.seq);
    assert.deepEqual(actual, expected); assert.equal(actual.length, eventCount + firstSeq);
    assert.equal(reopened.getThread(thread.id).eventCount, target.eventCount);
    assert.equal(reopened.listRuns(thread.id).find((item) => item.id === run.id).status, "running");
    await reopened.close();
    checkpoint(path.join(seedRoot, "ledger.sqlite"));
    seeds.push({ eventCount, rowCount: actual.length, maxSeq: actual.at(-1).seq, eventsSha256: digest(json(actual)), database: path.join(seedRoot, "ledger.sqlite"), databaseSha256: digest(await readFile(path.join(seedRoot, "ledger.sqlite"))) });
  }
  const factScales = smoke ? [50] : [1_000, 10_000];
  const uniqueControl = smoke ? 50 : 1_000;
  const contents = [];
  for (let index = 0; index < Math.max(32, uniqueControl); index++) {
    const filename = `shipping-${index}.ts`, content = `// synthetic shipping module ${index}\n${"x".repeat(1024)}\n`;
    await writeFile(path.join(workspaceRoot, filename), content, { flag: "wx" });
    contents.push({ path: filename, sha256: digest(content), bytes: Buffer.byteLength(content) });
  }
  const makeFact = (index, unique) => {
    const dependency = { path: contents[unique ? index : index % 32].path, sha256: contents[unique ? index : index % 32].sha256 };
    if (index % 10 === 0) dependency.sha256 = "0".repeat(64);
    const fact = memory.reviewMemoryFact(memory.createMemoryFact({ content: `Shipping module ${index} uses integer cents and threshold ${index + 5000}.`, category: "context" }, { type: "manual", fileDependencies: [dependency] }), { action: "approve" });
    fact.id = `memory_${digest(`${unique ? "unique" : "shared"}:${index}`).slice(0, 24)}`;
    return fact;
  };
  const forbidden = [
    { ...memory.reviewMemoryFact(memory.createMemoryFact({ content: "SECRET_FOREIGN shipping" }, { type: "manual" }), { action: "approve" }), id: "memory_forbidden_foreign", scope: "agent", agentId: "agent_foreign" },
    { ...memory.createMemoryFact({ content: "SECRET_PROPOSED shipping" }, { type: "manual" }), id: "memory_forbidden_proposed" },
    { ...memory.reviewMemoryFact(memory.createMemoryFact({ content: "SECRET_EXPIRED shipping" }, { type: "manual" }), { action: "approve" }), id: "memory_forbidden_expired", reviewDueAt: "2000-01-01T00:00:00Z" },
  ];
  const allShared = Array.from({ length: factScales.at(-1) }, (_, index) => makeFact(index, false));
  const workloads = [
    ...factScales.map((factCount) => ({ name: `shared-${factCount}`, factCount, uniquePaths: 32, reusedPaths: Math.min(32, factCount - 32), facts: [...allShared.slice(0, factCount), ...forbidden] })),
    { name: `unique-${uniqueControl}`, factCount: uniqueControl, uniquePaths: uniqueControl, reusedPaths: 0, facts: [...Array.from({ length: uniqueControl }, (_, index) => makeFact(index, true)), ...forbidden] },
  ];
  for (const workload of workloads) {
    const filename = path.join(directory, `${workload.name}.facts.json`);
    await writeFile(filename, json(workload.facts) + "\n", { flag: "wx" });
    workload.factsSha256 = digest(json(workload.facts)); workload.factsFile = filename; delete workload.facts;
  }
  const manifest = { workspaceRoot, run, thread, seeds, workloads, contents, forbiddenIds: forbidden.map((fact) => fact.id),
    corpusKind: "fixed synthetic noisy run, reviewed memory facts and declared stale/unauthorized controls",
    fixtureLeaseExpiresAt: run.lease.expiresAt, setupWallMs: performance.now() - started,
    seedMethod: "Production SqliteLedger.bootstrap(stateJson, events[]) with production thread projection and LocalStore reopen validation; no single-event scale append loop",
    seedTimeExcluded: true, writePerformanceClaim: false };
  await writeFile(path.join(directory, "fixture-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}
export async function copyComparisonSeed(fixture, eventCount, dataRoot) {
  assert.ok(Date.parse(fixture.fixtureLeaseExpiresAt) > Date.now() + 30_000, "Fixture lease is near expiry; refusing changed recovery state");
  const seed = fixture.seeds.find((item) => item.eventCount === eventCount); assert.ok(seed);
  assert.equal(digest(await readFile(seed.database)), seed.databaseSha256, "Fixed seed changed");
  await mkdir(dataRoot, { recursive: true }); await copyFile(seed.database, path.join(dataRoot, "ledger.sqlite"));
  const { LocalStore } = await import("../packages/runtime/dist/store.js");
  const store = new LocalStore({ workspaceRoot: fixture.workspaceRoot, dataRoot }); await store.initialize();
  const events = await store.listRunEvents(fixture.run.id);
  assert.equal(digest(json(events)), seed.eventsSha256); assert.equal(events.length, seed.rowCount);
  assert.equal(store.listRuns(fixture.thread.id).find((item) => item.id === fixture.run.id).status, "running");
  return store;
}
function checkpoint(filename) {
  const database = new DatabaseSync(filename);
  try { database.exec("PRAGMA busy_timeout=5000"); const row = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get(); assert.equal(Number(row.busy), 0); }
  finally { database.close(); }
}

export async function appendFixedComparisonEvents(dataRoot, fixture, label, inputs) {
  const [{ SqliteLedger }, { applyThreadSummaryEvent }, { resolveRegisteredEventInput }] = await Promise.all([
    import("../packages/runtime/dist/sqlite-ledger.js"), import("../packages/runtime/dist/store-thread-summary-projection.js"), import("../packages/runtime/dist/run-event-registry.js"),
  ]);
  const ledger = new SqliteLedger(path.join(dataRoot, "ledger.sqlite")); ledger.initialize();
  try {
    const snapshot = ledger.readSnapshot(); const state = JSON.parse(snapshot.stateJson);
    const thread = state.threads.find((item) => item.id === fixture.thread.id);
    const events = inputs.map((input, index) => {
      const checked = resolveRegisteredEventInput({ threadId: thread.id, runId: fixture.run.id, ...input });
      const event = { id: `event_${digest(`${label}:${index}`).slice(0, 24)}`, threadId: thread.id, runId: fixture.run.id,
        seq: thread.eventCount + 1, type: checked.type, category: checked.category, visibility: checked.visibility,
        createdAt: new Date(Date.parse(fixture.run.startedAt) + thread.eventCount + 1).toISOString(), payload: checked.payload, schemaVersion: checked.schemaVersion };
      applyThreadSummaryEvent(thread, event); return event;
    });
    ledger.commit(snapshot.revision, json(state), events);
    return { label, count: events.length, eventsSha256: digest(json(events)), totalRows: thread.eventCount };
  } finally { ledger.close(); }
}
