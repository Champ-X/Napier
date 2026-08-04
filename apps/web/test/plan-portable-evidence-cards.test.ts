import { describe, expect, it } from "vitest";

import {
  projectPlanArchiveReceiptView,
  projectPlanBlueprintReceiptView,
} from "../src/PlanPortableEvidenceCards";
import { planCopy } from "../src/plan-copy";

describe("Plan portable evidence cards", () => {
  it("renders archive verification diagnostics and evidence counts", () => {
    expect(
      projectPlanArchiveReceiptView({
        action: "verified",
        status: "invalid",
        diagnostics: ["event_stream_mismatch"],
        contentSha256: "a".repeat(64),
        eventStreamSha256: "b".repeat(64),
        revision: 3,
        eventCount: 12,
        stepCount: 4,
        artifactCount: 2,
        replanCount: 1,
      }),
    ).toEqual({
      status: "invalid",
      title: planCopy.archive.invalid,
      contentSha256: "a".repeat(16),
      summary: `r3 / 12 ${planCopy.archive.events} / 4 ${planCopy.archive.steps} / 2 ${planCopy.archive.artifacts} / 1 ${planCopy.archive.replans}`,
      eventStreamSha256: "b".repeat(16),
      diagnostics: "event_stream_mismatch",
    });
  });

  it("projects a created Blueprint receipt with its Plan identity", () => {
    expect(
      projectPlanBlueprintReceiptView({
        action: "created",
        contentSha256: "c".repeat(64),
        planId: "plan_created",
        stepCount: 3,
        artifactCount: 1,
      }),
    ).toEqual({
      status: "valid",
      title: planCopy.blueprint.created,
      contentSha256: "c".repeat(16),
      summary: `3 ${planCopy.blueprint.steps} / 1 ${planCopy.blueprint.artifacts} / plan_created`,
      diagnostics: undefined,
    });
  });
});
