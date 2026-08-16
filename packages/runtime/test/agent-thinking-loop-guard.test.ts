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
        expect(options?.maxTokens).toBe(2_048);
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
