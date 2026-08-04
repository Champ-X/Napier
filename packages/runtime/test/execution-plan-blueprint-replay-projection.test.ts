import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { sha256 } from "../src/ed25519.js";
import {
  createExecutionPlanBlueprintRecordReplayHistory,
  createExecutionPlanBlueprintRecordReplayOutcome,
  createExecutionPlanBlueprintRecordReplayOutcomes,
  executionPlanBlueprintRecordReplayFromEvent,
} from "../src/execution-plan-blueprint-replay-projection.js";
import { createExecutionPlan } from "../src/plans.js";

const RECORD_ID = "blueprint_record_1";
const DIGEST = "a".repeat(64);

describe("Execution Plan Blueprint replay projection", () => {
  it("accepts a complete bound event without retaining objective text", () => {
    const event = replayEvent({
      eventId: "event_1",
      threadId: "thread_1",
      planId: "plan_1",
      objective: "private delivery objective",
      seq: 2,
    });
    const replay = executionPlanBlueprintRecordReplayFromEvent(
      event,
      RECORD_ID,
    );

    expect(replay).toEqual(
      expect.objectContaining({
        eventId: "event_1",
        threadId: "thread_1",
        planId: "plan_1",
        objectiveSha256: sha256("private delivery objective"),
      }),
    );
    expect(JSON.stringify(replay)).not.toContain("private delivery objective");
    expect(
      executionPlanBlueprintRecordReplayFromEvent(
        {
          ...event,
          payload: { ...event.payload, blueprintPreviewSha256: "invalid" },
        },
        RECORD_ID,
      ),
    ).toBeUndefined();
  });

  it("sorts history and aggregates current and missing Plan outcomes", () => {
    const plan = createExecutionPlan("thread_1", {
      objective: "private plan objective",
      steps: [
        {
          id: "deliver",
          title: "Deliver",
          description: "private step description",
          verification: "private verification",
        },
      ],
      artifacts: [
        {
          id: "report",
          path: "private/report.txt",
          kind: "file",
          description: "private report",
        },
      ],
    });
    const currentReplay = executionPlanBlueprintRecordReplayFromEvent(
      replayEvent({
        eventId: "event_current",
        threadId: plan.threadId,
        planId: plan.id,
        objective: plan.objective,
        seq: 3,
      }),
      RECORD_ID,
    );
    const missingReplay = executionPlanBlueprintRecordReplayFromEvent(
      replayEvent({
        eventId: "event_missing",
        threadId: "thread_2",
        planId: "plan_missing",
        objective: "missing objective",
        seq: 1,
      }),
      RECORD_ID,
    );
    if (!currentReplay || !missingReplay) throw new Error("Expected replays");

    const history = createExecutionPlanBlueprintRecordReplayHistory(RECORD_ID, [
      currentReplay,
      missingReplay,
    ]);
    const reversed = createExecutionPlanBlueprintRecordReplayHistory(
      RECORD_ID,
      [missingReplay, currentReplay],
    );
    expect(reversed.contentSha256).toBe(history.contentSha256);
    expect(history.replays.map((replay) => replay.eventId)).toEqual([
      "event_missing",
      "event_current",
    ]);

    const outcomes = createExecutionPlanBlueprintRecordReplayOutcomes(
      RECORD_ID,
      history.contentSha256,
      [
        createExecutionPlanBlueprintRecordReplayOutcome(
          missingReplay,
          undefined,
        ),
        createExecutionPlanBlueprintRecordReplayOutcome(currentReplay, plan),
      ],
    );
    expect(outcomes).toEqual(
      expect.objectContaining({
        replayCount: 2,
        activeCount: 1,
        completedCount: 0,
        invalidCount: 1,
        completionRateBps: 0,
      }),
    );
    const serialized = JSON.stringify(outcomes);
    expect(serialized).not.toContain("private step description");
    expect(serialized).not.toContain("private/report.txt");
  });
});

function replayEvent(input: {
  eventId: string;
  threadId: string;
  planId: string;
  objective: string;
  seq: number;
}): RunEvent {
  return {
    id: input.eventId,
    threadId: input.threadId,
    runId: "runctl_replay",
    seq: input.seq,
    type: "plan.created",
    category: "plan",
    visibility: "user",
    createdAt: `2026-08-04T00:00:0${input.seq}.000Z`,
    payload: {
      planId: input.planId,
      objective: input.objective,
      status: "active",
      stepCount: 1,
      artifactCount: 1,
      blueprintRecordId: RECORD_ID,
      blueprintSha256: DIGEST,
      blueprintSourcePlanId: "plan_source",
      blueprintSourcePlanRevision: 1,
      blueprintSourceArchiveSha256: DIGEST,
      blueprintQualificationStatus: "qualified",
      blueprintQualificationSha256: DIGEST,
      blueprintQualificationDiagnosticsSha256: DIGEST,
      blueprintPreviewSha256: DIGEST,
    },
  };
}
