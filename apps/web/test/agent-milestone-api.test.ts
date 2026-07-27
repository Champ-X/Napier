import { createHash } from "node:crypto";

import type { AgentMilestone, RunEvent } from "@napier/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  latestAgentMilestoneEventSeq,
  listAgentMilestones,
} from "../src/agent-milestone-api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Agent milestone API", () => {
  it("finds the latest milestone sequence regardless of Trace ordering", () => {
    const event = (seq: number, type: string): RunEvent => ({
      id: `event_${seq}`,
      threadId: "thread_1",
      runId: "run_1",
      seq,
      type,
      category: "plan",
      visibility: "user",
      createdAt: "2026-07-28T00:00:00.000Z",
      payload: {},
    });
    expect(
      latestAgentMilestoneEventSeq([
        event(9, "agent.milestone.recorded"),
        event(8, "tool.completed"),
        event(5, "agent.milestone.recorded"),
      ]),
    ).toBe(9);
  });

  it("loads the hash-verified Thread milestone projection", async () => {
    const milestones: AgentMilestone[] = [
      {
        kind: "napier.agent-milestone",
        schemaVersion: 1,
        id: "milestone_public1234",
        threadId: "thread_1",
        runId: "run_1",
        sequence: 1,
        phase: "verification",
        title: "Focused checks passed",
        summary: "The focused milestone checks passed.",
        completedItems: ["Run focused checks"],
        openLoops: ["Run the release gate"],
        summarySha256: "a".repeat(64),
        completedItemSetSha256: "b".repeat(64),
        openLoopSetSha256: "c".repeat(64),
        evidence: {
          fromSeq: 1,
          toSeq: 4,
          eventCount: 4,
          eventStreamSha256: "d".repeat(64),
        },
        recordedAt: "2026-07-28T00:00:00.000Z",
        eventSeq: 5,
        contentSha256: "e".repeat(64),
      },
    ];
    const text = JSON.stringify(milestones);
    const fetchMock = vi.fn(async (path: string) => {
      expect(path).toBe("/api/threads/thread_1/agent-milestones");
      return new Response(text, {
        headers: {
          "Content-Type": "application/json",
          "X-Napier-Content-SHA256": createHash("sha256")
            .update(text)
            .digest("hex"),
          "X-Napier-Content-SHA256-Mode": "body",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAgentMilestones("thread_1")).resolves.toEqual(milestones);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
