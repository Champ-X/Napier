import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall, type AssistantMessage, type Context } from "@earendil-works/pi-ai";
import { emptyUsage } from "@napier/contracts";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSubagentWorkingSetForRestore } from "../src/subagent-working-set-capsule.js";
import { RUN_CONTEXT_COMPACTED_EVENT } from "../src/run-context-checkpoint.js";
import { LocalPrivateCapsuleDurabilityUnavailableError } from "../src/local-private-capsule-store.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { cleanupContinuationRunnerFixtures, continuationRunnerFixture } from "./subagent-continuation-runner-fixture.js";

beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests forbidden in continuation fixture"); })); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await cleanupContinuationRunnerFixtures(); });

describe("native child runner continuation", () => {
  it("rejects a native length-stopped assistant before claiming a successor", async () => {
    const f = await continuationRunnerFixture();
    await f.assistant(fauxAssistantMessage('{"answer":"truncated"}', { stopReason: "length" }));
    await expect(f.interruptAndClaim()).rejects.toThrow("source_tail_unresumable");
    expect(f.faux.state.callCount).toBe(0);
  });

  it.each(["copied capability", "changed profile"] as const)("terminalizes the claimed child after %s restoration failure", async (kind) => {
    const f = await continuationRunnerFixture();
    const active = await f.interruptAndClaim();
    if (kind === "copied capability") active.continuation.restore = { ...active.continuation.restore };
    else active.continuation.execution.profile.systemPrompt = "Changed after durable claim";
    await expect(active.runner.resume(active.continuation)).rejects.toThrow(kind === "copied capability" ? "committed continuation authority" : "claimed execution");
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === active.continuation.execution.task.id)!;
    expect(task).toMatchObject({ status: "failed", stopReason: "error", turnCount: 0, usage: emptyUsage() });
    const run = active.store.listRuns(f.thread.id).find((run) => run.id === task.childRunId)!;
    expect(run.status).toBe("failed");
    expect(f.faux.state.callCount).toBe(0);
    const events = await active.store.listRunEvents(run.id);
    expect(events.filter((event) => event.type === "model.response")).toEqual([]);
    expect(events.filter((event) => event.type === "run.failed")).toHaveLength(1);
  });

  it("continues a user tail once without injecting another initial prompt", async () => {
    const f = await continuationRunnerFixture();
    const active = await f.interruptAndClaim();
    const contexts: Context[] = [];
    f.faux.setResponses([(context) => { contexts.push(structuredClone(context)); return fauxAssistantMessage('{"answer":"continued"}'); }]);
    const result = await active.runner.resume(active.continuation);
    expect(result.details).toMatchObject({ status: "completed", turnCount: 1, stepCount: 1 });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.messages).toEqual(f.messages);
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === result.details.taskId)!;
    const run = active.store.listRuns(f.thread.id).find((run) => run.id === task.childRunId)!;
    const source = await readSubagentWorkingSetForRestore(f.dataRoot, run.subagent!.checkpoint!.capsuleSha256);
    expect(source.capsule.messages.slice(0, f.messages.length)).toEqual(f.messages);
    expect((await active.store.listRunEvents(run.id)).filter((event) => event.type === "model.response")).toHaveLength(1);
    expect(active.store.listSubagentTasks(f.thread.id).find((task) => task.id === f.task.id)).toEqual(active.sourceTask);
  });

  it.each(["continue", "finalize"] as const)("requires the first native restored checkpoint before %s", async (mode) => {
    const f = await continuationRunnerFixture();
    if (mode === "finalize") await f.assistant(fauxAssistantMessage('{"answer":"inherited final"}'));
    const active = await f.interruptAndClaim();
    vi.spyOn(active.store, "prepareSubagentChildCheckpoint")
      .mockRejectedValue(new LocalPrivateCapsuleDurabilityUnavailableError("restored checkpoint unavailable"));
    await expect(active.runner.resume(active.continuation)).rejects.toThrow("restored checkpoint unavailable");
    expect(f.faux.state.callCount).toBe(0);
    expect(active.store.listSubagentTasks(f.thread.id).find((task) => task.id === active.continuation.execution.task.id)?.status).toBe("failed");
  });

  it("finalizes an inherited final assistant at the logical ceiling with zero new model calls", async () => {
    const f = await continuationRunnerFixture({ maxTurns: 1, runLimits: { maxTotalTokens: 1_000, maxCostUsd: 0.01 } });
    await f.assistant(withUsage(fauxAssistantMessage('{"answer":"already finished"}'), 1_000, 0.01));
    const active = await f.interruptAndClaim();
    const result = await active.runner.resume(active.continuation);
    expect(result.details).toMatchObject({ status: "completed", turnCount: 0, stepCount: 0 });
    expect(f.faux.state.callCount).toBe(0);
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === result.details.taskId)!;
    const run = active.store.listRuns(f.thread.id).find((run) => run.id === task.childRunId)!;
    expect(task.output).toEqual({ answer: "already finished" });
    expect(task.usage).toEqual(emptyUsage());
    expect(run.usage).toEqual(emptyUsage());
    expect(run.subagent!.continuation!.budget).toMatchObject({ inheritedTurnCount: 1, inheritedUsage: { inputTokens: 1_000, costUsd: 0.01 } });
    expect((await active.store.listRunEvents(run.id)).filter((event) => event.type === "model.response")).toEqual([]);
    expect((await readSubagentWorkingSetForRestore(f.dataRoot, run.subagent!.checkpoint!.capsuleSha256)).capsule.messages).toEqual(f.messages);
  });

  it.each(["valid", "malformed"] as const)("checks the parent budget only when an inherited %s final needs another call", async (kind) => {
    const budget = new RunBudgetTracker({ maxTurns: 4, maxTotalTokens: 1_000, maxCostUsd: 1, timeoutMs: 60_000 });
    budget.observeAuxiliaryUsage({ ...emptyUsage(), inputTokens: 1_000 });
    const admission = vi.fn(() => budget.assertCanStartAuxiliaryCall());
    const f = await continuationRunnerFixture({ assertParentBudgetAvailable: admission });
    await f.assistant(fauxAssistantMessage(kind === "valid" ? '{"answer":"already done"}' : "malformed"));
    const active = await f.interruptAndClaim();
    if (kind === "valid") {
      expect((await active.runner.resume(active.continuation)).details.status).toBe("completed");
      expect(admission).not.toHaveBeenCalled();
    } else {
      await expect(active.runner.resume(active.continuation)).rejects.toThrow("tokens");
      expect(admission).toHaveBeenCalledTimes(1);
    }
    expect(f.faux.state.callCount).toBe(0);
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === active.continuation.execution.task.id)!;
    expect(task.turnCount).toBe(0);
    expect(task.usage).toEqual(emptyUsage());
  });

  it("settles a parent budget denial at the physical gate as known zero without a synthetic turn", async () => {
    const budget = new RunBudgetTracker({ maxTurns: 4, maxTotalTokens: 1_000, maxCostUsd: 1, timeoutMs: 60_000 });
    const admission = vi.fn(() => {
      if (admission.mock.calls.length === 2) budget.observeAuxiliaryUsage({ ...emptyUsage(), inputTokens: 1_000 });
      budget.assertCanStartAuxiliaryCall();
    });
    const f = await continuationRunnerFixture({ assertParentBudgetAvailable: admission });
    const active = await f.interruptAndClaim();
    await expect(active.runner.resume(active.continuation)).rejects.toThrow("tokens");
    expect(admission).toHaveBeenCalledTimes(2);
    expect(f.faux.state.callCount).toBe(0);
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === active.continuation.execution.task.id)!;
    expect(task).toMatchObject({ status: "failed", turnCount: 0, stepCount: 0, usageStatus: "complete", usage: emptyUsage() });
    const events = await active.store.listRunEvents(task.childRunId!);
    expect(events.filter((event) => event.type === "subagent.child.invocation_reserved")).toHaveLength(1);
    const response = events.filter((event) => event.type === "model.response");
    expect(response).toHaveLength(1);
    expect(response[0]!.payload).toMatchObject({ usageStatus: "known", usage: emptyUsage(), stopReason: "error" });
  });

  it.each([
    { label: "turn", maxTurns: 1, tokens: 0, maxTokens: 0, cost: 0, maxCost: 1, expected: "turn budget" },
    { label: "tokens", maxTurns: 4, tokens: 1_000, maxTokens: 1_000, cost: 0, maxCost: 1, expected: "tokens" },
    { label: "cost", maxTurns: 4, tokens: 0, maxTokens: 0, cost: 0.01, maxCost: 0.01, expected: "cost USD" },
  ])("denies malformed-final repair at inherited $label ceiling without a physical call", async (test) => {
    const f = await continuationRunnerFixture({ maxTurns: test.maxTurns, runLimits: { maxTotalTokens: test.maxTokens, maxCostUsd: test.maxCost } });
    await f.assistant(withUsage(fauxAssistantMessage("malformed inherited output"), test.tokens, test.cost));
    const active = await f.interruptAndClaim();
    await expect(active.runner.resume(active.continuation)).rejects.toThrow(test.expected);
    expect(f.faux.state.callCount).toBe(0);
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === active.continuation.execution.task.id)!;
    expect(task.turnCount).toBe(0);
    expect(task.usage).toEqual(emptyUsage());
    expect((await active.store.listRunEvents(task.childRunId!)).filter((event) => event.type === "model.response")).toEqual([]);
  });

  it("repairs an inherited malformed final using only the remaining logical turn", async () => {
    const f = await continuationRunnerFixture({ maxTurns: 2 });
    await f.assistant(withUsage(fauxAssistantMessage("malformed inherited output"), 500, 0.002));
    const active = await f.interruptAndClaim();
    const calls = controlledResponses(f, () => withUsage(fauxAssistantMessage('{"answer":"repaired"}'), 30, 0.001));
    const result = await active.runner.resume(active.continuation);
    expect(result.details).toMatchObject({ status: "completed", turnCount: 1 });
    expect(calls).toHaveLength(1);
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === result.details.taskId)!;
    expect(task.usage).toMatchObject({ inputTokens: 30, costUsd: 0.001 });
  });

  it("restores sparse consumed mailbox provenance and delivers only pending messages once", async () => {
    const f = await continuationRunnerFixture();
    const pending = await f.accept("earlier pending steering");
    const consumed = await f.accept("later consumed steering", true);
    await f.assistant(fauxAssistantMessage('{"answer":"stale before pending input"}'));
    const active = await f.interruptAndClaim();
    const contexts: Context[] = [];
    f.faux.setResponses([(context) => { contexts.push(structuredClone(context)); return fauxAssistantMessage('{"answer":"pending consumed"}'); }]);
    const result = await active.runner.resume(active.continuation);
    expect(active.delivered).toEqual([pending]);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.messages.filter((message) => message.role === "user" && message.content === pending.text)).toHaveLength(1);
    expect(contexts[0]!.messages.filter((message) => message.role === "user" && message.content === consumed.text)).toHaveLength(1);
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === result.details.taskId)!;
    const run = active.store.listRuns(f.thread.id).find((run) => run.id === task.childRunId)!;
    const restored = await readSubagentWorkingSetForRestore(f.dataRoot, run.subagent!.checkpoint!.capsuleSha256);
    expect(restored.binding.mailbox.entries.map((entry) => entry.id)).toEqual([pending.id, consumed.id]);
    expect(restored.binding.mailbox.entries.every((entry) => entry.originTaskId === f.task.id && entry.originParentRunId === f.parent.run.id)).toBe(true);
    expect(task.mailboxConsumedCount).toBe(2);
  });

  it("continues a final assistant when new steering is accepted after claim", async () => {
    const f = await continuationRunnerFixture();
    await f.assistant(fauxAssistantMessage('{"answer":"inherited final"}'));
    const active = await f.interruptAndClaim();
    const task = active.continuation.execution.task;
    const content = { kind: "napier.subagent-message" as const, schemaVersion: 1 as const, id: "submsg_afterclaim1234",
      taskId: task.id, messageKind: "steering" as const, text: "Apply new steering", createdAt: new Date().toISOString() };
    const message = { ...content, contentSha256: sha256(canonicalJson(content)) };
    await active.store.acceptSubagentMessage({ taskId: task.id, executionId: task.executionId!, message });
    await active.control.send(message);
    const contexts: Context[] = [];
    f.faux.setResponses([(context) => { contexts.push(structuredClone(context)); return fauxAssistantMessage('{"answer":"new steering applied"}'); }]);
    const result = await active.runner.resume(active.continuation);
    expect(result.details).toMatchObject({ status: "completed", turnCount: 1 });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.messages.at(-1)).toMatchObject({ role: "user", content: message.text });
    expect(active.delivered).toEqual([message]);
  });

  it("fails explicitly if late accepted steering misses the finalization checkpoint", async () => {
    const f = await continuationRunnerFixture();
    await f.assistant(fauxAssistantMessage('{"answer":"inherited final"}'));
    const active = await f.interruptAndClaim();
    const task = active.continuation.execution.task;
    const original = active.store.setSubagentSupervisorStatus.bind(active.store);
    vi.spyOn(active.store, "setSubagentSupervisorStatus").mockImplementation(async (...args) => {
      if (args[0] === task.id && args[1] === "reviewing") {
        const content = { kind: "napier.subagent-message" as const, schemaVersion: 1 as const, id: "submsg_latefinal12345",
          taskId: task.id, messageKind: "steering" as const, text: "Late accepted steering", createdAt: new Date().toISOString() };
        await active.store.acceptSubagentMessage({ taskId: task.id, executionId: task.executionId!,
          message: { ...content, contentSha256: sha256(canonicalJson(content)) } });
      }
      return original(...args);
    });
    await expect(active.runner.resume(active.continuation)).rejects.toThrow("unconsumed durable mailbox");
    expect(f.faux.state.callCount).toBe(0);
    expect(active.store.listSubagentTasks(f.thread.id).find((candidate) => candidate.id === task.id)?.status).toBe("failed");
  });

  it("continues a real read_file result without rerunning the inherited effect", async () => {
    const f = await continuationRunnerFixture({ readFile: true });
    await writeFile(path.join(f.workspaceRoot, "source.txt"), "verified inherited source");
    await f.assistant(fauxAssistantMessage(fauxToolCall("read_file", { path: "source.txt" }, { id: "inherited-read" }), { stopReason: "toolUse" }));
    const active = await f.interruptAndClaim();
    const contexts: Context[] = [];
    f.faux.setResponses([(context) => { contexts.push(structuredClone(context)); return fauxAssistantMessage('{"answer":"continued from read"}'); }]);
    const result = await active.runner.resume(active.continuation);
    expect(contexts[0]!.messages).toEqual(f.messages);
    expect((await active.store.listRunEvents(active.continuation.execution.run.id)).filter((event) => event.type === "tool.started")).toEqual([]);
    expect(await readFile(path.join(f.workspaceRoot, "source.txt"), "utf8")).toBe("verified inherited source");
    expect(result.details).toMatchObject({ status: "completed", turnCount: 1, stepCount: 1 });
  });

  it("rejects inherited provider ID reuse before another physical tool execution", async () => {
    const f = await continuationRunnerFixture({ readFile: true });
    await writeFile(path.join(f.workspaceRoot, "source.txt"), "verified inherited source");
    const tool = () => fauxAssistantMessage(fauxToolCall("read_file", { path: "source.txt" }, { id: "inherited-read" }), { stopReason: "toolUse" });
    await f.assistant(tool());
    const active = await f.interruptAndClaim();
    const contexts: Context[] = [];
    f.faux.setResponses([tool(), (context) => { contexts.push(structuredClone(context)); return fauxAssistantMessage('{"answer":"replay denied"}'); }]);
    const result = await active.runner.resume(active.continuation);
    expect(result.details.status).toBe("completed");
    expect(contexts[0]!.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true, toolCallId: "inherited-read" });
    expect(JSON.stringify(contexts[0]!.messages.at(-1))).toContain("inherited");
    expect((await active.store.listRunEvents(active.continuation.execution.run.id)).filter((event) => event.type === "tool.started")).toEqual([]);
  });

  it("revalidates inherited read evidence after claim and before any model dispatch", async () => {
    const f = await continuationRunnerFixture({ readFile: true });
    await writeFile(path.join(f.workspaceRoot, "source.txt"), "verified inherited source");
    await f.assistant(fauxAssistantMessage(fauxToolCall("read_file", { path: "source.txt" }, { id: "inherited-read" }), { stopReason: "toolUse" }));
    const active = await f.interruptAndClaim();
    await writeFile(path.join(f.workspaceRoot, "source.txt"), "changed after claim");
    await expect(active.runner.resume(active.continuation)).rejects.toThrow("dependency changed");
    expect(f.faux.state.callCount).toBe(0);
  });

  it("charges inherited usage before a subsequent normal call without copying it into the new attempt", async () => {
    const f = await continuationRunnerFixture({ readFile: true, runLimits: { maxTotalTokens: 1_000 } });
    await writeFile(path.join(f.workspaceRoot, "source.txt"), "verified inherited source");
    await f.assistant(withUsage(fauxAssistantMessage(fauxToolCall("read_file", { path: "source.txt" }, { id: "inherited-read" }), { stopReason: "toolUse" }), 150, 0));
    const active = await f.interruptAndClaim();
    const calls = controlledResponses(f, () => withUsage(fauxAssistantMessage(fauxToolCall("read_file", { path: "source.txt" }, { id: "new-read" }), { stopReason: "toolUse" }), 850, 0));
    await expect(active.runner.resume(active.continuation)).rejects.toThrow("tokens");
    expect(calls).toHaveLength(1);
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === active.continuation.execution.task.id)!;
    expect(task.turnCount).toBe(1);
    expect(task.usage).toMatchObject({ inputTokens: 850 });
    const run = active.store.listRuns(f.thread.id).find((run) => run.id === task.childRunId)!;
    expect(run.usage).toEqual(task.usage);
    expect((await active.store.listRunEvents(run.id)).filter((event) => event.type === "model.response")).toHaveLength(1);
  });

  it("hydrates the compactor with inherited debt and settles only its new auxiliary call", async () => {
    const f = await continuationRunnerFixture({ readFile: true, runLimits: { maxTotalTokens: 5_000 } });
    Object.assign(f.model, { contextWindow: 10_000, maxTokens: 1_200, reasoning: false });
    for (const name of ["first", "second"]) {
      await writeFile(path.join(f.workspaceRoot, `${name}.txt`), `${name} source evidence `.repeat(400));
      await f.assistant(withUsage(fauxAssistantMessage(fauxToolCall("read_file", { path: `${name}.txt` }, { id: `inherited-${name}` }), { stopReason: "toolUse" }), 1_100, 0.001));
    }
    const active = await f.interruptAndClaim();
    const calls = controlledResponses(f, () => withUsage(fauxAssistantMessage(JSON.stringify({ summary: "Both source files were inspected.",
      decisions: ["Preserve the source."], openLoops: ["Return final answer."], artifacts: ["first.txt", "second.txt"] })), 3_300, 0.003));
    await expect(active.runner.resume(active.continuation)).rejects.toThrow("tokens");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.systemPrompt).toContain("checkpoint inside an unfinished Run");
    const task = active.store.listSubagentTasks(f.thread.id).find((task) => task.id === active.continuation.execution.task.id)!;
    expect(task.turnCount).toBe(0);
    expect(task.usage).toMatchObject({ inputTokens: 3_300, costUsd: 0.003 });
    const run = active.store.listRuns(f.thread.id).find((run) => run.id === task.childRunId)!;
    expect(run.usage).toEqual(task.usage);
    const events = await active.store.listRunEvents(run.id);
    expect(events.filter((event) => event.type === "model.response")).toHaveLength(1);
    expect(events.filter((event) => event.type === RUN_CONTEXT_COMPACTED_EVENT)).toHaveLength(0);
    expect((await readSubagentWorkingSetForRestore(f.dataRoot, run.subagent!.checkpoint!.capsuleSha256)).capsule.messages).toEqual(f.messages);
  });
});

function withUsage(message: AssistantMessage, input: number, cost: number): AssistantMessage {
  message.usage = { input, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: input,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } };
  return message;
}

function controlledResponses(fixture: Awaited<ReturnType<typeof continuationRunnerFixture>>, next: (context: Context) => AssistantMessage): Context[] {
  const calls: Context[] = [];
  vi.spyOn(fixture.registry.models, "streamSimple").mockImplementation((model, context) => {
    calls.push(structuredClone(context));
    const response = next(context);
    Object.assign(response, { api: model.api, provider: model.provider, model: model.id });
    const stream = createAssistantMessageEventStream();
    if (response.stopReason === "error" || response.stopReason === "aborted") stream.push({ type: "error", reason: response.stopReason, error: response });
    else stream.push({ type: "done", reason: response.stopReason, message: response });
    return stream;
  });
  return calls;
}
