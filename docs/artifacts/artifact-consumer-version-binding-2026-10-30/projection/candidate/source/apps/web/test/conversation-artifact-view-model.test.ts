import type { ExecutionPlan, RunEvent, RunRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";
import { createPlanArtifactEventPayload } from "../../../packages/runtime/src/plans.js";
import { applyTaskNarrativeEvent, createTaskNarrativeEventState, projectTaskDeliverables } from "@napier/contracts/task-narrative";

import {
  conversationArtifactEventKey,
  conversationArtifactTargetId,
  conversationArtifactWorkspaceLinks,
  conversationArtifacts,
  currentConversationArtifacts,
} from "../src/conversation-artifact-view-model";

describe("Conversation artifacts", () => {
  it("joins only exact-bound artifact events to the current plan manifest", () => {
    const artifacts = conversationArtifacts(
      [
        event(1, "plan.artifact.produced", "user", {
          planId: "plan_1",
          artifactId: "artifact_report",
          path: "SPOOFED_PRIVATE_PATH",
          evidence: "SPOOFED_PRIVATE_EVIDENCE",
        }),
        event(2, "plan.artifact.verified", "user", createPlanArtifactEventPayload(plan(), plan().artifacts[0]!)),
      ],
      [plan()],
    );

    expect(artifacts).toEqual([
      expect.objectContaining({
        id: "event_2",
        seq: 2,
        threadId: "thread_1",
        runId: "run_1",
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
      event(5, "plan.artifact.verified", "user", createPlanArtifactEventPayload(plan(), plan().artifacts[0]!)),
    ];

    expect(conversationArtifacts(events, [plan()], 1)).toHaveLength(1);
    expect(conversationArtifactEventKey(events[0]!)).toBeUndefined();
    expect(conversationArtifactEventKey(events[2]!)).toBeUndefined();
    expect(conversationArtifactEventKey(events[4]!)).toEqual([
      "plan_1",
      "artifact_report",
    ]);
  });

  it("links only produced or verified file artifacts with safe DOM targets", () => {
    const verified = conversationArtifacts(
      [
        event(5, "plan.artifact.verified", "user", createPlanArtifactEventPayload(plan(), plan().artifacts[0]!)),
      ],
      [plan()],
    )[0]!;
    const produced = {
      ...verified,
      seq: 6,
      artifact: {
        ...verified.artifact,
        id: "artifact:output",
        path: "artifacts/output.txt",
        status: "produced" as const,
      },
    };
    const directory = {
      ...verified,
      seq: 7,
      artifact: {
        ...verified.artifact,
        id: "artifact_directory",
        path: "artifacts/results",
        kind: "directory" as const,
      },
    };
    const missing = {
      ...verified,
      seq: 8,
      artifact: {
        ...verified.artifact,
        id: "artifact_missing",
        path: ".env",
        status: "missing" as const,
      },
    };

    expect(
      conversationArtifactWorkspaceLinks([
        verified,
        produced,
        directory,
        missing,
      ]),
    ).toEqual([
      {
        artifact: verified.artifact,
        path: "artifacts/report.md",
        planId: "plan_1",
        planRevision: 3,
        threadId: "thread_1",
        targetId: conversationArtifactTargetId(verified),
      },
      {
        artifact: produced.artifact,
        path: "artifacts/output.txt",
        planId: "plan_1",
        planRevision: 3,
        threadId: "thread_1",
        targetId: conversationArtifactTargetId(produced),
      },
    ]);
    expect(conversationArtifactTargetId(produced)).not.toContain(":");
  });

  it("keeps a recovery candidate current through shared event-bound intent identity", () => {
    const currentPlan = plan();
    currentPlan.artifacts[0] = {
      ...currentPlan.artifacts[0]!,
      status: "candidate",
      sourceRunId: "run_interrupted",
    };
    const artifacts = conversationArtifacts(
      [
        startedEvent(1, "run_interrupted", "intent_delivery0001"),
        eventForRun(2, "run_interrupted", "plan.artifact.candidate", "user", createPlanArtifactEventPayload(currentPlan, currentPlan.artifacts[0]!)),
        startedEvent(3, "run_recovery", "intent_delivery0001"),
      ],
      [currentPlan],
      6,
      [run("run_interrupted", "interrupted"), run("run_recovery", "running")],
    );

    expect(artifacts[0]).toEqual(
      expect.objectContaining({
        attemptScope: "current",
        artifact: expect.objectContaining({ status: "candidate" }),
      }),
    );
  });

  it("marks artifacts previous after a newer unrelated intent starts", () => {
    const previousPlan = plan();
    previousPlan.artifacts[0]!.sourceRunId = "run_previous";
    const artifacts = conversationArtifacts(
      [
        startedEvent(1, "run_previous", "intent_previous0001"),
        eventForRun(2, "run_previous", "plan.artifact.verified", "user", createPlanArtifactEventPayload(previousPlan, previousPlan.artifacts[0]!)),
        startedEvent(3, "run_current", "intent_current00001"),
      ],
      [previousPlan],
      6,
      [run("run_previous", "completed"), run("run_current", "running")],
    );

    expect(artifacts[0]?.attemptScope).toBe("previous");
  });

  it("accepts an exact native version from shared history when the event window omits its event", () => {
    const f = versionFixture();
    expect(currentConversationArtifacts({ ...f, events: [], runs: [] })).toEqual(f.projected);
    expect(currentConversationArtifacts({ ...f, events: [], runs: [],
      projected: [{ ...f.projected[0]!, runId: "run_unrelated" }],
    })).toEqual([]);
  });

  it("rejects a legacy server joining an old event to a changed manifest", () => {
    const f = versionFixture();
    const changed = structuredClone(f.plans[0]!);
    changed.revision++;
    changed.artifacts[0]!.sha256 = "b".repeat(64);
    const projected = [{ ...f.projected[0]!, planRevision: changed.revision, artifact: changed.artifacts[0]! }];
    expect(currentConversationArtifacts({ events: f.events, plans: [changed], runs: [], projected })).toEqual([]);
    const state = f.events.reduce(applyTaskNarrativeEvent, createTaskNarrativeEventState());
    expect(currentConversationArtifacts({ events: [], plans: [changed], runs: [], projected,
      deliverables: projectTaskDeliverables([changed], { history: state.artifactHistory }),
    })).toEqual([]);
  });

  it("rejects a late native card and narrative after the current plan revision changed", () => {
    const f = versionFixture();
    const changed = structuredClone(f.plans[0]!);
    changed.revision++;
    expect(currentConversationArtifacts({ ...f, plans: [changed], runs: [] })).toEqual([]);
  });
});

function versionFixture() {
  const current = plan();
  const events = [event(2, "plan.artifact.verified", "user", createPlanArtifactEventPayload(current, current.artifacts[0]!))];
  const state = events.reduce(applyTaskNarrativeEvent, createTaskNarrativeEventState());
  return { plans: [current], events, projected: conversationArtifacts(events, [current]),
    deliverables: projectTaskDeliverables([current], { history: state.artifactHistory }) };
}

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
  return eventForRun(seq, "run_1", type, visibility, payload);
}

function eventForRun(
  seq: number,
  runId: string,
  type: string,
  visibility: RunEvent["visibility"],
  payload: RunEvent["payload"],
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_1",
    runId,
    seq,
    type,
    category: "plan",
    visibility,
    createdAt: `2026-08-08T00:00:0${String(seq)}.000Z`,
    payload,
  };
}

function startedEvent(seq: number, runId: string, intentId: string): RunEvent {
  return eventForRun(seq, runId, "run.started", "debug", { intentId });
}

function run(id: string, status: RunRecord["status"]): RunRecord {
  return {
    id,
    threadId: "thread_1",
    agentId: "agent_1",
    status,
    startedAt: `2026-08-08T00:00:0${id === "run_current" || id === "run_recovery" ? "3" : "1"}.000Z`,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
  };
}
