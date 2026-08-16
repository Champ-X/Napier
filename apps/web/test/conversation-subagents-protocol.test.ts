import { describe, expect, it } from "vitest";

import { isConversationSubagents } from "../src/conversation-subagents-protocol";

describe("Conversation Subagents protocol", () => {
  it("accepts minimal cards and rejects inconsistent terminal state", () => {
    const subagent = {
      id: "event_subagent",
      seq: 4,
      createdAt: "2026-08-16T00:00:04.000Z",
      task: {
        id: "task_fixture0001",
        role: "reviewer",
        description: "Review the release evidence",
        status: "completed",
        model: { provider: "napier", id: "demo" },
        stepCount: 2,
        turnCount: 1,
        usage: { inputTokens: 100, outputTokens: 20 },
        stopReason: "completed",
        outcome: {
          summary: "The release evidence is complete.",
          items: [
            {
              kind: "finding",
              severity: "info",
              title: "Evidence present",
              evidenceCount: 1,
            },
          ],
        },
      },
      itemCount: 1,
      evidenceCount: 1,
      unknownCount: 0,
      blockerCount: 0,
      warningCount: 0,
    };

    expect(isConversationSubagents([subagent])).toBe(true);
    expect(
      isConversationSubagents([
        { ...subagent, task: { ...subagent.task, status: "running" } },
      ]),
    ).toBe(false);
    expect(
      isConversationSubagents([
        { ...subagent, task: { ...subagent.task, prompt: "PRIVATE_PROMPT" } },
      ]),
    ).toBe(false);
    expect(isConversationSubagents(Array(9).fill(subagent))).toBe(false);
  });
});
