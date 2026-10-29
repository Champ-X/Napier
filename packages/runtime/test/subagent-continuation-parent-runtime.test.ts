import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { continuationRunnerFixture, cleanupContinuationRunnerFixtures } from "./subagent-continuation-runner-fixture.js";
import { createThreadReplayBundle, validateThreadReplayBundle } from "../src/thread-bundles.js";

afterEach(async () => { vi.useRealTimers(); await cleanupContinuationRunnerFixtures(); });

describe("parent Runtime child continuation", () => {
  it("restores the child before the recovered parent's model call and retains separate physical usage", async () => {
    const f = await continuationRunnerFixture();
    const interrupted = await f.interrupt();
    const observed: string[] = [];
    f.faux.setResponses([
      (context) => {
        observed.push("child");
        expect(context.messages[0]).toEqual(f.messages[0]);
        return fauxAssistantMessage('{"answer":"continued"}');
      },
      (context) => {
        observed.push("parent");
        expect(JSON.stringify(context)).toContain("subagent-continuation-results");
        return fauxAssistantMessage("The recovered child returned its answer.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const runtime = processReadyAgentRuntime(interrupted.store, f.registry);
    const parent = await runtime.resumeInterruptedRun({ threadId: f.thread.id, runId: f.parent.run.id });
    const tasks = interrupted.store.listSubagentTasks(f.thread.id);
    const successor = tasks.find((task) => task.continuedFromTaskId === f.task.id);
    expect(parent.status, parent.error).toBe("completed");
    expect(observed).toEqual(["child", "parent"]);
    expect(successor).toMatchObject({ status: "completed", runId: parent.id, output: { answer: "continued" } });
    expect(successor!.completion).toBeDefined();
    const child = interrupted.store.listRuns(f.thread.id).find((run) => run.id === successor!.childRunId)!;
    expect(child.usage).toEqual(successor!.usage);
    expect(parent.usage).toEqual(await interrupted.store.aggregateRunUsage(parent.id));
    const events = await interrupted.store.listRunEvents(child.id);
    expect(events.filter((event) => event.type === "message.user" || event.type === "message.assistant")).toEqual([]);
    const replay = createThreadReplayBundle(await interrupted.store.getDetail(f.thread.id));
    expect(() => validateThreadReplayBundle(replay)).not.toThrow();
  });

  it("keeps explicit read-only inspection from restarting any child", async () => {
    const f = await continuationRunnerFixture();
    const interrupted = await f.interrupt();
    f.faux.setResponses([fauxAssistantMessage("Inspection retained the interrupted child evidence."), fauxAssistantMessage('{"facts":[]}')]);
    const runtime = processReadyAgentRuntime(interrupted.store, f.registry);
    const parent = await runtime.resumeInterruptedRun({ threadId: f.thread.id, runId: f.parent.run.id, readOnly: true });
    expect(parent).toMatchObject({ source: "recovery", status: "failed", outcome: "partial" });
    expect(interrupted.store.listSubagentTasks(f.thread.id)).toHaveLength(1);
    expect(interrupted.store.listRuns(f.thread.id).filter((run) => run.source === "subagent")).toHaveLength(1);
    expect((await interrupted.store.listRunEvents(parent.id)).some((event) => event.type === "subagent.child.continuation_started")).toBe(false);
  });

  it("continues an eligible child under automatic read-only recovery without enabling new delegation tools", async () => {
    const f = await continuationRunnerFixture({ automaticRecovery: { mode: "safe_read_only", maxAttempts: 2, backoffMs: 1_000 } });
    const interrupted = await f.interrupt();
    const claimTime = Date.now() + 5_000;
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(claimTime);
    const claims = await interrupted.store.claimAutomaticRecoveries("recoveryworker_fixture");
    expect(claims.claims).toHaveLength(1);
    const claim = claims.claims[0]!;
    let parentTools: string[] = [];
    f.faux.setResponses([
      fauxAssistantMessage('{"answer":"automatic continuation"}'),
      (context) => {
        parentTools = (context.tools ?? []).map((tool) => tool.name);
        return fauxAssistantMessage("The saved child answered under the recovery grant.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const runtime = processReadyAgentRuntime(interrupted.store, f.registry);
    const parent = await runtime.resumeInterruptedRunAutomatically({ ...claim,
      onRunCreated: async (created) => { await interrupted.store.bindAutomaticRecoveryRun(claim.attempt.id, claim.token, created.id); } });
    expect(parent.status, parent.error).toBe("completed");
    expect(parent.configuration).toMatchObject({ executionMode: "safe_read_only_recovery", enabledSubagents: [], toolPolicy: "observe" });
    expect(parentTools).not.toContain("delegate_task");
    expect(parentTools).not.toContain("subagent_start");
    expect(interrupted.store.listSubagentTasks(f.thread.id).find((task) => task.continuedFromTaskId === f.task.id))
      .toMatchObject({ status: "completed", runId: parent.id, output: { answer: "automatic continuation" } });
  });

  it("retains the unavailable source when the recovered parent's configured role was removed", async () => {
    const f = await continuationRunnerFixture();
    const interrupted = await f.interrupt();
    await interrupted.store.updateAgent(f.profile.id, { enabledSubagents: [] });
    f.faux.setResponses([fauxAssistantMessage("The interrupted child remains unavailable."), fauxAssistantMessage('{"facts":[]}')]);
    const runtime = processReadyAgentRuntime(interrupted.store, f.registry);
    const parent = await runtime.resumeInterruptedRun({ threadId: f.thread.id, runId: f.parent.run.id });
    expect(parent.status, parent.error).toBe("completed");
    expect(interrupted.store.listSubagentTasks(f.thread.id)).toHaveLength(1);
    expect((await interrupted.store.listRunEvents(parent.id)).filter((event) => event.type === "subagent.continuation.unavailable"))
      .toEqual([expect.objectContaining({ payload: expect.objectContaining({ taskId: f.task.id, reason: "parent_authority_unavailable" }) })]);
  });

  it("does not recover a frozen read tool that was removed from the current configured profile", async () => {
    const f = await continuationRunnerFixture({ readFile: true });
    const interrupted = await f.interrupt();
    await interrupted.store.updateAgent(f.profile.id, { enabledTools: [] });
    f.faux.setResponses([fauxAssistantMessage("The revoked child read authority remains unavailable."), fauxAssistantMessage('{"facts":[]}')]);
    const runtime = processReadyAgentRuntime(interrupted.store, f.registry);
    const parent = await runtime.resumeInterruptedRun({ threadId: f.thread.id, runId: f.parent.run.id });
    expect(parent.status, parent.error).toBe("completed");
    expect(interrupted.store.listSubagentTasks(f.thread.id)).toHaveLength(1);
    expect((await interrupted.store.listRunEvents(parent.id)).filter((event) => event.type === "subagent.continuation.unavailable"))
      .toEqual([expect.objectContaining({ payload: expect.objectContaining({ taskId: f.task.id, reason: "parent_authority_unavailable" }) })]);
  });
});
