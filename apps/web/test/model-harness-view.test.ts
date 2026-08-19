import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { latestModelHarnessView, modelHarnessViews } from "../src/model-harness-view";

describe("model Harness view", () => {
  it("projects valid durable Harness decisions", () => {
    const valid = event(7);
    expect(modelHarnessViews([valid])).toEqual([
      expect.objectContaining({
        eventSeq: 7,
        runId: "run_1",
        family: "openai",
        intents: ["coding"],
        toolSurface: "focused",
        activeToolCount: 2,
        configuredToolCount: 3,
        savedToolDefinitionBytes: 700,
      }),
    ]);
    expect(latestModelHarnessView([event(6), valid], "run_1")?.eventSeq).toBe(7);
  });

  it("rejects count, byte, and receipt-shape drift", () => {
    const base = event(1);
    expect(modelHarnessViews([
      { ...base, payload: { ...asRecord(base.payload), activeToolCount: 3 } },
      { ...base, payload: { ...asRecord(base.payload), savedToolDefinitionBytes: 699 } },
      { ...base, payload: { ...asRecord(base.payload), contentSha256: "bad" } },
    ])).toEqual([]);
  });
});

function event(seq: number): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type: "model.harness.resolved",
    category: "model",
    visibility: "debug",
    createdAt: "2026-08-19T00:00:00.000Z",
    payload: {
      kind: "napier.model-harness-resolution",
      schemaVersion: 1,
      harnessId: "napier.model-harness.openai.v1",
      family: "openai",
      promptDialect: "instruction-led",
      provider: "openai",
      model: "gpt-5",
      modelApi: "openai-responses",
      attempt: 1,
      intents: ["coding"],
      toolSurface: "focused",
      configuredToolCount: 3,
      activeToolCount: 2,
      activeToolNames: ["read_file", "apply_patch"],
      omittedToolNames: ["browser"],
      configuredToolDefinitionBytes: 1_000,
      activeToolDefinitionBytes: 300,
      savedToolDefinitionBytes: 700,
      maxRetries: 2,
      maxRetriesSource: "harness",
      maxRetryDelayMs: 30_000,
      maxRetryDelayMsSource: "harness",
      contentSha256: "a".repeat(64),
    },
  };
}

function asRecord(value: RunEvent["payload"]): Record<string, RunEvent["payload"]> {
  return value as Record<string, RunEvent["payload"]>;
}
