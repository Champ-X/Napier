import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createAgentMilestoneContextProjection,
  createAgentMilestoneRecordedPayload,
  formatAgentMilestoneContextProjection,
  projectAgentMilestones,
} from "../src/agent-milestones.js";

const THREAD_ID = "thread_milestones";
const RUN_ID = "run_milestones";

function event(seq: number, type: string, payload: JsonValue): RunEvent {
  return {
    id: `event_milestone_${seq}`,
    threadId: THREAD_ID,
    runId: RUN_ID,
    seq,
    type,
    category: type === "agent.milestone.recorded" ? "plan" : "system",
    visibility: "user",
    createdAt: new Date(1_700_000_000_000 + seq * 1_000).toISOString(),
    payload,
  };
}

describe("Agent milestones", () => {
  it("binds each immutable milestone to its preceding Run event range", () => {
    const runStarted = event(1, "run.started", { status: "running" });
    const toolCompleted = event(2, "tool.completed", {
      toolName: "read_file",
      status: "completed",
    });
    const firstEvent = event(
      3,
      "agent.milestone.recorded",
      createAgentMilestoneRecordedPayload({
        milestoneId: "milestone_first1234",
        milestone: {
          phase: "execution",
          title: "Runtime evidence gathered",
          summary:
            "Inspected the runtime and established the implementation boundary.",
          completedItems: ["Read the runtime control flow"],
          openLoops: ["Implement the durable projection"],
        },
      }),
    );
    const first = projectAgentMilestones([
      runStarted,
      toolCompleted,
      firstEvent,
    ])[0]!;

    expect(first).toEqual(
      expect.objectContaining({
        id: "milestone_first1234",
        sequence: 1,
        phase: "execution",
        evidence: {
          fromSeq: 1,
          toSeq: 2,
          eventCount: 2,
          eventStreamSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );

    const verification = event(4, "verification.completed", {
      status: "passed",
    });
    const secondEvent = event(
      5,
      "agent.milestone.recorded",
      createAgentMilestoneRecordedPayload({
        milestoneId: "milestone_second123",
        predecessor: first,
        milestone: {
          phase: "verification",
          title: "Runtime contract verified",
          summary: "The implementation passes its focused contract checks.",
          completedItems: [
            "Read the runtime control flow",
            "Implement the durable projection",
          ],
          openLoops: ["Run the repository-wide release gate"],
        },
      }),
    );
    const milestones = projectAgentMilestones([
      runStarted,
      toolCompleted,
      firstEvent,
      verification,
      secondEvent,
    ]);

    expect(milestones[1]).toEqual(
      expect.objectContaining({
        sequence: 2,
        predecessorMilestoneId: first.id,
        predecessorEventSeq: first.eventSeq,
        evidence: {
          fromSeq: 4,
          toSeq: 4,
          eventCount: 1,
          eventStreamSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      }),
    );
  });

  it("creates bounded local and text-redacted context projections", () => {
    const firstEvent = event(
      2,
      "agent.milestone.recorded",
      createAgentMilestoneRecordedPayload({
        milestoneId: "milestone_context12",
        milestone: {
          phase: "planning",
          title: "Plan selected",
          summary: "Selected a durable event-derived milestone protocol.",
          completedItems: ["Compared candidate designs"],
          openLoops: ["Implement the protocol"],
        },
      }),
    );
    const first = projectAgentMilestones([
      event(1, "message.user", { text: "Build milestones." }),
      firstEvent,
    ])[0]!;
    const secondEvent = event(
      4,
      "agent.milestone.recorded",
      createAgentMilestoneRecordedPayload({
        milestoneId: "milestone_local1234",
        predecessor: first,
        milestone: {
          phase: "execution",
          title: "Local work continued",
          summary: "A local Run added a milestone after the import boundary.",
          completedItems: ["Implement the protocol"],
          openLoops: ["Verify the local milestone"],
        },
      }),
    );
    const milestones = projectAgentMilestones([
      event(1, "message.user", { text: "Build milestones." }),
      firstEvent,
      event(3, "run.started", { status: "running" }),
      secondEvent,
    ]);
    const local = createAgentMilestoneContextProjection(THREAD_ID, [first]);
    const mixedTrust = createAgentMilestoneContextProjection(
      THREAD_ID,
      milestones,
      {
        redactThroughEventSeq: first.eventSeq,
      },
    );

    expect(local.milestones[0]).toEqual(
      expect.objectContaining({
        title: "Plan selected",
        summary: "Selected a durable event-derived milestone protocol.",
        openLoops: ["Implement the protocol"],
      }),
    );
    expect(formatAgentMilestoneContextProjection(local)).toContain(
      "Implement the protocol",
    );
    expect(mixedTrust).toEqual(
      expect.objectContaining({
        textRedacted: true,
        milestones: [
          expect.not.objectContaining({
            title: expect.anything(),
            summary: expect.anything(),
          }),
          expect.objectContaining({
            title: "Local work continued",
            summary: "A local Run added a milestone after the import boundary.",
            openLoops: ["Verify the local milestone"],
            textRedacted: false,
          }),
        ],
      }),
    );
    expect(formatAgentMilestoneContextProjection(mixedTrust)).not.toContain(
      "Selected a durable event-derived milestone protocol.",
    );
    expect(formatAgentMilestoneContextProjection(mixedTrust)).toContain(
      "Verify the local milestone",
    );
  });

  it("rejects contradictory items and ignores tampered or stale links", () => {
    expect(() =>
      createAgentMilestoneRecordedPayload({
        milestoneId: "milestone_invalid12",
        milestone: {
          phase: "execution",
          title: "Contradictory state",
          summary: "The same work cannot be complete and open.",
          completedItems: ["Run tests"],
          openLoops: ["run tests"],
        },
      }),
    ).toThrow("both completed and open");

    const payload = createAgentMilestoneRecordedPayload({
      milestoneId: "milestone_valid1234",
      milestone: {
        phase: "execution",
        title: "Valid state",
        summary: "The valid snapshot has one open loop.",
        completedItems: [],
        openLoops: ["Run tests"],
      },
    });
    const tampered = structuredClone(payload);
    tampered.summary = "Tampered without rebinding the request hash.";
    expect(
      projectAgentMilestones([event(1, "agent.milestone.recorded", tampered)]),
    ).toEqual([]);

    const firstEvent = event(1, "agent.milestone.recorded", payload);
    const first = projectAgentMilestones([firstEvent])[0]!;
    const stale = createAgentMilestoneRecordedPayload({
      milestoneId: "milestone_stale1234",
      predecessor: first,
      milestone: {
        phase: "verification",
        title: "Stale link",
        summary: "This event is rebound to a predecessor that does not exist.",
        completedItems: ["Run tests"],
        openLoops: [],
      },
    });
    stale.predecessorEventSeq = 99;
    expect(
      projectAgentMilestones([
        firstEvent,
        event(2, "agent.milestone.recorded", stale),
      ]),
    ).toEqual([first]);
  });
});
