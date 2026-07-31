import type {
  RunEvent,
  RunExecutionMode,
  RunInvocationSource,
  RunRecord,
} from "@napier/contracts";

export type WorkflowReadOnlyChildExecutionMode =
  | "workflow_map_read_only"
  | "workflow_loop_read_only";

export function isWorkflowReadOnlyChildExecutionMode(
  mode: RunExecutionMode,
): mode is WorkflowReadOnlyChildExecutionMode {
  return (
    mode === "workflow_map_read_only" || mode === "workflow_loop_read_only"
  );
}

export function validateWorkflowReadOnlyChildRunGate(input: {
  executionMode: WorkflowReadOnlyChildExecutionMode;
  source: RunInvocationSource;
  threadId: string;
  agentId: string;
  parentRunId?: string;
  workflowPlanId?: string;
  runs: readonly RunRecord[];
  events: readonly RunEvent[];
}): void {
  const parent = input.parentRunId
    ? input.runs.find((candidate) => candidate.id === input.parentRunId)
    : undefined;
  const expectedNodeType =
    input.executionMode === "workflow_map_read_only" ? "map" : "loop";
  const parentStartedAsExpectedNode =
    parent !== undefined &&
    input.events.some(
      (event) =>
        event.runId === parent.id &&
        event.type === "workflow.node.started" &&
        record(event.payload)?.["planId"] === input.workflowPlanId &&
        record(event.payload)?.["nodeType"] === expectedNodeType,
    );
  if (
    input.source !== "workflow" ||
    !input.workflowPlanId ||
    !parent ||
    parent.threadId !== input.threadId ||
    parent.agentId !== input.agentId ||
    parent.source !== "workflow" ||
    parent.status !== "running" ||
    parent.workflowPlanId !== input.workflowPlanId ||
    parent.parentRunId !== undefined ||
    !parent.configuration ||
    parent.configuration.schemaVersion === 1 ||
    parent.configuration.executionMode !== "standard" ||
    !parentStartedAsExpectedNode
  ) {
    const label =
      input.executionMode === "workflow_map_read_only"
        ? "Workflow Map"
        : "Workflow Loop";
    throw new Error(
      `${label} read-only execution requires its active coordinator Run`,
    );
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
