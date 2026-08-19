import type { ExecutionPlan } from "@napier/contracts";

import { PlanOverviewHeader } from "./PlanOverviewHeader";
import { PlanReplanDraftCard } from "./PlanReplanDraftCard";
import { PlanReplanHistory } from "./PlanReplanHistory";
import { PlanReplanRecordCard } from "./PlanReplanRecordCard";
import { PlanStepList } from "./PlanStepList";
import type { PlanReplanController } from "./use-plan-replan-controller";

export interface PlanCurrentSheetProps {
  plan: ExecutionPlan;
  running: boolean;
  selectedModelConfigured: boolean;
  replan: PlanReplanController;
  onContinue: () => void;
}

export function PlanCurrentSheet({
  plan,
  running,
  selectedModelConfigured,
  replan,
  onContinue,
}: PlanCurrentSheetProps) {
  const readyStep =
    plan.steps.find((step) => step.id === plan.readyStepIds[0]) ??
    plan.steps.find((step) => step.status === "ready");
  return (
    <article className={`plan-sheet plan-${plan.status}`}>
      <PlanOverviewHeader plan={plan} />
      <PlanReplanRecordCard
        plan={plan}
        running={running}
        readyStepId={readyStep?.id}
        onContinue={onContinue}
      />
      <PlanReplanHistory plan={plan} />
      <PlanReplanDraftCard
        plan={plan}
        running={running}
        selectedModelConfigured={selectedModelConfigured}
        controller={replan}
      />
      <PlanStepList plan={plan} />
    </article>
  );
}
