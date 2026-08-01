import type {
  ExecutionPlanWorkflowExperimentMode,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";

const MAX_WORKFLOW_BREAKPOINTS = 16;

export interface WorkflowExperimentExecutionProjection {
  mode: ExecutionPlanWorkflowExperimentMode;
  rerunNodeIds: string[];
  executionNodeIds: string[];
  stopBeforeNodeIds: string[];
}

export function projectWorkflowExperimentExecution(
  manifest: ExecutionPlanWorkflowManifest,
  fromNodeId: string,
  mode: ExecutionPlanWorkflowExperimentMode,
): WorkflowExperimentExecutionProjection {
  const rerunNodeIds = workflowExperimentRerunNodeIds(manifest, fromNodeId);
  if (mode === "subgraph") {
    return {
      mode,
      rerunNodeIds,
      executionNodeIds: [...rerunNodeIds],
      stopBeforeNodeIds: [],
    };
  }
  const directSuccessors = new Set(
    manifest.blueprint.steps
      .filter((step) => step.dependsOn?.includes(fromNodeId))
      .map((step) => step.id),
  );
  const stopBeforeNodeIds = manifest.nodes
    .map((node) => node.id)
    .filter((nodeId) => directSuccessors.has(nodeId));
  if (stopBeforeNodeIds.length > MAX_WORKFLOW_BREAKPOINTS) {
    throw new Error(
      `Workflow single-node test exceeds ${String(MAX_WORKFLOW_BREAKPOINTS)} direct successors`,
    );
  }
  return {
    mode,
    rerunNodeIds,
    executionNodeIds: [fromNodeId],
    stopBeforeNodeIds,
  };
}

export function workflowExperimentRerunNodeIds(
  manifest: ExecutionPlanWorkflowManifest,
  fromNodeId: string,
): string[] {
  if (!manifest.nodes.some((node) => node.id === fromNodeId)) {
    throw new Error("Workflow experiment start node is not in the Manifest");
  }
  const rerun = new Set([fromNodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of manifest.blueprint.steps) {
      if (
        !rerun.has(step.id) &&
        step.dependsOn?.some((dependency) => rerun.has(dependency))
      ) {
        rerun.add(step.id);
        changed = true;
      }
    }
  }
  return manifest.nodes
    .map((node) => node.id)
    .filter((nodeId) => rerun.has(nodeId));
}
