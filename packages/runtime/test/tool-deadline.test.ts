import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { RunBudgetTracker } from "../src/run-budget.js";
import { LocalStore } from "../src/store.js";
import {
  createToolDeadlineManager,
  ToolDeadlineError,
  ToolNotStartedError,
} from "../src/tool-deadline.js";
import {
  DEFAULT_TOOL_DEADLINE_POLICY,
  TOOL_MINIMUM_DEADLINE_MS,
  type ToolMinimumDeadline,
} from "../src/tool-deadline-policy.js";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Tool deadline manager", () => {
  it("allows ten minutes by default for complex tool operations", () => {
    expect(DEFAULT_TOOL_DEADLINE_POLICY).toEqual({
      timeoutMs: 600_000,
      settlementGraceMs: 5_000,
    });
  });

  it("honors a bounded tool minimum deadline below the remaining Run budget", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture({
      timeoutMs: 100,
      settlementGraceMs: 20,
    });
    const manager = createToolDeadlineManager({
      budget: fixture.budget,
      registry: fixture.registry,
      run: fixture.run,
      store: fixture.store,
    });
    const longLived = tool(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(result("settled within tool bound")), 200);
        }),
    ) as AgentTool & ToolMinimumDeadline;
    longLived[TOOL_MINIMUM_DEADLINE_MS] = 250;
    const tools = [longLived];
    manager.wrap(tools);

    const pending = tools[0]!.execute("call_bounded_long", {}, undefined);
    await vi.advanceTimersByTimeAsync(100);
    expect(manager.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toEqual(result("settled within tool bound"));
    expect(manager.error).toBeUndefined();
    fixture.store.close();
  });

  it("passes through a tool that completes before its child deadline", async () => {
    const fixture = await createFixture();
    const manager = createToolDeadlineManager({
      budget: fixture.budget,
      registry: fixture.registry,
      run: fixture.run,
      store: fixture.store,
    });
    const tools = [tool(async () => result("complete"))];
    manager.wrap(tools);

    await expect(tools[0]!.execute("call_ok", {}, undefined)).resolves.toEqual(
      result("complete"),
    );
    expect(manager.error).toBeUndefined();
    const events = await fixture.store.listEvents(fixture.run.threadId);
    expect(
      events
        .filter((event) => event.type === "tool.effect.journaled")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({
        state: "not_started",
        attempt: 1,
        toolNameSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        state: "started_unknown",
        attempt: 1,
        toolNameSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        state: "completed",
        attempt: 1,
        toolNameSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('"toolName":"test_tool"');
    expect(
      events.filter((event) => event.type.startsWith("tool.deadline")),
    ).toEqual([]);
    fixture.store.close();
  });

  it("records completed when a timed-out tool settles during grace", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture({
      timeoutMs: 100,
      settlementGraceMs: 50,
    });
    const manager = createToolDeadlineManager({
      budget: fixture.budget,
      registry: fixture.registry,
      run: fixture.run,
      store: fixture.store,
    });
    const toolStarted = deferred<void>();
    const tools = [
      tool(
        (_callId, _args, signal) =>
          new Promise((resolve) => {
            toolStarted.resolve();
            signal?.addEventListener(
              "abort",
              () => setTimeout(() => resolve(result("settled")), 25),
              { once: true },
            );
          }),
      ),
    ];
    manager.wrap(tools);

    const pending = tools[0]!.execute("call_settled", {}, undefined);
    await toolStarted.promise;
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toEqual(result("settled"));
    expect(manager.error?.evidence).toEqual(
      expect.objectContaining({
        reason: "deadline_exceeded",
        state: "completed",
        timeoutMs: 100,
        graceMs: 50,
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.run.threadId))
        .filter((event) => event.type === "tool.effect.journaled")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ state: "not_started", attempt: 1 }),
      expect.objectContaining({ state: "started_unknown", attempt: 1 }),
      expect.objectContaining({ state: "completed", attempt: 1 }),
    ]);
    expect(() => manager.throwIfTriggered()).toThrow(ToolDeadlineError);
  });

  it("does not start after the child deadline expires during journaling", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture({
      timeoutMs: 100,
      settlementGraceMs: 50,
    });
    const manager = createToolDeadlineManager({
      budget: fixture.budget,
      registry: fixture.registry,
      run: fixture.run,
      store: fixture.store,
    });
    const journalEntered = deferred<void>();
    const releaseJournal = deferred<void>();
    const journalCompleted = deferred<void>();
    const appendEvent = fixture.store.appendEvent.bind(fixture.store);
    vi.spyOn(fixture.store, "appendEvent").mockImplementation(async (input) => {
      if (input.type === "tool.effect.journaled") {
        journalEntered.resolve();
        await releaseJournal.promise;
      }
      const event = await appendEvent(input);
      if (input.type === "tool.effect.journaled") journalCompleted.resolve();
      return event;
    });
    let calls = 0;
    const tools = [
      tool(async () => {
        calls += 1;
        return result("must not start");
      }),
    ];
    manager.wrap(tools);

    const pending = tools[0]!.execute("call_not_started", {}, undefined);
    const rejected = expect(pending).rejects.toBeInstanceOf(ToolDeadlineError);
    await journalEntered.promise;
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(0);
    releaseJournal.resolve();
    await rejected;
    await journalCompleted.promise;
    expect(calls).toBe(0);
    expect(manager.error?.evidence).toEqual(
      expect.objectContaining({
        reason: "deadline_exceeded",
        state: "not_started",
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.run.threadId))
        .filter((event) => event.type === "tool.effect.journaled")
        .map((event) => event.payload),
    ).toEqual([expect.objectContaining({ state: "not_started", attempt: 1 })]);
    fixture.store.close();
  });

  it("quarantines updates and records started_unknown after grace", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture({
      timeoutMs: 100,
      settlementGraceMs: 50,
    });
    const manager = createToolDeadlineManager({
      budget: fixture.budget,
      registry: fixture.registry,
      run: fixture.run,
      store: fixture.store,
    });
    let resolveLate!: (value: ReturnType<typeof result>) => void;
    const updates: string[] = [];
    const toolStarted = deferred<void>();
    const tools = [
      tool(
        (_callId, _args, _signal, onUpdate) =>
          new Promise((resolve) => {
            toolStarted.resolve();
            resolveLate = resolve;
            setTimeout(() => {
              onUpdate?.(result("late update"));
              resolve(result("late result"));
            }, 500);
          }),
      ),
    ];
    manager.wrap(tools);

    const pending = tools[0]!.execute(
      "call_unknown",
      {},
      undefined,
      (update) => {
        updates.push(
          String(
            update.content[0]?.type === "text" ? update.content[0].text : "",
          ),
        );
      },
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(ToolDeadlineError);
    await toolStarted.promise;
    await vi.advanceTimersByTimeAsync(150);
    await rejected;
    expect(manager.error?.evidence).toEqual(
      expect.objectContaining({
        reason: "deadline_exceeded",
        state: "started_unknown",
      }),
    );
    const deadlineEvent = (
      await fixture.store.listEvents(fixture.run.threadId)
    ).find((event) => event.type === "tool.deadline.exceeded");
    expect(deadlineEvent?.payload).toEqual(
      expect.objectContaining({
        callId: "call_unknown",
        toolName: "test_tool",
        effect: "unknown",
        state: "started_unknown",
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      (await fixture.store.listEvents(fixture.run.threadId))
        .filter((event) => event.type === "tool.effect.journaled")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ state: "not_started", attempt: 1 }),
      expect.objectContaining({ state: "started_unknown", attempt: 1 }),
    ]);
    await vi.advanceTimersByTimeAsync(500);
    resolveLate(result("late result"));
    expect(updates).toEqual([]);
    fixture.store.close();
  });

  it("retries exactly once only after an explicit not-started failure", async () => {
    const fixture = await createFixture();
    const manager = createToolDeadlineManager({
      budget: fixture.budget,
      registry: fixture.registry,
      run: fixture.run,
      store: fixture.store,
    });
    let calls = 0;
    const tools = [
      tool(() => {
        calls += 1;
        if (calls === 1) throw new ToolNotStartedError("temporary admission");
        return Promise.resolve(result("retried"));
      }),
    ];
    manager.wrap(tools);

    await expect(
      tools[0]!.execute("call_retry", {}, undefined),
    ).resolves.toEqual(result("retried"));
    expect(calls).toBe(2);
    const events = await fixture.store.listEvents(fixture.run.threadId);
    expect(
      events
        .filter((event) => event.type === "tool.effect.journaled")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ state: "not_started", attempt: 1 }),
      expect.objectContaining({ state: "not_started", attempt: 2 }),
      expect.objectContaining({ state: "started_unknown", attempt: 2 }),
      expect.objectContaining({ state: "completed", attempt: 2 }),
    ]);
    expect(
      events.filter((event) => event.type === "tool.retry.started"),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          fromAttempt: 1,
          toAttempt: 2,
          reason: "not_started",
        }),
      }),
    ]);
    fixture.store.close();
  });

  it("never retries an asynchronous failure after execution started", async () => {
    const fixture = await createFixture();
    const manager = createToolDeadlineManager({
      budget: fixture.budget,
      registry: fixture.registry,
      run: fixture.run,
      store: fixture.store,
    });
    let calls = 0;
    const tools = [
      tool(async () => {
        calls += 1;
        throw new ToolNotStartedError("too late to retry");
      }),
    ];
    manager.wrap(tools);

    await expect(
      tools[0]!.execute("call_no_retry", {}, undefined),
    ).rejects.toThrow("too late to retry");
    expect(calls).toBe(1);
    const events = await fixture.store.listEvents(fixture.run.threadId);
    expect(events.some((event) => event.type === "tool.retry.started")).toBe(
      false,
    );
    expect(
      events
        .filter((event) => event.type === "tool.effect.journaled")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ state: "not_started", attempt: 1 }),
      expect.objectContaining({ state: "started_unknown", attempt: 1 }),
      expect.objectContaining({ state: "completed", attempt: 1 }),
    ]);
    fixture.store.close();
  });
});

async function createFixture(policy?: {
  timeoutMs: number;
  settlementGraceMs: number;
}) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-tool-deadline-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: "Tool deadline",
    agentId: agent.id,
  });
  const run = await store.createRun({
    threadId: thread.id,
    agentId: agent.id,
  });
  const registry = new ModelRegistry();
  if (policy) registry.toolDeadlinePolicy = policy;
  return {
    store,
    registry,
    run,
    budget: new RunBudgetTracker(run.limits!, run.startedAt),
  };
}

function tool(execute: AgentTool["execute"]): AgentTool {
  return {
    name: "test_tool",
    label: "Test tool",
    description: "Test deadline behavior.",
    parameters: Type.Object({}),
    execute,
  };
}

function result(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
