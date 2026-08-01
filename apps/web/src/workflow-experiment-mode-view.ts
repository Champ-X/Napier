import type {
  ExecutionPlanWorkflowExperimentMode,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";

export function workflowExperimentPreviewMatchesMode(
  preview: ExecutionPlanWorkflowExperimentPreview,
  manifest: ExecutionPlanWorkflowManifest,
  fromNodeId: string,
  mode: ExecutionPlanWorkflowExperimentMode,
): boolean {
  const rerunNodeIds = rerunNodeIdsFrom(manifest, fromNodeId);
  if (!rerunNodeIds) return false;
  const rerun = new Set(rerunNodeIds);
  const reusedNodeIds = manifest.nodes
    .map((node) => node.id)
    .filter((nodeId) => !rerun.has(nodeId));
  if (
    !sameStrings(preview.reusedNodeIds, reusedNodeIds) ||
    !sameStrings(preview.rerunNodeIds, rerunNodeIds)
  ) {
    return false;
  }
  if (mode === "subgraph") return preview.schemaVersion === 1;
  if (mode === "simulate_node") {
    return (
      preview.schemaVersion === 3 &&
      preview.mode === "simulate_node" &&
      preview.simulatedNodeId === fromNodeId &&
      sameStrings(
        preview.executionNodeIds,
        rerunNodeIds.filter((nodeId) => nodeId !== fromNodeId),
      )
    );
  }
  if (mode === "replace_input") {
    return (
      preview.schemaVersion === 4 &&
      preview.mode === "replace_input" &&
      preview.replacedInputNodeId === fromNodeId &&
      sameStrings(preview.executionNodeIds, rerunNodeIds)
    );
  }
  if (mode === "step_nodes") {
    return (
      preview.schemaVersion === 5 &&
      preview.mode === "step_nodes" &&
      preview.stopBeforeNodeIds.length <= 16 &&
      sameStrings(preview.executionNodeIds, [fromNodeId]) &&
      sameStrings(
        preview.stopBeforeNodeIds,
        rerunNodeIds.filter((nodeId) => nodeId !== fromNodeId),
      )
    );
  }
  if (preview.schemaVersion !== 2 || preview.mode !== "single_node") {
    return false;
  }
  const directSuccessors = new Set(
    manifest.blueprint.steps
      .filter((step) => step.dependsOn?.includes(fromNodeId))
      .map((step) => step.id),
  );
  const stopBeforeNodeIds = manifest.nodes
    .map((node) => node.id)
    .filter((nodeId) => directSuccessors.has(nodeId));
  return (
    stopBeforeNodeIds.length <= 16 &&
    sameStrings(preview.executionNodeIds, [fromNodeId]) &&
    sameStrings(preview.stopBeforeNodeIds, stopBeforeNodeIds)
  );
}

function rerunNodeIdsFrom(
  manifest: ExecutionPlanWorkflowManifest,
  fromNodeId: string,
): string[] | undefined {
  if (!manifest.nodes.some((node) => node.id === fromNodeId)) return undefined;
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

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
