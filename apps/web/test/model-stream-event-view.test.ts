import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { modelStreamEventTraceSummary } from "../src/model-stream-event-view";

describe("Model stream event trace view", () => {
  it("projects watchdog and cancellation metadata without diagnostics", () => {
    const watchdog = event("model.stream.watchdog_triggered", {
      provider: "deepseek",
      model: "deepseek-reasoner",
      reason: "idle_timeout",
      limitMs: 90_000,
      turnTimeoutMs: 300_000,
      firstEventTimeoutMs: 45_000,
      idleTimeoutMs: 90_000,
      semanticProgressTimeoutMs: 90_000,
      contentSha256: "4".repeat(64),
      message: "TOP_SECRET_WATCHDOG_MESSAGE",
    });
    const cancellation = event("model.stream.cancellation_failed", {
      provider: "deepseek",
      model: "deepseek-reasoner",
      graceMs: 5_000,
      contentSha256: "5".repeat(64),
      diagnostic: "TOP_SECRET_PROVIDER_OUTPUT",
    });

    expect(modelStreamEventTraceSummary(watchdog)).toBe(
      `model / stream.watchdog_triggered / content ${"4".repeat(12)} / provider deepseek / model deepseek-reasoner / reason idle_timeout / limit-ms 90000 / turn-ms 300000 / first-ms 45000 / idle-ms 90000 / semantic-ms 90000`,
    );
    expect(modelStreamEventTraceSummary(cancellation)).toBe(
      `model / stream.cancellation_failed / content ${"5".repeat(12)} / provider deepseek / model deepseek-reasoner / grace-ms 5000`,
    );
    expect(modelStreamEventTraceSummary(watchdog)).not.toContain("TOP_SECRET");
    expect(modelStreamEventTraceSummary(cancellation)).not.toContain(
      "TOP_SECRET",
    );
  });

  it("fails closed for malformed stream metadata", () => {
    expect(
      modelStreamEventTraceSummary(
        event("model.stream.watchdog_triggered", {
          provider: "deepseek",
          message: "TOP_SECRET",
        }),
      ),
    ).toBe("model receipt");
    expect(
      modelStreamEventTraceSummary(event("model.response", { status: "ok" })),
    ).toBeUndefined();
  });
});

function event(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_model",
    runId: "run_model",
    seq: 34,
    type,
    category: "model",
    visibility: "debug",
    payload,
    createdAt: "2026-08-16T00:00:00.000Z",
  };
}
