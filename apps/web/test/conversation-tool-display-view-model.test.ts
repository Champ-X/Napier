import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { projectLocalToolDisplays } from "../src/conversation-tool-display-view-model";

describe("local conversation tool display projection", () => {
  it("merges local-only content without changing the source Ledger event", () => {
    const event = {
      id: "event_local_display",
      threadId: "thread_local_display",
      runId: "run_local_display",
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      createdAt: "2026-08-30T00:00:00.000Z",
      payload: { callId: "call_local_display", toolName: "run_command", status: "completed" },
    } as RunEvent;
    const projected = projectLocalToolDisplays([event], [{
      sourceRunId: event.runId,
      callId: "call_local_display",
      toolName: "run_command",
      input: "npm test",
      output: "passed",
    }]);

    expect(projected[0]?.payload).toEqual(expect.objectContaining({
      displayInput: "npm test",
      displayOutput: "passed",
    }));
    expect(event.payload).not.toHaveProperty("displayInput");
  });
});
