import type { ExecutionPlanWorkflowResult, RunEvent } from "@napier/contracts";

export function isWorkflowBenchmarkStatus(
  value: unknown,
): value is ExecutionPlanWorkflowResult["status"] {
  return (
    value === "completed" ||
    value === "waiting" ||
    value === "paused" ||
    value === "blocked" ||
    value === "cancelled"
  );
}

export function workflowBenchmarkTerminalEventType(
  status: ExecutionPlanWorkflowResult["status"],
): string {
  if (status === "completed") return "workflow.completed";
  if (status === "waiting") return "workflow.waiting";
  if (status === "paused") return "workflow.paused";
  if (status === "blocked") return "workflow.blocked";
  return "workflow.cancelled";
}

export function findWorkflowBenchmarkTerminalEvent(
  events: RunEvent[],
  result: Pick<ExecutionPlanWorkflowResult, "planId" | "status">,
): RunEvent | undefined {
  const eventType = workflowBenchmarkTerminalEventType(result.status);
  return events.find(
    (event) =>
      event.type === eventType &&
      workflowBenchmarkEventField(event, "planId") === result.planId,
  );
}

function workflowBenchmarkEventField(event: RunEvent, key: string): unknown {
  const payload = event.payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload[key]
    : undefined;
}
