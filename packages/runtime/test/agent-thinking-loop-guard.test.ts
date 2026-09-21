import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  fauxText,
  fauxThinking,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { createGoal } from "../src/goals.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { aggregateRunUsage } from "../src/run-replay.js";
import { PROGRESSIVE_REASONING } from "./progressive-reasoning-fixture.js";
import { ModelThinkingTraceStore } from "../src/model-thinking-trace-store.js";

const roots: string[] = [];
const LOOP_REASONING =
  "We should keep reconsidering the same general plan without taking action. ".repeat(
    90,
  );

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent thinking-loop guard", () => {
  it("executes the original tool call after distinct unanchored reasoning sections", async () => {
    const fixture = await createFixture("progressive-reasoning");
    const provider = fauxProvider({
      provider: "progressive-reasoning",
      models: [{ id: "reasoning", reasoning: true }],
      tokenSize: { min: 17, max: 17 },
    });
    provider.setResponses([
      fauxAssistantMessage([
        fauxThinking(PROGRESSIVE_REASONING),
        fauxToolCall("list_files", { path: "." }, { id: "inspect_accounts" }),
      ]),
      fauxAssistantMessage("The workspace inspection completed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    try {
      const run = await new AgentRuntime(fixture.store, models).runPrompt({
        threadId: fixture.threadId,
        text: "Inspect the workspace and report completion.",
        model: { provider: "progressive-reasoning", id: "reasoning" },
      });
      const events = await fixture.store.listEvents(fixture.threadId);
      expect(run.status, run.error).toBe("completed");
      expect(provider.state.callCount).toBe(3);
      expect(
        events.filter((e) => e.type === "model.thinking_loop.detected"),
      ).toEqual([]);
      expect(events.filter((e) => e.type === "tool.completed")).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            toolName: "list_files",
            callId: "inspect_accounts",
          }),
        }),
      ]);
      expect(
        events.filter((e) => e.type === "context.model_invocation"),
      ).toHaveLength(3);
    } finally {
      fixture.store.close();
    }
  });

  it("charges the full rejected terminal response before deciding whether to retry", async () => {
    const fixture = await createFixture("terminal-budget");
    const agent = fixture.store.listAgents()[0]!;
    await fixture.store.updateAgent(agent.id, {
      enabledTools: ["list_files"],
      runLimits: {
        maxTurns: 24,
        maxTotalTokens: 1000,
        maxCostUsd: 10,
        timeoutMs: 120000,
      },
    });
    const provider = fauxProvider({ provider: "terminal-budget" });
    provider.setResponses([
      fauxAssistantMessage([fauxThinking("Inspect src/graph.mjs next.")]),
      fauxAssistantMessage("MUST_NOT_RETRY"),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    try {
      const run = await new AgentRuntime(fixture.store, models).runPrompt({
        threadId: fixture.threadId,
        text: "Return a result.",
        model: { provider: "terminal-budget", id: "faux-1" },
      });
      expect(run).toEqual(
        expect.objectContaining({ status: "failed", outcome: "paused_budget" }),
      );
      expect(provider.state.callCount).toBe(1);
      const detection = (await fixture.store.listEvents(fixture.threadId)).find(
        (e) => e.type === "model.thinking_loop.detected",
      );
      expect(detection?.payload).toEqual(
        expect.objectContaining({
          action: "budget_exhausted",
          reason: "thinking_only_terminal",
          usage: expect.objectContaining({ inputTokens: expect.any(Number) }),
        }),
      );
    } finally {
      fixture.store.close();
    }
  });

  it("recovers a reasoning-only normal stop instead of completing silently", async () => {
    const fixture = await createFixture("reasoning-only-stop");
    const provider = fauxProvider({
      provider: "reasoning-only-stop",
      models: [{ id: "reasoning", reasoning: true }],
    });
    provider.setResponses([
      fauxAssistantMessage([
        fauxThinking("Inspect src/graph.mjs, then run the existing tests."),
      ]),
      (context, options) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Internal thinking-loop redirect",
        );
        expect(options?.maxTokens).toBeGreaterThan(2048);
        return fauxAssistantMessage("Concrete recovered result.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);
    try {
      const run = await runtime.runPrompt({
        threadId: fixture.threadId,
        text: "Return a concrete result.",
        model: { provider: "reasoning-only-stop", id: "reasoning" },
      });
      const events = await fixture.store.listEvents(fixture.threadId);
      expect(run.status, run.error).toBe("completed");
      expect(run.usage).toEqual(aggregateRunUsage(events, []));
      expect(
        events.findLast((e) => e.type === "message.assistant")?.payload,
      ).toEqual(
        expect.objectContaining({ text: "Concrete recovered result." }),
      );
      expect(
        events.find((e) => e.type === "model.thinking_loop.detected")?.payload,
      ).toEqual(
        expect.objectContaining({
          action: "retry",
          reason: "thinking_only_terminal",
          usage: expect.any(Object),
        }),
      );
    } finally {
      fixture.store.close();
    }
  });

  it("chooses the retry level from the serving fallback model", async () => {
    const fixture = await createFixture("fallback-retry");
    const primary = fauxProvider({
      provider: "thinking-primary",
      models: [{ id: "primary", reasoning: true }],
    });
    const fallback = fauxProvider({
      provider: "thinking-fallback",
      models: [{ id: "fallback", reasoning: false }],
      tokenSize: { min: 16, max: 16 },
    });
    primary.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "HTTP 503 service unavailable",
      }),
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "HTTP 503 service unavailable",
      }),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    let retryObserved = false;
    fallback.setResponses([
      fauxAssistantMessage([fauxThinking(LOOP_REASONING)]),
      (context, options) => {
        expect(JSON.stringify(context.messages)).toContain(
          "Internal thinking-loop redirect",
        );
        expect(options?.reasoning).toBeUndefined();
        expect(options?.maxTokens).toBeGreaterThan(2048);
        retryObserved = true;
        return fauxAssistantMessage("Recovered using the serving model.");
      },
    ]);
    const models = new ModelRegistry();
    models.registerProvider(primary.provider);
    models.registerProvider(fallback.provider);
    const runtime = new AgentRuntime(fixture.store, models);
    try {
      const run = await runtime.runPrompt({
        threadId: fixture.threadId,
        text: "Return a concrete result.",
        model: { provider: "thinking-primary", id: "primary" },
        modelRoute: {
          role: "reasoning",
          fallbackModels: [{ provider: "thinking-fallback", id: "fallback" }],
        },
      });
      expect(run.status, run.error).toBe("completed");
      expect(retryObserved).toBe(true);
    } finally {
      fixture.store.close();
    }
  });

  it("quarantines one failed attempt and retries with a short redirect", async () => {
    const fixture = await createFixture("retry");
    const provider = fauxProvider({
      provider: "thinking-loop-retry",
      models: [{ id: "reasoning", reasoning: true }],
      tokenSize: { min: 16, max: 16 },
    });
    provider.setResponses([
      fauxAssistantMessage([
        fauxThinking(LOOP_REASONING),
        fauxText("FAILED_REASONING_MUST_NOT_SURFACE"),
      ]),
      (context, options) => {
        const serialized = JSON.stringify(context.messages);
        expect(serialized).toContain("Internal thinking-loop redirect");
        expect(serialized).not.toContain("FAILED_REASONING_MUST_NOT_SURFACE");
        expect(options?.reasoning).toBe("minimal");
        expect(options?.maxTokens).toBeGreaterThan(2_048);
        return fauxAssistantMessage("RECOVERED_AFTER_LOOP_GUARD");
      },
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Return a concrete result.",
      model: { provider: "thinking-loop-retry", id: "reasoning" },
    });

    expect(run.status).toBe("completed");
    expect(provider.state.callCount).toBe(3);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "model.thinking_loop.detected"),
    ).toEqual([
      expect.objectContaining({
        visibility: "debug",
        payload: expect.objectContaining({
          action: "retry",
          attempt: 1,
          reason: expect.any(String),
          repeatedUnitSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    ]);
    expect(
      events.filter((event) => event.type === "context.model_invocation"),
    ).toHaveLength(3);
    expect(
      events.find((event) => event.type === "message.assistant")?.payload,
    ).toEqual(expect.objectContaining({ text: "RECOVERED_AFTER_LOOP_GUARD" }));
    expect(JSON.stringify(events)).not.toContain(
      "FAILED_REASONING_MUST_NOT_SURFACE",
    );
    expect(JSON.stringify(events)).not.toContain(LOOP_REASONING.slice(0, 120));
    const detection = events.find(
      (e) => e.type === "model.thinking_loop.detected",
    )!.payload as Record<string, unknown>;
    const receipt = detection["reasoningTrace"] as {
      status: string;
      capsuleSha256: string;
    };
    expect(receipt.status).toBe("stored");
    const trace = await new ModelThinkingTraceStore(
      fixture.store.dataRoot,
    ).read(receipt.capsuleSha256);
    expect(trace.sourceRunId).toBe(run.id);
    expect(trace.sourceThreadId).toBe(fixture.threadId);
    expect(trace.contextEnvelopeSha256).toBe(
      detection["modelContextEnvelopeSha256"],
    );
    expect(trace.turnIndex).toBe(0);
    expect(trace.trace.observedBytes).toBeGreaterThanOrEqual(1024);
    expect(LOOP_REASONING.startsWith(trace.trace.text)).toBe(true);
    expect(trace.trace.truncated).toBe(false);
    expect(
      JSON.stringify(
        await exportThreadReplayBundle(fixture.store, fixture.threadId),
      ),
    ).not.toContain(LOOP_REASONING.slice(0, 120));
    await expect(
      exportThreadReplayBundle(fixture.store, fixture.threadId),
    ).resolves.toEqual(
      expect.objectContaining({
        events: expect.arrayContaining([
          expect.objectContaining({
            type: "model.thinking_loop.detected",
            payload: expect.objectContaining({
              action: "retry",
              modelContextEnvelopeTurnIndex: 0,
              modelContextEnvelopeSha256:
                expect.stringMatching(/^[a-f0-9]{64}$/u),
            }),
          }),
        ]),
      }),
    );
    fixture.store.close();
  });

  it("finalizes resumably when the redirected attempt loops again", async () => {
    const fixture = await createFixture("finalize");
    await fixture.store.setGoal(
      fixture.threadId,
      createGoal("Finish after bounded reasoning."),
    );
    const provider = fauxProvider({
      provider: "thinking-loop-finalize",
      models: [{ id: "reasoning", reasoning: true }],
      tokenSize: { min: 16, max: 16 },
    });
    provider.setResponses([
      fauxAssistantMessage([fauxThinking(LOOP_REASONING)]),
      fauxAssistantMessage([fauxThinking(LOOP_REASONING)]),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Stop if reasoning repeats.",
      model: { provider: "thinking-loop-finalize", id: "reasoning" },
    });

    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        error: expect.stringContaining("thinking-loop guard"),
      }),
    );
    expect(provider.state.callCount).toBe(2);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.filter((event) => event.type === "model.thinking_loop.detected"),
    ).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ action: "retry", attempt: 1 }),
      }),
      expect.objectContaining({
        visibility: "user",
        payload: expect.objectContaining({ action: "finalize", attempt: 2 }),
      }),
    ]);
    expect(
      events.find((event) => event.type === "model.thinking_loop.finalized")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        kind: "napier.model-thinking-loop-finalization",
        attempt: 2,
        reason: expect.any(String),
      }),
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.settlement.recorded",
        "run.settlement.checkpoint",
        "run.failed",
      ]),
    );
    expect(fixture.store.getThread(fixture.threadId).goal).toEqual(
      expect.objectContaining({ status: "active" }),
    );
    expect(JSON.stringify(events)).not.toContain(LOOP_REASONING.slice(0, 120));
    fixture.store.close();
  });

  it("does not retry after discarded reasoning exhausts the hard budget", async () => {
    const fixture = await createFixture("budget");
    const seededAgent = fixture.store.listAgents()[0]!;
    await fixture.store.updateAgent(seededAgent.id, {
      enabledTools: ["list_files"],
      runLimits: {
        maxTurns: 24,
        maxTotalTokens: 1_000,
        maxCostUsd: 10,
        timeoutMs: 120_000,
      },
    });
    const provider = fauxProvider({
      provider: "thinking-loop-budget",
      tokenSize: { min: 10_000, max: 10_000 },
    });
    provider.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking("budget calibration ".repeat(1_000)),
          fauxToolCall("list_files", { path: "." }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("SECOND_PROVIDER_CALL_MUST_NOT_RUN"),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(fixture.store, models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Stop when hidden reasoning exhausts the Run budget.",
      model: { provider: "thinking-loop-budget", id: "faux-1" },
    });

    expect(run).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        error: expect.stringContaining("total tokens"),
      }),
    );
    expect(provider.state.callCount).toBe(1);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.find((event) => event.type === "model.thinking_loop.detected")
        ?.payload,
    ).toEqual(
      expect.objectContaining({
        action: "budget_exhausted",
        attempt: 1,
      }),
    );
    expect(events.filter((event) => event.type === "model.response")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          stopReason: "length",
          toolCalls: [],
        }),
      }),
    ]);
    expect(events.some((event) => event.type === "tool.started")).toBe(false);
    expect(JSON.stringify(events)).not.toContain(
      "SECOND_PROVIDER_CALL_MUST_NOT_RUN",
    );
    await expect(
      exportThreadReplayBundle(fixture.store, fixture.threadId),
    ).resolves.toEqual(
      expect.objectContaining({
        thread: expect.objectContaining({ id: fixture.threadId }),
      }),
    );
    fixture.store.close();
  });
});

async function createFixture(label: string) {
  const root = await mkdtemp(path.join(tmpdir(), `napier-thinking-${label}-`));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agentId = store.listAgents()[0]!.id;
  const thread = await store.createThread({
    title: "Thinking loop guard",
    agentId,
  });
  return { store, threadId: thread.id };
}
