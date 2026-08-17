import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Api,
  type Provider,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { createGoal } from "../src/goals.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent model stream cancellation", () => {
  it("settles a signal-ignoring provider and quarantines late output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-stream-cancel-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const thread = await store.createThread({
      title: "Hard model cancellation",
      agentId: store.listAgents()[0]!.id,
    });
    const started = deferred<void>();
    const release = deferred<void>();
    const models = new ModelRegistry();
    models.registerProvider(
      hangingProvider(async () => {
        started.resolve();
        await release.promise;
        return "LATE_PROVIDER_OUTPUT_MUST_BE_QUARANTINED";
      }),
    );
    const runtime = new AgentRuntime(store, models);
    const controller = new AbortController();

    const pendingRun = runtime.runPrompt({
      threadId: thread.id,
      text: "Wait until cancellation.",
      model: { provider: "signal-ignoring", id: "stuck" },
      signal: controller.signal,
    });
    await started.promise;
    const cancelledAt = Date.now();
    controller.abort();
    const run = await pendingRun;

    expect(run.status).toBe("cancelled");
    expect(Date.now() - cancelledAt).toBeLessThan(1_000);
    expect(runtime.stop(thread.id)).toBe(false);

    release.resolve();
    await vi.waitFor(() => expect(release.settled()).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const events = await store.listEvents(thread.id);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({ type: "run.cancelled" }),
    );
    expect(JSON.stringify(events)).not.toContain(
      "LATE_PROVIDER_OUTPUT_MUST_BE_QUARANTINED",
    );
    expect(
      events.filter((event) => event.type === "model.response"),
    ).toHaveLength(1);
    expect(
      events.find((event) => event.type === "model.response")?.payload,
    ).toEqual(expect.objectContaining({ stopReason: "aborted" }));
    store.close();
  });

  it("records a metadata-only adapter failure after the cancellation grace", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture("cancel-grace");
    const started = deferred<void>();
    fixture.models.registerProvider(
      hangingProvider(async () => {
        started.resolve();
        return new Promise(() => undefined);
      }),
    );
    const runtime = new AgentRuntime(fixture.store, fixture.models);
    const controller = new AbortController();

    const pendingRun = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Cancel the stuck provider.",
      model: { provider: "signal-ignoring", id: "stuck" },
      signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    const run = await pendingRun;

    expect(run.status).toBe("cancelled");
    expect(
      (await fixture.store.listEvents(fixture.threadId)).some(
        (event) => event.type === "model.stream.cancellation_failed",
      ),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    const events = await fixture.store.listEvents(fixture.threadId);
    const failures = events.filter(
      (event) => event.type === "model.stream.cancellation_failed",
    );
    expect(failures).toEqual([
      expect.objectContaining({
        category: "model",
        visibility: "debug",
        payload: {
          kind: "napier.model-stream-cancellation-failure",
          schemaVersion: 1,
          provider: "signal-ignoring",
          model: "stuck",
          graceMs: 5_000,
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      }),
    ]);
    expect(JSON.stringify(failures)).not.toContain(
      "Cancel the stuck provider.",
    );
    fixture.store.close();
  });

  it("turns a Run deadline into prompt settlement without provider release", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture("deadline");
    await fixture.store.setGoal(
      fixture.threadId,
      createGoal("Continue after a bounded Run attempt."),
    );
    const started = deferred<void>();
    fixture.models.registerProvider(
      hangingProvider(async () => {
        started.resolve();
        return new Promise(() => undefined);
      }),
    );
    const runtime = new AgentRuntime(fixture.store, fixture.models);

    const pendingRun = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Stop at the configured deadline.",
      model: { provider: "signal-ignoring", id: "stuck" },
    });
    await started.promise;
    const activeRun = fixture.store.listRuns(fixture.threadId).at(-1)!;
    await fixture.store.recordAgentMilestone({
      threadId: fixture.threadId,
      runId: activeRun.id,
      phase: "execution",
      title: "Durable work preserved",
      summary: "The bounded attempt recorded progress before finalization.",
      completedItems: ["Capture durable progress"],
      openLoops: ["Finish the bounded delivery"],
    });
    const plan = await fixture.store.createPlan(fixture.threadId, {
      objective: "Finish the bounded delivery.",
      steps: [
        {
          id: "finish",
          title: "Finish the output",
          description: "Complete the remaining output.",
          verification: "Verify the final output.",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "report.md",
          description: "The partially produced report.",
        },
      ],
    });
    await writeFile(
      path.join(fixture.workspaceRoot, "report.md"),
      "# Partial report\n",
      "utf8",
    );
    await fixture.store.transitionPlanStep(plan.id, "finish", {
      action: "start",
      runId: activeRun.id,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const run = await pendingRun;

    expect(run.status).toBe("failed");
    expect(run.outcome).toBe("partial");
    expect(run.error).toContain("wall time ms");
    expect(runtime.stop(fixture.threadId)).toBe(false);
    expect(fixture.store.getThread(fixture.threadId).status).toBe("idle");
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "model.response",
        "run.budget.exhausted",
        "plan.step.partial",
        "plan.artifact.candidate",
        "run.settlement.recorded",
        "run.settlement.checkpoint",
        "run.failed",
      ]),
    );
    expect(
      events.find((event) => event.type === "run.budget.exhausted")?.payload,
    ).toEqual(
      expect.objectContaining({
        observed: expect.objectContaining({
          turns: 1,
          inFlightTurns: 1,
        }),
      }),
    );
    expect(
      events.find((event) => event.type === "model.response")?.payload,
    ).toEqual(expect.objectContaining({ stopReason: "aborted" }));
    expect(
      events.find((event) => event.type === "run.failed")?.payload,
    ).toEqual(expect.objectContaining({ outcome: "partial" }));
    expect(
      events.find((event) => event.type === "run.settlement.recorded")?.payload,
    ).toEqual(
      expect.objectContaining({
        kind: "napier.run-settlement",
        schemaVersion: 1,
        outcome: "partial",
        completedItems: ["Capture durable progress"],
        openLoops: ["Finish the bounded delivery", "Finish the output"],
        artifacts: [
          expect.objectContaining({
            planId: plan.id,
            artifactId: "report",
            path: "report.md",
            status: "candidate",
          }),
        ],
        planIds: [plan.id],
        continuation: expect.stringContaining("Continue from this settlement"),
        sourceEventCount: expect.any(Number),
        sourceEventStreamSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(
      events.find((event) => event.type === "run.settlement.checkpoint")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        kind: "napier.run-settlement-checkpoint",
        schemaVersion: 1,
        outcome: "partial",
        settlementSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        sourceEventStreamSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        openLoops: ["Finish the bounded delivery", "Finish the output"],
        artifactCount: 1,
        planIds: [plan.id],
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(events.some((event) => event.type === "goal.evaluated")).toBe(false);
    expect(fixture.store.getThread(fixture.threadId).goal).toEqual(
      expect.objectContaining({
        status: "active",
        blocker: "missing_evidence",
      }),
    );
    fixture.store.close();
    const reopened = new LocalStore({
      workspaceRoot: fixture.workspaceRoot,
      dataRoot: fixture.dataRoot,
    });
    await reopened.initialize();
    expect(reopened.getThread(fixture.threadId).status).toBe("idle");
    expect(reopened.listRuns(fixture.threadId).at(-1)).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "partial",
      }),
    );
    expect(
      (await reopened.listEvents(fixture.threadId)).find(
        (event) => event.type === "run.settlement.recorded",
      )?.payload,
    ).toEqual(expect.objectContaining({ contentSha256: expect.any(String) }));
    expect(reopened.getPlan(plan.id).artifacts).toEqual([
      expect.objectContaining({
        id: "report",
        status: "candidate",
        sourceRunId: activeRun.id,
        evidence: expect.stringContaining("verification remains pending"),
      }),
    ]);
    expect(reopened.getPlan(plan.id).steps).toEqual([
      expect.objectContaining({
        id: "finish",
        status: "partial",
        runId: activeRun.id,
        evidence: expect.stringContaining("settlement checkpoint"),
      }),
    ]);
    const reopenedPlan = await reopened.transitionPlanStep(plan.id, "finish", {
      action: "reopen",
    });
    expect(reopenedPlan.steps[0]).toEqual(
      expect.objectContaining({
        id: "finish",
        status: "ready",
        evidence: "",
      }),
    );
    expect(reopenedPlan.steps[0]).not.toHaveProperty("runId");
    reopened.close();
  });

  it("finalizes a first-event watchdog before the Run deadline", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture("first-event-watchdog");
    const started = deferred<void>();
    fixture.models.registerProvider(
      hangingProvider(async () => {
        started.resolve();
        return new Promise(() => undefined);
      }),
    );
    const runtime = new AgentRuntime(fixture.store, fixture.models);
    fixture.models.modelTurnDeadlinePolicy = {
      turnTimeoutMs: 1_000,
      firstEventTimeoutMs: 100,
      idleTimeoutMs: 500,
    };

    const pendingRun = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Trigger the first-event watchdog.",
      model: { provider: "signal-ignoring", id: "stuck" },
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(100);
    const run = await pendingRun;

    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        error: expect.stringContaining("first_event_timeout"),
      }),
    );
    expect(fixture.store.getThread(fixture.threadId).status).toBe("idle");
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.find((event) => event.type === "model.stream.watchdog_triggered")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        kind: "napier.model-stream-watchdog",
        schemaVersion: 1,
        reason: "first_event_timeout",
        limitMs: 100,
        turnTimeoutMs: 1_000,
        firstEventTimeoutMs: 100,
        idleTimeoutMs: 500,
      }),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "model.stream.watchdog_triggered",
        "run.settlement.recorded",
        "run.settlement.checkpoint",
        "run.failed",
      ]),
    );
    fixture.store.close();
  });

  it("finalizes an idle watchdog after the provider stops making progress", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture("idle-watchdog");
    const started = deferred<void>();
    fixture.models.registerProvider(stallingProvider(started));
    const runtime = new AgentRuntime(fixture.store, fixture.models);
    fixture.models.modelTurnDeadlinePolicy = {
      turnTimeoutMs: 1_000,
      firstEventTimeoutMs: 100,
      idleTimeoutMs: 200,
    };

    const pendingRun = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Trigger the idle watchdog.",
      model: { provider: "stalling", id: "stuck" },
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(199);
    expect(
      (await fixture.store.listEvents(fixture.threadId)).some(
        (event) => event.type === "model.stream.watchdog_triggered",
      ),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const run = await pendingRun;

    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
      }),
    );
    const watchdog = (await fixture.store.listEvents(fixture.threadId)).find(
      (event) => event.type === "model.stream.watchdog_triggered",
    );
    expect(watchdog?.payload).toEqual(
      expect.objectContaining({
        reason: "idle_timeout",
        limitMs: 200,
      }),
    );
    fixture.store.close();
  });

  it("finalizes semantic keepalive without waiting for transport idle", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture("semantic-watchdog");
    const started = deferred<void>();
    fixture.models.registerProvider(keepaliveProvider(started));
    const runtime = new AgentRuntime(fixture.store, fixture.models);
    fixture.models.modelTurnDeadlinePolicy = {
      turnTimeoutMs: 1_000,
      firstEventTimeoutMs: 100,
      idleTimeoutMs: 300,
      semanticProgressTimeoutMs: 200,
    };

    const pendingRun = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Stop framing-only model output.",
      model: { provider: "keepalive", id: "stuck" },
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(200);
    const run = await pendingRun;

    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        error: expect.stringContaining("semantic_progress_timeout"),
      }),
    );
    const watchdog = (await fixture.store.listEvents(fixture.threadId)).find(
      (event) => event.type === "model.stream.watchdog_triggered",
    );
    expect(watchdog?.payload).toEqual(
      expect.objectContaining({
        reason: "semantic_progress_timeout",
        limitMs: 200,
        idleTimeoutMs: 300,
        semanticProgressTimeoutMs: 200,
      }),
    );
    fixture.store.close();
  });

  it("retries one reasoning-only semantic stall with minimal reasoning", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture("semantic-stall-retry");
    const started = deferred<void>();
    fixture.models.registerProvider(semanticStallRetryProvider(started));
    const runtime = new AgentRuntime(fixture.store, fixture.models);
    fixture.models.modelTurnDeadlinePolicy = {
      turnTimeoutMs: 1_000,
      firstEventTimeoutMs: 100,
      idleTimeoutMs: 300,
      semanticProgressTimeoutMs: 200,
    };

    const pendingRun = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Recover from a reasoning-only stall.",
      model: { provider: "semantic-stall-retry", id: "stuck" },
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(200);
    const run = await pendingRun;

    expect(run.status, run.error).toBe("completed");
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.find((event) => event.type === "model.thinking_loop.detected")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        action: "retry",
        reason: "semantic_stall",
        attempt: 1,
      }),
    );
    expect(
      events.findLast((event) => event.type === "message.assistant")?.payload,
    ).toEqual(
      expect.objectContaining({ text: "RECOVERED_FROM_SEMANTIC_STALL" }),
    );
    fixture.store.close();
  });

  it("keeps an empty budget settlement paused and resumable", async () => {
    vi.useFakeTimers();
    const fixture = await createFixture("empty-deadline");
    const started = deferred<void>();
    fixture.models.registerProvider(
      hangingProvider(async () => {
        started.resolve();
        return new Promise(() => undefined);
      }),
    );
    const runtime = new AgentRuntime(fixture.store, fixture.models);

    const pendingRun = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Pause without durable deliverables.",
      model: { provider: "signal-ignoring", id: "stuck" },
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(10_000);
    const run = await pendingRun;

    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
      }),
    );
    expect(fixture.store.getThread(fixture.threadId).status).toBe("idle");
    const settlement = (await fixture.store.listEvents(fixture.threadId)).find(
      (event) => event.type === "run.settlement.recorded",
    );
    expect(settlement?.payload).toEqual(
      expect.objectContaining({
        outcome: "paused_budget",
        completedItems: [],
        artifacts: [],
      }),
    );
    fixture.store.close();
  });

  it("uses the reserved turn for constrained finalization", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-reserve-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const seededAgent = store.listAgents()[0]!;
    const agent = await store.updateAgent(seededAgent.id, {
      enabledTools: ["read_file"],
      runLimits: {
        maxTurns: 7,
        maxTotalTokens: 1_000_000,
        maxCostUsd: 25,
        timeoutMs: 1_800_000,
      },
    });
    const thread = await store.createThread({
      title: "Finalization reserve",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "reserve-provider" });
    provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "missing.txt" }), {
        stopReason: "toolUse",
      }),
      (context) => {
        if (
          !JSON.stringify(context.messages).includes(
            "Internal finalization reserve",
          )
        ) {
          throw new Error("Finalization reserve guidance is unavailable");
        }
        return fauxAssistantMessage("Finalized from the bounded read result.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(store, models);

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Try the bounded read and then finish.",
      model: { provider: "reserve-provider", id: "faux-1" },
    });

    expect(run).toEqual(
      expect.objectContaining({
        status: "completed",
      }),
    );
    const events = await store.listEvents(thread.id);
    expect(provider.state.callCount).toBe(3);
    expect(
      events.find((event) => event.type === "run.finalization.reserved")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        status: "reserved",
        reasons: ["turns"],
        reservedTurns: 6,
        observed: expect.objectContaining({
          turns: 1,
          inFlightTurns: 0,
        }),
      }),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.finalization.reserved",
        "message.assistant",
        "run.completed",
      ]),
    );
    expect(
      events.filter((event) => event.type === "run.finalization.reserved"),
    ).toHaveLength(1);
    expect(
      events.findLast((event) => event.type === "message.assistant")?.payload,
    ).toEqual(
      expect.objectContaining({
        text: "Finalized from the bounded read result.",
      }),
    );
    store.close();
  });
});

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-stream-${label}-`));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const seededAgent = store.listAgents()[0]!;
  const agent = await store.updateAgent(seededAgent.id, {
    runLimits: {
      ...seededAgent.runLimits!,
      timeoutMs: 10_000,
    },
  });
  const thread = await store.createThread({
    title: `Hard model cancellation ${label}`,
    agentId: agent.id,
  });
  return {
    store,
    models: new ModelRegistry(),
    threadId: thread.id,
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  };
}

function hangingProvider(response: () => Promise<string>): Provider<Api> {
  const model = {
    id: "stuck",
    name: "Signal-ignoring model",
    api: "signal-ignoring-api",
    provider: "signal-ignoring",
    baseUrl: "https://example.invalid",
    reasoning: false,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 1_024,
  };
  const stream = () => {
    const output = createAssistantMessageEventStream();
    void response().then((text) => {
      const message = {
        ...fauxAssistantMessage(text),
        api: model.api,
        provider: model.provider,
        model: model.id,
      };
      output.push({ type: "start", partial: message });
      output.push({ type: "done", reason: "stop", message });
    });
    return output;
  };
  return {
    id: model.provider,
    name: "Signal-ignoring provider",
    auth: {
      apiKey: {
        check: async () => ({ source: "test", type: "api_key" }),
        resolve: async () => ({
          auth: { apiKey: "test" },
          source: "test",
        }),
      },
    },
    getModels: () => [model],
    stream,
    streamSimple: stream,
  };
}

function stallingProvider(
  started: ReturnType<typeof deferred<void>>,
): Provider<Api> {
  const provider = hangingProvider(async () => new Promise(() => undefined));
  const model = provider.getModels()[0]!;
  const stream = () => {
    const output = createAssistantMessageEventStream();
    queueMicrotask(() => {
      output.push({
        type: "start",
        partial: {
          ...fauxAssistantMessage(""),
          api: model.api,
          provider: model.provider,
          model: model.id,
        },
      });
      started.resolve();
    });
    return output;
  };
  return {
    ...provider,
    id: "stalling",
    getModels: () => [{ ...model, provider: "stalling" }],
    stream,
    streamSimple: stream,
  };
}

function keepaliveProvider(
  started: ReturnType<typeof deferred<void>>,
): Provider<Api> {
  const provider = hangingProvider(async () => new Promise(() => undefined));
  const model = provider.getModels()[0]!;
  const stream = () => {
    const output = createAssistantMessageEventStream();
    const message = {
      ...fauxAssistantMessage(""),
      api: model.api,
      provider: "keepalive",
      model: model.id,
    };
    queueMicrotask(() => {
      output.push({ type: "start", partial: message });
      started.resolve();
      for (const delayMs of [50, 100, 150]) {
        const timer = setTimeout(() => {
          output.push({
            type: "text_start",
            contentIndex: 0,
            partial: message,
          });
        }, delayMs);
        timer.unref?.();
      }
    });
    return output;
  };
  return {
    ...provider,
    id: "keepalive",
    getModels: () => [{ ...model, provider: "keepalive" }],
    stream,
    streamSimple: stream,
  };
}

function semanticStallRetryProvider(
  started: ReturnType<typeof deferred<void>>,
): Provider<Api> {
  const provider = hangingProvider(async () => new Promise(() => undefined));
  const model = provider.getModels()[0]!;
  let attempt = 0;
  const stream = (
    _model: unknown,
    _context: unknown,
    options?: { reasoning?: string },
  ) => {
    attempt += 1;
    if (attempt >= 2) {
      if (attempt === 2) expect(options?.reasoning).toBe("minimal");
      const output = createAssistantMessageEventStream();
      const text =
        attempt === 2 ? "RECOVERED_FROM_SEMANTIC_STALL" : '{"facts":[]}';
      const message = {
        ...fauxAssistantMessage(text),
        api: model.api,
        provider: "semantic-stall-retry",
        model: model.id,
      };
      queueMicrotask(() => {
        output.push({ type: "start", partial: message });
        output.push({
          type: "text_delta",
          contentIndex: 0,
          delta: text,
          partial: message,
        });
        output.push({ type: "done", reason: "stop", message });
      });
      return output;
    }
    const output = createAssistantMessageEventStream();
    const message = {
      ...fauxAssistantMessage(""),
      api: model.api,
      provider: "semantic-stall-retry",
      model: model.id,
    };
    queueMicrotask(() => {
      output.push({ type: "start", partial: message });
      started.resolve();
      for (const delayMs of [50, 100, 150]) {
        const timer = setTimeout(() => {
          output.push({
            type: "thinking_delta",
            contentIndex: 0,
            delta: "still reasoning",
            partial: message,
          });
        }, delayMs);
        timer.unref?.();
      }
    });
    return output;
  };
  return {
    ...provider,
    id: "semantic-stall-retry",
    getModels: () => [
      { ...model, provider: "semantic-stall-retry", reasoning: true },
    ],
    stream: stream as Provider<Api>["stream"],
    streamSimple: stream as Provider<Api>["streamSimple"],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let settled = false;
  const promise = new Promise<T>((next) => {
    resolve = (value) => {
      settled = true;
      next(value);
    };
  });
  return { promise, resolve, settled: () => settled };
}
