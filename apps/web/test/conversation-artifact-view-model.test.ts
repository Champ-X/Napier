import type { ExecutionPlan, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  conversationArtifactEventKey,
  conversationArtifacts,
} from "../src/conversation-artifact-view-model";

describe("Conversation artifacts", () => {
  it("joins user-visible artifact events to the authoritative plan manifest", () => {
    const artifacts = conversationArtifacts(
      [
        event(1, "plan.artifact.produced", "user", {
          planId: "plan_1",
          artifactId: "artifact_report",
          path: "SPOOFED_PRIVATE_PATH",
          evidence: "SPOOFED_PRIVATE_EVIDENCE",
        }),
        event(2, "plan.artifact.verified", "user", {
          planId: "plan_1",
          artifactId: "artifact_report",
        }),
      ],
      [plan()],
    );

    expect(artifacts).toEqual([
      expect.objectContaining({
        id: "event_2",
        seq: 2,
        threadId: "thread_1",
        planId: "plan_1",
        planRevision: 3,
        artifact: expect.objectContaining({
          id: "artifact_report",
          path: "artifacts/report.md",
          description: "Verified delivery report",
          status: "verified",
        }),
      }),
    ]);
    expect(JSON.stringify(artifacts)).not.toContain("SPOOFED_PRIVATE");
  });

  it("filters hidden, malformed, and unbound events before applying the limit", () => {
    const events = [
      event(1, "plan.artifact.verified", "hidden", {
        planId: "plan_1",
        artifactId: "artifact_report",
      }),
      event(2, "plan.artifact.verified", "user", {
        planId: "missing_plan",
        artifactId: "artifact_report",
      }),
      event(3, "plan.step.completed", "user", {
        planId: "plan_1",
        artifactId: "artifact_report",
      }),
      event(4, "plan.artifact.verified", "user", {
        planId: "plan_1",
        artifactId: "missing_artifact",
      }),
      event(5, "plan.artifact.verified", "user", {
        planId: "plan_1",
        artifactId: "artifact_report",
      }),
    ];

    expect(conversationArtifacts(events, [plan()], 1)).toHaveLength(1);
    expect(conversationArtifactEventKey(events[0]!)).toBeUndefined();
    expect(conversationArtifactEventKey(events[2]!)).toBeUndefined();
    expect(conversationArtifactEventKey(events[4]!)).toEqual([
      "plan_1",
      "artifact_report",
    ]);
  });
});

function plan(): ExecutionPlan {
  return {
    id: "plan_1",
    threadId: "thread_1",
    objective: "Deliver the report",
    status: "completed",
    steps: [],
    artifacts: [
      {
        id: "artifact_report",
        path: "artifacts/report.md",
        kind: "file",
        description: "Verified delivery report",
        status: "verified",
        sha256: "a".repeat(64),
        sizeBytes: 128,
        sourceRunId: "run_1",
        evidence: "Runtime verified the report bytes.",
        createdAt: "2026-08-08T00:00:00.000Z",
        updatedAt: "2026-08-08T00:00:02.000Z",
      },
    ],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: [],
    readyStepIds: [],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: null,
    parallelReadyStepIds: [],
    phaseProjectionSha256: "b".repeat(64),
    revision: 3,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:02.000Z",
  };
}

function event(
  seq: number,
  type: string,
  visibility: RunEvent["visibility"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId: "run_1",
    seq,
    type,
    category: "plan",
    visibility,
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    payload,
  };
}
