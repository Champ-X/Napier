import { canonicalJson } from "./ed25519.js";
import { assertWorkflowInputReplacementPreview } from "./workflow-input-override.js";
import { MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES } from "./workflow-schemas.js";
import { assertWorkflowTopLevelInputReplacementPreview } from "./workflow-top-level-input-override.js";

const RESOURCE_ID = /^[a-z][a-z0-9_-]{0,63}$/u;

export function workflowExperimentPreviewModeKeys(
  schemaVersion: unknown,
): readonly string[] {
  switch (schemaVersion) {
    case 2:
      return ["mode", "executionNodeIds", "stopBeforeNodeIds"];
    case 3:
      return [
        "mode",
        "executionNodeIds",
        "simulatedNodeId",
        "simulatedOutputSha256",
        "simulatedOutputBytes",
      ];
    case 4:
      return [
        "mode",
        "executionNodeIds",
        "replacedInputNodeId",
        "replacementInputSha256",
        "replacementInputBytes",
      ];
    case 5:
      return ["mode", "executionNodeIds", "stopBeforeNodeIds"];
    case 6:
      return [
        "mode",
        "executionNodeIds",
        "replacementWorkflowInputSha256",
        "replacementWorkflowInputBytes",
      ];
    default:
      return [];
  }
}

export function validWorkflowExperimentPreviewSchemaVersion(
  value: unknown,
): value is 1 | 2 | 3 | 4 | 5 | 6 {
  return (
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6
  );
}

export function workflowExperimentNodeIdList(
  input: unknown,
  label: string,
): string[] {
  if (
    !Array.isArray(input) ||
    input.length > 30 ||
    input.some(
      (value) => typeof value !== "string" || !RESOURCE_ID.test(value),
    ) ||
    new Set(input).size !== input.length
  ) {
    throw new Error(`Workflow experiment ${label} node IDs are invalid`);
  }
  return [...input] as string[];
}

export function validateWorkflowExperimentPreviewMode(
  preview: Record<string, unknown>,
  rerunNodeIds: string[],
): {
  executionNodeIds: string[];
  stopBeforeNodeIds: string[];
  toolEffectNodeIds: string[];
} {
  const schemaVersion = preview["schemaVersion"];
  const executionNodeIds =
    schemaVersion === 1
      ? rerunNodeIds
      : workflowExperimentNodeIdList(preview["executionNodeIds"], "execution");
  const stopBeforeNodeIds =
    schemaVersion === 2 || schemaVersion === 5
      ? workflowExperimentNodeIdList(
          preview["stopBeforeNodeIds"],
          "stop-before",
        )
      : [];
  if (
    (schemaVersion === 2 &&
      (preview["mode"] !== "single_node" ||
        canonicalJson(executionNodeIds) !==
          canonicalJson([preview["fromNodeId"]]) ||
        stopBeforeNodeIds.length > 16 ||
        stopBeforeNodeIds.includes(String(preview["fromNodeId"])) ||
        stopBeforeNodeIds.some((nodeId) => !rerunNodeIds.includes(nodeId)))) ||
    (schemaVersion === 5 &&
      (preview["mode"] !== "step_nodes" ||
        canonicalJson(executionNodeIds) !==
          canonicalJson([preview["fromNodeId"]]) ||
        stopBeforeNodeIds.length > 16 ||
        canonicalJson(stopBeforeNodeIds) !==
          canonicalJson(
            rerunNodeIds.filter(
              (nodeId) => nodeId !== String(preview["fromNodeId"]),
            ),
          ))) ||
    (schemaVersion === 3 &&
      (preview["mode"] !== "simulate_node" ||
        preview["simulatedNodeId"] !== preview["fromNodeId"] ||
        executionNodeIds.includes(String(preview["fromNodeId"])) ||
        executionNodeIds.some((nodeId) => !rerunNodeIds.includes(nodeId)) ||
        !hash(preview["simulatedOutputSha256"]) ||
        !positiveInteger(preview["simulatedOutputBytes"]) ||
        Number(preview["simulatedOutputBytes"]) >
          MAX_EXECUTION_PLAN_WORKFLOW_NODE_OUTPUT_BYTES))
  ) {
    throw new Error("Workflow experiment node sets are invalid");
  }
  assertWorkflowInputReplacementPreview(
    preview,
    executionNodeIds,
    rerunNodeIds,
  );
  assertWorkflowTopLevelInputReplacementPreview(
    preview,
    executionNodeIds,
    rerunNodeIds,
  );
  return {
    executionNodeIds,
    stopBeforeNodeIds,
    toolEffectNodeIds: schemaVersion === 5 ? rerunNodeIds : executionNodeIds,
  };
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
