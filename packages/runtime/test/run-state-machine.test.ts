import type { RunStatus } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  initialRunStatus,
  requireRunTransition,
  RUN_TRANSITION_DEFINITIONS,
  RunStateTransitionError,
  transitionRunStatus,
} from "../src/run-state-machine.js";

describe("Run state machine", () => {
  it("defines every transition once", () => {
    const edges = RUN_TRANSITION_DEFINITIONS.map(
      ({ from, to }) => `${from}->${to}`,
    );

    expect(new Set(edges).size).toBe(edges.length);
    expect(edges).toEqual([
      "new->running",
      "queued->running",
      "queued->completed",
      "queued->failed",
      "queued->cancelled",
      "queued->interrupted",
      "running->completed",
      "running->failed",
      "running->cancelled",
      "running->interrupted",
    ]);
  });

  it("starts new Runs through the declared durable transition", () => {
    expect(initialRunStatus()).toBe("running");
    expect(requireRunTransition("new", "running")).toEqual({
      from: "new",
      to: "running",
      durableEvent: "run.started",
      recoverable: true,
      cancellationBoundary: "before_start",
      delivery: "exactly_once",
    });
  });

  it.each([
    ["completed", "run.completed", false, "exactly_once"],
    ["failed", "run.failed", false, "exactly_once"],
    ["cancelled", "run.cancelled", false, "at_most_once"],
    ["interrupted", "run.interrupted", true, "at_most_once"],
  ] as const)(
    "settles a running Run as %s",
    (status, durableEvent, recoverable, delivery) => {
      const run: { status: RunStatus } = { status: "running" };

      expect(transitionRunStatus(run, status)).toEqual(
        expect.objectContaining({
          from: "running",
          to: status,
          durableEvent,
          recoverable,
          cancellationBoundary: "while_running",
          delivery,
        }),
      );
      expect(run.status).toBe(status);
    },
  );

  it("rejects undeclared transitions without mutating the Run", () => {
    const run: { status: RunStatus } = { status: "completed" };

    expect(() => transitionRunStatus(run, "running")).toThrow(
      RunStateTransitionError,
    );
    expect(run.status).toBe("completed");
    expect(() => requireRunTransition("new", "queued")).toThrow(
      "Run status transition is invalid: new -> queued",
    );
  });
});
