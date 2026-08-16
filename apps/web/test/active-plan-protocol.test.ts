import { describe, expect, it } from "vitest";

import { isActivePlanProjection } from "../src/active-plan-protocol";

describe("Active Plan protocol", () => {
  it("accepts bounded projections and rejects malformed output paths", () => {
    const valid = {
      planId: "plan_fixture0001",
      revision: 1,
      status: "active",
      objective: "Ship",
      completedStepCount: 0,
      settledStepCount: 0,
      stepCount: 1,
      verifiedArtifactCount: 0,
      producedArtifactCount: 0,
      missingArtifactCount: 0,
      outputPaths: [],
      activePhaseIndex: 0,
      phaseCount: 1,
      eventWatermark: 1,
    };
    expect(isActivePlanProjection(valid)).toBe(true);
    expect(isActivePlanProjection({ ...valid, outputPaths: [42] })).toBe(false);
  });
});
