import type { RunEvent, ToolLoopGuardPolicy } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createToolCallSha256,
  createToolLoopGuardContextReceipt,
  detectToolCallLoop,
  latestActiveToolLoopGuard,
  normalizeToolLoopGuardPolicy,
  projectToolLoopGuardContexts,
  projectToolLoopGuardTriggers,
  TOOL_LOOP_GUARD_CONTEXT_EVENT,
  TOOL_LOOP_GUARD_TRIGGERED_EVENT,
  toolLoopGuardBlockReason,
  validateToolLoopGuardTriggerEvidence,
} from "../src/tool-loop-guard.js";

const THREAD_ID = "thread_tool_loop";
const RUN_ID = "run_tool_loop";
const POLICY: ToolLoopGuardPolicy = {
  enabled: true,
  threshold: 3,
  exemptTools: [],
};

describe("Tool loop guard", () => {
  it("normalizes a strict revisioned policy and hash-only context receipt", () => {
    expect(normalizeToolLoopGuardPolicy(undefined)).toEqual(POLICY);
    expect(
      normalizeToolLoopGuardPolicy({
        enabled: true,
        threshold: 4,
        exemptTools: ["web_search", "read_file"],
      }),
    ).toEqual({
      enabled: true,
      threshold: 4,
      exemptTools: ["read_file", "web_search"],
    });
    expect(() =>
      normalizeToolLoopGuardPolicy({
        enabled: true,
        threshold: 1,
        exemptTools: [],
      }),
    ).toThrow("policy is invalid");
    expect(() =>
      normalizeToolLoopGuardPolicy({
        enabled: true,
        threshold: 3,
        exemptTools: ["read_file", "read_file"],
      }),
    ).toThrow("must be distinct");

    const receipt = createToolLoopGuardContextReceipt({
      enabled: true,
      threshold: 4,
      exemptTools: ["read_file"],
    });
    expect(receipt).toEqual(
      expect.objectContaining({
        enabled: true,
        threshold: 4,
        exemptToolCount: 1,
        exemptToolSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        policySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(receipt)).not.toContain("read_file");
    expect(
      projectToolLoopGuardContexts([
        event(1, TOOL_LOOP_GUARD_CONTEXT_EVENT, receipt),
      ]),
    ).toEqual([receipt]);
  });

  it("detects only consecutive identical single-tool calls and results", () => {
    const firstTwo = repeatedToolEvents(2);
    expect(detectToolCallLoop(firstTwo, RUN_ID, POLICY)).toBeUndefined();

    const events = repeatedToolEvents(3);
    const trigger = detectToolCallLoop(events, RUN_ID, POLICY);
    expect(trigger).toEqual(
      expect.objectContaining({
        toolName: "read_file",
        threshold: 3,
        attemptCount: 3,
        fromSeq: 1,
        toSeq: 6,
        callSha256: createToolCallSha256("read_file", {
          path: "README.md",
        }),
        resultSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        attemptSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        policySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(JSON.stringify(trigger)).not.toContain("README.md");
    expect(JSON.stringify(trigger)).not.toContain("same result");

    const changedResult = repeatedToolEvents(3);
    changedResult[5]!.payload = {
      callId: "call_3",
      toolName: "read_file",
      status: "completed",
      output: "changed result",
    };
    expect(detectToolCallLoop(changedResult, RUN_ID, POLICY)).toBeUndefined();

    const reusedCallId = Array.from({ length: 3 }, (_, index) => [
      modelResponseEvent(index * 2 + 1, "call_reused", "read_file", {
        path: "README.md",
      }),
      event(index * 2 + 2, "tool.completed", {
        callId: "call_reused",
        toolName: "read_file",
        status: "completed",
        output: `result_${index + 1}`,
      }),
    ]).flat();
    expect(detectToolCallLoop(reusedCallId, RUN_ID, POLICY)).toBeUndefined();

    const mismatchedTerminal = repeatedToolEvents(3);
    mismatchedTerminal[5]!.payload = {
      callId: "call_3",
      toolName: "write_file",
      status: "completed",
      output: "same result",
    };
    expect(
      detectToolCallLoop(mismatchedTerminal, RUN_ID, POLICY),
    ).toBeUndefined();

    const changedStatus = repeatedToolEvents(3);
    changedStatus[5] = {
      ...changedStatus[5]!,
      type: "tool.failed",
      payload: {
        callId: "call_3",
        toolName: "read_file",
        status: "failed",
        output: "same result",
      },
    };
    expect(detectToolCallLoop(changedStatus, RUN_ID, POLICY)).toBeUndefined();

    expect(
      detectToolCallLoop(events, RUN_ID, {
        ...POLICY,
        exemptTools: ["read_file"],
      }),
    ).toBeUndefined();
    expect(
      detectToolCallLoop(events, RUN_ID, { ...POLICY, enabled: false }),
    ).toBeUndefined();

    const redactedCallSha256 = createToolCallSha256("run_command", {
      runtime: "node",
      args: ["--version"],
    });
    const redactedResultSha256 = "a".repeat(64);
    const redactedEvents = Array.from({ length: 3 }, (_, index) => [
      modelResponseEvent(index * 2 + 1, `command_${index}`, "run_command", {
        kind: "napier.redacted-tool-arguments",
        schemaVersion: 1,
        redacted: true,
        runtime: "node",
        argumentCount: 1,
        cwdPathSha256: "b".repeat(64),
        inputSha256: redactedCallSha256,
      }),
      event(index * 2 + 2, "tool.completed", {
        callId: `command_${index}`,
        toolName: "run_command",
        status: "completed",
        outputRedacted: true,
        outputSha256: "c".repeat(64),
        resultSha256: redactedResultSha256,
      }),
    ]).flat();
    expect(detectToolCallLoop(redactedEvents, RUN_ID, POLICY)).toEqual(
      expect.objectContaining({
        toolName: "run_command",
        callSha256: redactedCallSha256,
        resultSha256: redactedResultSha256,
      }),
    );
  });

  it("projects, grounds, activates, and retires trigger receipts", () => {
    const attempts = repeatedToolEvents(3);
    const receipt = detectToolCallLoop(attempts, RUN_ID, POLICY)!;
    const triggerEvent = event(7, TOOL_LOOP_GUARD_TRIGGERED_EVENT, receipt);
    const triggered = [...attempts, triggerEvent];

    expect(projectToolLoopGuardTriggers(triggered)).toEqual([
      { eventSeq: 7, receipt },
    ]);
    expect(
      validateToolLoopGuardTriggerEvidence(triggerEvent, triggered, POLICY),
    ).toBe(true);
    expect(latestActiveToolLoopGuard(triggered, RUN_ID, POLICY)).toEqual({
      eventSeq: 7,
      receipt,
    });
    expect(toolLoopGuardBlockReason({ eventSeq: 7, receipt })).not.toContain(
      "README.md",
    );

    const repeatedAgain = [
      ...triggered,
      modelResponseEvent(8, "call_4", "read_file", { path: "README.md" }),
    ];
    expect(latestActiveToolLoopGuard(repeatedAgain, RUN_ID, POLICY)).toEqual({
      eventSeq: 7,
      receipt,
    });

    const changedStrategy = [
      ...triggered,
      modelResponseEvent(8, "call_4", "search_files", { query: "ledger" }),
    ];
    expect(
      latestActiveToolLoopGuard(changedStrategy, RUN_ID, POLICY),
    ).toBeUndefined();

    const tampered = event(7, TOOL_LOOP_GUARD_TRIGGERED_EVENT, {
      ...receipt,
      count: 99,
    });
    expect(projectToolLoopGuardTriggers([...attempts, tampered])).toEqual([]);
    expect(
      validateToolLoopGuardTriggerEvidence(tampered, attempts, POLICY),
    ).toBe(false);
  });
});

function repeatedToolEvents(count: number): RunEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    return [
      modelResponseEvent(ordinal * 2 - 1, `call_${ordinal}`, "read_file", {
        path: "README.md",
      }),
      event(ordinal * 2, "tool.completed", {
        callId: `call_${ordinal}`,
        toolName: "read_file",
        status: "completed",
        output: "same result",
      }),
    ];
  }).flat();
}

function modelResponseEvent(
  seq: number,
  callId: string,
  name: string,
  args: unknown,
): RunEvent {
  return event(seq, "model.response", {
    stopReason: "toolUse",
    toolCalls: [{ id: callId, name, arguments: args }],
  });
}

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: THREAD_ID,
    runId: RUN_ID,
    seq,
    type,
    category: type.startsWith("tool.") ? "tool" : "system",
    visibility: "debug",
    payload,
    createdAt: new Date(Date.UTC(2026, 6, 28, 12, 0, seq)).toISOString(),
  };
}
