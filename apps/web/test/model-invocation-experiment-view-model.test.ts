import type {
  ModelInvocationExperimentComparison,
  ModelInvocationExperimentResultFrame,
  RunEvent,
  RunRecord,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  modelInvocationCheckpoints,
  modelInvocationExperimentResultFilename,
  parseModelInvocationExperimentModelKey,
  projectModelInvocationExperimentComparison,
} from "../src/model-invocation-experiment-view-model";

describe("Model invocation experiment view model", () => {
  it("selects only terminal strict capsule receipts without provider context", () => {
    const runs = [
      run("run_source_12345678", "completed"),
      run("run_active_12345678", "running"),
      run("run_legacy_12345678", "completed", false),
    ];
    const leaked = capsuleEvent(runs[0]!.id, 12, 3);
    (leaked.payload as Record<string, unknown>)["context"] =
      "PRIVATE_PROVIDER_CONTEXT";
    const events = [
      capsuleEvent(runs[0]!.id, 10, 2),
      capsuleEvent(runs[1]!.id, 11, 1),
      leaked,
      capsuleEvent(runs[2]!.id, 13, 0),
    ];

    expect(modelInvocationCheckpoints(runs, events)).toEqual([
      {
        key: "run_source_12345678:2:10",
        runId: "run_source_12345678",
        turnIndex: 2,
        capsuleEventSeq: 10,
        runIndex: 1,
        status: "completed",
        purpose: "agent_turn",
        model: { provider: "deepseek", id: "deepseek-chat" },
        capsuleBytes: 4096,
        createdAt: "2026-08-01T01:00:00.000Z",
      },
    ]);
    expect(
      JSON.stringify(modelInvocationCheckpoints(runs, events)),
    ).not.toContain("PRIVATE_PROVIDER_CONTEXT");
  });

  it("projects bounded comparison metadata and stable download names", () => {
    const comparison = {
      source: {
        status: "completed",
        stopReason: "toolUse",
        model: { provider: "deepseek", id: "deepseek-chat" },
        toolCallCount: 2,
      },
      target: {
        status: "failed",
        stopReason: "error",
        model: { provider: "openai", id: "gpt-5" },
        toolCallCount: 1,
      },
      outputChanged: true,
      textChanged: false,
      metricDelta: {
        durationMs: 25,
        inputTokens: -4,
        outputTokens: 2,
        toolCallCount: -1,
        costUsd: -0.002,
      },
      addedToolNames: ["search_files"],
      removedToolNames: ["apply_patch"],
    } as unknown as ModelInvocationExperimentComparison;

    expect(projectModelInvocationExperimentComparison(comparison)).toEqual({
      sourceStatus: "completed",
      targetStatus: "failed",
      sourceStopReason: "toolUse",
      targetStopReason: "error",
      sourceModel: "deepseek/deepseek-chat",
      targetModel: "openai/gpt-5",
      outputChanged: true,
      textChanged: false,
      durationMsDelta: 25,
      tokenDelta: -2,
      toolCallDelta: -1,
      costUsdDelta: -0.002,
      addedToolNames: ["search_files"],
      removedToolNames: ["apply_patch"],
      sourceToolCallCount: 2,
      targetToolCallCount: 1,
    });
    expect(
      modelInvocationExperimentResultFilename({
        targetRunId: "run_TARGET/unsafe",
        contentSha256: "a".repeat(64),
      } as ModelInvocationExperimentResultFrame),
    ).toBe(`napier-model-experiment-run_target-unsafe-${"a".repeat(16)}.json`);
    expect(
      parseModelInvocationExperimentModelKey("deepseek/deepseek-chat"),
    ).toEqual({
      provider: "deepseek",
      id: "deepseek-chat",
    });
    expect(() => parseModelInvocationExperimentModelKey("INVALID")).toThrow(
      "model is invalid",
    );
  });
});

function run(
  id: string,
  status: RunRecord["status"],
  configured = true,
): RunRecord {
  return {
    id,
    threadId: "thread_source12345678",
    agentId: "agent_napier",
    source: "user",
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
    ...(configured
      ? {
          configuration: {
            schemaVersion: 8,
            model: { provider: "deepseek", id: "deepseek-chat" },
          } as NonNullable<RunRecord["configuration"]>,
        }
      : {}),
  };
}

function capsuleEvent(runId: string, seq: number, turnIndex: number): RunEvent {
  return {
    id: `event_${String(seq).padStart(8, "0")}`,
    threadId: "thread_source12345678",
    runId,
    seq,
    type: "context.model_invocation",
    category: "model",
    visibility: "debug",
    createdAt: "2026-08-01T01:00:00.000Z",
    payload: {
      kind: "napier.model-invocation-capsule-receipt",
      schemaVersion: 1,
      turnIndex,
      purpose: "agent_turn",
      model: { provider: "deepseek", id: "deepseek-chat" },
      contextEnvelopeSha256: "1".repeat(64),
      contextSha256: "2".repeat(64),
      capsuleSha256: "3".repeat(64),
      capsuleBytes: 4096,
      storage: "local_only",
      contentSha256: "4".repeat(64),
    },
  };
}
