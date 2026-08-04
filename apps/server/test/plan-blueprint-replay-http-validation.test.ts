import { describe, expect, it } from "vitest";

import {
  parseVerifyExecutionPlanBlueprintRecordReplayEventRequest,
  parseVerifyExecutionPlanBlueprintRecordReplayHistoryRequest,
  parseVerifyExecutionPlanBlueprintRecordReplayOutcomesRequest,
} from "../src/plan-blueprint-replay-http-validation.js";

describe("Plan Blueprint replay HTTP validation", () => {
  it("accepts exactly one history or outcomes artifact", () => {
    const history = { kind: "history" };
    const outcomes = { kind: "outcomes" };
    expect(
      parseVerifyExecutionPlanBlueprintRecordReplayHistoryRequest({ history }),
    ).toEqual({ history });
    expect(
      parseVerifyExecutionPlanBlueprintRecordReplayOutcomesRequest({
        outcomes,
      }),
    ).toEqual({ outcomes });
    expect(
      parseVerifyExecutionPlanBlueprintRecordReplayHistoryRequest({
        history,
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parseVerifyExecutionPlanBlueprintRecordReplayOutcomesRequest({}),
    ).toBeUndefined();
  });

  it("bounds event identity, sequence, and digest", () => {
    const request = {
      threadId: "thread_replay",
      eventId: "event_replay",
      seq: 3,
      eventSha256: "a".repeat(64),
    };
    expect(
      parseVerifyExecutionPlanBlueprintRecordReplayEventRequest(request),
    ).toEqual(request);
    expect(
      parseVerifyExecutionPlanBlueprintRecordReplayEventRequest({
        ...request,
        seq: 0,
      }),
    ).toBeUndefined();
    expect(
      parseVerifyExecutionPlanBlueprintRecordReplayEventRequest({
        ...request,
        eventSha256: "A".repeat(64),
      }),
    ).toBeUndefined();
    expect(
      parseVerifyExecutionPlanBlueprintRecordReplayEventRequest({
        ...request,
        extra: true,
      }),
    ).toBeUndefined();
  });
});
