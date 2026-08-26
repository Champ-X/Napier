import type {
  ExecutionPlanWorkflowManifest,
  JsonValue,
} from "@napier/contracts";

import type { WorkflowSimulatedNode } from "./workflow-context.js";
import { workflowSchemaSha256 } from "./workflow-schemas.js";

export const WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT =
  "workflow.node.simulation.requested" as const;
export const WORKFLOW_NODE_SIMULATED_EVENT = "workflow.node.simulated";

export function workflowSimulationRequestPayload(input: {
  planId: string;
  manifestSha256: string;
  nodeId: string;
  output: JsonValue;
  outputSha256: string;
  outputBytes: number;
  outputSchemaSha256: string;
}): Record<string, JsonValue> {
  return {
    schemaVersion: 1,
    planId: input.planId,
    manifestSha256: input.manifestSha256,
    nodeId: input.nodeId,
    output: structuredClone(input.output),
    outputSha256: input.outputSha256,
    outputBytes: input.outputBytes,
    outputSchemaSha256: input.outputSchemaSha256,
  };
}

export function workflowSimulationRequestEvents(
  manifest: ExecutionPlanWorkflowManifest,
  planId: string,
  simulatedNodes: WorkflowSimulatedNode[],
) {
  return simulatedNodes.map((simulated) => {
    const node = manifest.nodes.find(
      (candidate) => candidate.id === simulated.nodeId,
    );
    if (!node) {
      throw new Error("Workflow simulation node is not in the Manifest");
    }
    return {
      type: WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT,
      category: "plan" as const,
      visibility: "hidden" as const,
      payload: workflowSimulationRequestPayload({
        planId,
        manifestSha256: manifest.contentSha256,
        nodeId: simulated.nodeId,
        output: simulated.output,
        outputSha256: simulated.outputSha256,
        outputBytes: simulated.outputBytes,
        outputSchemaSha256: workflowSchemaSha256(node.outputSchema),
      }),
    };
  });
}
