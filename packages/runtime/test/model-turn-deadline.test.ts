import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createModelTurnDeadline,
  ModelTurnWatchdogError,
} from "../src/model-turn-deadline.js";

afterEach(() => vi.useRealTimers());

describe("Model turn deadline", () => {
  it("caps child policy by the remaining Run deadline", () => {
    const deadline = createModelTurnDeadline({
      remainingRunMs: 500,
      policy: {
        turnTimeoutMs: 1_000,
        firstEventTimeoutMs: 800,
        idleTimeoutMs: 700,
        semanticProgressTimeoutMs: 600,
      },
    });

    expect(deadline.signal.aborted).toBe(false);
    deadline.finish();
  });

  it("triggers first-event, idle, and turn watchdogs independently", async () => {
    vi.useFakeTimers();
    const first = createModelTurnDeadline({
      remainingRunMs: 1_000,
      policy: {
        turnTimeoutMs: 1_000,
        firstEventTimeoutMs: 100,
        idleTimeoutMs: 200,
        semanticProgressTimeoutMs: 200,
      },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(first.signal.reason).toEqual(
      expect.objectContaining({
        name: "ModelTurnWatchdogError",
        evidence: expect.objectContaining({
          reason: "first_event_timeout",
          limitMs: 100,
        }),
      }),
    );

    const idle = createModelTurnDeadline({
      remainingRunMs: 1_000,
      policy: {
        turnTimeoutMs: 1_000,
        firstEventTimeoutMs: 100,
        idleTimeoutMs: 200,
        semanticProgressTimeoutMs: 300,
      },
    });
    idle.observe(startEvent());
    await vi.advanceTimersByTimeAsync(150);
    idle.observe(textEvent());
    await vi.advanceTimersByTimeAsync(199);
    expect(idle.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(idle.signal.reason).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          reason: "idle_timeout",
          limitMs: 200,
        }),
      }),
    );

    const turn = createModelTurnDeadline({
      remainingRunMs: 300,
      policy: {
        turnTimeoutMs: 300,
        firstEventTimeoutMs: 100,
        idleTimeoutMs: 250,
        semanticProgressTimeoutMs: 250,
      },
    });
    turn.observe(startEvent());
    await vi.advanceTimersByTimeAsync(200);
    turn.observe(textEvent());
    await vi.advanceTimersByTimeAsync(100);
    expect(turn.signal.reason).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          reason: "turn_timeout",
          limitMs: 300,
        }),
      }),
    );
  });

  it("requires semantic progress even while framing events keep arriving", async () => {
    vi.useFakeTimers();
    const deadline = createModelTurnDeadline({
      remainingRunMs: 1_000,
      policy: {
        turnTimeoutMs: 1_000,
        firstEventTimeoutMs: 100,
        idleTimeoutMs: 300,
        semanticProgressTimeoutMs: 200,
      },
    });
    deadline.observe(startEvent());
    for (let elapsed = 50; elapsed < 200; elapsed += 50) {
      await vi.advanceTimersByTimeAsync(50);
      deadline.observe(textStartEvent());
      deadline.observe(whitespaceTextEvent());
    }
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(deadline.signal.reason).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          reason: "semantic_progress_timeout",
          limitMs: 200,
        }),
      }),
    );
  });

  it("resets semantic progress only for meaningful deltas", async () => {
    vi.useFakeTimers();
    const deadline = createModelTurnDeadline({
      remainingRunMs: 1_000,
      policy: {
        turnTimeoutMs: 1_000,
        firstEventTimeoutMs: 100,
        idleTimeoutMs: 300,
        semanticProgressTimeoutMs: 200,
      },
    });
    deadline.observe(startEvent());
    await vi.advanceTimersByTimeAsync(150);
    deadline.observe(textEvent());
    await vi.advanceTimersByTimeAsync(199);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.reason).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          reason: "semantic_progress_timeout",
          limitMs: 200,
        }),
      }),
    );
  });

  it("does not treat hidden reasoning deltas as executable semantic progress", async () => {
    vi.useFakeTimers();
    const deadline = createModelTurnDeadline({
      remainingRunMs: 1_000,
      policy: {
        turnTimeoutMs: 1_000,
        firstEventTimeoutMs: 100,
        idleTimeoutMs: 300,
        semanticProgressTimeoutMs: 200,
      },
    });
    deadline.observe(startEvent());
    for (let elapsed = 50; elapsed < 200; elapsed += 50) {
      await vi.advanceTimersByTimeAsync(50);
      deadline.observe(thinkingEvent());
    }
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(deadline.signal.reason).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          reason: "semantic_progress_timeout",
          limitMs: 200,
        }),
      }),
    );
  });

  it("lets root cancellation win without watchdog evidence", () => {
    const root = new AbortController();
    const deadline = createModelTurnDeadline({
      rootSignal: root.signal,
      remainingRunMs: 1_000,
      policy: {
        turnTimeoutMs: 1_000,
        firstEventTimeoutMs: 100,
        idleTimeoutMs: 200,
        semanticProgressTimeoutMs: 300,
      },
    });
    root.abort(new Error("parent cancelled"));

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.evidence).toBeUndefined();
    expect(deadline.signal.reason).not.toBeInstanceOf(ModelTurnWatchdogError);
  });
});

function startEvent() {
  const message = fauxAssistantMessage("");
  return { type: "start" as const, partial: message };
}

function textEvent() {
  const message = fauxAssistantMessage("x");
  return {
    type: "text_delta" as const,
    contentIndex: 0,
    delta: "x",
    partial: message,
  };
}

function textStartEvent() {
  const message = fauxAssistantMessage("");
  return {
    type: "text_start" as const,
    contentIndex: 0,
    partial: message,
  };
}

function whitespaceTextEvent() {
  const message = fauxAssistantMessage(" ");
  return {
    type: "text_delta" as const,
    contentIndex: 0,
    delta: " ",
    partial: message,
  };
}

function thinkingEvent() {
  const message = fauxAssistantMessage("");
  return {
    type: "thinking_delta" as const,
    contentIndex: 0,
    delta: "still reasoning",
    partial: message,
  };
}
