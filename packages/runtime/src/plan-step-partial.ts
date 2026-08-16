import type { RunRecord } from "@napier/contracts";

import type { EventSink } from "./event-sink.js";
import { PARTIAL_PLAN_STEP } from "./plan-step-transition.js";
import type { LocalStore } from "./store.js";

export async function partialRunPlanSteps(input: {
  store: LocalStore;
  run: Pick<RunRecord, "id" | "threadId">;
  onEvent?: EventSink;
}): Promise<void> {
  const plans = input.store.listPlans(input.run.threadId);
  for (const plan of plans) {
    const steps = plan.steps.filter(
      (step) => step.status === "running" && step.runId === input.run.id,
    );
    for (const step of steps) {
      const updated = await input.store.transitionPlanStep(plan.id, step.id, {
        action: PARTIAL_PLAN_STEP,
        runId: input.run.id,
        evidence:
          "Deterministic finalization paused the owning Run; resume from the settlement checkpoint.",
      });
      const partial = updated.steps.find((entry) => entry.id === step.id)!;
      const event = await input.store.appendEvent({
        threadId: input.run.threadId,
        runId: input.run.id,
        type: "plan.step.partial",
        category: "plan",
        visibility: "user",
        payload: {
          planId: updated.id,
          stepId: partial.id,
          title: partial.title,
          status: partial.status,
          planStatus: updated.status,
          evidence: partial.evidence,
          phaseProjectionSha256: updated.phaseProjectionSha256,
        },
      });
      if (!input.onEvent) continue;
      try {
        await input.onEvent(event);
      } catch {
        // Durable partial-step evidence survives a disconnected stream.
      }
    }
  }
}
