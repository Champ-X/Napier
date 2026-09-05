import type { ThreadRecord } from "@napier/contracts";

import { describe, expect, it } from "vitest";

import {
  RunEventAdmissionError,
  RunTerminalEventConflictError,
} from "../src/run-event-admission.js";
import {
  appendRegisteredEventsToThread,
  appendWorkspaceSeedEventsToThread,
} from "../src/run-event-writer.js";

describe("Run event batch writer", () => {
  it("requires an explicit runtime admission context", () => {
    const thread = testThread();

    expect(() =>
      (
        appendRegisteredEventsToThread as unknown as (
          thread: ThreadRecord,
          inputs: unknown[],
          options?: object,
        ) => unknown
      )(
        thread,
        [
          {
            threadId: thread.id,
            runId: "run_writer",
            type: "message.user",
            category: "message",
            payload: { role: "user", text: "must not be appended" },
          },
        ],
        {},
      ),
    ).toThrow("Registered event batch admission context is required");
    expect(thread).toEqual(expect.objectContaining({ eventCount: 0 }));
  });

  it("validates the whole registered batch before mutating its Thread", () => {
    const thread = testThread();

    expect(() =>
      appendRegisteredEventsToThread(
        thread,
        [
          {
            threadId: thread.id,
            runId: "run_writer",
            type: "message.user",
            category: "message",
            payload: { role: "user", text: "must roll back" },
          },
          {
            threadId: thread.id,
            runId: "run_writer",
            type: "model.text.delta",
            category: "model",
            payload: { delta: "late authority" },
          },
        ],
        {
          admission: {
            runStatus: () => ({
              threadId: thread.id,
              status: "completed",
            }),
            terminalRunStatus: () => "completed",
          },
        },
      ),
    ).toThrow(RunEventAdmissionError);
    expect(thread).toEqual(
      expect.objectContaining({ eventCount: 0, lastMessage: "" }),
    );
  });

  it("rejects a new operator-decision request beyond a terminal fence", () => {
    const thread = testThread();

    expect(() =>
      appendRegisteredEventsToThread(
        thread,
        [
          {
            threadId: thread.id,
            runId: "run_writer",
            type: "operator.decision.requested",
            category: "system",
            payload: { decisionId: "decision_late" },
          },
        ],
        {
          admission: {
            runStatus: () => ({
              threadId: thread.id,
              status: "completed",
            }),
            terminalRunStatus: () => "completed",
          },
        },
      ),
    ).toThrow(RunEventAdmissionError);
    expect(thread.eventCount).toBe(0);
  });

  it.each([
    ["run.recovery.started", "lifecycle"],
    ["model.advisor.correction.requested", "system"],
  ] as const)("rejects %s after its Run is terminal", (type, category) => {
    const thread = testThread();

    expect(() =>
      appendRegisteredEventsToThread(
        thread,
        [
          {
            threadId: thread.id,
            runId: "run_writer",
            type,
            category,
            payload: { status: "requested" },
          },
        ],
        {
          admission: {
            runStatus: () => ({
              threadId: thread.id,
              status: "completed",
            }),
            terminalRunStatus: () => "completed",
          },
        },
      ),
    ).toThrow(RunEventAdmissionError);
    expect(thread.eventCount).toBe(0);
  });

  it("allows at most the first terminal transition in one batch", () => {
    const thread = testThread();

    expect(() =>
      appendRegisteredEventsToThread(
        thread,
        [
          {
            threadId: thread.id,
            runId: "run_writer",
            type: "run.completed",
            category: "lifecycle",
            payload: { status: "completed" },
          },
          {
            threadId: thread.id,
            runId: "run_writer",
            type: "run.failed",
            category: "lifecycle",
            payload: { status: "failed" },
          },
        ],
        {
          admission: {
            runStatus: () => ({
              threadId: thread.id,
              status: "running",
            }),
            terminalRunStatus: () => undefined,
          },
        },
      ),
    ).toThrow(RunTerminalEventConflictError);
    expect(thread.eventCount).toBe(0);
  });

  it("keeps the pre-ledger workspace seed bypass explicit and bounded", () => {
    const thread = testThread();

    const events = appendWorkspaceSeedEventsToThread(
      thread,
      [
        {
          threadId: thread.id,
          runId: "run_writer",
          type: "run.started",
          category: "lifecycle",
          payload: { source: "onboarding" },
        },
      ],
      { createdAt: "2026-09-03T00:00:00.000Z" },
    );

    expect(events).toEqual([
      expect.objectContaining({
        runId: "run_writer",
        type: "run.started",
        seq: 1,
      }),
    ]);
    expect(thread.eventCount).toBe(1);
  });
});

function testThread(): ThreadRecord {
  return {
    id: "thread_writer",
    title: "Writer admission",
    agentId: "agent_writer",
    status: "running",
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    lastMessage: "",
    eventCount: 0,
    runIds: ["run_writer"],
    currentRunId: "run_writer",
  };
}
