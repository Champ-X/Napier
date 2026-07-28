import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  agentEventTraceSummary,
  agentEventTraceView,
} from "../src/agent-event-view";

describe("Agent event trace view", () => {
  it("projects milestones without title, summary, or loop text", () => {
    const event = agentEvent("agent.milestone.recorded", {
      kind: "napier.agent-milestone-recorded",
      schemaVersion: 1,
      milestoneId: "milestone_1234567890",
      phase: "verification",
      title: "TOP_SECRET_MILESTONE_TITLE",
      summary: "TOP_SECRET_MILESTONE_SUMMARY",
      completedItems: ["TOP_SECRET_COMPLETED_ITEM"],
      openLoops: ["TOP_SECRET_OPEN_LOOP", "another loop"],
      predecessorMilestoneId: "milestone_0987654321",
      predecessorEventSeq: 42,
      requestSha256: "a".repeat(64),
    });

    expect(agentEventTraceView(event)).toEqual({
      action: "milestone.recorded",
      milestoneId: "milestone_1234567890",
      predecessorMilestoneId: "milestone_0987654321",
      phase: "verification",
      predecessorEventSeq: 42,
      completedItemCount: 1,
      openLoopCount: 2,
      requestSha256: "a".repeat(64),
    });
    expect(agentEventTraceSummary(event)).toBe(
      `agent / milestone.recorded / milestone 1234567890 / predecessor 0987654321 / phase verification / predecessor-seq 42 / completed 1 / open-loops 2 / request ${"a".repeat(12)}`,
    );
    expect(agentEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects agent update and rollback receipts as bounded metadata", () => {
    const updated = agentEvent("agent.updated", {
      agentId: "agent_1234567890",
      revision: 8,
      changedFields: ["systemPrompt", "description", "model"],
      profileRevisionSha256: "b".repeat(64),
      name: "TOP_SECRET_AGENT_NAME",
      description: "TOP_SECRET_AGENT_DESCRIPTION",
    });
    const rolledBack = agentEvent("agent.rolled_back", {
      agentId: "agent_1234567890",
      revision: 9,
      restoredFromRevision: 4,
      changedFields: ["model"],
      profileRevisionSha256: "c".repeat(64),
      restoredSnapshotSha256: "d".repeat(64),
      systemPrompt: "TOP_SECRET_SYSTEM_PROMPT",
    });

    expect(agentEventTraceSummary(updated)).toBe(
      `agent / updated / agent 1234567890 / revision 8 / changed-fields 3 / profile ${"b".repeat(12)}`,
    );
    expect(agentEventTraceSummary(rolledBack)).toBe(
      `agent / rolled_back / agent 1234567890 / revision 9 / restored-from 4 / changed-fields 1 / profile ${"c".repeat(12)} / restored ${"d".repeat(12)}`,
    );
    expect(agentEventTraceSummary(updated)).not.toContain("TOP_SECRET");
    expect(agentEventTraceSummary(rolledBack)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown agent receipts", () => {
    expect(
      agentEventTraceSummary(
        agentEvent("agent.milestone.recorded", ["TOP_SECRET_SUMMARY"]),
      ),
    ).toBe("agent receipt");
    expect(
      agentEventTraceSummary(
        agentEvent("agent.future", { summary: "TOP_SECRET_SUMMARY" }),
      ),
    ).toBe("system");
  });
});

function agentEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_agent",
    runId: "run_agent",
    seq: 53,
    type,
    category: "system",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
