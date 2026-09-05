import { describe, expect, it } from "vitest";

import {
  RunDirectiveFixedPointGuard,
  RUN_DIRECTIVE_FIXED_POINT_STATE_LIMIT,
} from "../src/run-convergence-controller-support.js";
import type { RunConvergenceSnapshot } from "../src/run-convergence-policy.js";
import type {
  RunDirectiveDecision,
  RunDirectiveState,
} from "../src/run-progress-directive-types.js";

describe("Run directive fixed-point guard", () => {
  it("detects a semantic state cycle despite changing lineage IDs", () => {
    const guard = new RunDirectiveFixedPointGuard();
    const first = requestedState("lineage-a", false);
    const second = requestedState("lineage-b", false);
    const decision = activateDecision();

    guard.commit(guard.prepare(first, decision));
    expect(() => guard.prepare(second, decision)).toThrow("state cycle");
  });

  it("allows distinct materialized delivery states", () => {
    const guard = new RunDirectiveFixedPointGuard();
    const decision = activateDecision();

    guard.commit(guard.prepare(requestedState("lineage", false), decision));
    expect(() =>
      guard.prepare(requestedState("lineage", true), decision),
    ).not.toThrow();
    expect(RUN_DIRECTIVE_FIXED_POINT_STATE_LIMIT).toBeGreaterThan(1);
  });
});

function requestedState(
  directiveId: string,
  delivered: boolean,
): RunDirectiveState {
  return {
    controlEpochId: "run:initial",
    convergence: {
      phase: "requested",
      directiveId,
      turnIndex: 1,
      delivered,
    },
    noProgress: { phase: "idle" },
    latestVector: vector,
  };
}

function activateDecision(): RunDirectiveDecision {
  return { kind: "convergence_activate", vector };
}

const vector: RunConvergenceSnapshot = {
  turnIndex: 2,
  elapsedMs: 1,
  progressed: false,
  productProgressed: false,
  acceptanceProgressed: false,
  supportProgressed: false,
  regressed: false,
  stagnantTurnCount: 1,
  stagnantElapsedMs: 1,
  acquisitionOnlyTurnCount: 0,
  acquisitionStagnantTurnCount: 0,
  supportCount: 0,
  acquisitionAttemptCount: 0,
  acquisitionAttemptCountSinceProgress: 0,
  acquisitionAdvanceCountSinceProgress: 0,
  productCount: 0,
  acceptanceCount: 0,
  failureFingerprintCount: 0,
  failureDomainCount: 0,
  failureDomainCountSinceProgress: 0,
  unclassifiedActivityCountSinceProgress: 0,
  contentSha256: "a".repeat(64),
};
