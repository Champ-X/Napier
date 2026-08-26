import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationToolActivities,
  conversationToolActivity,
} from "../src/conversation-tool-activity-view-model";

describe("Conversation tool activities", () => {
  it("joins tool lifecycle by call ID and excludes specialized tools", () => {
    const activities = conversationToolActivities([
      event(1, "tool.started", {
        callId: "call_read",
        toolName: "read_file",
        status: "started",
        input: "PRIVATE_INPUT",
      }),
      event(2, "tool.completed", {
        callId: "call_read",
        toolName: "read_file",
        status: "completed",
        output: "PRIVATE_OUTPUT",
        details: {
          startLine: 2,
          endLine: 4,
          totalLines: 20,
          sizeBytes: 120,
          pathSha256: "a".repeat(64),
          fileSha256: "b".repeat(64),
          lineAnchorSetSha256: "c".repeat(64),
        },
      }),
      event(3, "tool.completed", {
        callId: "call_search",
        toolName: "web_search",
        status: "completed",
      }),
    ]);

    expect(activities).toEqual([
      expect.objectContaining({
        id: "event_2",
        callId: "call_read",
        seq: 2,
        kind: "tool",
        status: "completed",
        toolName: "read_file",
        eventIds: ["event_1", "event_2"],
      }),
    ]);
    expect(activities[0]?.receipt).toContain("range 2-4");
    expect(JSON.stringify(activities)).not.toContain("PRIVATE");
  });

  it("excludes calls already owned by a more specific card", () => {
    expect(
      conversationToolActivities(
        [
          event(3, "tool.started", {
            callId: "call_citation",
            toolName: "research_source",
            status: "started",
          }),
          event(4, "tool.completed", {
            callId: "call_citation",
            toolName: "research_source",
            status: "completed",
          }),
        ],
        new Set(["call_citation"]),
      ),
    ).toEqual([]);
  });

  it("projects Shell receipts without argv or output", () => {
    const activity = conversationToolActivity(
      event(4, "tool.completed", {
        callId: "call_shell",
        toolName: "run_command",
        status: "completed",
        effect: "read",
        output: "TOP_SECRET_STDOUT",
        details: {
          runtime: "node",
          status: "succeeded",
          workspaceAccess: "read_only",
          networkAccess: "denied",
          argumentCount: 2,
          exitCode: 0,
          timeoutMs: 30_000,
          outputLimitChars: 32_000,
          commandSha256: "a".repeat(64),
          resultSha256: "b".repeat(64),
          stdoutSha256: "c".repeat(64),
          stderrSha256: "d".repeat(64),
          rawArgs: ["TOP_SECRET_ARG"],
        },
      }),
    );

    expect(activity).toEqual(
      expect.objectContaining({
        kind: "shell",
        status: "completed",
        toolName: "run_command",
        evidence: expect.objectContaining({
          commandRuntime: "node",
          commandStatus: "succeeded",
          commandArgumentCount: 2,
          commandExitCode: 0,
          commandWorkspaceAccess: "read_only",
          commandNetworkAccess: "denied",
        }),
      }),
    );
    expect(JSON.stringify(activity)).not.toContain("TOP_SECRET");
  });

  it("treats a settled command failure as failed Shell work", () => {
    expect(
      conversationToolActivity(
        event(5, "tool.completed", {
          callId: "call_shell_failed",
          toolName: "run_command",
          status: "completed",
          details: {
            runtime: "node",
            status: "timed_out",
            argumentCount: 1,
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        kind: "shell",
        status: "failed",
        evidence: expect.objectContaining({ commandStatus: "timed_out" }),
      }),
    );
  });

  it("preserves working, failed, and blocked terminal states", () => {
    expect(
      conversationToolActivity(
        event(6, "tool.started", {
          callId: "call_running",
          toolName: "verify_workspace",
          status: "started",
        }),
      )?.status,
    ).toBe("working");
    expect(
      conversationToolActivity(
        event(7, "tool.failed", {
          callId: "call_failed",
          toolName: "verify_workspace",
          status: "failed",
          error: "PRIVATE_ERROR",
        }),
      )?.status,
    ).toBe("failed");
    expect(
      conversationToolActivity(
        event(8, "tool.blocked", {
          callId: "call_blocked",
          toolName: "apply_patch",
          status: "blocked",
          policyReason: "PRIVATE_POLICY",
        }),
      )?.status,
    ).toBe("blocked");
  });

  it("uses the typed Tool Protocol projection for activity evidence", () => {
    const activity = conversationToolActivity(
      event(9, "tool.started", {
        callId: "call_native",
        toolName: "workspace_file_apply",
        status: "started",
        effect: "read",
        toolProtocol: {
          kind: "napier.tool-ui-projection",
          schemaVersion: 2,
          toolId: "workspace_file_apply",
          semanticVersion: "2.0.0",
          definitionSha256: "a".repeat(64),
          implementationSha256: "b".repeat(64),
          status: "started",
          sideEffect: "reversible",
          concurrency: "exclusive",
          compatibilityMode: "native",
        },
      }),
    );

    expect(activity?.evidence).toEqual(
      expect.objectContaining({
        effect: "write",
        toolProtocolVersion: "2.0.0",
        toolSideEffect: "reversible",
        toolConcurrency: "exclusive",
        toolCompatibilityMode: "native",
      }),
    );
  });
});

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: `2026-08-09T00:00:0${String(seq)}.000Z`,
    payload,
  };
}
