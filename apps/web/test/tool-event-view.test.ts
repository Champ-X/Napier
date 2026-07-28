import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("Tool event trace view", () => {
  it("projects bounded tool metadata without raw input or output", () => {
    const event = toolEvent("tool.completed", {
      callId: "call_secret",
      toolName: "read_file",
      status: "completed",
      effect: "read",
      input: { path: "TOP_SECRET_PATH" },
      output: "TOP_SECRET_OUTPUT",
      details: { content: "TOP_SECRET_DETAILS" },
      summary: "TOP_SECRET_SUMMARY",
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "read_file",
      status: "completed",
      effect: "read",
    });
    expect(toolEventTraceSummary(event)).toBe(
      "tool / read_file / completed / effect read",
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("defaults status from the event type and includes hash-only receipts", () => {
    const event = toolEvent("tool.blocked", {
      toolName: "read_file",
      inputSha256: "a".repeat(64),
      loopGuardTriggerSha256: "b".repeat(64),
      policyReason: "TOP_SECRET_POLICY_REASON",
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "read_file",
      status: "blocked",
      inputSha256: "a".repeat(64),
      loopGuardTriggerSha256: "b".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / read_file / blocked / input ${"a".repeat(12)} / loop ${"b".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes search_files hash evidence without match text", () => {
    const event = toolEvent("tool.completed", {
      toolName: "search_files",
      status: "completed",
      output: "TOP_SECRET_MATCH_LINE",
      details: {
        count: 2,
        truncated: true,
        matchSetSha256: "c".repeat(64),
        matches: [
          {
            path: "TOP_SECRET_PATH",
            line: 7,
            lineSha256: "d".repeat(64),
            fileSha256: "e".repeat(64),
          },
        ],
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "search_files",
      status: "completed",
      searchMatchCount: 2,
      searchTruncated: true,
      searchMatchSetSha256: "c".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / search_files / completed / matches 2 / truncated / match-set ${"c".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("summarizes verify_workspace status and output hashes only", () => {
    const event = toolEvent("tool.completed", {
      toolName: "verify_workspace",
      status: "completed",
      output: "TOP_SECRET_STDOUT\nTOP_SECRET_STDERR",
      details: {
        kind: "typecheck",
        status: "failed",
        sandbox: "TOP_SECRET_SANDBOX",
        cwd: "TOP_SECRET_CWD",
        target: "TOP_SECRET_TARGET",
        exitCode: 2,
        stdoutSha256: "d".repeat(64),
        stderrSha256: "e".repeat(64),
        stdoutTruncated: true,
        stderrTruncated: false,
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "verify_workspace",
      status: "completed",
      verificationKind: "typecheck",
      verificationStatus: "failed",
      verificationExitCode: 2,
      verificationStdoutSha256: "d".repeat(64),
      verificationStderrSha256: "e".repeat(64),
      verificationStdoutTruncated: true,
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / verify_workspace / completed / verification typecheck failed / exit 2 / stdout ${"d".repeat(12)} / stderr ${"e".repeat(12)} / stdout-truncated`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("fails closed to a fixed summary for malformed tool receipts", () => {
    const event = toolEvent("tool.failed", {
      toolName: "bad tool name",
      status: "failed",
      error: "TOP_SECRET_ERROR",
      result: "TOP_SECRET_RESULT",
    });

    expect(toolEventTraceView(event)).toBeUndefined();
    expect(toolEventTraceSummary(event)).toBe("tool receipt");
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });
});

function toolEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_tool",
    threadId: "thread_tool",
    runId: "runctl_tool",
    seq: 9,
    type,
    category: "tool",
    visibility: "user",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
