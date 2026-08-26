import type {
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlanWorkflowExperimentMode,
  ExecutionPlanWorkflowManifest,
  JsonValue,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type { WorkflowNodeInputOverride } from "./workflow-context.js";
import {
  assertWorkflowJsonValue,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  workflowSchemaSha256,
} from "./workflow-schemas.js";

export const WORKFLOW_NODE_INPUT_REPLACEMENT_REQUESTED_EVENT =
  "workflow.node.input_replacement.requested" as const;

export function validateWorkflowExperimentReplacementInput(
  mode: ExecutionPlanWorkflowExperimentMode | undefined,
  value: unknown,
): JsonValue | undefined {
  if (
    (mode === "replace_input" && value === undefined) ||
    (mode !== "replace_input" && value !== undefined)
  ) {
    throw new Error(
      "Workflow experiment replacement input requires replace-input mode",
    );
  }
  if (value === undefined) return undefined;
  assertWorkflowJsonValue(
    value,
    "Workflow experiment replacement input",
    MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  );
  return structuredClone(value);
}

export function assertWorkflowInputReplacementPreview(
  preview: Record<string, unknown>,
  executionNodeIds: string[],
  rerunNodeIds: string[],
): void {
  if (preview["schemaVersion"] !== 4) return;
  if (
    preview["mode"] !== "replace_input" ||
    preview["replacedInputNodeId"] !== preview["fromNodeId"] ||
    canonicalJson(executionNodeIds) !== canonicalJson(rerunNodeIds) ||
    typeof preview["replacementInputSha256"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(preview["replacementInputSha256"]) ||
    !Number.isSafeInteger(preview["replacementInputBytes"]) ||
    Number(preview["replacementInputBytes"]) < 1 ||
    Number(preview["replacementInputBytes"]) >
      MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES
  ) {
    throw new Error("Workflow experiment node sets are invalid");
  }
}

export function projectWorkflowExperimentInputOverrides(
  manifest: ExecutionPlanWorkflowManifest,
  request: CreateExecutionPlanWorkflowExperimentRequest,
): WorkflowNodeInputOverride[] {
  if (request.mode !== "replace_input") return [];
  const node = manifest.nodes.find(
    (candidate) => candidate.id === request.fromNodeId,
  );
  if (!node || request.replacementInput === undefined) {
    throw new Error("Workflow replacement input is required");
  }
  assertWorkflowValue(
    node.inputSchema,
    request.replacementInput,
    `Workflow replacement input ${node.id}`,
    MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  );
  const input = structuredClone(request.replacementInput);
  const encoded = canonicalJson(input);
  return [
    {
      nodeId: node.id,
      input,
      inputSha256: sha256(encoded),
      inputBytes: Buffer.byteLength(encoded, "utf8"),
    },
  ];
}

export function workflowInputReplacementRequestPayload(input: {
  planId: string;
  manifestSha256: string;
  nodeId: string;
  replacementInput: JsonValue;
  replacementInputSha256: string;
  replacementInputBytes: number;
  inputSchemaSha256: string;
}): Record<string, JsonValue> {
  return {
    schemaVersion: 1,
    planId: input.planId,
    manifestSha256: input.manifestSha256,
    nodeId: input.nodeId,
    input: structuredClone(input.replacementInput),
    inputSha256: input.replacementInputSha256,
    inputBytes: input.replacementInputBytes,
    inputSchemaSha256: input.inputSchemaSha256,
  };
}

export function workflowInputReplacementRequestEvents(
  manifest: ExecutionPlanWorkflowManifest,
  planId: string,
  overrides: WorkflowNodeInputOverride[],
) {
  return overrides.map((override) => {
    const node = manifest.nodes.find(
      (candidate) => candidate.id === override.nodeId,
    );
    if (!node) {
      throw new Error("Workflow replacement input node is not in the Manifest");
    }
    return {
      type: WORKFLOW_NODE_INPUT_REPLACEMENT_REQUESTED_EVENT,
      category: "plan" as const,
      visibility: "hidden" as const,
      payload: workflowInputReplacementRequestPayload({
        planId,
        manifestSha256: manifest.contentSha256,
        nodeId: override.nodeId,
        replacementInput: override.input,
        replacementInputSha256: override.inputSha256,
        replacementInputBytes: override.inputBytes,
        inputSchemaSha256: workflowSchemaSha256(node.inputSchema),
      }),
    };
  });
}
