import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { emptyUsage } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubagentExecutionLifetime } from "../src/subagent-execution-lifetime.js";
import { SubagentTaskObserver } from "../src/subagent-task-observer.js";
import { createSubagentToolCallScope } from "../src/subagent-tool-call-identity.js";
import { cleanupModelSessionFixtures, createModelSessionFixture } from "./subagent-model-session-fixture.js";

afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await cleanupModelSessionFixtures(); });

describe("child continuation local state", () => {
  it("keeps the original absolute deadline instead of granting a fresh timeout", () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000);
    const lifetime = new SubagentExecutionLifetime([], 5_000, 1_500);
    lifetime.start();
    expect(lifetime.remainingMs()).toBe(500);
    vi.advanceTimersByTime(500);
    expect(lifetime.timedOut).toBe(true);
    expect(lifetime.signal.aborted).toBe(true);
    expect(() => lifetime.assertActive()).toThrow("timed out");
    lifetime.dispose();
  });

  it("enforces inherited turn limits while retaining attempt-only usage and counters", async () => {
    const fixture = await createModelSessionFixture({ maxTurns: 3 });
    const created = await fixture.store.createSubagentTask({ threadId: fixture.thread.id, runId: fixture.run.id,
      role: "researcher", description: "Restored observer", prompt: "Keep source", model: fixture.run.configuration!.model });
    const task = await fixture.store.startSubagentTask(created.id);
    const emit = vi.fn(async () => undefined);
    const observer = new SubagentTaskObserver(fixture.store, task, emptyUsage(),
      { maxConcurrent: 2, maxTotal: 4, maxTurns: 3, timeoutMs: 5_000 }, emit, undefined,
      { inheritedTurnCount: 2, inheritedStepCount: 4 });
    observer.assertTurnAvailable();
    await observer.observe({ type: "message_end", message: fauxAssistantMessage("one new result") });
    expect(observer.task.turnCount).toBe(1);
    expect(observer.task.stepCount).toBe(1);
    expect(observer.stepIndex).toBe(5);
    expect(emit).toHaveBeenCalledWith("subagent.step", expect.anything(), expect.objectContaining({ messageIndex: 5 }));
    expect(() => observer.assertTurnAvailable()).toThrow("turn budget exhausted");
    expect(observer.usage).toEqual(emptyUsage());
  });

  it("rejects inherited provider tool IDs before deriving a new execution identity", async () => {
    const fixture = await createModelSessionFixture();
    const query = vi.spyOn(fixture.store, "listRunEvents");
    const identify = createSubagentToolCallScope({ store: fixture.store, runId: fixture.run.id,
      taskId: "task_continuation", executionId: "subexec_continuation", inheritedProviderCallIds: ["inherited-tool-call"] });
    await expect(identify("inherited-tool-call")).rejects.toThrow("inherited");
    expect(query).not.toHaveBeenCalled();
    await expect(identify("fresh-tool-call")).resolves.toMatchObject({ providerCallId: "fresh-tool-call",
      subagentTaskId: "task_continuation", subagentExecutionId: "subexec_continuation" });
  });
});
