import type {
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentPreviewV1,
  ExecutionPlanWorkflowManifest,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  WorkflowNodeInputOverride,
  WorkflowSimulatedNode,
} from "./workflow-context.js";
import type { WorkflowExperimentExecutionProjection } from "./workflow-experiment-mode.js";
import type { WorkflowTopLevelInputReplacement } from "./workflow-top-level-input-override.js";
import {
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
} from "./workflow-schemas.js";

type WorkflowExperimentPreviewBase = Omit<
  ExecutionPlanWorkflowExperimentPreviewV1,
  "schemaVersion" | "previewSha256" | "fromNodeId"
> & {
  fromNodeId?: string;
};

export function projectWorkflowExperimentSimulation(
  manifest: ExecutionPlanWorkflowManifest,
  request: CreateExecutionPlanWorkflowExperimentRequest,
): WorkflowSimulatedNode[] {
  if (request.mode !== "simulate_node") return [];
  const node = manifest.nodes.find(
    (candidate) => candidate.id === request.fromNodeId,
  );
  if (!node || request.simulatedOutput === undefined) {
    throw new Error("Workflow simulation output is required");
  }
  assertWorkflowValue(
    node.outputSchema,
    request.simulatedOutput,
    `Workflow simulated output ${node.id}`,
    MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES,
  );
  const output = structuredClone(request.simulatedOutput);
  const encoded = canonicalJson(output);
  return [
    {
      nodeId: node.id,
      output,
      outputSha256: sha256(encoded),
      outputBytes: Buffer.byteLength(encoded, "utf8"),
    },
  ];
}

export function createWorkflowExperimentPreview(input: {
  base: WorkflowExperimentPreviewBase;
  execution: WorkflowExperimentExecutionProjection;
  simulatedNodes: WorkflowSimulatedNode[];
  inputOverrides: WorkflowNodeInputOverride[];
  topLevelInputReplacement?: WorkflowTopLevelInputReplacement;
}): ExecutionPlanWorkflowExperimentPreview {
  if (
    (input.execution.mode === "simulate_node" &&
      input.simulatedNodes.length !== 1) ||
    (input.execution.mode !== "simulate_node" &&
      input.simulatedNodes.length !== 0)
  ) {
    throw new Error("Workflow experiment simulation projection is invalid");
  }
  if (
    (input.execution.mode === "replace_input" &&
      input.inputOverrides.length !== 1) ||
    (input.execution.mode !== "replace_input" &&
      input.inputOverrides.length !== 0)
  ) {
    throw new Error("Workflow experiment input override projection is invalid");
  }
  if (
    (input.execution.mode === "replace_workflow_input" &&
      input.topLevelInputReplacement === undefined) ||
    (input.execution.mode !== "replace_workflow_input" &&
      input.topLevelInputReplacement !== undefined)
  ) {
    throw new Error(
      "Workflow experiment top-level input projection is invalid",
    );
  }
  if (
    input.execution.mode === "replace_workflow_input"
      ? input.base.fromNodeId !== undefined
      : typeof input.base.fromNodeId !== "string"
  ) {
    throw new Error("Workflow experiment checkpoint projection is invalid");
  }
  const nodeBase = {
    ...input.base,
    fromNodeId: input.base.fromNodeId!,
  };
  const content =
    input.execution.mode === "single_node"
      ? {
          ...nodeBase,
          schemaVersion: 2 as const,
          mode: "single_node" as const,
          executionNodeIds: input.execution.executionNodeIds,
          stopBeforeNodeIds: input.execution.stopBeforeNodeIds,
        }
      : input.execution.mode === "step_nodes"
        ? {
            ...nodeBase,
            schemaVersion: 5 as const,
            mode: "step_nodes" as const,
            executionNodeIds: input.execution.executionNodeIds,
            stopBeforeNodeIds: input.execution.stopBeforeNodeIds,
          }
        : input.execution.mode === "simulate_node"
          ? {
              ...nodeBase,
              schemaVersion: 3 as const,
              mode: "simulate_node" as const,
              executionNodeIds: input.execution.executionNodeIds,
              simulatedNodeId: input.simulatedNodes[0]!.nodeId,
              simulatedOutputSha256: input.simulatedNodes[0]!.outputSha256,
              simulatedOutputBytes: input.simulatedNodes[0]!.outputBytes,
            }
          : input.execution.mode === "replace_input"
            ? {
                ...nodeBase,
                schemaVersion: 4 as const,
                mode: "replace_input" as const,
                executionNodeIds: input.execution.executionNodeIds,
                replacedInputNodeId: input.inputOverrides[0]!.nodeId,
                replacementInputSha256: input.inputOverrides[0]!.inputSha256,
                replacementInputBytes: input.inputOverrides[0]!.inputBytes,
              }
            : input.execution.mode === "replace_workflow_input"
              ? {
                  ...input.base,
                  schemaVersion: 6 as const,
                  mode: "replace_workflow_input" as const,
                  executionNodeIds: input.execution.executionNodeIds,
                  replacementWorkflowInputSha256:
                    input.topLevelInputReplacement!.inputSha256,
                  replacementWorkflowInputBytes:
                    input.topLevelInputReplacement!.inputBytes,
                }
              : {
                  ...nodeBase,
                  schemaVersion: 1 as const,
                };
  return {
    ...content,
    previewSha256: sha256(canonicalJson(content)),
  };
}
