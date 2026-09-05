import type { RunLimits } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  evaluateRunConvergence,
  hasRunNoProgressPressure,
  projectRunAcquisitionPhase,
  type RunConvergenceSnapshot,
} from "../src/run-convergence-policy.js";

const LIMITS: RunLimits = {
  maxTurns: 100,
  maxTotalTokens: 100_000,
  maxCostUsd: 10,
  timeoutMs: 1_000_000,
};

describe("Run convergence policy", () => {
  it("never turns elapsed time into a fixed acquisition budget", () => {
    const highYield = snapshot({
      turnIndex: 90,
      elapsedMs: 900_000,
      acquisitionAttemptCount: 12,
      acquisitionAttemptCountSinceProgress: 12,
      acquisitionAdvanceCountSinceProgress: 12,
      supportCount: 12,
      supportProgressed: true,
      acquisitionStagnantTurnCount: 0,
    });
    const phase = projectRunAcquisitionPhase(highYield, {
      acquisitionAttemptCountSinceProgress: 0,
      acquisitionAdvanceCountSinceProgress: 0,
      failureDomainCount: 0,
    });

    expect(evaluateRunConvergence(highYield, phase, LIMITS)).toBeUndefined();
  });

  it("uses phase-local yield and failure pressure after a productive reset", () => {
    const current = snapshot({
      acquisitionAttemptCount: 14,
      acquisitionAttemptCountSinceProgress: 14,
      acquisitionAdvanceCountSinceProgress: 9,
      supportCount: 9,
      failureDomainCount: 7,
      failureDomainCountSinceProgress: 7,
      acquisitionStagnantTurnCount: 1,
    });
    const phase = projectRunAcquisitionPhase(current, {
      acquisitionAttemptCountSinceProgress: 12,
      acquisitionAdvanceCountSinceProgress: 8,
      failureDomainCount: 7,
    });

    expect(phase).toEqual({ attempts: 2, advances: 1, failureDomains: 0 });
    expect(evaluateRunConvergence(current, phase, LIMITS)).toBeUndefined();
  });

  it("converges on diminishing marginal value rather than tool identity", () => {
    const current = snapshot({
      acquisitionAttemptCount: 5,
      acquisitionAttemptCountSinceProgress: 5,
      acquisitionAdvanceCountSinceProgress: 2,
      supportCount: 2,
    });
    const phase = projectRunAcquisitionPhase(current, {
      acquisitionAttemptCountSinceProgress: 0,
      acquisitionAdvanceCountSinceProgress: 0,
      failureDomainCount: 0,
    });

    expect(evaluateRunConvergence(current, phase, LIMITS)).toBe(
      "support_phase",
    );
  });

  it("does not call productive acquisition-only turns no-progress", () => {
    const current = snapshot({
      stagnantTurnCount: 20,
      stagnantElapsedMs: 900_000,
      acquisitionAttemptCount: 20,
      acquisitionAttemptCountSinceProgress: 20,
      acquisitionAdvanceCountSinceProgress: 20,
      supportCount: 20,
      supportProgressed: true,
      acquisitionStagnantTurnCount: 0,
    });
    const phase = projectRunAcquisitionPhase(current, {
      acquisitionAttemptCountSinceProgress: 0,
      acquisitionAdvanceCountSinceProgress: 0,
      failureDomainCount: 0,
    });

    expect(hasRunNoProgressPressure(current, phase)).toBe(false);
  });
});

function snapshot(
  overrides: Partial<RunConvergenceSnapshot>,
): RunConvergenceSnapshot {
  return {
    turnIndex: 1,
    elapsedMs: 1,
    progressed: false,
    productProgressed: false,
    acceptanceProgressed: false,
    supportProgressed: false,
    regressed: false,
    stagnantTurnCount: 1,
    stagnantElapsedMs: 1,
    acquisitionOnlyTurnCount: 1,
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
    ...overrides,
  };
}
