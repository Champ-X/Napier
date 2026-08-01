import type { JsonValue } from "@napier/contracts";

export const WORKFLOW_NODE_SIMULATION_REQUESTED_EVENT =
  "workflow.node.simulation.requested";
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
