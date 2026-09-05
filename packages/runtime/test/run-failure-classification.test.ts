import { describe, expect, it } from "vitest";

import {
  classifyFailure,
  withSettlementOutcome,
} from "../src/run-failure-classification.js";
import {
  modelFailureError,
  ModelTurnWatchdogError,
} from "../src/model-turn-deadline.js";
import { RunNoProgressError } from "../src/run-no-progress-policy.js";
import {
  ToolDeadlineError,
  type ToolDeadlineEvidence,
} from "../src/tool-deadline-policy.js";

describe("Run failure classification", () => {
  it("keeps model and tool deadline failures resumable and non-blocking", () => {
    const model = classifyFailure(
      false,
      false,
      undefined,
      new ModelTurnWatchdogError({
        reason: "idle_timeout",
        limitMs: 90_000,
        turnTimeoutMs: 300_000,
        firstEventTimeoutMs: 45_000,
        idleTimeoutMs: 90_000,
      }),
    );
    expect(model).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        blocksGoal: false,
        modelWatchdog: expect.objectContaining({ reason: "idle_timeout" }),
      }),
    );

    const toolEvidence: ToolDeadlineEvidence = {
      callId: "call_deadline",
      toolName: "apply_patch",
      reason: "deadline_exceeded",
      effect: "write",
      state: "started_unknown",
      timeoutMs: 120_000,
      graceMs: 5_000,
      callSha256: "a".repeat(64),
      contentSha256: "b".repeat(64),
    };
    const tool = classifyFailure(
      false,
      false,
      undefined,
      new ToolDeadlineError(toolEvidence),
    );
    expect(tool).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        blocksGoal: false,
        toolDeadline: toolEvidence,
      }),
    );
  });

  it("keeps ordinary user cancellation cancelled", () => {
    const failure = classifyFailure(
      true,
      false,
      undefined,
      new Error("cancelled"),
    );
    expect(failure).toEqual(
      expect.objectContaining({
        status: "cancelled",
        blocksGoal: false,
      }),
    );
    expect(failure).not.toHaveProperty("outcome");
  });

  it("keeps transient provider stream failures resumable and non-blocking", () => {
    const failure = classifyFailure(
      false,
      false,
      undefined,
      modelFailureError("error", "terminated"),
    );

    expect(failure).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        blocksGoal: false,
        message:
          "The model response stream ended unexpectedly. Safely resume the Run; select another configured model if the connection keeps failing.",
        modelProviderFailure: {
          failureClass: "network",
          message:
            "The model response stream ended unexpectedly. Safely resume the Run; select another configured model if the connection keeps failing.",
        },
      }),
    );
    expect(withSettlementOutcome(failure, "partial").outcome).toBe("partial");
  });

  it("distinguishes a provider abort from root Run cancellation", () => {
    const failure = classifyFailure(
      false,
      false,
      undefined,
      modelFailureError("aborted", "provider stream aborted", false),
    );

    expect(failure).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        blocksGoal: false,
        modelProviderFailure: expect.objectContaining({
          failureClass: "network",
        }),
      }),
    );
  });

  it.each(["AbortError", "request timeout", "HTTP 408"])(
    "keeps provider-side %s failures resumable",
    (diagnostic) => {
      const failure = classifyFailure(
        false,
        false,
        undefined,
        modelFailureError("error", diagnostic, false),
      );

      expect(failure).toEqual(
        expect.objectContaining({
          status: "failed",
          outcome: "paused_budget",
          blocksGoal: false,
          modelProviderFailure: expect.objectContaining({
            failureClass: "network",
          }),
        }),
      );
    },
  );

  it("keeps no-progress convergence resumable and non-blocking", () => {
    const evidence = {
      reason: "turns" as const,
      turnIndex: 7,
      stagnantTurnCount: 7,
      elapsedMs: 210_000,
      stagnantElapsedMs: 210_000,
      thresholdTurns: 6,
      thresholdElapsedMs: 180_000,
      taskIntentSha256: "a".repeat(64),
      progressVectorSha256: "b".repeat(64),
      rerouteContentSha256: "c".repeat(64),
    };
    const failure = classifyFailure(
      false,
      false,
      undefined,
      new RunNoProgressError(evidence),
    );

    expect(failure).toEqual(
      expect.objectContaining({
        status: "failed",
        outcome: "paused_budget",
        blocksGoal: false,
        noProgress: evidence,
        message: expect.stringContaining("no measurable progress"),
      }),
    );
  });
});
