import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  createExecutionPlanBlueprintRecordReplayHistory,
  createExecutionPlanBlueprintRecordReplayOutcomes,
} from "../src/execution-plan-blueprint-replay-projection.js";
import {
  verifyExecutionPlanBlueprintRecordReplayEventProjection,
  verifyExecutionPlanBlueprintRecordReplayHistoryProjection,
  verifyExecutionPlanBlueprintRecordReplayOutcomesProjection,
} from "../src/execution-plan-blueprint-replay-verification.js";
import { storeSha256 } from "../src/store-hashing.js";

const RECORD_ID = "blueprint_record_1";

describe("Execution Plan Blueprint replay verification", () => {
  it("verifies portable history and outcomes and orders drift diagnostics", () => {
    const history = createExecutionPlanBlueprintRecordReplayHistory(
      RECORD_ID,
      [],
    );
    expect(
      verifyExecutionPlanBlueprintRecordReplayHistoryProjection(
        history,
        RECORD_ID,
        history,
      ),
    ).toEqual(expect.objectContaining({ status: "valid", diagnostics: [] }));
    expect(
      verifyExecutionPlanBlueprintRecordReplayHistoryProjection(
        { ...history, replayCount: 1 },
        RECORD_ID,
        history,
      ).diagnostics,
    ).toEqual(["content_hash_mismatch", "replay_count_mismatch"]);

    const outcomes = createExecutionPlanBlueprintRecordReplayOutcomes(
      RECORD_ID,
      history.contentSha256,
      [],
    );
    expect(
      verifyExecutionPlanBlueprintRecordReplayOutcomesProjection(
        outcomes,
        RECORD_ID,
        outcomes,
      ),
    ).toEqual(expect.objectContaining({ status: "valid", diagnostics: [] }));
    expect(
      verifyExecutionPlanBlueprintRecordReplayOutcomesProjection(
        { ...outcomes, outcomeSetSha256: "b".repeat(64) },
        RECORD_ID,
        outcomes,
      ).diagnostics,
    ).toEqual(["content_hash_mismatch", "outcome_set_mismatch"]);
  });

  it("binds event ID, sequence, JSON hash, and Blueprint Record identity", () => {
    const event = replayEvent();
    const eventSha256 = storeSha256(JSON.stringify(event));
    const verification =
      verifyExecutionPlanBlueprintRecordReplayEventProjection(
        RECORD_ID,
        {
          threadId: event.threadId,
          eventId: event.id,
          seq: event.seq,
          eventSha256,
        },
        [event],
      );
    expect(verification).toEqual(
      expect.objectContaining({
        status: "valid",
        diagnostics: [],
        observedEventSha256: eventSha256,
        observedReplay: expect.objectContaining({ recordId: RECORD_ID }),
      }),
    );

    expect(
      verifyExecutionPlanBlueprintRecordReplayEventProjection(
        RECORD_ID,
        {
          threadId: event.threadId,
          eventId: "event_other",
          seq: event.seq,
          eventSha256,
        },
        [event],
      ).diagnostics,
    ).toEqual(["event_id_mismatch"]);
  });
});

function replayEvent(): RunEvent {
  const digest = "a".repeat(64);
  return {
    id: "event_replay",
    threadId: "thread_replay",
    runId: "runctl_replay",
    seq: 1,
    type: "plan.created",
    category: "plan",
    visibility: "user",
    createdAt: "2026-08-04T00:00:00.000Z",
    payload: {
      planId: "plan_replay",
      objective: "private objective",
      status: "active",
      stepCount: 1,
      artifactCount: 0,
      blueprintRecordId: RECORD_ID,
      blueprintSha256: digest,
      blueprintSourcePlanId: "plan_source",
      blueprintSourcePlanRevision: 1,
      blueprintSourceArchiveSha256: digest,
      blueprintQualificationStatus: "qualified",
      blueprintQualificationSha256: digest,
      blueprintQualificationDiagnosticsSha256: digest,
      blueprintPreviewSha256: digest,
    },
  };
}
