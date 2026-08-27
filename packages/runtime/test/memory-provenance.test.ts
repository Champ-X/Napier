import { describe, expect, it } from "vitest";

import type { RunEvent } from "@napier/contracts";

import { createMemorySourceProvenance } from "../src/memory-provenance.js";

describe("memory provenance", () => {
  it("binds source messages and the latest current verification snapshot", () => {
    const source = createMemorySourceProvenance({
      type: "conversation",
      threadId: "thread_example",
      runId: "run_example",
      taskTitle: "Ship verified changes",
      messageIds: ["event_1", "event_2"],
      events: [
        event(1, "message.user", { role: "user", text: "Keep this." }),
        event(2, "message.assistant", {
          role: "assistant",
          text: "Recorded.",
        }),
        event(3, "tool.completed", {
          toolName: "verify_workspace",
          effect: "read",
          details: {
            status: "passed",
            workspaceSnapshotSha256: "a".repeat(64),
          },
        }),
      ],
    });

    expect(source).toEqual({
      type: "conversation",
      threadId: "thread_example",
      runId: "run_example",
      taskTitle: "Ship verified changes",
      messageIds: ["event_1", "event_2"],
      repositoryEvidence: {
        status: "linked",
        eventId: "event_3",
        eventSeq: 3,
        workspaceSnapshotSha256: "a".repeat(64),
        capturedAt: "2026-08-27T00:00:03.000Z",
      },
    });
  });

  it("marks repository evidence unavailable after a later write", () => {
    const source = createMemorySourceProvenance({
      type: "manual",
      events: [
        event(1, "tool.completed", {
          toolName: "verify_workspace",
          effect: "read",
          details: {
            status: "passed",
            workspaceSnapshotSha256: "b".repeat(64),
          },
        }),
        event(2, "tool.completed", {
          toolName: "apply_patch",
          effect: "write",
        }),
      ],
    });

    expect(source.repositoryEvidence).toEqual({ status: "unavailable" });
  });
});

function event(
  seq: number,
  type: string,
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${seq}`,
    threadId: "thread_example",
    runId: "run_example",
    seq,
    type,
    category: type.startsWith("message.") ? "message" : "tool",
    visibility: "user",
    createdAt: `2026-08-27T00:00:0${seq}.000Z`,
    payload,
  };
}
