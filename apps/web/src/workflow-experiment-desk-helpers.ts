import type {
  ExecutionPlan,
  ExecutionPlanWorkflowExperimentResultFrame,
} from "@napier/contracts";

import { workflowExperimentResultFilename } from "./workflow-experiment-view-model";

export function defaultWorkflowExperimentSourcePlanId(
  plans: ExecutionPlan[],
): string {
  return (
    plans.findLast((plan) => plan.status === "completed")?.id ??
    plans.findLast((plan) => plan.status === "blocked")?.id ??
    plans.at(-1)?.id ??
    ""
  );
}

export function shortWorkflowExperimentId(value: string): string {
  return value.length > 18
    ? `${value.slice(0, 10)}...${value.slice(-6)}`
    : value;
}

export function downloadWorkflowExperimentResult(
  result: ExecutionPlanWorkflowExperimentResultFrame,
): void {
  const blob = new Blob([JSON.stringify(result, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = workflowExperimentResultFilename(result);
  anchor.click();
  URL.revokeObjectURL(url);
}
