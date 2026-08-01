import type {
  CreateExecutionPlanWorkflowExperimentRequest,
  ExecutionPlanWorkflowExperimentMode,
  ExecutionPlanWorkflowManifest,
  JsonValue,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertWorkflowJsonValue,
  assertWorkflowValue,
  MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
} from "./workflow-schemas.js";

export interface WorkflowTopLevelInputReplacement {
  input: JsonValue;
  inputSha256: string;
  inputBytes: number;
}

export function validateWorkflowExperimentReplacementWorkflowInput(
  mode: ExecutionPlanWorkflowExperimentMode | undefined,
  value: unknown,
): JsonValue | undefined {
  if (
    (mode === "replace_workflow_input" && value === undefined) ||
    (mode !== "replace_workflow_input" && value !== undefined)
  ) {
    throw new Error(
      "Workflow experiment replacement Workflow input requires replace-workflow-input mode",
    );
  }
  if (value === undefined) return undefined;
  assertWorkflowJsonValue(
    value,
    "Workflow experiment replacement Workflow input",
    MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  );
  return structuredClone(value);
}

export function projectWorkflowExperimentTopLevelInputReplacement(
  manifest: ExecutionPlanWorkflowManifest,
  request: CreateExecutionPlanWorkflowExperimentRequest,
): WorkflowTopLevelInputReplacement | undefined {
  if (request.mode !== "replace_workflow_input") return undefined;
  if (request.replacementWorkflowInput === undefined) {
    throw new Error("Workflow replacement Workflow input is required");
  }
  assertWorkflowValue(
    manifest.inputSchema,
    request.replacementWorkflowInput,
    "Workflow replacement Workflow input",
    MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES,
  );
  const input = structuredClone(request.replacementWorkflowInput);
  const encoded = canonicalJson(input);
  return {
    input,
    inputSha256: sha256(encoded),
    inputBytes: Buffer.byteLength(encoded, "utf8"),
  };
}

export function assertWorkflowTopLevelInputReplacementPreview(
  preview: Record<string, unknown>,
  executionNodeIds: string[],
  rerunNodeIds: string[],
): void {
  if (preview["schemaVersion"] !== 6) return;
  if (
    preview["mode"] !== "replace_workflow_input" ||
    preview["fromNodeId"] !== undefined ||
    canonicalJson(executionNodeIds) !== canonicalJson(rerunNodeIds) ||
    typeof preview["replacementWorkflowInputSha256"] !== "string" ||
    !/^[a-f0-9]{64}$/u.test(preview["replacementWorkflowInputSha256"]) ||
    !Number.isSafeInteger(preview["replacementWorkflowInputBytes"]) ||
    Number(preview["replacementWorkflowInputBytes"]) < 1 ||
    Number(preview["replacementWorkflowInputBytes"]) >
      MAX_EXECUTION_PLAN_WORKFLOW_VALUE_BYTES
  ) {
    throw new Error("Workflow experiment node sets are invalid");
  }
}
