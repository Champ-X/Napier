import type { ExecutionPlan, RunInvocationSource } from "@napier/contracts";

import type { WorkflowSimulationExecution } from "./workflow-simulation-execution.js";

const NODE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;
const HASH = /^[a-f0-9]{64}$/u;

export function validateWorkflowSimulationRunGate(input: {
  source: RunInvocationSource | undefined;
  threadId: string;
  execution: WorkflowSimulationExecution | undefined;
  plans: ExecutionPlan[];
}): WorkflowSimulationExecution | undefined {
  if (input.source !== "workflow_simulation") {
    if (input.execution) {
      throw new Error(
        "Workflow simulation capability requires a simulation Run source",
      );
    }
    return undefined;
  }
  const execution = input.execution;
  const plan = execution
    ? input.plans.find((candidate) => candidate.id === execution.planId)
    : undefined;
  const step = plan?.steps.find(
    (candidate) => candidate.id === execution?.nodeId,
  );
  if (
    !execution ||
    !plan ||
    plan.threadId !== input.threadId ||
    plan.status !== "active" ||
    !NODE_ID.test(execution.nodeId) ||
    !HASH.test(execution.outputSha256) ||
    step?.status !== "ready"
  ) {
    throw new Error(
      "Workflow simulation Run requires its active dependency-ready Plan capability",
    );
  }
  return execution;
}
