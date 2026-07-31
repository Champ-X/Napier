import type {
  RunEvent,
  RunRecord,
  ToolInvocationExperimentComparison,
  ToolInvocationExperimentResultFrame,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  projectToolInvocationExperimentComparison,
  toolInvocationCheckpoints,
  toolInvocationExperimentResultFilename,
} from "../src/tool-invocation-experiment-view-model";

describe("Tool invocation experiment view model", () => {
  it("selects only terminal strict completed capsule receipts", () => {
    const runs = [
      run("run_source_12345678", "completed"),
      run("run_active_12345678", "running"),
      run("run_legacy_12345678", "completed", false),
    ];
    const leaked = capsuleEvent(runs[0]!.id, 20, "call_leaked");
    (leaked.payload as Record<string, unknown>)["arguments"] = {
      path: "PRIVATE_PATH",
    };
    const events = [
      capsuleEvent(runs[0]!.id, 10, "call_selected"),
      completedEvent(runs[0]!.id, 11, "call_selected"),
      capsuleEvent(runs[1]!.id, 12, "call_active"),
      completedEvent(runs[1]!.id, 13, "call_active"),
      capsuleEvent(runs[0]!.id, 14, "call_incomplete"),
      capsuleEvent(runs[2]!.id, 15, "call_legacy"),
      completedEvent(runs[2]!.id, 16, "call_legacy"),
      leaked,
      completedEvent(runs[0]!.id, 21, "call_leaked"),
    ];

    expect(toolInvocationCheckpoints(runs, events)).toEqual([
      {
        key: "run_source_12345678:call_selected:10",
        runId: "run_source_12345678",
        callId: "call_selected",
        capsuleEventSeq: 10,
        runIndex: 1,
        status: "completed",
        toolName: "read_file",
        capsuleBytes: 512,
        createdAt: "2026-08-01T01:00:00.000Z",
      },
    ]);
    expect(
      JSON.stringify(toolInvocationCheckpoints(runs, events)),
    ).not.toContain("PRIVATE_PATH");
  });

  it("projects bounded comparison metadata and stable download names", () => {
    const comparison = {
      source: {
        status: "completed",
        toolName: "read_file",
        outputBytes: 100,
      },
      target: {
        status: "failed",
        toolName: "read_file",
        outputBytes: 0,
      },
      outputChanged: true,
      durationMsDelta: 25,
    } as unknown as ToolInvocationExperimentComparison;
    expect(projectToolInvocationExperimentComparison(comparison)).toEqual({
      sourceStatus: "completed",
      targetStatus: "failed",
      toolName: "read_file",
      outputChanged: true,
      durationMsDelta: 25,
      outputBytesDelta: -100,
      sourceOutputBytes: 100,
      targetOutputBytes: 0,
    });
    expect(
      toolInvocationExperimentResultFilename({
        targetRunId: "run_TARGET/unsafe",
        contentSha256: "a".repeat(64),
      } as ToolInvocationExperimentResultFrame),
    ).toBe(`napier-tool-experiment-run_target-unsafe-${"a".repeat(16)}.json`);
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

function capsuleEvent(runId: string, seq: number, callId: string): RunEvent {
  return {
    id: `event_${String(seq).padStart(8, "0")}`,
    threadId: "thread_source12345678",
    runId,
    seq,
    type: "context.tool_invocation",
    category: "tool",
    visibility: "debug",
    createdAt: "2026-08-01T01:00:00.000Z",
    payload: {
      kind: "napier.tool-invocation-capsule-receipt",
      schemaVersion: 1,
      callId,
      toolName: "read_file",
      effect: "read",
      toolDefinitionSha256: "1".repeat(64),
      argumentsSha256: "2".repeat(64),
      workspaceScopeSha256: "3".repeat(64),
      capsuleSha256: "4".repeat(64),
      capsuleBytes: 512,
      storage: "local_only",
      contentSha256: "5".repeat(64),
    },
  };
}

function completedEvent(runId: string, seq: number, callId: string): RunEvent {
  return {
    id: `event_${String(seq).padStart(8, "0")}`,
    threadId: "thread_source12345678",
    runId,
    seq,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-01T01:00:01.000Z",
    payload: {
      callId,
      toolName: "read_file",
      status: "completed",
      outputTextSha256: "6".repeat(64),
      outputTextBytes: 100,
      output: "PRIVATE_OUTPUT",
    },
  };
}
