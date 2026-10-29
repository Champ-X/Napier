import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { LocalStore } from "../src/store.js";
import { authorizeSubagentChildRun } from "../src/subagent-child-authorization.js";
import { SubagentChildExecution } from "../src/subagent-child-execution.js";
import type { StartedSubagentChildRun, SubagentChildRunState } from "../src/subagent-child-run-types.js";
import { SubagentCandidateStore } from "../src/subagent-candidate-store.js";
import { readCommittedSubagentResult } from "../src/subagent-committed-result.js";
import { finishSubagentTypedOutput } from "../src/subagent-typed-output-settlement.js";
import type { FinishSubagentTaskInput } from "../src/subagent-store-records.js";
import { deliveryManager, patchCandidate } from "./subagent-worktree-delivery-fixture.js";

const roots: string[] = [], stores: LocalStore[] = [];
const limits = { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 60_000 };
const lease = { ownerId: `process:${process.pid}:completion_test`, ttlMs: 60_000 };
const finish: FinishSubagentTaskInput = { status: "completed", stopReason: "completed", result: "ready", output: "ready" };
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(role: "researcher" | "coder" = "coder") {
  const root = await mkdtemp(path.join(tmpdir(), "napier-completion-")); roots.push(root);
  const options = { workspaceRoot: path.join(root, "workspace"), dataRoot: path.join(root, "data") };
  await mkdir(options.workspaceRoot); await writeFile(path.join(options.workspaceRoot, "a.ts"), "export const a = 1;\n");
  const store = await reopen(options);
  const profile = await store.updateAgent(store.listAgents()[0]!.id, { enabledSubagents: [role], subagentLimits: limits,
    enabledTools: ["read_file", "apply_patch", "lsp_diagnostics"], toolPolicy: "workspace" });
  const thread = await store.createThread({ agentId: profile.id, title: "Atomic completion" });
  const parent = await store.createLeasedRun({ threadId: thread.id, agentId: profile.id, source: "user" }, lease);
  const task = await store.createSubagentTask({ threadId: thread.id, runId: parent.run.id, role, description: "Result delivery",
    prompt: "Update a.ts", model: profile.model, executionId: "subexec_completion", providerId: "in_process",
    outputSchema: { type: "string" }, outputSchemaSha256: sha256(canonicalJson({ type: "string" })),
    ...(role === "coder" ? { writePaths: ["a.ts"] } : {}) });
  const authorization = authorizeSubagentChildRun({ parentRun: parent.run, parentProfile: profile,
    taskId: task.id, executionId: task.executionId!, limits });
  const child = await store.startSubagentChildRun({ taskId: task.id, executionId: task.executionId!, authorization, lease });
  const manager = deliveryManager(options, { requireCompletionBinding: true,
    candidateDeliveryAuthority: (reservation, candidate) => store.subagentChildRunRepository.candidateDelivered(reservation, candidate) });
  const session = role === "coder" ? await manager.createWorktree(task.id, ["a.ts"]) : undefined;
  if (session) await patchCandidate(manager, session, "a.ts", "export const a = 1;\n", "export const a = 2;\n");
  return { root, store, options, profile, thread, parent, task, child, manager, session };
}
async function reopen(options: ConstructorParameters<typeof LocalStore>[0]) {
  const store = new LocalStore(options); stores.push(store); await store.initialize(); return store;
}
function fence(child: StartedSubagentChildRun, state: SubagentChildRunState = child) {
  return { runId: child.run.id, taskId: child.task.id, executionId: child.task.executionId!, token: child.token,
    expectedExecutionRevision: state.executionRevision };
}
async function stage(f: Awaited<ReturnType<typeof fixture>>) {
  const ready = await f.store.prepareSubagentChildCompletion({ ...fence(f.child), finish });
  const preview = await f.manager.storePreview(f.session!, sha256(canonicalJson("ready")), undefined, ready.prepared);
  const input = { ...fence(f.child, ready), finish: { ...finish, preparedCompletion: ready.prepared, candidateId: preview.id } };
  return { ready, preview, input };
}


async function childProcess(f: Awaited<ReturnType<typeof fixture>>, mode: string, suffix = mode, barrier?: string) {
  const output = path.join(f.root, `${suffix}-result.json`), config = path.join(f.root, `${suffix}-config.json`);
  await writeFile(config, JSON.stringify({ ...f.options, fence: fence(f.child), finish, mode, output, barrier }), { mode: 0o600 });
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./subagent-completion-child.ts", import.meta.url)), config],
    { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  const ended = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject); child.once("exit", (code, signal) => {
      if (code !== 0 && signal !== "SIGKILL") reject(new Error(stderr)); else resolve({ code, signal });
    });
  });
  return { output, ended };
}
async function waitForFile(file: string) {
  for (let attempt = 0; ; attempt += 1) {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { if (attempt >= 1000) throw error; await delay(10); }
  }
}

describe("atomic logical completion", () => {
  it("commits exactly one result and delivery events across independent Stores", async () => {
    const f = await fixture("researcher"), other = await reopen(f.options);
    const preparations = await Promise.all([f.store.prepareSubagentChildCompletion({ ...fence(f.child), finish }),
      other.prepareSubagentChildCompletion({ ...fence(f.child), finish })]);
    expect(preparations[0]!.task.completionReservation).toEqual(preparations[1]!.task.completionReservation);
    const results = await Promise.all(preparations.map((ready, index) => (index ? other : f.store).finishSubagentChildRun({
      ...fence(f.child, ready), finish: { ...finish, preparedCompletion: ready.prepared } })));
    expect(results[0]!.task.completion).toEqual(results[1]!.task.completion);
    const events = await other.listRunEvents(f.parent.run.id);
    expect(events.filter((event) => event.type === "subagent.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "subagent.output.accepted")).toHaveLength(1);
    expect(await readCommittedSubagentResult(other, results[0]!.task)).toEqual(await readCommittedSubagentResult(f.store, results[1]!.task));
    await expect(other.finishSubagentChildRun({ ...fence(f.child, preparations[1]!),
      finish: { ...finish, output: "different", preparedCompletion: preparations[1]!.prepared } })).rejects.toThrow(/conflicts/);
  });

  it("retains the fixed candidate without granting apply before terminal commit", async () => {
    const f = await fixture(), { input, preview } = await stage(f);
    await expect(f.manager.apply(preview.id)).rejects.toThrow("no committed completion authority");
    const other = await reopen(f.options);
    expect(other.listSubagentTasks(f.thread.id)[0]?.completionReservation?.candidate?.id).toBe(preview.id);
    expect(other.listSubagentTasks(f.thread.id)[0]?.completion).toBeUndefined();
    const committed = await other.finishSubagentChildRun(input);
    expect(committed.task.completion?.reservation.candidate?.id).toBe(preview.id);
    expect((await f.manager.apply(preview.id)).details.status).toBe("applied");
    expect((await f.manager.apply(preview.id)).summary).toContain("Stored merge receipt reused");
    expect(await readFile(path.join(f.options.workspaceRoot, "a.ts"), "utf8")).toBe("export const a = 2;\n");
  });

  it("reconstructs the identical result after commit succeeds but publication crashes", async () => {
    const f = await fixture(), child = new SubagentChildExecution(f.store, f.child);
    const emit = vi.fn();
    await expect(finishSubagentTypedOutput({ store: f.store, task: f.task, output: "ready", resultText: "ready", usage: f.task.usage,
      finishTask: child.finish, assertActive: () => child.assertActive(), worktrees: f.manager, worktree: f.session!,
      publishCommitted: async () => { throw new Error("crash before publication"); }, emit })).rejects.toThrow("crash before publication");
    const reopened = await reopen(f.options), task = reopened.listSubagentTasks(f.thread.id)[0]!;
    expect(task.status).toBe("completed"); expect(emit).not.toHaveBeenCalled();
    const result = await readCommittedSubagentResult(reopened, task);
    expect(result.details.worktreePreviewId).toBe(task.completion?.reservation.candidate?.id);
    expect(result.content[0]!.text).toContain("export const a = 2");
    expect((await f.manager.inspectPreview(result.details.worktreePreviewId!)).state).toBeUndefined();
    const events = await reopened.listRunEvents(f.parent.run.id);
    expect(events.filter((event) => event.type === "subagent.completed")).toHaveLength(1);
    expect(await f.manager.revokePreview(result.details.worktreePreviewId!, f.task.id)).toBe(false);
  });

  it("reuses one ID and expiry and refuses changed content or output before and after completion", async () => {
    const f = await fixture(), { ready, preview, input } = await stage(f);
    const candidates = new SubagentCandidateStore({ ...f.options,
      now: () => new Date(Date.now() + 30 * 24 * 60 * 60_000),
      candidateDeliveryAuthority: (reservation, candidate) => f.store.subagentChildRunRepository.candidateDelivered(reservation, candidate) });
    const { completion: _binding, ...source } = (await candidates.inspect(preview.id)).source;
    const repeated = await candidates.store(source, ready.prepared);
    expect(repeated).toEqual({ id: preview.id, expiresAt: preview.expiresAt, cleanupOwned: false });
    await expect(candidates.store({ ...source, sourceBytes: source.sourceBytes + 1 }, ready.prepared)).rejects.toThrow("candidate conflicts");
    await expect(f.store.prepareSubagentChildCompletion({ ...fence(f.child, ready), finish: { ...finish, result: "changed" } })).rejects.toThrow("payload conflicts");
    await f.store.finishSubagentChildRun(input);
    await expect(candidates.store({ ...source, sourceBytes: source.sourceBytes + 1 }, ready.prepared)).rejects.toThrow("candidate conflicts");
    expect(await candidates.store(source, ready.prepared)).toEqual(repeated);
    expect((await readdir(path.join(f.options.dataRoot, "subagent-candidates"))).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });

  it("preserves applying reconciliation through repeated completion and candidate staging", async () => {
    const f = await fixture(), { ready, preview, input } = await stage(f);
    const committed = await f.store.finishSubagentChildRun(input);
    const candidates = new SubagentCandidateStore(f.options);
    const source = (await candidates.inspect(preview.id)).source;
    await candidates.beginCommit({ ...source, candidateId: preview.id });
    expect((await f.store.finishSubagentChildRun(input)).task.completion).toEqual(committed.task.completion);
    const { completion: _completion, ...original } = source;
    expect((await candidates.store(original, ready.prepared)).id).toBe(preview.id);
    await expect(f.manager.apply(preview.id)).rejects.toThrow("requires reconciliation");
    await expect(candidates.store({ ...original, sourceBytes: original.sourceBytes + 1 }, ready.prepared)).rejects.toThrow("candidate conflicts");
  });

  it("never regenerates a revoked candidate and fences new model calls after reservation", async () => {
    const f = await fixture(), { ready, preview, input } = await stage(f);
    expect(await f.manager.revokePreview(preview.id, f.task.id)).toBe(true);
    await expect(f.store.finishSubagentChildRun(input)).rejects.toThrow(/revoked/);
    await expect(f.store.reserveSubagentChildInvocation({ ...fence(f.child, ready), phase: "subagent_turn", requestId: "after_completion" }))
      .rejects.toThrow("completion is reserved");
    await expect(f.manager.apply(preview.id)).rejects.toThrow("revoked");
    expect(f.store.listSubagentTasks(f.thread.id)[0]!.status).toBe("running");
  });

  it("rejects schema-invalid output and cloned preparation capabilities before completion", async () => {
    const f = await fixture("researcher");
    await expect(f.store.prepareSubagentChildCompletion({ ...fence(f.child), finish: { ...finish, output: 123 } }))
      .rejects.toThrow("Subagent completion output");
    expect(f.store.listSubagentTasks(f.thread.id)[0]!.completionReservation).toBeUndefined();
    const ready = await f.store.prepareSubagentChildCompletion({ ...fence(f.child), finish });
    await expect(f.store.finishSubagentChildRun({ ...fence(f.child, ready),
      finish: { ...finish, preparedCompletion: { ...ready.prepared } } })).rejects.toThrow("preparation authority");
    expect(f.store.listSubagentTasks(f.thread.id)[0]!.status).toBe("running");
  });
  it.each(["after_stage", "after_completion"])("recovers fixed candidate identity after real SIGKILL at %s", async (mode) => {
    const f = await fixture(); await f.manager.cleanup(f.session!);
    const child = await childProcess(f, mode);
    expect((await child.ended).signal).toBe("SIGKILL");
    const staged = await waitForFile(child.output), reopened = await reopen(f.options);
    let task = reopened.listSubagentTasks(f.thread.id)[0]!;
    expect(task.completionReservation?.candidate?.id).toBe(staged.preview.id);
    if (mode === "after_stage") {
      expect(task.completion).toBeUndefined();
      await expect(f.manager.apply(staged.preview.id)).rejects.toThrow("no committed completion authority");
      const ready = await reopened.prepareSubagentChildCompletion({ ...fence(f.child), finish });
      task = (await reopened.finishSubagentChildRun({ ...fence(f.child, ready),
        finish: { ...finish, preparedCompletion: ready.prepared, candidateId: staged.preview.id } })).task;
    }
    const restored = await readCommittedSubagentResult(reopened, task);
    expect(restored.details.worktreePreviewId).toBe(staged.preview.id);
    expect((await reopened.listRunEvents(f.parent.run.id)).filter((event) => event.type === "subagent.completed")).toHaveLength(1);
    expect((await readdir(path.join(f.options.dataRoot, "subagent-candidates"))).filter((name) => name.endsWith(".json"))).toHaveLength(1);
  });

  it("uses one candidate and receipt when two real processes stage and complete concurrently", async () => {
    const f = await fixture(); await f.manager.cleanup(f.session!);
    const barrier = path.join(f.root, "finish.go");
    const children = await Promise.all([childProcess(f, "race", "race-a", barrier), childProcess(f, "race", "race-b", barrier)]);
    const staged = await Promise.all(children.map((child) => waitForFile(child.output)));
    expect(staged[0].preview.id).toBe(staged[1].preview.id);
    expect(staged[0].preview.expiresAt).toBe(staged[1].preview.expiresAt);
    await writeFile(barrier, "go"); await Promise.all(children.map((child) => child.ended));
    const results = await Promise.all(children.map((child) => waitForFile(child.output)));
    expect(results[0].result.task.completion).toEqual(results[1].result.task.completion);
    expect((await f.store.listRunEvents(f.parent.run.id)).filter((event) => event.type === "subagent.completed")).toHaveLength(1);
  });

});
