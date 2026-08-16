import type { RunEvent, RunRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { createAgentRunStartedPayload } from "../src/agent-run-started-event.js";
import type { RunPromptOptions } from "../src/agent-runtime-options.js";
import {
  prepareAutomaticSkillRecoveryOptions,
  prepareManualSkillRecoveryOptions,
} from "../src/research-recovery-options.js";
import { createRunIntentId, projectRunIntents } from "../src/run-intents.js";

describe("Run intent identity", () => {
  it("creates deterministic IDs and projects only valid run.started evidence", () => {
    expect(createRunIntentId("run_source")).toBe(
      createRunIntentId("run_source"),
    );
    expect(createRunIntentId("run_source")).not.toBe(
      createRunIntentId("run_other"),
    );
    expect(
      projectRunIntents([
        startedEvent(1, "run_source", "intent_delivery0001"),
        startedEvent(2, "run_invalid", "INVALID"),
        event(3, "run_other", "message.user", {
          intentId: "intent_spoofed0001",
        }),
      ]),
    ).toEqual(new Map([["run_source", "intent_delivery0001"]]));
  });

  it.each([
    ["manual", prepareManualSkillRecoveryOptions],
    ["automatic", prepareAutomaticSkillRecoveryOptions],
  ] as const)(
    "inherits a valid source intent through %s recovery into child start evidence",
    async (mode, prepare) => {
      const source = run("run_source");
      const options: RunPromptOptions = {
        threadId: source.threadId,
        text: "Continue from the durable checkpoint.",
        source: "recovery",
        parentRunId: source.id,
        recovery: { mode },
      };
      const prepared = await prepare(
        "/unused",
        source,
        [startedEvent(1, source.id, "intent_delivery0001")],
        options,
      );

      expect(prepared.recovery).toEqual({
        mode,
        intentId: "intent_delivery0001",
      });
      expect(
        createAgentRunStartedPayload({
          agent: { id: "agent_1", revision: 1 },
          model: { provider: "faux", id: "faux-1" },
          source: "recovery",
          run: run("run_child"),
          limits: {
            maxTurns: 10,
            maxTotalTokens: 10_000,
            maxCostUsd: 1,
            timeoutMs: 60_000,
          },
          triggerId: undefined,
          capabilityPreset: undefined,
          parentRunId: source.id,
          sourceContinuityRunId: undefined,
          recovery: prepared.recovery,
        }),
      ).toEqual(expect.objectContaining({ intentId: "intent_delivery0001" }));
    },
  );
});

function run(id: string): RunRecord {
  return {
    id,
    threadId: "thread_1",
    agentId: "agent_1",
    status: "interrupted",
    startedAt: "2026-08-16T00:00:00.000Z",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}

function startedEvent(seq: number, runId: string, intentId: string): RunEvent {
  return event(seq, runId, "run.started", { intentId });
}

function event(
  seq: number,
  runId: string,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type,
    category: "lifecycle",
    visibility: "debug",
    createdAt: `2026-08-16T00:00:0${String(seq)}.000Z`,
    payload,
  };
}
