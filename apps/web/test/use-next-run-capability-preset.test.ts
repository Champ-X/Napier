import type { RunEvent, StreamFrame } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

import { executeNextRunPrompt } from "../src/next-run-capability-preset-execution";
import { DEFAULT_COMPOSER_PERMISSION_PRESET } from "../src/use-next-run-capability-preset";

describe("persistent Composer permission", () => {
  it("defaults to full access", () => {
    expect(DEFAULT_COMPOSER_PERMISSION_PRESET).toBe("full_access");
  });

  it("keeps sending the permission after the matching Run starts", async () => {
    const onFrame = vi.fn();
    const onRefresh = vi.fn(async () => undefined);
    const restoreInput = vi.fn();
    const stream = vi.fn(async (_threadId, body, dispatch) => {
      expect(body).toEqual({
        text: "Use Browser once.",
        model: { provider: "faux", id: "faux-1" },
        capabilityPreset: "browser",
      });
      dispatch(eventFrame("run.started", { capabilityPreset: "browser" }));
      dispatch(errorFrame());
    });

    await executeNextRunPrompt(
      {
        threadId: "thread_1",
        text: "Use Browser once.",
        model: { provider: "faux", id: "faux-1" },
        capabilityPreset: "browser",
        onStart: vi.fn(),
        onRefresh,
        onError: vi.fn(),
        restoreInput,
        onFinish: vi.fn(),
        onFrame,
      },
      stream,
    );

    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(restoreInput).not.toHaveBeenCalled();
  });

  it("restores the prompt when the Run is rejected before creation", async () => {
    const onError = vi.fn();
    const onRefresh = vi.fn();
    const restoreInput = vi.fn();
    const failure = new Error("Model unavailable");

    await executeNextRunPrompt(
      {
        threadId: "thread_1",
        text: "Retry after setup.",
        model: { provider: "faux", id: "faux-1" },
        capabilityPreset: "coding",
        onStart: vi.fn(),
        onRefresh,
        onError,
        restoreInput,
        onFinish: vi.fn(),
        onFrame: vi.fn(),
      },
      vi.fn(async () => {
        throw failure;
      }),
    );

    expect(onRefresh).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(restoreInput).toHaveBeenCalledWith("Retry after setup.");
  });

  it("forwards pre-start frames without changing the selected permission", async () => {
    const onFrame = vi.fn();
    await executeNextRunPrompt(
      {
        threadId: "thread_1",
        text: "Use Coding once.",
        model: { provider: "faux", id: "faux-1" },
        capabilityPreset: "coding",
        onStart: vi.fn(),
        onRefresh: vi.fn(async () => undefined),
        onError: vi.fn(),
        restoreInput: vi.fn(),
        onFinish: vi.fn(),
        onFrame,
      },
      vi.fn(async (_threadId, _body, dispatch) => {
        dispatch(eventFrame("message.user", { role: "user" }));
      }),
    );
    expect(onFrame).toHaveBeenCalledOnce();
  });
});

function eventFrame(type: string, payload: RunEvent["payload"]): StreamFrame {
  return {
    type: "event",
    event: {
      id: `event_${type.replace(".", "_")}`,
      threadId: "thread_1",
      runId: "run_1",
      seq: 1,
      type,
      category: "lifecycle",
      visibility: "debug",
      createdAt: "2026-08-11T00:00:00.000Z",
      payload,
    },
    eventSha256: "a".repeat(64),
  };
}

function errorFrame(): StreamFrame {
  return {
    type: "error",
    threadId: "thread_1",
    message: "Run failed while streaming.",
    code: "run_failed",
    diagnosticSha256: "b".repeat(64),
  };
}
