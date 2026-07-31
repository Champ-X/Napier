import type {
  AgentMessageExperimentComparison,
  AgentMessageExperimentResultFrame,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  agentMessageCheckpoints,
  agentMessageExperimentResultFilename,
  parseAgentExperimentModelKey,
  projectAgentMessageExperimentComparison,
} from "../src/agent-message-experiment-view-model";

describe("Agent message experiment view model", () => {
  it("selects only terminal modern user-message checkpoints without prose", () => {
    const runs = [
      run("run_source_12345678", "user", "completed", 8),
      run("run_legacy_12345678", "user", "completed", 6),
      run("run_active_12345678", "user", "running", 8),
      run("run_workflow_12345678", "workflow", "completed", 8),
    ];
    const events = runs.map((candidate, index) =>
      event(candidate.id, index + 10, `PRIVATE_PROMPT_${String(index)}`),
    );

    expect(agentMessageCheckpoints(runs, events)).toEqual([
      {
        key: "run_source_12345678:10",
        runId: "run_source_12345678",
        messageSeq: 10,
        runIndex: 1,
        status: "completed",
        model: { provider: "napier", id: "demo" },
        createdAt: "2026-08-01T01:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(agentMessageCheckpoints(runs, events))).not.toContain(
      "PRIVATE_PROMPT",
    );
  });

  it("projects bounded comparison metadata and stable download names", () => {
    const comparison = {
      source: {
        status: "completed",
        model: { provider: "deepseek", id: "deepseek-chat" },
        metrics: { toolCallCount: 3 },
      },
      target: {
        status: "failed",
        model: { provider: "openai", id: "gpt-5" },
        metrics: { toolCallCount: 1 },
      },
      outputChanged: true,
      metricDelta: {
        durationMs: 25,
        inputTokens: -4,
        outputTokens: 2,
        toolCallCount: -2,
        costUsd: -0.002,
      },
      configurationDelta: {
        changedFields: ["model", "enabledTools"],
      },
      addedToolNames: ["search_files"],
      removedToolNames: ["apply_patch"],
    } as unknown as AgentMessageExperimentComparison;

    expect(projectAgentMessageExperimentComparison(comparison)).toEqual({
      sourceStatus: "completed",
      targetStatus: "failed",
      sourceModel: "deepseek/deepseek-chat",
      targetModel: "openai/gpt-5",
      outputChanged: true,
      durationMsDelta: 25,
      tokenDelta: -2,
      toolCallDelta: -2,
      costUsdDelta: -0.002,
      changedConfigurationFields: ["model", "enabledTools"],
      addedToolNames: ["search_files"],
      removedToolNames: ["apply_patch"],
      sourceToolCallCount: 3,
      targetToolCallCount: 1,
    });
    expect(
      agentMessageExperimentResultFilename({
        targetRunId: "run_TARGET/unsafe",
        contentSha256: "a".repeat(64),
      } as AgentMessageExperimentResultFrame),
    ).toBe(`napier-agent-experiment-run_target-unsafe-${"a".repeat(16)}.json`);
    expect(parseAgentExperimentModelKey("deepseek/deepseek-chat")).toEqual({
      provider: "deepseek",
      id: "deepseek-chat",
    });
    expect(() => parseAgentExperimentModelKey("INVALID")).toThrow(
      "model is invalid",
    );
  });
});

function run(
  id: string,
  source: NonNullable<RunRecord["source"]>,
  status: RunRecord["status"],
  schemaVersion: number,
): RunRecord {
  return {
    id,
    threadId: "thread_source_12345678",
    agentId: "agent_napier",
    source,
    status,
    startedAt: "2026-08-01T01:00:00.000Z",
    ...(status === "running" ? {} : { finishedAt: "2026-08-01T01:00:01.000Z" }),
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    agentRevision: 1,
    configuration: {
      schemaVersion,
      model: { provider: "napier", id: "demo" },
    } as NonNullable<RunRecord["configuration"]>,
  };
}

function event(runId: string, seq: number, text: string): RunEvent {
  return {
    id: `event_${String(seq).padStart(8, "0")}`,
    threadId: "thread_source_12345678",
    runId,
    seq,
    type: "message.user",
    category: "message",
    visibility: "user",
    createdAt: "2026-08-01T01:00:00.000Z",
    payload: { role: "user", text },
  };
}
