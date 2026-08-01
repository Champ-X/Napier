import type { ExecutionPlanWorkflowManifest } from "@napier/contracts";

export const MAX_EXECUTION_PLAN_WORKFLOW_BREAKPOINTS = 16;

const RESOURCE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

export function validateExecutionPlanWorkflowBreakpointNodeIds(
  manifest: ExecutionPlanWorkflowManifest,
  input: unknown,
): string[] {
  if (input === undefined) return [];
  if (
    !Array.isArray(input) ||
    input.length > MAX_EXECUTION_PLAN_WORKFLOW_BREAKPOINTS ||
    input.some(
      (nodeId) => typeof nodeId !== "string" || !RESOURCE_ID.test(nodeId),
    )
  ) {
    throw new Error("Workflow breakpoint node IDs are invalid");
  }
  const requested = new Set(input as string[]);
  if (requested.size !== input.length) {
    throw new Error("Workflow breakpoint node IDs must be unique");
  }
  if (
    [...requested].some(
      (nodeId) => !manifest.nodes.some((node) => node.id === nodeId),
    )
  ) {
    throw new Error("Workflow breakpoint node is not in the Manifest");
  }
  return manifest.nodes.flatMap((node) =>
    requested.has(node.id) ? [node.id] : [],
  );
}
