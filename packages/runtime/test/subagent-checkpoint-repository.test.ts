import { mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { emptyUsage, type JsonObject, type SubagentLimits } from "@napier/contracts";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { subagentToolResultEvidence } from "../src/subagent-tool-result-evidence.js";
import { LocalStore } from "../src/store.js";
import { createModelContextEnvelopeReceipt } from "../src/model-context-envelope.js";
import { LEDGER_DATABASE_FILENAME } from "../src/sqlite-ledger.js";
import { authorizeSubagentChildRun } from "../src/subagent-child-authorization.js";
import type { StartedSubagentChildRun, SubagentChildRunState } from "../src/subagent-child-run-types.js";
import { prepareSubagentWorkingSet, resolvePreparedSubagentWorkingSet } from "../src/subagent-working-set-capsule.js";
import type { PrepareSubagentChildCheckpointResult, PreparedSubagentWorkingSet, SubagentMailboxConsumedBinding } from "../src/subagent-working-set-types.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";
import { DurableToolOperationJournal } from "../src/tool-operation-journal.js";

const roots: string[] = [], stores: LocalStore[] = [];
const limits: SubagentLimits = { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 10_000 };
const lease = { ownerId: `process:${process.pid}:checkpoint_test`, ttlMs: 60_000 };
const initial = { role: "user" as const, content: "Private source requirement", timestamp: 1 };
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(input: { role?: "researcher" | "coder"; enabledTools?: string[]; writePaths?: string[] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-child-checkpoint-")); roots.push(root);
  const options = { dataRoot: path.join(root, "data"), workspaceRoot: path.join(root, "workspace") };
  await mkdir(options.workspaceRoot);
  const store = new LocalStore(options); stores.push(store); await store.initialize();
  const role = input.role ?? "researcher";
  const profile = await store.updateAgent(store.listAgents()[0]!.id, {
    enabledSubagents: [role], subagentLimits: limits, enabledTools: input.enabledTools ?? ["read_file"], toolPolicy: "workspace",
  });
  const thread = await store.createThread({ agentId: profile.id, title: "Checkpoint test" });
  const parent = await store.createLeasedRun({ threadId: thread.id, agentId: profile.id, source: "user" }, lease);
  const task = await store.createSubagentTask({ threadId: thread.id, runId: parent.run.id, role,
    description: "Private checkpoint", prompt: initial.content, model: profile.model,
    ...(input.writePaths ? { writePaths: input.writePaths } : {}),
    providerId: "in_process", executionId: "subexec_checkpointtest" });
  const authorization = authorizeSubagentChildRun({ parentRun: parent.run, parentProfile: profile,
    taskId: task.id, executionId: task.executionId!, limits });
  const child = await store.startSubagentChildRun({ taskId: task.id, executionId: task.executionId!, authorization, lease });
  return { root, store, options, thread, parent, task, child };
}
function fence(child: StartedSubagentChildRun, state: SubagentChildRunState = child) {
  return { runId: child.run.id, taskId: child.task.id, executionId: child.task.executionId!,
    token: child.token, expectedExecutionRevision: state.executionRevision };
}
async function reopen(options: ConstructorParameters<typeof LocalStore>[0]) {
  const store = new LocalStore(options); stores.push(store); await store.initialize(); return store;
}
async function capsule(f: Awaited<ReturnType<typeof fixture>>, prepared: PrepareSubagentChildCheckpointResult,
  messages: readonly unknown[] = [initial], entries: SubagentMailboxConsumedBinding[] = [], through = 0) {
  return prepareSubagentWorkingSet(f.options.dataRoot, { frontier: prepared.frontier, boundary: "before_model",
    systemPrompt: f.child.profile.systemPrompt, tools: [], messages, mailbox: { consumedThroughSeq: through, entries },
    ...(prepared.previousCheckpoint ? { previousCheckpoint: prepared.previousCheckpoint } : {}) });
}
function message(taskId: string, id: string, text: string): SubagentMessage {
  const content = { kind: "napier.subagent-message" as const, schemaVersion: 1 as const, id, taskId,
    messageKind: "steering" as const, text, createdAt: "2026-10-29T00:00:00.000Z" };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}
function user(message: SubagentMessage) { return { role: "user" as const, content: message.text, timestamp: Date.parse(message.createdAt) }; }
function expire(f: Awaited<ReturnType<typeof fixture>>, runId: string) {
  const db = new DatabaseSync(path.join(f.options.dataRoot, LEDGER_DATABASE_FILENAME));
  try { db.prepare("UPDATE run_leases SET acquired_at = ?, heartbeat_at = ?, expires_at = ? WHERE run_id = ?")
    .run("2000-01-01T00:00:00.000Z", "2000-01-01T00:00:00.000Z", "2000-01-01T00:01:00.000Z", runId); } finally { db.close(); }
}

describe("child private checkpoint repository", () => {
  it("persists only a digest pointer and commits once across independent Stores", async () => {
    const f = await fixture(), other = await reopen(f.options);
    const ready = await f.store.prepareSubagentChildCheckpoint(fence(f.child));
    const prepared = await capsule(f, ready);
    const results = await Promise.allSettled([f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared }),
      other.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const checkpoint = other.listRuns(f.thread.id).find((r) => r.id === f.child.run.id)?.subagent?.checkpoint;
    expect(checkpoint).toMatchObject({ revision: 1, messageCount: 1, mailboxConsumedCount: 0, storage: "local_only" });
    expect(JSON.stringify(checkpoint)).not.toContain(initial.content);
    expect((await other.listRunEvents(f.child.run.id)).filter((e) => e.type === "subagent.child.checkpoint_committed")).toHaveLength(1);
  });

  it("rejects forged preparation authority and an unavailable prepared capsule", async () => {
    const f = await fixture();
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared: {} as PreparedSubagentWorkingSet })).rejects.toThrow("preparation authority");
    const prepared = await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child)));
    await unlink(path.join(f.options.dataRoot, "subagent-working-sets", `${resolvePreparedSubagentWorkingSet(prepared).receipt.capsuleSha256}.json`));
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).rejects.toThrow();
    expect(f.store.listRuns(f.thread.id).find((r) => r.id === f.child.run.id)?.subagent?.checkpoint).toBeUndefined();
  });

  it.each(["parent", "child"] as const)("rejects %s lease loss after capsule installation", async (owner) => {
    const f = await fixture();
    const prepared = await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child)));
    expire(f, owner === "parent" ? f.parent.run.id : f.child.run.id);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).rejects.toThrow("no longer active");
  });

  it("rejects a new tool ledger event even when execution revision did not change", async () => {
    const f = await fixture();
    const prepared = await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child)));
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.child.run.id, type: "tool.started", category: "tool",
      payload: { callId: "call_checkpoint", toolName: "read_file" } });
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).rejects.toThrow("incomplete tool exchange");
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.child.run.id, type: "tool.completed", category: "tool",
      payload: { callId: "call_checkpoint", toolName: "read_file" } });
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).rejects.toThrow("frontier changed");
  });

  it("refuses unresolved model usage and preserves the previous checkpoint", async () => {
    const f = await fixture();
    const prepared = await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child)));
    const saved = await f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared });
    const pending = await f.store.reserveSubagentChildInvocation({ ...fence(f.child, saved), requestId: "unsettled", phase: "subagent_turn" });
    await expect(f.store.prepareSubagentChildCheckpoint({ ...fence(f.child), expectedExecutionRevision: pending.executionRevision })).rejects.toThrow("unresolved model usage");
    expect(f.store.listRuns(f.thread.id).find((r) => r.id === f.child.run.id)?.subagent?.checkpoint?.revision).toBe(1);
  });

  it("accepts a repeated identical message once across stores and rejects content conflicts", async () => {
    const f = await fixture(), other = await reopen(f.options);
    const msg = message(f.task.id, "submsg_idempotent", "Apply this constraint");
    const input = { taskId: f.task.id, executionId: f.task.executionId!, message: msg };
    const results = await Promise.all([f.store.acceptSubagentMessage(input), other.acceptSubagentMessage(input)]);
    expect(results.filter((r) => r.appended)).toHaveLength(1);
    expect(results[0]!.event.id).toBe(results[1]!.event.id);
    await expect(other.acceptSubagentMessage({ ...input, message: message(f.task.id, msg.id, "Conflicting content") })).rejects.toThrow("conflicts");
  });

  it("rejects new acceptance after parent completion while retaining an identical acceptance receipt", async () => {
    const f = await fixture();
    const prior = { taskId: f.task.id, executionId: f.task.executionId!, message: message(f.task.id, "submsg_prioraccepted", "Accepted before completion") };
    const accepted = await f.store.acceptSubagentMessage(prior);
    await f.store.finishRun(f.parent.run.id, "completed", { leaseToken: f.parent.token });
    expect(await f.store.acceptSubagentMessage(prior)).toMatchObject({ appended: false, event: { id: accepted.event.id } });
    await expect(f.store.acceptSubagentMessage({ ...prior, message: message(f.task.id, "submsg_toolatenow", "Too late") })).rejects.toThrow("not accepting");
  });

  it("retains sparse B-before-A consumption, binds exact text, and advances only the contiguous prefix", async () => {
    const f = await fixture();
    const a = message(f.task.id, "submsg_messageaa", "First constraint"), b = message(f.task.id, "submsg_messagebb", "Second constraint");
    for (const msg of [a, b]) await f.store.acceptSubagentMessage({ taskId: f.task.id, executionId: f.task.executionId!, message: msg });
    const ready = await f.store.prepareSubagentChildCheckpoint(fence(f.child));
    const entryB = { ...ready.mailbox.accepted[1]!, messageIndex: 1 };
    const prepared = await capsule(f, ready, [initial, user(b)], [entryB]);
    const first = await f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared });
    expect(first.task).toMatchObject({ mailboxConsumedCount: 1, mailboxConsumedThroughSeq: 0 });
    await f.store.acceptSubagentMessage({ taskId: f.task.id, executionId: f.task.executionId!,
      message: message(f.task.id, "submsg_messagecc", b.text) });
    const next = await f.store.prepareSubagentChildCheckpoint(fence(f.child, first));
    expect(next.mailbox.consumed).toEqual([entryB]);
    const dropped = await capsule(f, next, [initial, user(b)], [{ ...next.mailbox.accepted[2]!, messageIndex: 1 }]);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, first), prepared: dropped })).rejects.toThrow("drop or rewrite consumed");
    const entries = [entryB, { ...next.mailbox.accepted[0]!, messageIndex: 2 }];
    const forgedMessage = { ...user(a), content: "A different instruction" };
    const forgedEntries = [entryB, { ...entries[1]!, messageSha256: sha256(canonicalJson(forgedMessage)) }];
    const forged = await capsule(f, next, [initial, user(b), forgedMessage], forgedEntries, next.mailbox.accepted[1]!.acceptedSeq);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, first), prepared: forged })).rejects.toThrow("consumed binding");
    const second = await capsule(f, next, [initial, user(b), user(a)], entries, next.mailbox.accepted[1]!.acceptedSeq);
    const saved = await f.store.commitSubagentChildCheckpoint({ ...fence(f.child, first), prepared: second });
    expect(saved.task).toMatchObject({ mailboxConsumedCount: 2, mailboxConsumedThroughSeq: next.mailbox.accepted[1]!.acceptedSeq });
  });

  it("refuses admitted work and live physical effect authority until durable settlement", async () => {
    const f = await fixture();
    const effect = new DurableToolOperationJournal(f.store,
      { threadId: f.thread.id, runId: f.child.run.id },
      { executionLease: { ownerId: "checkpoint_effect_owner", durationMs: 30_000 } },
    ).observer("call_checkpoint_effect").operation({
      role: "execution_authority", ordinal: 1, mode: "mutation", route: "fixture", operation: "mutate",
      scope: "workspace", contribution: "product", resourceKey: { workspace: "checkpoint-fixture" },
      failureDomainKey: { tool: "fixture" },
    });
    await effect.admit();
    await expect(f.store.prepareSubagentChildCheckpoint(fence(f.child))).rejects.toThrow("unsettled tool operation");
    await effect.started();
    await effect.effectBoundary();
    await expect(f.store.prepareSubagentChildCheckpoint(fence(f.child))).rejects.toThrow("live tool effect authority");
    await effect.settled({ outcome: "succeeded", effect: { mutation: "durably-observed" } });
    const prepared = await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child)));
    expect((await f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).run.subagent?.checkpoint?.revision).toBe(1);
  });

  it("preserves frozen prompt and tool surface across checkpoints", async () => {
    const f = await fixture();
    const saved = await f.store.commitSubagentChildCheckpoint({ ...fence(f.child),
      prepared: await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child))) });
    const next = await f.store.prepareSubagentChildCheckpoint(fence(f.child, saved));
    const input = { frontier: next.frontier, boundary: "before_model" as const,
      systemPrompt: f.child.profile.systemPrompt, tools: [], messages: [initial],
      mailbox: { consumedThroughSeq: 0, entries: [] }, previousCheckpoint: next.previousCheckpoint! };
    for (const alteration of [{ systemPrompt: "Changed prompt" },
      { tools: [{ name: "invented_tool", description: "Changed tools", parameters: { type: "object" as const, properties: {} } }] }]) {
      const changed = await prepareSubagentWorkingSet(f.options.dataRoot, { ...input, ...alteration });
      await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, saved), prepared: changed })).rejects.toThrow("prompt, or tools");
    }
    expect(f.store.listRuns(f.thread.id).find((r) => r.id === f.child.run.id)?.subagent?.checkpoint?.revision).toBe(1);
  });

  it.each([["invented_tool"], ["read_file", "read_file"], ["skill_resource"], ["candidate_file"]])("rejects unauthorized or duplicate first-checkpoint tools %j", async (...names: string[]) => {
    const f = await fixture(), ready = await f.store.prepareSubagentChildCheckpoint(fence(f.child));
    const tools = names.map((name) => ({ name, description: "Untrusted initial catalog", parameters: { type: "object" as const, properties: {} } }));
    const prepared = await prepareSubagentWorkingSet(f.options.dataRoot, { frontier: ready.frontier, boundary: "before_model",
      systemPrompt: f.child.profile.systemPrompt, tools, messages: [initial], mailbox: { entries: [], consumedThroughSeq: 0 } });
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).rejects.toThrow("unauthorized tool definitions");
  });

  it.each(["skill_resource", "candidate_file"] as const)("allows derived %s only with its frozen prerequisites", async (name) => {
    const f = await fixture(name === "skill_resource" ? { enabledTools: ["skill_load"] }
      : { role: "coder", enabledTools: ["apply_patch", "lsp_diagnostics"], writePaths: ["src/**"] });
    const ready = await f.store.prepareSubagentChildCheckpoint(fence(f.child));
    const prepared = await prepareSubagentWorkingSet(f.options.dataRoot, { frontier: ready.frontier, boundary: "before_model",
      systemPrompt: f.child.profile.systemPrompt, tools: [{ name, description: "Authorized derived catalog", parameters: { type: "object", properties: {} } }],
      messages: [initial], mailbox: { entries: [], consumedThroughSeq: 0 } });
    expect((await f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).run.subagent?.checkpoint?.revision).toBe(1);
  });

  it("atomically rolls back pointer, consumed cursor, and event when SQLite rejects the commit", async () => {
    const f = await fixture();
    const prepared = await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child)));
    const db = new DatabaseSync(path.join(f.options.dataRoot, LEDGER_DATABASE_FILENAME));
    try { db.exec("CREATE TRIGGER fail_checkpoint BEFORE INSERT ON ledger_events WHEN NEW.event_type = 'subagent.child.checkpoint_committed' BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END"); } finally { db.close(); }
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).rejects.toThrow("injected checkpoint failure");
    expect(f.store.listSubagentTasks(f.thread.id)[0]?.mailboxConsumedCount).toBeUndefined();
    expect((await f.store.listRunEvents(f.child.run.id)).some((e) => e.type === "subagent.child.checkpoint_committed")).toBe(false);
    const clean = new DatabaseSync(path.join(f.options.dataRoot, LEDGER_DATABASE_FILENAME));
    try { clean.exec("DROP TRIGGER fail_checkpoint"); } finally { clean.close(); }
    expect((await f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared })).run.subagent?.checkpoint?.revision).toBe(1);
  });

  it("exports receipt evidence and imports it as unavailable private state without raw source", async () => {
    const f = await fixture();
    const prepared = await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child)));
    const saved = await f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared });
    await f.store.finishSubagentChildRun({ ...fence(f.child, saved), finish: { status: "completed", stopReason: "completed", usage: emptyUsage() } });
    const bundle = createThreadReplayBundle(await f.store.getDetail(f.thread.id));
    const imported = await f.store.importThreadReplayBundle(bundle);
    expect(imported.runs.find((r) => r.source === "subagent")?.subagent?.checkpoint?.storage).toBe("not_imported");
    expect(() => createThreadReplayBundle(imported)).not.toThrow();
    const bad = structuredClone(bundle);
    (bad.events.find((e) => e.type === "subagent.child.checkpoint_committed")!.payload as JsonObject)["capsuleSha256"] = "0".repeat(64);
    expect(() => validateThreadReplayBundle(bad)).toThrow("pointer differs");
    expect(JSON.stringify(bundle.events.filter((e) => e.type === "subagent.child.checkpoint_committed"))).not.toContain(initial.content);
  });
  it("binds the initial user and all successful primary assistant messages to durable source", async () => {
    const f = await fixture();
    const first = await f.store.prepareSubagentChildCheckpoint(fence(f.child));
    const unrelated = await capsule(f, first, [{ ...initial, content: "An unrelated requirement" }]);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child), prepared: unrelated })).rejects.toThrow("Task prompt");
    const response = { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture",
      content: [{ type: "text", text: "Canonical finding" }], stopReason: "stop", timestamp: 2,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const pending = await f.store.reserveSubagentChildInvocation({ ...fence(f.child), requestId: "canonical-source", phase: "subagent_turn" });
    const settled = await f.store.settleSubagentChildInvocation({ ...fence(f.child), expectedExecutionRevision: pending.executionRevision,
      invocationId: pending.invocationId, usage: emptyUsage(), payload: { responseSha256: sha256(canonicalJson(response)), stopReason: "stop", toolCalls: [] } });
    const next = await f.store.prepareSubagentChildCheckpoint(fence(f.child, settled));
    const missing = await capsule(f, next);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: missing })).rejects.toThrow("assistant source");
    const rewritten = await capsule(f, next, [initial, { ...response, content: [{ type: "text", text: "Invented finding" }] }]);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: rewritten })).rejects.toThrow("assistant source");
    const actual = await capsule(f, next, [initial, response]);
    const saved = await f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: actual });
    expect(saved.run.subagent?.checkpoint?.messageCount).toBe(2);
    const after = await f.store.prepareSubagentChildCheckpoint(fence(f.child, saved));
    const rewrittenPrefix = await capsule(f, after, [{ ...initial, timestamp: 9 }, response]);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, saved), prepared: rewrittenPrefix })).rejects.toThrow("prior source");
  });

  it("binds tool definitions to captured primary requests while excluding auxiliary catalogs", async () => {
    const f = await fixture();
    const response = { role: "assistant" as const, api: "openai-completions" as const, provider: "fixture", model: "fixture",
      content: [{ type: "text" as const, text: "Captured finding" }], stopReason: "stop" as const, timestamp: 2,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const pending = await f.store.reserveSubagentChildInvocation({ ...fence(f.child), requestId: "captured-tools", phase: "subagent_turn" });
    const settled = await f.store.settleSubagentChildInvocation({ ...fence(f.child), expectedExecutionRevision: pending.executionRevision,
      invocationId: pending.invocationId, usage: emptyUsage(), payload: { responseSha256: sha256(canonicalJson(response)), stopReason: "stop", toolCalls: [] },
      capture: { envelope: createModelContextEnvelopeReceipt({ turnIndex: 0, systemPrompt: f.child.profile.systemPrompt, tools: [], messages: [initial] }) } });
    const ready = await f.store.prepareSubagentChildCheckpoint(fence(f.child, settled));
    const differentTools = [{ name: "read_file", description: "A different tool catalog", parameters: { type: "object" as const, properties: {} } }];
    const wrong = await prepareSubagentWorkingSet(f.options.dataRoot, { frontier: ready.frontier, boundary: "turn_complete",
      systemPrompt: f.child.profile.systemPrompt, tools: differentTools, messages: [initial, response], mailbox: { entries: [], consumedThroughSeq: 0 } });
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: wrong })).rejects.toThrow("captured model requests");
    const aux = await f.store.reserveSubagentChildInvocation({ ...fence(f.child, settled), requestId: "auxiliary-tools", phase: "typed_repair" });
    const auxSettled = await f.store.settleSubagentChildInvocation({ ...fence(f.child), expectedExecutionRevision: aux.executionRevision,
      invocationId: aux.invocationId, usage: emptyUsage(), payload: { responseSha256: sha256(canonicalJson(response)), stopReason: "stop", toolCalls: [] },
      capture: { envelope: createModelContextEnvelopeReceipt({ turnIndex: 1, systemPrompt: "Auxiliary repair prompt", tools: differentTools, messages: [initial] }) } });
    const actual = await capsule(f, await f.store.prepareSubagentChildCheckpoint(fence(f.child, auxSettled)), [initial, response]);
    expect((await f.store.commitSubagentChildCheckpoint({ ...fence(f.child, auxSettled), prepared: actual })).run.subagent?.checkpoint?.messageCount).toBe(2);
  });

  it("binds exact success and a repeated provider ID denied by the SDK without inventing execution", async () => {
    const f = await fixture();
    const response = { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture",
      content: [{ type: "toolCall", id: "provider_call_checkpoint", name: "read_file", arguments: { path: "README.md" } }],
      stopReason: "toolUse", timestamp: 2, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const pending = await f.store.reserveSubagentChildInvocation({ ...fence(f.child), requestId: "tool-source", phase: "subagent_turn" });
    const settled = await f.store.settleSubagentChildInvocation({ ...fence(f.child), expectedExecutionRevision: pending.executionRevision,
      invocationId: pending.invocationId, usage: emptyUsage(), payload: { responseSha256: sha256(canonicalJson(response)), stopReason: "toolUse",
        toolCalls: [{ id: "provider_call_checkpoint", name: "read_file" }] } });
    const result = { role: "toolResult", toolCallId: "provider_call_checkpoint", toolName: "read_file", isError: false,
      content: [{ type: "text", text: "Actual file body" }], timestamp: 3 };
    const before = await f.store.prepareSubagentChildCheckpoint(fence(f.child, settled));
    const invented = await capsule(f, before, [initial, response, result]);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: invented })).rejects.toThrow("exact SDK receipt");
    const identity = { callId: "owned_call_checkpoint", providerCallId: result.toolCallId, toolName: result.toolName };
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.child.run.id, type: "tool.started", category: "tool", payload: identity });
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.child.run.id, type: "tool.completed", category: "tool",
      payload: { ...identity, ...subagentToolResultEvidence(result) } });
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "subagent.step", category: "subagent",
      payload: { taskId: f.task.id, childRunId: f.child.run.id, executionId: f.task.executionId!,
        kind: "tool", providerCallId: result.toolCallId, toolName: result.toolName, isError: false, ...subagentToolResultEvidence(result) } });
    const ready = await f.store.prepareSubagentChildCheckpoint(fence(f.child, settled));
    const corrupted = await capsule(f, ready, [initial, response, { ...result, content: [{ type: "text", text: "Invented file body" }] }]);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: corrupted })).rejects.toThrow("canonical SDK output");
    const actual = await capsule(f, ready, [initial, response, result]);
    const saved = await f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: actual });
    expect(saved.run.subagent?.checkpoint?.messageCount).toBe(3);
    const repeatedResponse = { ...response, timestamp: 4 };
    const nextInvocation = await f.store.reserveSubagentChildInvocation({ ...fence(f.child, saved), requestId: "repeated-tool-source", phase: "subagent_turn" });
    const nextSettled = await f.store.settleSubagentChildInvocation({ ...fence(f.child), expectedExecutionRevision: nextInvocation.executionRevision,
      invocationId: nextInvocation.invocationId, usage: emptyUsage(), payload: { responseSha256: sha256(canonicalJson(repeatedResponse)), stopReason: "toolUse",
        toolCalls: [{ id: result.toolCallId, name: result.toolName }] } });
    const denied = { ...result, isError: true, content: [{ type: "text", text: "Repeated provider call ID denied" }], details: {}, timestamp: 5 };
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "subagent.step", category: "subagent",
      payload: { taskId: f.task.id, childRunId: f.child.run.id, executionId: f.task.executionId!, kind: "tool",
        providerCallId: result.toolCallId, toolName: result.toolName, isError: true, ...subagentToolResultEvidence(denied) } });
    const finalReady = await f.store.prepareSubagentChildCheckpoint(fence(f.child, nextSettled));
    const final = await capsule(f, finalReady, [initial, response, result, repeatedResponse, denied]);
    expect((await f.store.commitSubagentChildCheckpoint({ ...fence(f.child, nextSettled), prepared: final })).run.subagent?.checkpoint?.messageCount).toBe(5);
    expect((await f.store.listRunEvents(f.child.run.id)).filter((event) => event.type === "tool.completed")).toHaveLength(1);
  });

  it.each(["details", "usage", "addedToolNames"] as const)("accepts exact SDK preflight errors without execution and rejects altered %s", async (field) => {
    const f = await fixture();
    const response = { role: "assistant", api: "openai-completions", provider: "fixture", model: "fixture",
      content: [{ type: "toolCall", id: "provider_call_invalid", name: "read_file", arguments: {} }],
      stopReason: "toolUse", timestamp: 2, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const pending = await f.store.reserveSubagentChildInvocation({ ...fence(f.child), requestId: "invalid-tool-source", phase: "subagent_turn" });
    const settled = await f.store.settleSubagentChildInvocation({ ...fence(f.child), expectedExecutionRevision: pending.executionRevision,
      invocationId: pending.invocationId, usage: emptyUsage(), payload: { responseSha256: sha256(canonicalJson(response)), stopReason: "toolUse",
        toolCalls: [{ id: "provider_call_invalid", name: "read_file" }] } });
    const result = { role: "toolResult", toolCallId: "provider_call_invalid", toolName: "read_file", isError: true,
      content: [{ type: "text", text: "Missing required path" }], details: {}, timestamp: 3 };
    await f.store.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id, type: "subagent.step", category: "subagent",
      payload: { taskId: f.task.id, childRunId: f.child.run.id, executionId: f.task.executionId!, kind: "tool",
        providerCallId: result.toolCallId, toolName: result.toolName, isError: true, ...subagentToolResultEvidence(result) } });
    const ready = await f.store.prepareSubagentChildCheckpoint(fence(f.child, settled));
    const changes = { details: null, usage: { inputTokens: 999 }, addedToolNames: ["invented_tool"] };
    const altered = await capsule(f, ready, [initial, response, { ...result, [field]: changes[field] }]);
    await expect(f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: altered })).rejects.toThrow("canonical SDK output");
    const exact = await capsule(f, ready, [initial, response, result]);
    expect((await f.store.commitSubagentChildCheckpoint({ ...fence(f.child, settled), prepared: exact })).run.subagent?.checkpoint?.messageCount).toBe(3);
    expect((await f.store.listRunEvents(f.child.run.id)).filter((event) => event.type.startsWith("tool."))).toEqual([]);
  });

});
