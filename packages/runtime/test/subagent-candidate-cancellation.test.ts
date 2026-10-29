import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { LocalPrivateCapsuleStore } from "../src/local-private-capsule-store.js";
import { LocalStore } from "../src/store.js";
import { SubagentCandidateStore, SUBAGENT_CANDIDATE_RETENTION_MS } from "../src/subagent-candidate-store.js";
import { completeSubagentTask } from "../src/subagent-completion.js";
import { finishSubagentTypedOutput } from "../src/subagent-typed-output-settlement.js";
import { settleSubagentOutcome } from "../src/subagent-outcome-settlement.js";
import * as worktreeFiles from "../src/subagent-worktree-files.js";
import { deliveryManager, digest, patchCandidate } from "./subagent-worktree-delivery-fixture.js";

const fixtures: Array<{ root: string; store: LocalStore }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map(async ({ root, store }) => {
    store.close();
    await rm(root, { recursive: true, force: true });
  }));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-candidate-cancel-"));
  const workspaceRoot = path.join(root, "workspace"), dataRoot = path.join(root, "data");
  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, "a.ts"), "export const a = 1;\n");
  const store = new LocalStore({ workspaceRoot, dataRoot });
  fixtures.push({ root, store });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({ title: "Cancelled candidate", agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  const registry = new ModelRegistry();
  const faux = fauxProvider({ provider: `candidate-${run.id}` });
  registry.registerProvider(faux.provider);
  const model = registry.resolve({ provider: faux.provider.id, id: "faux-1" })!;
  const task = await store.createSubagentTask({
    threadId: thread.id, runId: run.id, role: "coder", description: "Candidate cancellation",
    prompt: "Update a.ts", model: { provider: model.provider, id: model.id },
  });
  await store.startSubagentTask(task.id);
  const manager = deliveryManager({ workspaceRoot, dataRoot });
  const session = await manager.createWorktree(task.id, ["a.ts"]);
  await patchCandidate(manager, session, "a.ts", "export const a = 1;\n", "export const a = 2;\n");
  const abort = new AbortController();
  const emit = vi.fn(async () => undefined);
  const assertActive = () => abort.signal.throwIfAborted();
  const common = {
    store, task, worktrees: manager, worktree: session, usage: task.usage,
    toolSignal: abort.signal, assertActive, emit,
  };
  return {
    root, workspaceRoot, dataRoot, store, manager, session, task, abort, emit,
    complete: (kind: "typed" | "outcome" = "typed") => kind === "typed"
      ? finishSubagentTypedOutput({ ...common, output: "ready", resultText: "ready" })
      : settleSubagentOutcome({
          ...common, models: registry.models, model, runId: run.id,
          limits: { maxConcurrent: 1, maxTotal: 1, maxTurns: 1, timeoutMs: 5_000 },
          resultText: '{"summary":"ready","items":[],"unknowns":[]}',
          activateAgent: () => undefined, markOutcomeRejected: () => undefined,
          modelSession: {
            lifetime: { signal: abort.signal, assertActive, remainingMs: () => 5_000 },
            open: async () => { throw new Error("Unexpected model call"); },
          },
        }),
  };
}

async function candidateIds(dataRoot: string): Promise<string[]> {
  return (await readdir(path.join(dataRoot, "subagent-candidates")))
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .map((name) => `subworkpreview_${name.slice(0, -5)}`);
}

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => { resolve = ready; });
  return { promise, resolve };
}

describe("cancelled retained candidate delivery", () => {
  for (const kind of ["typed", "outcome"] as const) {
  for (const boundary of ["store returned", "candidate publication", "source cleanup", "queued completion"] as const) {
    it(`revokes the new ${kind} candidate when cancellation occurs at ${boundary}`, async () => {
      const f = await fixture();
      const cancellation = new Error(`Cancelled at ${boundary}`);
      const storePreview = f.manager.storePreview.bind(f.manager);
      const previewSpy = vi.spyOn(f.manager, "storePreview").mockImplementation(async (...args) => {
        const preview = await storePreview(...args);
        if (boundary === "store returned") f.abort.abort(cancellation);
        return preview;
      });
      if (boundary === "candidate publication") {
        const store = SubagentCandidateStore.prototype.store;
        vi.spyOn(SubagentCandidateStore.prototype, "store").mockImplementation(async function (this: SubagentCandidateStore, ...args) {
          const preview = await store.apply(this, args);
          f.abort.abort(cancellation);
          return preview;
        });
      }
      if (boundary === "queued completion") {
        const finish = f.store.finishSubagentTask.bind(f.store);
        vi.spyOn(f.store, "finishSubagentTask").mockImplementation((...args) => {
          const pending = finish(...args);
          f.abort.abort(cancellation);
          return pending;
        });
      }
      if (boundary === "source cleanup") {
        const remove = worktreeFiles.removeSubagentWorktree;
        vi.spyOn(worktreeFiles, "removeSubagentWorktree").mockImplementation(async (...args) => {
          await remove(...args);
          f.abort.abort(cancellation);
        });
      }
      await expect(f.complete(kind)).rejects.toThrow(cancellation.message);
      expect(previewSpy.mock.calls[0]?.[2]).toBe(f.abort.signal);
      const ids = await candidateIds(f.dataRoot);
      expect(ids).toHaveLength(1);
      const restored = deliveryManager(f);
      expect((await restored.inspectPreview(ids[0]!)).state?.status).toBe("revoked");
      await expect(restored.apply(ids[0]!)).rejects.toThrow(/revoked/u);
      expect(await readFile(path.join(f.workspaceRoot, "a.ts"), "utf8")).toBe("export const a = 1;\n");
      expect(f.store.listSubagentTasks(f.task.threadId)[0]?.status).toBe("running");
      expect(f.emit).not.toHaveBeenCalled();
    });
  }
  }

  it("retracts publication if source cleanup fails before storePreview can return its ID", async () => {
    const f = await fixture();
    vi.spyOn(worktreeFiles, "removeSubagentWorktree").mockRejectedValue(new Error("Source cleanup failed"));
    await expect(f.complete()).rejects.toThrow("Source cleanup failed");
    const [id] = await candidateIds(f.dataRoot);
    expect((await f.manager.inspectPreview(id!)).state?.status).toBe("revoked");
    await expect(deliveryManager(f).apply(id!)).rejects.toThrow(/revoked/u);
  });

  it("retracts a capsule installed by a store write that rejects before returning its ID", async () => {
    const f = await fixture();
    const put = LocalPrivateCapsuleStore.prototype.put;
    vi.spyOn(LocalPrivateCapsuleStore.prototype, "put").mockImplementation(async function (
      this: LocalPrivateCapsuleStore<unknown>, ...args
    ) {
      const result = await put.apply(this, args);
      if (this.rootPath === path.join(f.dataRoot, "subagent-candidates")) {
        f.abort.abort(new Error("Cancelled during publication"));
        throw new Error("Publication failed after install");
      }
      return result;
    });
    await expect(f.complete()).rejects.toThrow("Publication failed after install");
    const [id] = await candidateIds(f.dataRoot);
    expect((await deliveryManager(f).inspectPreview(id!)).state?.status).toBe("revoked");
    await expect(deliveryManager(f).apply(id!)).rejects.toThrow(/revoked/u);
    expect(f.emit).not.toHaveBeenCalled();
  });

  it("retains revoked evidence across restart until the existing retention boundary", async () => {
    const f = await fixture();
    const preview = await f.manager.storePreview(f.session, digest("ready"));
    expect(await f.manager.revokePreview(preview.id, f.task.id)).toBe(true);
    const restored = deliveryManager(f);
    expect(await restored.revokePreview(preview.id, f.task.id)).toBe(true);
    expect((await restored.inspectPreview(preview.id)).source.changes).toHaveLength(1);
    expect(await restored.prunePreviews([preview.id])).toBe(0);
    const expired = deliveryManager(f, { now: () => new Date(Date.now() + SUBAGENT_CANDIDATE_RETENTION_MS + 1_000) });
    expect(await expired.prunePreviews([preview.id])).toBe(1);
    await expect(expired.inspectPreview(preview.id)).rejects.toThrow(/not found/u);
  });

  it("refuses a different task and preserves normal apply idempotency after settlement", async () => {
    const f = await fixture();
    const preview = await f.manager.storePreview(f.session, digest("ready"));
    await expect(f.manager.revokePreview(preview.id, "task_other")).rejects.toThrow(/task binding/u);
    expect((await f.manager.inspectPreview(preview.id)).state).toBeUndefined();
    const applied = await f.manager.apply(preview.id);
    const before = (await f.manager.inspectPreview(preview.id)).state;
    expect(await f.manager.revokePreview(preview.id, f.task.id)).toBe(false);
    expect((await f.manager.inspectPreview(preview.id)).state).toEqual(before);
    const replay = await deliveryManager(f).apply(preview.id);
    expect(replay.details).toEqual(applied.details);
    expect(replay.summary).toContain("Stored merge receipt reused");
  });

  it("cannot acquire an active apply lock or overwrite an interrupted applying marker", async () => {
    const f = await fixture();
    const preview = await f.manager.storePreview(f.session, digest("ready"));
    const candidates = new SubagentCandidateStore(f);
    const entered = barrier(), release = barrier();
    const apply = candidates.apply(preview.id, async (source) => {
      await candidates.beginCommit(source);
      entered.resolve();
      await release.promise;
      throw new Error("Interrupted apply");
    });
    const failed = expect(apply).rejects.toThrow("Interrupted apply");
    await entered.promise;
    try {
      await expect(f.manager.revokePreview(preview.id, f.task.id)).rejects.toThrow(/already being edited/u);
    } finally {
      release.resolve();
    }
    await failed;
    const before = (await f.manager.inspectPreview(preview.id)).state;
    expect(before?.status).toBe("applying");
    expect(await deliveryManager(f).revokePreview(preview.id, f.task.id)).toBe(false);
    expect((await f.manager.inspectPreview(preview.id)).state).toEqual(before);
    await expect(f.manager.apply(preview.id)).rejects.toThrow(/requires reconciliation/u);
  });

  it("does not revoke a durable completed task when its finish callback fails after commit", async () => {
    const f = await fixture();
    const finish = f.store.finishSubagentTask.bind(f.store);
    vi.spyOn(f.store, "finishSubagentTask").mockImplementation(async (...args) => {
      await finish(...args);
      throw new Error("After commit failure");
    });
    await expect(f.complete()).rejects.toThrow("After commit failure");
    expect(f.store.listSubagentTasks(f.task.threadId)[0]?.status).toBe("completed");
    const [id] = await candidateIds(f.dataRoot);
    expect((await f.manager.inspectPreview(id!)).state).toBeUndefined();
    expect((await deliveryManager(f).apply(id!)).details.status).toBe("applied");
  });

  it("does not revoke a committed delivery when a later accepted event fails", async () => {
    const f = await fixture();
    f.emit.mockRejectedValue(new Error("Accepted event failure"));
    await expect(f.complete()).rejects.toThrow("Accepted event failure");
    expect(f.store.listSubagentTasks(f.task.threadId)[0]?.status).toBe("completed");
    const [id] = await candidateIds(f.dataRoot);
    expect((await f.manager.inspectPreview(id!)).state).toBeUndefined();
    expect((await f.manager.apply(id!)).details.status).toBe("applied");
  });

  it("preserves the interruption cause and candidate when cleanup cannot confirm revocation", async () => {
    const f = await fixture();
    const original = new Error("Completion interrupted");
    vi.spyOn(f.manager, "revokePreview").mockResolvedValue(false);
    let failure: unknown;
    try {
      await completeSubagentTask({
        taskId: f.task.id, outcomeSha256: digest("ready"), worktree: f.session, worktrees: f.manager,
        assertActive: () => undefined, finish: async () => { throw original; },
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).cause).toBe(original);
    expect((failure as AggregateError).errors).toContain(original);
    expect((failure as Error).message).toContain("cleanup unresolved");
    const [id] = await candidateIds(f.dataRoot);
    expect((await f.manager.inspectPreview(id!)).state).toBeUndefined();
  });
});
