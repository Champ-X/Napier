import { describe, expect, it } from "vitest";

import {
  parseTransitionPlanStepRequest,
  parseUpdateArtifactManifestRequest,
} from "../src/plan-progress-http-validation.js";

describe("Plan progress HTTP validation", () => {
  it("preserves raw bounded step evidence and rejects unknown fields", () => {
    expect(
      parseTransitionPlanStepRequest({
        action: "block",
        evidence: "  evidence stays raw  ",
        blocker: "",
      }),
    ).toEqual({
      action: "block",
      evidence: "  evidence stays raw  ",
      blocker: "",
    });
    expect(
      parseTransitionPlanStepRequest({
        action: "complete",
        unexpected: true,
      }),
    ).toBeUndefined();
    expect(
      parseTransitionPlanStepRequest({
        action: "start",
        runId: "run_short",
      }),
    ).toBeUndefined();
  });

  it("allows only server-observed verified or missing artifact updates", () => {
    expect(
      parseUpdateArtifactManifestRequest({
        status: "verified",
        observeWorkspace: true,
        evidence: "server observed",
      }),
    ).toEqual({
      status: "verified",
      observeWorkspace: true,
      evidence: "server observed",
    });
    expect(
      parseUpdateArtifactManifestRequest({
        status: "produced",
        observeWorkspace: true,
      }),
    ).toBeUndefined();
    expect(
      parseUpdateArtifactManifestRequest({
        status: "verified",
        observeWorkspace: true,
        sha256: "a".repeat(64),
      }),
    ).toBeUndefined();
    expect(
      parseUpdateArtifactManifestRequest({
        status: "verified",
        evidence: "x".repeat(2_001),
      }),
    ).toBeUndefined();
  });
});
