import type { ExecutionPlan } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

import { PlanCurrentSheet } from "../src/PlanCurrentSheet";
import { planCopy } from "../src/plan-copy";
import type { PlanReplanController } from "../src/use-plan-replan-controller";
import { renderToStaticMarkup } from "./render-static-preact";

describe("Plan current sheet", () => {
  it("keeps objective, progress, path, and step evidence in one task narrative", () => {
    const markup = renderToStaticMarkup(
      <PlanCurrentSheet
        plan={planFixture()}
        running={false}
        selectedModelConfigured={true}
        replan={replanController()}
        onContinue={vi.fn()}
      />,
    );

    expect(markup).toContain("Deliver a verified handoff");
    expect(markup).toContain(`1 / 2`);
    expect(markup).toContain("Inspect workspace");
    expect(markup).toContain("Run verification");
    expect(markup).toContain(planCopy.criticalPath);
    expect(markup).toContain(planCopy.statuses.ready);
    expect(markup).not.toContain(planCopy.replanSignal);
  });
});

function replanController(): PlanReplanController {
  return {
    review: undefined,
    reviewBusy: false,
    applyBusy: false,
    error: undefined,
    onReview: vi.fn(async () => undefined),
    onApply: vi.fn(async () => undefined),
  };
}

function planFixture(): ExecutionPlan {
  return {
    id: "plan_fixture",
    threadId: "thread_fixture",
    objective: "Deliver a verified handoff",
    status: "active",
    steps: [
      step("inspect", "Inspect workspace", "completed"),
      step("verify", "Run verification", "ready"),
    ],
    artifacts: [],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: ["inspect", "verify"],
    readyStepIds: ["verify"],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: null,
    parallelReadyStepIds: ["verify"],
    phaseProjectionSha256: "a".repeat(64),
    revision: 1,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:01.000Z",
  };
}

function step(
  id: string,
  title: string,
  status: ExecutionPlan["steps"][number]["status"],
): ExecutionPlan["steps"][number] {
  return {
    id,
    title,
    description: title,
    verification: "Verified by Runtime evidence.",
    dependsOn: [],
    status,
    evidence: status === "completed" ? "Evidence recorded." : "",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:01.000Z",
  };
}
