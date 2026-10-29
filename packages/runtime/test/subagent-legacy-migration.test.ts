import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocalStore } from "../src/store.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { SubagentCandidateStore } from "../src/subagent-candidate-store.js";
import type { LegacyCandidateMigrationProof } from "../src/subagent-candidate-legacy-capability.js";
import { LEGACY_CANDIDATE_MIGRATED_EVENT } from "../src/subagent-candidate-legacy-repository.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";
import { deliveryManager } from "./subagent-worktree-delivery-fixture.js";
import { createLegacyFixtureProducer, type NativeLegacyFixture } from "./subagent-legacy-fixture.js";

let producer: Awaited<ReturnType<typeof createLegacyFixtureProducer>>;
const stores: LocalStore[] = [];
beforeAll(async () => { producer = await createLegacyFixtureProducer(); }, 30_000);
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) store.close(); });
afterAll(async () => { await producer?.cleanup(); });
async function open(f: Pick<NativeLegacyFixture, "workspaceRoot" | "dataRoot">) {
  const store = new LocalStore(f); await store.initialize(); stores.push(store); return store;
}
function candidates(f: NativeLegacyFixture, store: LocalStore, now?: Date) {
  return new SubagentCandidateStore({ ...f, ...(now ? { now: () => now } : {}), requireCompletionBinding: true,
    legacyCandidateAuthority: (proof) => store.subagentChildRunRepository.reconcileLegacyCandidateProof(proof) });
}
function strictManager(f: NativeLegacyFixture, store: LocalStore) {
  return deliveryManager(f, { requireCompletionBinding: true,
    legacyCandidateAuthority: (proof) => store.subagentChildRunRepository.reconcileLegacyCandidateProof(proof) });
}
async function receipts(f: NativeLegacyFixture, store: LocalStore) {
  return (await store.listRunEvents(f.parentRunId)).filter((event) => event.type === LEGACY_CANDIDATE_MIGRATED_EVENT);
}
async function unchanged(f: NativeLegacyFixture, store: LocalStore) {
  expect(sha256(await readFile(f.capsulePath, "utf8"))).toBe(f.capsuleSha256);
  expect(store.listSubagentTasks(f.threadId)[0]).toEqual(f.task);
  expect(store.listSubagentTasks(f.threadId)[0]!.completion).toBeUndefined();
  expect((await store.listEvents(f.threadId)).filter((event) => event.type !== LEGACY_CANDIDATE_MIGRATED_EVENT)).toEqual(f.events);
}

describe("native legacy candidate authority migration", () => {
  it("uses actual old source and preserves capsule, Task, expiry, terminal evidence and one receipt across Stores/reopen", async () => {
    const f = await producer.create(), store = await open(f), other = await open(f);
    expect(f.modelCalls).toBe(0);
    const [first, second] = await Promise.all([store.reconcileLegacySubagentCandidate(f.candidateId), other.reconcileLegacySubagentCandidate(f.candidateId)]);
    expect(first).toEqual(second); expect(first.candidateExpiresAt).toBe(f.expiresAt);
    expect(await receipts(f, store)).toHaveLength(1); await unchanged(f, store);
    const reopened = await open(f);
    expect(await reopened.reconcileLegacySubagentCandidate(f.candidateId)).toEqual(first);
    expect((await candidates(f, reopened).inspect(f.candidateId)).state).toBeUndefined();
    expect(await readFile(path.join(f.workspaceRoot, "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it("migrates on strict apply, performs the original diff once and reuses the settled receipt", async () => {
    const f = await producer.create(), store = await open(f), manager = strictManager(f, store);
    expect((await manager.apply(f.candidateId)).details.status).toBe("applied");
    const state = await candidates(f, store).inspect(f.candidateId);
    expect((await manager.apply(f.candidateId)).summary).toContain("Stored merge receipt reused");
    expect(await candidates(f, store).inspect(f.candidateId)).toEqual(state);
    expect(await receipts(f, store)).toHaveLength(1); await unchanged(f, store);
    expect(await readFile(path.join(f.workspaceRoot, "a.ts"), "utf8")).toBe("export const a = 2;\n");
    const replay = createThreadReplayBundle(await store.getDetail(f.threadId));
    expect(() => validateThreadReplayBundle(replay)).not.toThrow();
  });

  it("preserves already settled native state without writing or replaying it", async () => {
    const f = await producer.create(), store = await open(f);
    await deliveryManager(f).apply(f.candidateId);
    const before = await readFile(f.capsulePath.replace(/\.json$/u, ".state"), "utf8");
    const receipt = await store.reconcileLegacySubagentCandidate(f.candidateId);
    expect(receipt.candidateId).toBe(f.candidateId);
    expect((await strictManager(f, store).apply(f.candidateId)).summary).toContain("Stored merge receipt reused");
    expect(await readFile(f.capsulePath.replace(/\.json$/u, ".state"), "utf8")).toBe(before);
  });

  it("allows native execution after the imported evidence interval", async () => {
    const f = await producer.create("post_import"), store = await open(f);
    expect(store.getThread(f.threadId).importProvenance).toBeDefined();
    expect((await store.reconcileLegacySubagentCandidate(f.candidateId)).candidateId).toBe(f.candidateId);
    expect((await strictManager(f, store).apply(f.candidateId)).details.status).toBe("applied");
    await unchanged(f, store);
  });

  it("migrates old native typed output with its own schema and result proof", async () => {
    const f = await producer.create("typed"), store = await open(f);
    expect(f.task.outcome).toBeUndefined(); expect(f.task.output).toBe("updated");
    const receipt = await store.reconcileLegacySubagentCandidate(f.candidateId);
    expect(receipt).toMatchObject({ resultKind: "typed_output", resultSha256: sha256(canonicalJson("updated")),
      outputSchemaSha256: f.task.outputSchemaSha256 });
    expect((await strictManager(f, store).apply(f.candidateId)).details.status).toBe("applied");
    await unchanged(f, store);
  });

  it("revalidates the old typed value rather than trusting accepted event status", async () => {
    const f = await producer.create("typed_invalid"), store = await open(f);
    expect(f.task.output).toBe(42);
    await expect(store.reconcileLegacySubagentCandidate(f.candidateId)).rejects.toThrow("Legacy candidate typed output");
    expect(await receipts(f, store)).toHaveLength(0);
  });

  it("returns an expired applied settlement read-only without minting migration authority", async () => {
    const f = await producer.create(), store = await open(f);
    await deliveryManager(f).apply(f.candidateId);
    const statePath = f.capsulePath.replace(/\.json$/u, ".state"), state = await readFile(statePath, "utf8");
    const future = new Date(Date.parse(f.expiresAt) + 1);
    const applied = await deliveryManager(f, { requireCompletionBinding: true, now: () => future,
      legacyCandidateAuthority: (proof) => store.subagentChildRunRepository.reconcileLegacyCandidateProof(proof) }).apply(f.candidateId);
    expect(applied.summary).toContain("Stored merge receipt reused");
    expect(await readFile(statePath, "utf8")).toBe(state);
    expect(await receipts(f, store)).toHaveLength(0);
    await expect(candidates(f, store, future).reconcileLegacy(f.candidateId)).rejects.toThrow("expired");
  });

  it("never retries an expired verified rollback and preserves its state", async () => {
    const f = await producer.create(), store = await open(f);
    const rolledBack = await deliveryManager(f, { commitOptions: {
      async renameFile() { throw new Error("Local commit fault"); },
    } }).apply(f.candidateId);
    expect(rolledBack.details).toMatchObject({ status: "rolled_back", durable: true, rollbackVerified: true });
    const statePath = f.capsulePath.replace(/\.json$/u, ".state"), state = await readFile(statePath, "utf8");
    const manager = deliveryManager(f, { requireCompletionBinding: true, now: () => new Date(Date.parse(f.expiresAt) + 1),
      legacyCandidateAuthority: (proof) => store.subagentChildRunRepository.reconcileLegacyCandidateProof(proof) });
    await expect(manager.apply(f.candidateId)).rejects.toThrow("expired");
    expect(await readFile(statePath, "utf8")).toBe(state);
    expect(await readFile(path.join(f.workspaceRoot, "a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(await receipts(f, store)).toHaveLength(0);
  });

  it.each(["revoked", "applying", "expired"] as const)("rejects %s without granting or resetting authority", async (mode) => {
    const f = await producer.create(), store = await open(f), raw = new SubagentCandidateStore(f);
    if (mode === "revoked") await raw.revokeUndelivered(f.candidateId, f.taskId);
    if (mode === "applying") await raw.beginCommit({ ...(await raw.inspect(f.candidateId)).source, candidateId: f.candidateId });
    const before = await raw.inspect(f.candidateId);
    await expect(candidates(f, store, mode === "expired" ? new Date(Date.parse(f.expiresAt) + 1) : undefined)
      .reconcileLegacy(f.candidateId)).rejects.toThrow(/revoked|applying|expired/);
    expect(await raw.inspect(f.candidateId)).toEqual(before); expect(await receipts(f, store)).toHaveLength(0);
    await unchanged(f, store);
  });

  it("rejects indeterminate settled state even when its state checksum is valid", async () => {
    const f = await producer.create(), store = await open(f);
    await deliveryManager(f).apply(f.candidateId);
    const target = f.capsulePath.replace(/\.json$/u, ".state"), saved = JSON.parse(await readFile(target, "utf8"));
    saved.state.result.details.postcondition = "indeterminate";
    const { resultSha256: _old, ...details } = saved.state.result.details;
    saved.state.result.details.resultSha256 = sha256(canonicalJson(details));
    const bytes = canonicalJson({ state: saved.state, sha256: sha256(canonicalJson(saved.state)) });
    await writeFile(target, bytes);
    await expect(store.reconcileLegacySubagentCandidate(f.candidateId)).rejects.toThrow("settled state is unknown");
    expect(await readFile(target, "utf8")).toBe(bytes); expect(await receipts(f, store)).toHaveLength(0);
  });

  it("rejects multiple original-task capsules instead of choosing one by timestamp or nonce", async () => {
    const f = await producer.create(), store = await open(f), raw = new SubagentCandidateStore(f);
    const extra = await raw.store((await raw.inspect(f.candidateId)).source);
    expect(extra.id).not.toBe(f.candidateId);
    await expect(store.reconcileLegacySubagentCandidate(f.candidateId)).rejects.toThrow("ambiguous");
    await expect(store.reconcileLegacySubagentCandidate(extra.id)).rejects.toThrow("ambiguous");
    expect(await receipts(f, store)).toHaveLength(0); await unchanged(f, store);
  });

  it("rejects ambiguous completed events and fabricated proof objects", async () => {
    const f = await producer.create(), store = await open(f);
    await expect(store.subagentChildRunRepository.reconcileLegacyCandidateProof({} as LegacyCandidateMigrationProof))
      .rejects.toThrow("locked local proof");
    const event = f.events.find((entry) => entry.type === "subagent.completed")!;
    if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) throw new Error("Fixture completion is not an object");
    await store.appendEvent({ threadId: f.threadId, runId: f.parentRunId, type: "subagent.completed", category: "subagent", payload: event.payload });
    await expect(store.reconcileLegacySubagentCandidate(f.candidateId)).rejects.toThrow("missing or ambiguous");
    expect(await receipts(f, store)).toHaveLength(0);
  });

  it("rejects copied capsules outside their original dataRoot", async () => {
    const f = await producer.create(), copy = { workspaceRoot: f.workspaceRoot, dataRoot: path.join(f.root, "copied-data") };
    const store = await open(copy); await mkdir(path.join(copy.dataRoot, "subagent-candidates"), { mode: 0o700 });
    await copyFile(f.capsulePath, path.join(copy.dataRoot, "subagent-candidates", path.basename(f.capsulePath)));
    await expect(store.reconcileLegacySubagentCandidate(f.candidateId)).rejects.toThrow("workspace binding changed");
  });

  it("never converts an imported completed outcome or imported migration event into local authority", async () => {
    const f = await producer.create(), store = await open(f);
    await store.reconcileLegacySubagentCandidate(f.candidateId);
    const imported = await store.importThreadReplayBundle(createThreadReplayBundle(await store.getDetail(f.threadId)));
    expect(imported.events.some((event) => event.type === LEGACY_CANDIDATE_MIGRATED_EVENT)).toBe(false);
    const task = imported.subagents[0]!, raw = new SubagentCandidateStore(f);
    const original = (await raw.inspect(f.candidateId)).source;
    const source = { ...original, taskId: task.id, outcomeSha256: task.outcome!.contentSha256 };
    const { sourcePreviewResultSha256: _digest, sourceRoot: _root, changes: _changes, files: _files, ...content } = source;
    source.sourcePreviewResultSha256 = sha256(canonicalJson(content));
    const rebound = await raw.store(source);
    await expect(store.reconcileLegacySubagentCandidate(rebound.id)).rejects.toThrow("imported evidence");
    expect(store.listSubagentTasks(imported.thread.id)[0]!.completion).toBeUndefined();
    expect(await receipts(f, store)).toHaveLength(1);
  });

  it("rechecks live inventory after migration and never upgrades a conflicting candidate", async () => {
    const f = await producer.create(), store = await open(f), raw = new SubagentCandidateStore(f);
    const receipt = await store.reconcileLegacySubagentCandidate(f.candidateId);
    const extra = await raw.store((await raw.inspect(f.candidateId)).source);
    await expect(strictManager(f, store).apply(f.candidateId)).rejects.toThrow("ambiguous");
    expect((await receipts(f, store))[0]!.payload).toEqual(receipt);
    await rm(path.join(path.dirname(f.capsulePath), `${extra.id.slice(15)}.json`));
    expect(await store.reconcileLegacySubagentCandidate(f.candidateId)).toEqual(receipt);
  });

  it("rejects rehashed replacement metadata that the historical event did not independently anchor", async () => {
    const f = await producer.create(), store = await open(f);
    const replacement = await replaceCapsule(f, (source) => {
      source["sourceFileCount"] = Number(source["sourceFileCount"]) + 777;
      source["sourceBytes"] = Number(source["sourceBytes"]) + 777;
      source["readDependencies"] = [];
    });
    await expect(store.reconcileLegacySubagentCandidate(replacement)).rejects.toThrow("complete original source snapshot");
    expect(await receipts(f, store)).toHaveLength(0);
    expect(await readFile(path.join(f.workspaceRoot, "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it("constrains a rehashed omitted read-set by the independently published full baseline", async () => {
    const f = await producer.create("dependency"), store = await open(f);
    const replacement = await replaceCapsule(f, (source) => { source["readDependencies"] = []; });
    expect(replacement).not.toBe(f.candidateId);
    const receipt = await store.reconcileLegacySubagentCandidate(replacement);
    expect(receipt).toMatchObject({ candidateId: replacement, candidateIdentityEvidence: "current_private_capsule",
      sourceConstraint: { kind: "original_full_source_snapshot" } });
    await writeFile(path.join(f.workspaceRoot, "dependency.ts"), "export const dependency = 2;\n");
    await expect(strictManager(f, store).apply(replacement)).rejects.toThrow("complete original source snapshot");
    expect((await candidates(f, store).inspect(replacement)).state).toBeUndefined();
    expect(await readFile(path.join(f.workspaceRoot, "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it("rechecks the complete baseline after diagnostics and before the actual merge", async () => {
    const f = await producer.create("dependency"), store = await open(f);
    await store.reconcileLegacySubagentCandidate(f.candidateId);
    const manager = deliveryManager(f, { requireCompletionBinding: true,
      legacyCandidateAuthority: (proof) => store.subagentChildRunRepository.reconcileLegacyCandidateProof(proof),
      lifecycleDiagnostics: {
        async observeBefore(changes) {
          await writeFile(path.join(f.workspaceRoot, "dependency.ts"), "changed during diagnostics\n");
          return { entries: changes.map((change) => ({ change })), omittedFileCount: 0 };
        },
        async observeAfter() { throw new Error("Must reject before workspace commit"); },
        unavailable() { throw new Error("Unexpected unavailable diagnostics"); },
      },
    });
    await expect(manager.apply(f.candidateId)).rejects.toThrow("complete original source snapshot");
    expect((await candidates(f, store).inspect(f.candidateId)).state).toBeUndefined();
    expect(await readFile(path.join(f.workspaceRoot, "a.ts"), "utf8")).toBe("export const a = 1;\n");
  });

  it.each(["before_commit", "after_commit"] as const)("survives real SIGKILL %s with one durable receipt", async (mode) => {
    const f = await producer.create(), crashed = await worker(f, mode);
    expect((await crashed.ended).signal).toBe("SIGKILL");
    const store = await open(f);
    expect(await receipts(f, store)).toHaveLength(mode === "after_commit" ? 1 : 0);
    const receipt = await store.reconcileLegacySubagentCandidate(f.candidateId);
    expect(await store.reconcileLegacySubagentCandidate(f.candidateId)).toEqual(receipt);
    expect(await receipts(f, store)).toHaveLength(1); await unchanged(f, store);
    expect((await candidates(f, store).inspect(f.candidateId)).state).toBeUndefined();
  });

  it("commits one migration across two real processes", async () => {
    const f = await producer.create(), barrier = path.join(f.root, "go");
    const workers = await Promise.all([worker(f, "race", "one", barrier), worker(f, "race", "two", barrier)]);
    await writeFile(barrier, "go");
    expect(await Promise.all(workers.map((entry) => entry.ended))).toEqual([{ code: 0, signal: null }, { code: 0, signal: null }]);
    const values = await Promise.all(workers.map(async (entry) => JSON.parse(await readFile(entry.output, "utf8"))));
    expect(values[0]).toEqual(values[1]);
    const store = await open(f); expect(await receipts(f, store)).toHaveLength(1); await unchanged(f, store);
  });
});

async function replaceCapsule(f: NativeLegacyFixture, mutate: (source: Record<string, unknown>) => void): Promise<string> {
  const envelope = JSON.parse(await readFile(f.capsulePath, "utf8"));
  mutate(envelope.source);
  const { sourcePreviewResultSha256: _digest, sourceRoot: _root, changes: _changes, files: _files, ...content } = envelope.source;
  envelope.source.sourcePreviewResultSha256 = sha256(canonicalJson(content));
  const bytes = canonicalJson(envelope), hash = sha256(bytes);
  await rename(f.capsulePath, path.join(f.root, "original-capsule.json"));
  await writeFile(path.join(path.dirname(f.capsulePath), `${hash}.json`), bytes, { mode: 0o600 });
  return `subworkpreview_${hash}`;
}

async function worker(f: NativeLegacyFixture, mode: "before_commit" | "after_commit" | "race", suffix: string = mode, barrier?: string) {
  const output = path.join(f.root, `${suffix}-receipt.json`), config = path.join(f.root, `${suffix}-config.json`);
  await writeFile(config, JSON.stringify({ ...f, output, mode, barrier }));
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./subagent-legacy-migration-worker.ts", import.meta.url)), config],
    { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ended = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject); child.once("exit", (code, signal) => {
      if (code !== 0 && signal !== "SIGKILL") reject(new Error(stderr)); else resolve({ code, signal });
    });
  });
  return { output, ended };
}
